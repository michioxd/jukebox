import { LitElement, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { keyed } from "lit/directives/keyed.js";
import { repeat } from "lit/directives/repeat.js";
import type { MdOutlinedSelect } from "@material/web/select/outlined-select.js";
import type { MdOutlinedTextField } from "@material/web/textfield/outlined-text-field.js";
import "@material/web/icon/icon.js";
import "@material/web/iconbutton/icon-button.js";
import "@material/web/list/list.js";
import "@material/web/list/list-item.js";
import "@material/web/select/outlined-select.js";
import "@material/web/select/select-option.js";
import "@material/web/textfield/outlined-text-field.js";
import "@material/web/progress/circular-progress.js";
import "@material/web/button/outlined-button.js";
import type { Library, Track, TrackLocation } from "../library.ts";
import { icon, time } from "./presentation.ts";

const PAGE_SIZE = 50;
const noTracks: readonly Track[] = [];

@customElement("jukebox-library")
export class LibraryView extends LitElement {
    @property({ attribute: false }) library?: Library;
    @property({ attribute: false }) current?: Track;
    @property({ attribute: false }) sharedTrack?: TrackLocation;
    @property() error = "";
    @property({ type: Boolean }) playbackAvailable = true;
    @state() private categoryIndex = 0;
    @state() private versionIndex = 0;
    @state() private query = "";
    @state() private page = 0;

    protected willUpdate(changed: Map<PropertyKey, unknown>) {
        const target = this.sharedTrack;
        if (changed.has("sharedTrack") && target) {
            this.categoryIndex = target.categoryIndex;
            this.versionIndex = target.versionIndex;
            this.query = "";
            this.page = Math.floor(target.trackIndex / PAGE_SIZE);
        }
    }

    protected updated(changed: Map<PropertyKey, unknown>) {
        if (changed.has("sharedTrack") && this.sharedTrack) {
            const row = this.renderRoot.querySelector("md-list-item.current");
            if (row) {
                if (import.meta.env.LEGACY && "scrollIntoViewIfNeeded" in row) {
                    (row as HTMLElement & { scrollIntoViewIfNeeded(center: boolean): void }).scrollIntoViewIfNeeded(
                        false,
                    );
                } else {
                    row.scrollIntoView({ block: "nearest" });
                }
            }
        }
    }

    private choose(event: Event, categoryChanged: boolean) {
        const index = Number((event.currentTarget as MdOutlinedSelect | HTMLSelectElement).value);
        if (categoryChanged) {
            this.categoryIndex = index;
            this.versionIndex = 0;
        } else {
            this.versionIndex = index;
        }
        this.query = "";
        this.turnPage(0);
    }

    private turnPage(page: number) {
        this.page = page;
        this.dispatchEvent(new CustomEvent("reset-scroll", { bubbles: true }));
    }

    private filterTracks(event: Event) {
        this.query = (event.currentTarget as MdOutlinedTextField | HTMLInputElement).value;
        this.turnPage(0);
    }

    protected render() {
        const categories = this.library?.categories ?? [];
        const category = categories[this.categoryIndex];
        const versions = category?.versions ?? [];
        const version = versions[this.versionIndex];
        const tracks = version?.tracks ?? noTracks;
        const query = this.query.trim().toLowerCase();
        const matches: number[] = [];
        tracks.forEach((track, index) => {
            if (!query || `${track.name} ${track.type}`.toLowerCase().includes(query)) matches.push(index);
        });
        const first = this.page * PAGE_SIZE;
        const last = Math.min(first + PAGE_SIZE, matches.length);

        return html`
            <header>
                <span class="total">${tracks.length} ${tracks.length === 1 ? "track" : "tracks"}</span>
            </header>
            ${
                this.error
                    ? html`<div class="message" role="alert">${this.error}</div>
                          <md-outlined-button class="retry" @click=${() => this.dispatchEvent(new Event("retry-index"))}
                              >Retry</md-outlined-button
                          >`
                    : !this.library
                      ? html`<div class="message loading" role="status">
                            <md-circular-progress indeterminate aria-label="Loading library"></md-circular-progress>
                            Loading library...
                        </div>`
                      : !categories.length
                        ? html`<p class="message">No categories in this library.</p>`
                        : html` <nav aria-label="Library collection">
                                  ${
                                      import.meta.env.LEGACY
                                          ? html`
                                                <label
                                                    >Category
                                                    <select @change=${(event: Event) => this.choose(event, true)}>
                                                        ${categories.map((entry, index) => html`<option value=${index} .selected=${index === this.categoryIndex}>${entry.name}</option>`)}
                                                    </select>
                                                </label>
                                                <label
                                                    >Version
                                                    <select
                                                        ?disabled=${!versions.length}
                                                        @change=${(event: Event) => this.choose(event, false)}
                                                    >
                                                        ${versions.map((entry, index) => html`<option value=${index} .selected=${index === this.versionIndex}>${entry.name}</option>`)}
                                                    </select>
                                                </label>
                                            `
                                          : html`<md-outlined-select
                                                    label="Category"
                                                    .value=${String(this.categoryIndex)}
                                                    clamp-menu-width
                                                    ?quick=${matchMedia("(prefers-reduced-motion: reduce)").matches}
                                                    @change=${(event: Event) => this.choose(event, true)}
                                                >
                                                    ${categories.map(
                                                        (entry, index) =>
                                                            html`<md-select-option value=${index}>
                                                                <span slot="headline"
                                                                    >${entry.name}</span
                                                                ></md-select-option
                                                            >`,
                                                    )}
                                                </md-outlined-select>
                                                ${keyed(
                                                    category,
                                                    html`<md-outlined-select
                                                        label="Version"
                                                        .value=${versions.length ? String(this.versionIndex) : ""}
                                                        ?disabled=${!versions.length}
                                                        clamp-menu-width
                                                        ?quick=${matchMedia("(prefers-reduced-motion: reduce)").matches}
                                                        @change=${(event: Event) => this.choose(event, false)}
                                                    >
                                                        ${versions.map(
                                                            (entry, index) =>
                                                                html`<md-select-option value=${index}>
                                                                    <span slot="headline"
                                                                        >${entry.name}</span
                                                                    ></md-select-option
                                                                >`,
                                                        )}
                                                    </md-outlined-select>`,
                                                )}`
                                  }
                                  ${
                                      tracks.length > PAGE_SIZE
                                          ? import.meta.env.LEGACY
                                              ? html`<label class="native-filter"
                                                    >Filter tracks
                                                    <input
                                                        type="search"
                                                        .value=${this.query}
                                                        @input=${this.filterTracks}
                                                    />
                                                </label>`
                                              : html` <md-outlined-text-field
                                                    type="search"
                                                    label="Filter tracks"
                                                    .value=${this.query}
                                                    @input=${this.filterTracks}
                                                    >${icon("search", "leading-icon")}</md-outlined-text-field
                                                >`
                                          : nothing
                                  }
                              </nav>
                              <div class="list-heading" aria-hidden="true"><span>TRACK</span><span>LENGTH</span></div>
                              <div class="tracks">
                                  ${
                                      !versions.length
                                          ? html`<p class="message">No versions in this category.</p>`
                                          : !tracks.length
                                            ? html`<p class="message">No tracks in this version.</p>`
                                            : !matches.length
                                              ? html`<p class="message" role="status">No tracks match your filter.</p>`
                                              : html` <md-list aria-label="Tracks in ${version?.name}">
                                                    ${repeat(
                                                        matches.slice(first, last),
                                                        (index) => tracks[index],
                                                        (index) => {
                                                            const track = tracks[index];
                                                            const active = track === this.current;
                                                            return html`<md-list-item
                                                                type="button"
                                                                class=${active ? "current" : ""}
                                                                ?disabled=${!this.playbackAvailable}
                                                                aria-current=${active ? "true" : "false"}
                                                                @click=${() =>
                                                                    this.dispatchEvent(
                                                                        new CustomEvent("choose-track", {
                                                                            detail: {
                                                                                tracks,
                                                                                index,
                                                                                collection: `${category.name} / ${version?.name}`,
                                                                            },
                                                                        }),
                                                                    )}
                                                            >
                                                                <span class="track-index" slot="start"
                                                                    >${active ? icon("play") : String(index + 1).padStart(2, "0")}</span
                                                                >
                                                                <span class="track-name" slot="headline"
                                                                    >${track.name}</span
                                                                >
                                                                <span class="track-type" slot="supporting-text"
                                                                    >${track.type}</span
                                                                >
                                                                <span class="track-end" slot="end"
                                                                    >${track.loop ? html`<span title="Loop available" role="img" aria-label="Loop available">${icon("repeat")}</span>` : nothing}
                                                                    <span class="duration"
                                                                        >${time(track.duration)}</span
                                                                    ></span
                                                                >
                                                            </md-list-item>`;
                                                        },
                                                    )}
                                                </md-list>`
                                  }
                              </div>
                              ${
                                  matches.length > PAGE_SIZE
                                      ? html`<footer aria-label="Track pages">
                                            <span role="status">${first + 1}-${last} of ${matches.length}</span>
                                            <md-icon-button
                                                aria-label="Previous page"
                                                ?disabled=${first === 0}
                                                @click=${() => this.turnPage(this.page - 1)}
                                                >${icon("left")}</md-icon-button
                                            >
                                            <md-icon-button
                                                aria-label="Next page"
                                                ?disabled=${last === matches.length}
                                                @click=${() => this.turnPage(this.page + 1)}
                                                >${icon("right")}</md-icon-button
                                            >
                                        </footer>`
                                      : nothing
                              }`
            }
        `;
    }

    protected override createRenderRoot() {
        return this;
    }
}
