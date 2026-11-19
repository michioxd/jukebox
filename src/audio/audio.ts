import { LOOP_COUNTS, normalizeLoop, planPlayback, playbackPosition } from "./loop.ts";
import type { LoopRegion, PlaybackPlan } from "./loop.ts";
import { isPlaybackSpeed, loadPlaybackSettings, storePlaybackSettings } from "../helper/playback-settings.ts";
import type { PlaybackSettings } from "../helper/playback-settings.ts";
import type { PitchProcessor } from "./pitch.ts";

export type AudioState = "idle" | "loading" | "playing" | "paused" | "interrupted" | "ended" | "error";

const CONTEXT_ERROR = "Web Audio is unavailable in this browser.";
const RESUME_ERROR = "Playback was blocked. Select Play to allow audio.";
const PLAYBACK_ERROR = "Could not start audio playback.";
const SPEED_FADE = 0.015;

interface ActivePlayback {
    plan: PlaybackPlan;
    start: number;
    speed: number;
    jumpsUsed: number;
    output: GainNode;
    sources: Set<AudioScheduledSourceNode>;
    pitch?: AudioWorkletNode;
}

async function fetchAudio(urls: readonly string[], signal: AbortSignal): Promise<ArrayBuffer> {
    try {
        for (const url of urls) {
            if (signal.aborted) throw new DOMException("Audio download aborted.", "AbortError");
            const response = await fetch(url, { signal });
            if (
                response.status === 404 ||
                (response.ok && /^text\/html\b/i.test(response.headers.get("content-type") ?? ""))
            ) {
                // Release the rejected response before trying the next candidate.
                void response.body?.cancel().catch(() => {});
                continue;
            }
            if (!response.ok) {
                void response.body?.cancel().catch(() => {});
                throw new Error(`Could not download audio (HTTP ${response.status}).`);
            }
            return await response.arrayBuffer();
        }
    } catch (error) {
        if (error instanceof TypeError) throw new Error("Could not download audio. Check your connection.");
        throw error;
    }
    throw new Error("Audio file not found.");
}

export class AudioEngine extends EventTarget {
    private context: AudioContext | undefined;
    private gain: GainNode | undefined;
    private buffer: AudioBuffer | undefined;
    private request: AbortController | undefined;
    private disposed = false;
    private wantsPlayback = false;
    private playRevision = 0;
    private currentState: AudioState = "idle";
    private message = "";
    private region: LoopRegion | undefined;
    private offset = 0;
    private jumpsUsed = 0;
    private settings = loadPlaybackSettings();
    private starting = false;
    private active?: ActivePlayback;
    private outgoing?: ActivePlayback;
    private fadeClock?: AudioScheduledSourceNode;

    get state(): AudioState {
        return this.currentState;
    }
    get error(): string {
        return this.message;
    }
    get position(): number {
        return this.active ? this.progress().position : this.offset;
    }
    get duration(): number {
        return this.buffer?.duration ?? 0;
    }
    get loop(): LoopRegion | undefined {
        return this.region ? { ...this.region } : undefined;
    }
    get loopCount(): number {
        return this.settings.loopCount;
    }
    get volume(): number {
        return this.settings.volume;
    }
    get muted(): boolean {
        return this.settings.muted;
    }
    get speed(): number {
        return this.settings.speed;
    }
    get preservePitch(): boolean {
        return this.settings.preservePitch;
    }
    get canPreservePitch(): boolean {
        return globalThis.isSecureContext && typeof AudioWorkletNode === "function";
    }

    async load(
        urls: readonly string[],
        loop?: LoopRegion,
        mode: "play" | "shared" | "restore" = "play",
        position = 0,
    ): Promise<void> {
        if (this.disposed) return;
        this.request?.abort();
        const request = new AbortController();
        this.request = request;
        this.resetTransport();
        this.wantsPlayback = mode !== "restore";
        this.buffer = undefined;
        this.region = undefined;
        this.offset = position;
        this.jumpsUsed = 0;
        this.message = "";
        try {
            const context = this.openContext();
            // Issue resume in the user's activation, not after network or decoding work.
            let resumeFailed = false;
            const revision = this.playRevision;
            if (this.wantsPlayback)
                void this.resumeContext(context).then((resumed) => {
                    if (resumed || request.signal.aborted) return;
                    resumeFailed = true;
                    if (this.state === "interrupted" && this.active && this.playRevision === revision) {
                        this.message = RESUME_ERROR;
                        this.notify();
                    }
                });
            this.updateState("loading");
            const bytes = await fetchAudio(urls, request.signal);
            if (request.signal.aborted) return;
            let buffer: AudioBuffer;
            try {
                // Older Chrome requires callbacks; handle the returned promise when present too.
                buffer = import.meta.env.LEGACY
                    ? await new Promise<AudioBuffer>((resolve, reject) => {
                          void context.decodeAudioData(bytes, resolve, reject)?.catch(reject);
                      })
                    : await context.decodeAudioData(bytes);
            } catch {
                throw new Error("Could not decode audio. The format may be unsupported or the file damaged.");
            }
            if (request.signal.aborted) return;
            this.buffer = buffer;
            this.region = normalizeLoop(loop, buffer.duration, buffer.sampleRate);
            this.offset = Math.min(this.offset, buffer.duration);
            if (this.wantsPlayback) {
                // A browser can leave resume() pending until a user gesture.
                if (mode === "shared" && context.state !== "running") {
                    this.updateState("paused");
                    return;
                }
                if (resumeFailed && context.state !== "running") throw new Error(RESUME_ERROR);
                this.startPlayback();
            } else {
                this.updateState("paused");
            }
        } catch (error) {
            if (!request.signal.aborted) this.fail(error instanceof Error ? error.message : PLAYBACK_ERROR);
        } finally {
            if (this.request === request) this.request = undefined;
        }
    }

    async play(): Promise<void> {
        const context = this.context;
        if (this.disposed || !context || this.state === "playing") return;
        if (this.state === "loading") {
            this.wantsPlayback = true;
            void this.resumeContext(context);
            return;
        }
        if (!this.buffer) return;
        const revision = ++this.playRevision;
        const resumed = await this.resumeContext(context);
        if (revision !== this.playRevision) return;
        if (!resumed) {
            if (this.active) {
                this.message = RESUME_ERROR;
                this.updateState("interrupted");
            } else {
                this.fail(RESUME_ERROR);
            }
            return;
        }
        this.message = "";
        if (this.active) {
            this.syncContextState();
            return;
        }
        if (this.offset >= this.duration) {
            this.offset = 0;
            this.jumpsUsed = 0;
        }
        this.startPlayback();
    }

    setPlaybackSettings({ speed, preservePitch }: Pick<PlaybackSettings, "speed" | "preservePitch">): void {
        if (this.disposed || !isPlaybackSpeed(speed) || (this.speed === speed && this.preservePitch === preservePitch))
            return;
        this.settings.speed = speed;
        this.settings.preservePitch = preservePitch;
        storePlaybackSettings(this.settings);
        if (this.active || this.starting) this.startPlayback();
        else this.notify();
    }

    pause(): void {
        if (this.disposed) return;
        this.wantsPlayback = false;
        this.playRevision++;
        if (this.starting) {
            this.starting = false;
            this.updateState("paused");
            return;
        }
        if (!this.active) return;
        this.capturePosition();
        this.stopSources();
        this.message = "";
        this.updateState("paused");
    }

    seek(position: number): void {
        if (this.disposed || !this.buffer || !Number.isFinite(position) || this.state === "loading") return;
        const resume = Boolean(this.active);
        this.resetTransport();
        this.offset = Math.max(0, Math.min(position, this.duration));
        this.jumpsUsed = 0;
        this.message = "";
        if (resume && this.offset < this.duration) this.startPlayback();
        else this.updateState("paused");
    }

    setLoopCount(count: number): void {
        if (this.disposed || count === this.loopCount || !LOOP_COUNTS.includes(count)) return;
        this.settings.loopCount = count;
        storePlaybackSettings(this.settings);
        if (!this.active || !this.region) {
            this.notify();
            return;
        }
        const progress = this.progress();
        if (progress.position >= this.region.end) {
            // The outro has no future jump to change; keep its natural EOF scheduled.
            this.notify();
            return;
        }
        this.offset = progress.position;
        this.jumpsUsed = progress.jumps;
        this.stopSources();
        this.startPlayback();
    }

    setVolume(value: number): void {
        if (this.disposed || !Number.isFinite(value)) return;
        const volume = Math.max(0, Math.min(value, 1));
        if (volume === this.volume) return;
        this.settings.volume = volume;
        storePlaybackSettings(this.settings);
        this.updateGain();
        this.notify();
    }

    toggleMute(): void {
        if (this.disposed) return;
        this.settings.muted = !this.muted;
        storePlaybackSettings(this.settings);
        this.updateGain();
        this.notify();
    }

    dispose(): void {
        if (this.disposed) return;
        this.disposed = true;
        this.request?.abort();
        this.request = undefined;
        this.resetTransport();
        if (this.context) {
            this.context.removeEventListener("statechange", this.syncContextState);
            this.gain?.disconnect();
            void this.context.close().catch(() => {});
        }
        this.context = undefined;
        this.gain = undefined;
        this.buffer = undefined;
        this.region = undefined;
        this.offset = 0;
        this.message = "";
        this.updateState("idle");
    }

    private openContext(): AudioContext {
        // A closed context cannot be resumed; a new load must use a fresh one.
        if (this.context && this.context.state !== "closed") return this.context;
        this.context?.removeEventListener("statechange", this.syncContextState);
        this.gain?.disconnect();
        this.context = undefined;
        this.gain = undefined;
        try {
            this.context = new AudioContext();
            this.gain = this.context.createGain();
            this.gain.connect(this.context.destination);
            this.updateGain();
            this.context.addEventListener("statechange", this.syncContextState);
            return this.context;
        } catch {
            if (this.context) void this.context.close().catch(() => {});
            this.context = undefined;
            this.gain = undefined;
            throw new Error(CONTEXT_ERROR);
        }
    }

    private async resumeContext(context: AudioContext): Promise<boolean> {
        try {
            if (context.state !== "running") await context.resume();
            return context.state === "running";
        } catch {
            return false;
        }
    }

    private syncContextState = (): void => {
        if (!this.active || !this.context) return;
        if (this.context.state === "closed") {
            this.fail(CONTEXT_ERROR);
        } else if (this.context.state === "running") {
            this.message = "";
            this.updateState("playing");
        } else {
            this.updateState("interrupted");
        }
    };

    private startPlayback(): void {
        if (this.outgoing) {
            // Finish the audible handoff before applying another committed change.
            this.notify();
            return;
        }
        const previous = this.active;
        const speed = this.speed;
        const needsPitch = speed !== 1 && this.preservePitch && this.canPreservePitch;
        const revision = previous || this.starting || needsPitch ? ++this.playRevision : this.playRevision;
        if (previous?.speed === speed && Boolean(previous.pitch) === needsPitch) {
            this.notify();
            return;
        }
        this.starting = !previous && needsPitch;
        if (!needsPitch) {
            this.schedulePlayback();
            return;
        }
        const context = this.context!;
        const { numberOfChannels } = this.buffer!;
        if (previous) this.notify();
        else this.updateState("loading");
        // Only load the optional worklet on browsers and settings that use it.
        void import("./pitch.ts")
            .then(({ createPitchProcessor }) => createPitchProcessor(context, numberOfChannels, speed))
            .then((pitch) => {
                if (revision !== this.playRevision || this.active !== previous) {
                    pitch.node.port.close();
                    return;
                }
                this.starting = false;
                this.schedulePlayback(pitch);
            })
            .catch(() => {
                if (revision === this.playRevision && this.active === previous)
                    this.fail("Could not preserve pitch. Turn off Preserve pitch and try again.");
            });
    }

    private schedulePlayback(pitch?: PitchProcessor): void {
        const context = this.context!;
        const buffer = this.buffer!;
        const previous = this.active;
        // Give every source a shared origin; align the old and new audible positions, including worklet latency.
        const start = Math.ceil((context.currentTime + 0.02) * context.sampleRate) / context.sampleRate;
        const audibleStart = start + (pitch?.latency ?? 0);
        const handoff = previous ? this.positionAt(previous, audibleStart) : undefined;
        if (handoff && handoff.position >= buffer.duration) {
            // Let the natural end advance the queue instead of replaying the last sample.
            pitch?.node.port.close();
            this.notify();
            return;
        }
        const jumpsUsed = handoff?.jumps ?? this.jumpsUsed;
        // Keep a seek just before a loop boundary on that side of the boundary.
        const offset = handoff?.position ?? this.offset;
        const frame = Math.min(buffer.length - 1, Math.floor(offset * buffer.sampleRate + 1e-8));
        const plan = planPlayback(frame / buffer.sampleRate, this.duration, this.region, this.loopCount - jumpsUsed);
        const sources = new Set<AudioScheduledSourceNode>();
        const speed = this.speed;
        const output = context.createGain();
        if (previous) output.gain.value = 0;
        const active = { plan, start: audibleStart, speed, jumpsUsed, output, sources, pitch: pitch?.node };
        this.active = active;
        this.outgoing = previous;
        try {
            output.connect(this.gain!);
            const destination = pitch?.node ?? output;
            if (pitch) {
                pitch.node.addEventListener(
                    "processorerror",
                    () => {
                        if (this.active === active)
                            this.fail("Could not preserve pitch. Turn off Preserve pitch and try again.");
                    },
                    { once: true },
                );
                pitch.node.connect(output);
            }
            const finish = () => {
                if (this.active !== active) return;
                this.stopSources();
                this.offset = this.duration;
                const revision = this.playRevision;
                this.updateState("ended");
                if (!this.disposed && this.state === "ended" && revision === this.playRevision) {
                    this.dispatchEvent(new Event("ended"));
                }
            };
            for (const [index, segment] of plan.segments.entries()) {
                const source = context.createBufferSource();
                sources.add(source);
                source.buffer = buffer;
                source.playbackRate.value = speed;
                source.connect(destination);
                const last = index === plan.segments.length - 1;
                source.onended = () => {
                    if (!sources.delete(source)) return;
                    source.onended = null;
                    source.disconnect();
                    if (last && !pitch) finish();
                };
                if (segment.loop) {
                    source.loop = true;
                    source.loopStart = segment.loop.start;
                    source.loopEnd = segment.loop.end;
                }
                const when = start + segment.at / speed;
                if (last) source.start(when, segment.offset);
                else source.start(when, segment.offset, segment.duration);
            }
            const last = plan.segments[plan.segments.length - 1];
            if (pitch && Number.isFinite(last.duration)) {
                // A silent source marks the end of the delayed output on the audio clock.
                const marker = context.createConstantSource();
                marker.offset.value = 0;
                sources.add(marker);
                marker.connect(this.gain!);
                marker.onended = finish;
                marker.start(start);
                marker.stop(active.start + (last.at + last.duration) / speed);
            }
            if (previous) {
                const fadeEnd = audibleStart + SPEED_FADE;
                output.gain.setValueAtTime(0, audibleStart);
                output.gain.linearRampToValueAtTime(1, fadeEnd);
                previous.output.gain.setValueAtTime(1, audibleStart);
                previous.output.gain.linearRampToValueAtTime(0, fadeEnd);
                // An unconnected source ends on the audio clock even if the page's timers are throttled.
                const clock = (this.fadeClock = context.createOscillator());
                clock.start(start);
                clock.onended = () => {
                    this.fadeClock = undefined;
                    this.finishFade();
                    const needsPitch = this.speed !== 1 && this.preservePitch && this.canPreservePitch;
                    if (this.speed !== speed || needsPitch !== Boolean(pitch)) {
                        this.startPlayback();
                    }
                };
                clock.stop(fadeEnd);
            }
            this.syncContextState();
        } catch {
            this.fail(PLAYBACK_ERROR);
        }
    }

    private progress(): { position: number; jumps: number } {
        const now = this.context!.currentTime;
        const active = this.active!;
        return this.positionAt(now < active.start && this.outgoing ? this.outgoing : active, now);
    }

    private positionAt(active: ActivePlayback, time: number): { position: number; jumps: number } {
        const progress = playbackPosition(active.plan, (time - active.start) * active.speed);
        progress.jumps += active.jumpsUsed;
        return progress;
    }

    private capturePosition(): void {
        const progress = this.progress();
        this.offset = progress.position;
        this.jumpsUsed = progress.jumps;
    }

    private stopSources(): void {
        const active = this.active;
        this.active = undefined;
        this.finishFade();
        if (active) this.disposePlayback(active);
    }

    private finishFade(): void {
        if (this.fadeClock) {
            this.fadeClock.onended = null;
            try {
                this.fadeClock.stop();
            } catch {
                // The clock may already have ended or failed to start.
            }
            this.fadeClock = undefined;
        }
        if (this.outgoing) this.disposePlayback(this.outgoing);
        this.outgoing = undefined;
    }

    private disposePlayback(active: ActivePlayback): void {
        for (const source of active.sources) {
            source.onended = null;
            try {
                source.stop();
            } catch {
                /* A partially configured source may not have started. */
            }
            source.disconnect();
        }
        active.sources.clear();
        active.pitch?.disconnect();
        active.pitch?.port.close();
        active.output.disconnect();
    }

    private resetTransport(): void {
        this.playRevision++;
        this.starting = false;
        this.stopSources();
    }

    private updateGain(): void {
        if (this.gain) this.gain.gain.value = this.muted ? 0 : this.volume;
    }

    private notify(): void {
        this.dispatchEvent(new Event("change"));
    }

    private updateState(state: AudioState): void {
        this.currentState = state;
        this.notify();
    }

    private fail(message: string): void {
        this.resetTransport();
        this.message = message;
        this.updateState("error");
    }
}
