import { html } from "lit";

const symbols = {
    note: "M12 3v10.55A4 4 0 1 0 14 17V7h4V3h-6Z",
    library:
        "M20 2H6c-1.1 0-2 .9-2 2v14h2V4h14V2Zm-2 4H10c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2Zm-1 5h-2v5.5a2.5 2.5 0 1 1-2-2.45V9h4v2Z",
    play: "M8 5v14l11-7Z",
    pause: "M6 5h4v14H6Zm8 0h4v14h-4Z",
    previous: "M6 6h2v12H6Zm3.5 6 8.5 6V6Z",
    next: "M6 18l8.5-6L6 6Zm10-12h2v12h-2Z",
    repeat: "M7 7h11v3l4-4-4-4v3H5v6h2Zm10 10H6v-3l-4 4 4 4v-3h13v-6h-2Z",
    speed: "M12 4a10 10 0 0 0-8.66 15H6a8 8 0 1 1 12 0h2.66A10 10 0 0 0 12 4Zm5.4 4.6-6.8 4.8a2 2 0 1 0 2.8 2.8l4-7.6Z",
    link: "M7 7h4v2H7a3 3 0 0 0 0 6h4v2H7A5 5 0 0 1 7 7Zm6 0h4a5 5 0 0 1 0 10h-4v-2h4a3 3 0 0 0 0-6h-4ZM8 11h8v2H8Z",
    volume: "M3 9v6h4l5 5V4L7 9H3Zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05A4.49 4.49 0 0 0 16.5 12ZM14 3.23v2.06A7 7 0 0 1 14 18.71v2.06a9 9 0 0 0 0-17.54Z",
    mute: "M3 9v6h4l5 5V4L7 9H3Zm12.41-.41L18 11.17l2.59-2.58L22 10l-2.59 2.59L22 15.17l-1.41 1.42L18 14l-2.59 2.59L14 15.17l2.59-2.58L14 10Z",
    search: "M15.5 14h-.79l-.28-.27a6.5 6.5 0 1 0-.71.71l.28.27v.79l5 4.99L20.49 19Zm-5 0a4.5 4.5 0 1 1 0-9 4.5 4.5 0 0 1 0 9Z",
    left: "M15.41 7.41 14 6l-6 6 6 6 1.41-1.41L10.83 12Z",
    right: "M8.59 16.59 10 18l6-6-6-6-1.41 1.41L13.17 12Z",
} as const;

export function icon(name: keyof typeof symbols, slot?: string) {
    return html`<md-icon slot=${slot ?? ""}
        ><svg viewBox="0 0 24 24" width="100%" height="100%" aria-hidden="true">
            <path fill="currentColor" d=${symbols[name]}></path>
        </svg>
    </md-icon>`;
}

export function time(seconds: number | undefined, precise = false): string {
    if (seconds === undefined) return "--:--";
    const units = precise ? Math.round(seconds * 1000) : Math.floor(seconds);
    const whole = precise ? Math.floor(units / 1000) : units;
    return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}${precise ? `.${String(units % 1000).padStart(3, "0")}` : ""}`;
}
