import { LitElement, html, nothing } from "lit";
import { customElement, state } from "lit/decorators.js";
import { AudioEngine } from "./audio/audio.ts";
import { findSharedTrack, loadLibrary } from "./library.ts";
import type { Library, Track, TrackLocation } from "./library.ts";
import { adjacentTrack } from "./helper/queue.ts";
import "@material/web/button/text-button.js";
import "@material/web/dialog/dialog.js";
import "./components/library-view.ts";
import "./components/player-view.ts";

interface Selection {
    tracks: readonly Track[];
    index: number;
    collection: string;
}

const LAST_TRACK_KEY = "jukebox.last-track";
const indexUrl = import.meta.env.VITE_INDEX_URL || `https://jukeboxgek.michioxd.ch/gek/index.json`;
const assetBase = import.meta.env.VITE_AUDIO_BASE_URL || undefined;

@customElement("jukebox-app")
export class JukeboxApp extends LitElement {
    @state() private library?: Library;
    @state() private indexError = "";
    @state() private selection?: Selection;
    @state() private revision = 0;
    @state() private sharedTrack?: TrackLocation;
    @state() private linkError = "";
    @state() private autoplayPrompt = false;
    private savedPosition = "";
    private engine = new AudioEngine();
    private request?: AbortController;
    private readonly audioSupported = typeof AudioContext === "function";

    connectedCallback() {
        super.connectedCallback();
        this.engine.addEventListener("change", this.audioChanged);
        this.engine.addEventListener("ended", this.advance);
        window.addEventListener("hashchange", this.openSharedTrack);
        window.addEventListener("pagehide", this.savePosition);
        document.addEventListener("visibilitychange", this.saveWhenHidden);
        if (!this.library) void this.readLibrary();
        else this.restoreSelection();
    }

    disconnectedCallback() {
        this.savePosition();
        window.removeEventListener("hashchange", this.openSharedTrack);
        window.removeEventListener("pagehide", this.savePosition);
        document.removeEventListener("visibilitychange", this.saveWhenHidden);
        this.request?.abort();
        this.engine.removeEventListener("change", this.audioChanged);
        this.engine.removeEventListener("ended", this.advance);
        this.engine.dispose();
        this.engine = new AudioEngine();
        this.selection = undefined;
        this.sharedTrack = undefined;
        this.autoplayPrompt = false;
        super.disconnectedCallback();
    }

    private audioChanged = () => {
        this.revision++;
        this.savePosition();
    };
    private advance = () => {
        this.move(1);
    };

    private async readLibrary() {
        this.request?.abort();
        const request = new AbortController();
        this.request = request;
        this.indexError = "";
        try {
            const library = await loadLibrary(indexUrl, assetBase, request.signal);
            if (!request.signal.aborted) {
                this.library = library;
                this.restoreSelection();
            }
        } catch (error) {
            if (!request.signal.aborted) {
                this.indexError =
                    error instanceof TypeError
                        ? "Could not reach the library index. Check your connection and try again."
                        : error instanceof Error
                          ? error.message
                          : "Could not open the library index.";
            }
        } finally {
            if (this.request === request) this.request = undefined;
        }
    }

    private select(selection: Selection, mode: "play" | "shared" | "restore" = "play", position = 0) {
        this.autoplayPrompt = false;
        this.selection = selection;
        if (!this.audioSupported) return;
        const track = selection.tracks[selection.index];
        void this.engine.load(track.urls, track.loop, mode, position).then(() => {
            if (mode === "shared" && this.selection === selection && this.engine.state === "paused") {
                this.autoplayPrompt = true;
            }
        });
    }

    private openSharedTrack = () => {
        if (!this.library || !location.hash) return;
        const target = findSharedTrack(this.library, location.hash);
        const url = new URL(location.href);
        url.hash = "";
        history.replaceState(history.state, "", url);
        this.linkError = target ? "" : "This shared track is not in the library.";
        if (target) this.selectLocation(target, "shared");
    };

    private playSharedTrack() {
        this.autoplayPrompt = false;
        void this.engine.play();
    }

    private selectLocation(target: TrackLocation, mode: "shared" | "restore", position = 0) {
        this.sharedTrack = target;
        this.select(
            {
                tracks: target.version.tracks,
                index: target.trackIndex,
                collection: `${target.category.name} / ${target.version.name}`,
            },
            mode,
            position,
        );
    }

    private restoreSelection() {
        if (location.hash) {
            this.openSharedTrack();
            if (this.selection) return;
        }
        if (!this.library) return;
        try {
            const saved: unknown = JSON.parse(localStorage.getItem(LAST_TRACK_KEY) ?? "null");
            if (!saved || typeof saved !== "object" || !("uuid" in saved) || typeof saved.uuid !== "string") return;
            const target = findSharedTrack(this.library, `#${saved.uuid}`);
            if (target) {
                const seconds = "position" in saved ? saved.position : undefined;
                const position = typeof seconds === "number" && Number.isFinite(seconds) && seconds > 0 ? seconds : 0;
                this.selectLocation(target, "restore", position);
            }
        } catch {
            /* Invalid or unavailable storage does not prevent browsing. */
        }
    }

    private saveWhenHidden = () => {
        if (document.visibilityState === "hidden") this.savePosition();
    };

    private savePosition = () => {
        const queue = this.selection;
        if (!queue || !this.audioSupported) return;
        const snapshot = JSON.stringify({ uuid: queue.tracks[queue.index].uuid, position: this.engine.position });
        if (snapshot === this.savedPosition) return;
        try {
            localStorage.setItem(LAST_TRACK_KEY, snapshot);
            this.savedPosition = snapshot;
        } catch {
            /* Playback is available without storage. */
        }
    };

    private move(direction: -1 | 1) {
        const selection = this.selection;
        if (!selection) return;
        const index = adjacentTrack(selection.index, selection.tracks.length, direction);
        if (index !== undefined) this.select({ ...selection, index });
    }

    private transport(event: CustomEvent<"previous" | "next" | "toggle">) {
        if (event.detail === "previous") this.move(-1);
        if (event.detail === "next") this.move(1);
        if (event.detail === "toggle" && this.selection) {
            if (this.engine.state === "playing") this.engine.pause();
            else if (this.engine.state === "error") this.select(this.selection, "play", this.engine.position);
            else void this.engine.play();
        }
    }

    protected render() {
        const queue = this.selection;
        const track = queue?.tracks[queue.index];
        return html` <header class="bar">
                <h1>michioxd's random jukebox</h1>
            </header>
            ${!this.audioSupported ? html`<p class="compat" role="alert">Web Audio is unavailable. You can browse the library, but playback requires a browser with Web Audio.</p>` : nothing}
            ${this.linkError ? html`<p class="compat" role="status">${this.linkError}</p>` : nothing}
            <main
                aria-label="Library"
                tabindex="0"
                @reset-scroll=${(event: Event) => {
                    (event.currentTarget as HTMLElement).scrollTop = 0;
                }}
            >
                <jukebox-library
                    aria-label="Library"
                    .library=${this.library}
                    .error=${this.indexError}
                    .current=${track}
                    .sharedTrack=${this.sharedTrack}
                    .playbackAvailable=${this.audioSupported}
                    @retry-index=${this.readLibrary}
                    @choose-track=${(event: CustomEvent<Selection>) => this.select(event.detail)}
                ></jukebox-library>
                <p class="info" role="contentinfo">
                    made with <a href="https://lit.dev" target="_blank" rel="noopener noreferrer">lit</a> +
                    <a
                        href="https://github.com/material-components/material-web"
                        target="_blank"
                        rel="noopener noreferrer"
                        >material web components</a
                    >. available on
                    <a href="https://github.com/michioxd/jukebox" target="_blank" rel="noopener noreferrer">github</a>.
                </p>
            </main>
            <footer class="dock" aria-label="Audio player">
                <jukebox-player
                    .engine=${this.engine}
                    .track=${track}
                    .collection=${queue?.collection ?? ""}
                    .canPlay=${!!track && this.audioSupported}
                    .revision=${this.revision}
                    .previous=${!!queue && adjacentTrack(queue.index, queue.tracks.length, -1) !== undefined}
                    .next=${!!queue && adjacentTrack(queue.index, queue.tracks.length, 1) !== undefined}
                    @transport=${this.transport}
                ></jukebox-player>
            </footer>
            <md-dialog
                .open=${this.autoplayPrompt}
                ?quick=${import.meta.env.LEGACY}
                @cancel=${() => {
                    this.autoplayPrompt = false;
                }}
            >
                <div slot="headline">Play shared track?</div>
                <div slot="content">Your browser needs a click to play ${track?.name ?? "this track"}.</div>
                <div slot="actions">
                    <md-text-button
                        @click=${() => {
                            this.autoplayPrompt = false;
                        }}
                        >Not now</md-text-button
                    >
                    <md-text-button autofocus @click=${this.playSharedTrack}>Play</md-text-button>
                </div>
            </md-dialog>`;
    }

    protected override createRenderRoot() {
        return this;
    }

    protected override firstUpdated() {
        this.querySelector(".startup")?.remove();
    }
}
