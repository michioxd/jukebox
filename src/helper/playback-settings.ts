import { LOOP_COUNTS } from "../audio/loop.ts";

export const PLAYBACK_SETTINGS_KEY = "jukebox.playback-settings";
export const MIN_SPEED = 0.4;
export const MAX_SPEED = 2;

export function isPlaybackSpeed(value: unknown): value is number {
    return typeof value === "number" && value >= MIN_SPEED && value <= MAX_SPEED;
}

export interface PlaybackSettings {
    speed: number;
    preservePitch: boolean;
    volume: number;
    muted: boolean;
    loopCount: number;
}

export function parsePlaybackSettings(text: string | null): PlaybackSettings {
    let value: unknown;
    try {
        value = text === null ? undefined : JSON.parse(text);
    } catch {
        /* Use defaults. */
    }
    const settings = value && typeof value === "object" ? value : {};
    const speed = "speed" in settings ? settings.speed : 1;
    const volume = "volume" in settings ? settings.volume : 1;
    const loopCount = "loopCount" in settings ? settings.loopCount : Infinity;
    return {
        speed: isPlaybackSpeed(speed) ? speed : 1,
        preservePitch: !("preservePitch" in settings) || settings.preservePitch !== false,
        volume: typeof volume === "number" && volume >= 0 && volume <= 1 ? volume : 1,
        muted: "muted" in settings && settings.muted === true,
        loopCount: typeof loopCount === "number" && LOOP_COUNTS.includes(loopCount) ? loopCount : Infinity,
    };
}

export function loadPlaybackSettings(): PlaybackSettings {
    try {
        return parsePlaybackSettings(localStorage.getItem(PLAYBACK_SETTINGS_KEY));
    } catch {
        return parsePlaybackSettings(null);
    }
}

export function storePlaybackSettings(settings: PlaybackSettings): void {
    try {
        // JSON stores Infinity as null; the parser restores it as unlimited repeats.
        localStorage.setItem(PLAYBACK_SETTINGS_KEY, JSON.stringify(settings));
    } catch {
        /* Playback still works when storage is blocked. */
    }
}
