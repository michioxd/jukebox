export function adjacentTrack(index: number, count: number, direction: -1 | 1): number | undefined {
    const next = index + direction;
    return index >= 0 && index < count && next >= 0 && next < count ? next : undefined;
}
