import { LitElement, html, nothing } from "lit";
import { customElement, property, query, state } from "lit/decorators.js";
import { styleMap } from "lit/directives/style-map.js";
import { html as staticHtml, literal } from "lit/static-html.js";
import type { MdDialog } from "@material/web/dialog/dialog.js";
import type { MdSwitch } from "@material/web/switch/switch.js";
import type { MdSlider } from "@material/web/slider/slider.js";
import "@lit-material/tooltip";
import "@material/web/button/text-button.js";
import "@material/web/dialog/dialog.js";
import "@material/web/icon/icon.js";
import "@material/web/iconbutton/filled-icon-button.js";
import "@material/web/iconbutton/icon-button.js";
import "@material/web/progress/circular-progress.js";
import "@material/web/switch/switch.js";
import "@material/web/slider/slider.js";
import type { AudioEngine } from "../audio/audio.ts";
import type { Track } from "../library.ts";
import { LOOP_COUNTS } from "../audio/loop.ts";
import { MAX_SPEED, MIN_SPEED } from "../helper/playback-settings.ts";
import { icon, time } from "./presentation.ts";

const supportsTooltip = typeof HTMLElement.prototype.showPopover === "function";
const sliderTag = import.meta.env.LEGACY ? literal`input` : literal`md-slider`;

function sliderValue(event: Event): number | undefined {
    const slider = event.currentTarget as MdSlider | HTMLInputElement;
    return slider instanceof HTMLInputElement ? slider.valueAsNumber : slider.value;
}

@customElement("jukebox-player")
export class PlayerView extends LitElement {
    @property({ attribute: false }) engine?: AudioEngine;
    @property({ attribute: false }) track?: Track;
    @property() collection = "";
    @property({ type: Boolean }) canPlay = false;
    @property({ type: Boolean }) previous = false;
    @property({ type: Boolean }) next = false;
    @property({ type: Number }) revision = 0;
    @state() private scrub?: number;
    @state() private speedDraft?: number;
    @state() private dismissedError = "";
    @state() private shareNotice = "";
    @state() private manualLink = "";
    @query("#settings-dialog") private settingsDialog!: MdDialog;
    @query("#share-dialog") private shareDialog!: MdDialog;
    private frame = 0;
    private lastTick = 0;

    protected updated(changed: Map<PropertyKey, unknown>) {
        if (changed.has("track")) this.scrub = undefined;
        if (!this.engine?.error) this.dismissedError = "";
        if (!this.frame && this.engine?.state === "playing" && this.isConnected) {
            this.frame = requestAnimationFrame(this.tick);
        }
    }

    private async copyTrackLink() {
        const track = this.track;
        if (!track) return;
        const url = new URL(location.href);
        url.hash = track.uuid;
        try {
            await navigator.clipboard.writeText(url.href);
            this.shareNotice = "Track link copied.";
        } catch {
            if (!this.isConnected) return;
            this.manualLink = url.href;
            void this.shareDialog.show();
        }
    }

    private commitSpeed(speed: number | undefined) {
        this.speedDraft = undefined;
        const engine = this.engine;
        if (engine && speed !== undefined) engine.setPlaybackSettings({ speed, preservePitch: engine.preservePitch });
    }

    disconnectedCallback() {
        cancelAnimationFrame(this.frame);
        this.frame = 0;
        super.disconnectedCallback();
    }

    private tick = (now: number) => {
        this.frame = 0;
        if (this.engine?.state !== "playing") return;
        if (now - this.lastTick >= 80) {
            if (this.scrub === undefined) this.requestUpdate();
            this.lastTick = now;
        }
        this.frame = requestAnimationFrame(this.tick);
    };

    protected render() {
        const engine = this.engine;
        const state = engine?.state ?? "idle";
        const playing = state === "playing";
        const loading = state === "loading";
        const duration = engine?.duration || this.track?.duration;
        const playable = (engine?.duration ?? 0) > 0;
        const position = this.scrub ?? engine?.position ?? 0;
        const loop = playable ? engine?.loop : this.track?.loop;
        const marked = loop && duration && duration > 0 ? loop : undefined;
        const loopStart = marked && duration ? (marked.start / duration) * 100 : 0;
        const loopWidth = marked && duration ? ((marked.end - marked.start) / duration) * 100 : 0;
        const playLabel = loading ? "Loading audio" : playing ? "Pause" : state === "error" ? "Retry playback" : "Play";
        const error = engine?.error ?? "";
        const showError = error !== "" && error !== this.dismissedError;
        const muted = engine?.muted ?? false;
        const repeatCount = engine?.loopCount === Infinity ? "Unlimited" : engine?.loopCount;
        const repeatHelp = `Change how many times the loop repeats after the first pass. Current: ${repeatCount}.`;

        return staticHtml` <div class="timeline">
                <div class=${import.meta.env.LEGACY ? "seek native-seek" : "seek"}>
                    ${
                        marked
                            ? html`<div class="loop-band" aria-hidden="true">
                                  <span style=${styleMap({ left: `${loopStart}%`, width: `${loopWidth}%` })}></span>
                              </div>`
                            : nothing
                    }
                    <${sliderTag}
                        type="range"
                        aria-label="Seek"
                        aria-valuetext="${time(position)} of ${time(duration)}"
                        .max=${duration ? Math.ceil(duration * 10) / 10 : 1}
                        step="0.1"
                        .value=${position}
                        ?disabled=${!playable || loading}
                        @input=${(event: Event) => {
                            this.scrub = sliderValue(event);
                        }}
                        @change=${(event: Event) => {
                            const value = sliderValue(event);
                            if (value !== undefined) engine?.seek(value);
                            this.scrub = undefined;
                        }}
                        @pointercancel=${() => {
                            this.scrub = undefined;
                        }}
                    ></${sliderTag}>
                </div>
                <span class="time" aria-hidden="true">${time(position)}</span>
                <span class="time" aria-hidden="true">${time(duration)}</span>
                ${marked ? html`<div class="loop-legend">${icon("repeat")} <span>${time(marked.start, true)} - ${time(marked.end, true)}</span></div>` : nothing}
            </div>
            <div class="track-copy">
                <h2>${this.track?.name ?? "No track selected"}</h2>
                ${this.track ? html`<p class="metadata">${this.collection} / ${this.track.type.toUpperCase()}</p>` : nothing}
            </div>
            <div class="transport" role="group" aria-label="Playback">
                <md-icon-button
                    aria-label="Previous track"
                    ?disabled=${!this.previous}
                    @click=${() => this.command("previous")}
                    >${icon("previous")}</md-icon-button
                >
                <md-filled-icon-button
                    aria-label=${playLabel}
                    ?disabled=${!this.canPlay || loading}
                    @click=${() => this.command("toggle")}
                    >${loading ? html`<md-circular-progress indeterminate aria-hidden="true"></md-circular-progress>` : icon(playing ? "pause" : "play")}</md-filled-icon-button
                >
                <md-icon-button aria-label="Next track" ?disabled=${!this.next} @click=${() => this.command("next")}
                    >${icon("next")}</md-icon-button
                >
            </div>
            <div class="options">
                <div class="volume" role="group" aria-label="Volume controls">
                    <md-icon-button aria-label=${muted ? "Unmute" : "Mute"} @click=${() => engine?.toggleMute()}
                        >${icon(muted || engine?.volume === 0 ? "mute" : "volume")}</md-icon-button
                    >
                    <${sliderTag}
                        type="range"
                        aria-label="Volume"
                        aria-valuetext="${Math.round((engine?.volume ?? 1) * 100)}%"
                        max="100"
                        .value=${(engine?.volume ?? 1) * 100}
                        @input=${(event: Event) => {
                            const value = sliderValue(event);
                            if (value !== undefined) engine?.setVolume(value / 100);
                        }}
                    ></${sliderTag}>
                </div>
                <md-icon-button
                    id="playback-settings-button"
                    aria-label="Playback settings"
                    aria-haspopup="dialog"
                    title=${supportsTooltip ? "" : "Playback speed and pitch"}
                    @click=${() => this.settingsDialog.show()}
                    >${icon("speed")}</md-icon-button
                >
                ${supportsTooltip ? html`<lit-material-tooltip anchor="playback-settings-button">Playback speed and pitch</lit-material-tooltip>` : nothing}
                ${
                    this.track
                        ? html`
                              <md-icon-button
                                  id="copy-track-link"
                                  aria-label="Copy track link"
                                  title=${supportsTooltip ? "" : "Copy track link"}
                                  @click=${this.copyTrackLink}
                              >
                                  ${icon("link")}
                              </md-icon-button>
                              ${supportsTooltip ? html`<lit-material-tooltip anchor="copy-track-link">Copy track link</lit-material-tooltip>` : nothing}
                          `
                        : nothing
                }
                ${
                    loop && engine
                        ? html`<md-icon-button
                                  id="repeat-button"
                                  class="repeat"
                                  aria-label=${`Change extra repeats. Current: ${repeatCount}.`}
                                  title=${supportsTooltip ? "" : repeatHelp}
                                  @click=${() => {
                                      const current = LOOP_COUNTS.findIndex((count) => count === engine.loopCount);
                                      engine.setLoopCount(LOOP_COUNTS[(current + 1) % LOOP_COUNTS.length]);
                                  }}
                                  >${icon("repeat")}</md-icon-button
                              >${supportsTooltip ? html`<lit-material-tooltip anchor="repeat-button">${repeatHelp}</lit-material-tooltip>` : nothing}`
                        : nothing
                }
            </div>
            <md-dialog
                id="settings-dialog"
                ?quick=${import.meta.env.LEGACY}
                @closed=${() => {
                    this.speedDraft = undefined;
                }}
            >
                <div slot="headline">Playback settings</div>
                <div slot="content" class="playback-settings">
                    <div class="speed-setting">
                        <div class="setting-label"><span>Playback speed</span><span>${this.speedDraft ?? engine?.speed ?? 1}x</span></div>
                        <${sliderTag}
                            type="range"
                            aria-label="Playback speed"
                            aria-valuetext=${`${this.speedDraft ?? engine?.speed ?? 1} times`}
                            .min=${MIN_SPEED}
                            .max=${MAX_SPEED}
                            step="0.01"
                            .value=${this.speedDraft ?? engine?.speed ?? 1}
                            @input=${(event: Event) => {
                                this.speedDraft = sliderValue(event);
                            }}
                            @change=${(event: Event) => this.commitSpeed(sliderValue(event))}
                            @pointercancel=${() => {
                                this.speedDraft = undefined;
                            }}
                        ></${sliderTag}>
                    </div>
                    <label class="pitch-setting">
                        Preserve pitch
                        <md-switch
                            aria-label="Preserve pitch"
                            .selected=${!!(engine?.preservePitch && engine.canPreservePitch)}
                            ?disabled=${!engine?.canPreservePitch}
                            @change=${(event: Event) => {
                                if (engine)
                                    engine.setPlaybackSettings({
                                        speed: engine.speed,
                                        preservePitch: (event.currentTarget as MdSwitch).selected,
                                    });
                            }}
                        ></md-switch>
                    </label>
                    ${engine?.canPreservePitch ? nothing : html`<p>Pitch preservation requires AudioWorklet and a secure connection.</p>`}
                </div>
                <div slot="actions">
                    <md-text-button
                        ?disabled=${!engine || (engine.speed === 1 && (this.speedDraft ?? 1) === 1)}
                        @click=${() => this.commitSpeed(1)}
                        >Reset</md-text-button
                    >
                    <md-text-button @click=${() => this.settingsDialog.close()}>Done</md-text-button>
                </div>
            </md-dialog>
            <md-dialog id="share-dialog" ?quick=${import.meta.env.LEGACY}>
                <div slot="headline">Share track</div>
                <label slot="content"
                    >Copy this link:
                    <input
                        class="share-url"
                        readonly
                        aria-label="Track link"
                        .value=${this.manualLink}
                        @focus=${(event: Event) => (event.currentTarget as HTMLInputElement).select()}
                        autofocus
                    />
                </label>
                <div slot="actions"><md-text-button @click=${() => this.shareDialog.close()}>Done</md-text-button></div>
            </md-dialog>
            ${
                showError || this.shareNotice
                    ? html`
                          <div class="snackbar">
                              ${showError ? html`<span role="alert">${error}</span>` : html`<span role="status">${this.shareNotice}</span>`}
                              <md-text-button
                                  @click=${() => {
                                      if (showError) this.dismissedError = error;
                                      else this.shareNotice = "";
                                  }}
                                  >Dismiss</md-text-button
                              >
                          </div>
                      `
                    : nothing
            }`;
    }

    private command(command: "previous" | "next" | "toggle") {
        this.dispatchEvent(new CustomEvent("transport", { detail: command }));
    }

    protected override createRenderRoot() {
        return this;
    }
}
