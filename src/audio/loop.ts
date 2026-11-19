export type LoopRegion = { start: number; end: number };
export type LoopCount = number;
export const LOOP_COUNTS = [1, 2, 3, 5, 10, Infinity] as const;

export type PlaybackSegment = {
    offset: number;
    at: number;
    duration: number;
    loop?: LoopRegion;
};

export type PlaybackPlan = {
    segments: readonly PlaybackSegment[];
    duration: number;
};

export function normalizeLoop(
    loop: LoopRegion | undefined,
    duration: number,
    sampleRate: number,
): LoopRegion | undefined {
    if (
        !loop ||
        !Number.isFinite(duration) ||
        duration <= 0 ||
        !Number.isFinite(sampleRate) ||
        sampleRate <= 0 ||
        !Number.isFinite(loop.start) ||
        !Number.isFinite(loop.end) ||
        loop.start < 0
    ) {
        return undefined;
    }
    const start = Math.round(loop.start * sampleRate);
    const end = Math.round(loop.end * sampleRate);
    if (end <= start || end > Math.round(duration * sampleRate)) return undefined;
    return { start: start / sampleRate, end: end / sampleRate };
}

export function planPlayback(
    offset: number,
    duration: number,
    loop: LoopRegion | undefined,
    repeats: number,
): PlaybackPlan {
    offset = Math.max(0, Math.min(offset, duration));
    if (offset === duration) return { segments: [], duration };
    if (!loop || offset >= loop.end || !(repeats >= 1)) {
        return { segments: [{ offset, at: 0, duration: duration - offset }], duration };
    }
    if (repeats === Infinity) {
        return { segments: [{ offset, at: 0, duration: Infinity, loop }], duration };
    }

    const first = loop.end - offset;
    const length = loop.end - loop.start;
    const count = Math.floor(repeats);
    const segments: PlaybackSegment[] = [{ offset, at: 0, duration: first }];
    for (let jump = 1; jump <= count; jump++) {
        segments.push({
            offset: loop.start,
            at: first + (jump - 1) * length,
            duration: jump === count ? duration - loop.start : length,
        });
    }
    return { segments, duration };
}

export function playbackPosition(plan: PlaybackPlan, elapsed: number): { position: number; jumps: number } {
    elapsed = Math.max(0, elapsed);
    const { segments, duration } = plan;
    const first = segments[0];
    if (!first) return { position: duration, jumps: 0 };
    // Treat roundoff from subtracting two clock timestamps as the boundary itself.
    const epsilon = 8 * Number.EPSILON * Math.max(1, elapsed, duration);
    if (first.loop) {
        const { start, end } = first.loop;
        const afterFirst = elapsed - (end - first.offset);
        if (afterFirst < -epsilon) return { position: first.offset + elapsed, jumps: 0 };
        const length = end - start;
        const laps = Math.floor((afterFirst + epsilon) / length);
        return { position: start + Math.max(0, afterFirst - laps * length), jumps: laps + 1 };
    }
    let jumps = segments.length - 1;
    while (jumps > 0 && elapsed + epsilon < segments[jumps].at) jumps--;
    const segment = segments[jumps];
    return { position: Math.min(duration, segment.offset + Math.max(0, elapsed - segment.at)), jumps };
}
