import { validate as isUuid, v5 } from "uuid";

export interface Track {
    uuid: string;
    name: string;
    type: string;
    urls: readonly string[];
    metadata?: Readonly<Record<string, unknown>>;
    highlight?: boolean;
    duration?: number;
    loop?: { start: number; end: number };
}

export interface Category {
    name: string;
    versions: readonly Version[];
}

export interface Version {
    name: string;
    tracks: readonly Track[];
}

export interface Library {
    categories: readonly Category[];
}

export interface TrackLocation {
    categoryIndex: number;
    versionIndex: number;
    trackIndex: number;
    category: Category;
    version: Version;
}

export function findSharedTrack(library: Library, hash: string): TrackLocation | undefined {
    const uuid = hash.slice(1).toLowerCase();
    if (!hash.startsWith("#") || !isUuid(uuid)) return;
    for (const [categoryIndex, category] of library.categories.entries()) {
        for (const [versionIndex, version] of category.versions.entries()) {
            const trackIndex = version.tracks.findIndex((track) => track.uuid === uuid);
            if (trackIndex !== -1) return { categoryIndex, versionIndex, trackIndex, category, version };
        }
    }
}

function objectValue(value: unknown): Record<string, unknown> | undefined {
    return typeof value === "object" && value !== null && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : undefined;
}

function record(value: unknown, field: string): Record<string, unknown> {
    const object = objectValue(value);
    if (!object) throw new Error(`${field} must be an object.`);
    return object;
}

function list(value: unknown, field: string): unknown[] {
    if (!Array.isArray(value)) throw new Error(`${field} must be an array.`);
    return value;
}

function nonempty(value: unknown, field: string): string {
    if (typeof value !== "string" || !value.trim()) throw new Error(`${field} must be a nonempty string.`);
    return value;
}

function httpUrl(value: string, base: string | URL | undefined, field: string): URL {
    let url: URL;
    try {
        url = new URL(value, base);
    } catch {
        throw new Error(`${field} must resolve to a valid HTTP(S) URL.`);
    }
    if ((url.protocol !== "https:" && url.protocol !== "http:") || url.username || url.password) {
        throw new Error(`${field} must use HTTP(S) without credentials.`);
    }
    return url;
}

function assetDirectory(index: URL, override: string | undefined, basePath: unknown): URL {
    const field = override === undefined ? "index.base_path" : "Asset base override";
    const value = override ?? basePath;
    if (value === undefined) return new URL(".", index);
    const base = httpUrl(nonempty(value, field), index, field);
    if (base.search || base.hash) throw new Error(`${field} must not include a query or fragment.`);
    if (!base.pathname.endsWith("/")) base.pathname += "/";
    return base;
}

function pathSegment(segment: string): string | undefined {
    if (!segment.trim() || segment === "." || segment === ".." || /[\\/:\x00-\x1f\x7f]|%(?:2e|2f|5c|25)/i.test(segment))
        return undefined;
    try {
        return encodeURIComponent(segment);
    } catch {
        return undefined;
    }
}

function relativePath(value: unknown, field: string): string {
    const segments = nonempty(value, field).split("/").map(pathSegment);
    if (segments.includes(undefined)) throw new Error(`${field} must be a safe relative asset path.`);
    return segments.join("/");
}

function timestamp(seconds: unknown, samples: unknown, rate: unknown): number | undefined {
    const fromSeconds = typeof seconds === "number" && Number.isFinite(seconds) && seconds >= 0 ? seconds : undefined;
    if (
        typeof samples !== "number" ||
        !Number.isSafeInteger(samples) ||
        samples < 0 ||
        typeof rate !== "number" ||
        !Number.isFinite(rate) ||
        rate <= 0
    )
        return fromSeconds;
    const fromSamples = samples / rate;
    // The index rounds timestamps to microseconds; use the sample clock when both agree.
    return Number.isFinite(fromSamples) && (fromSeconds === undefined || Math.abs(fromSamples - fromSeconds) <= 1e-6)
        ? fromSamples
        : fromSeconds;
}

function addTiming(track: Track, metadata: Record<string, unknown>): void {
    const rate = metadata.sample_rate;
    const duration = timestamp(
        metadata.duration_seconds === 0 ? undefined : metadata.duration_seconds,
        metadata.total_samples,
        rate,
    );
    if (duration !== undefined && duration > 0) track.duration = duration;
    const loop = objectValue(metadata.loop);
    if (loop?.enabled !== true) return;
    const start = timestamp(loop.start_seconds, loop.start_sample, rate);
    const end = timestamp(loop.end_seconds, loop.end_sample, rate);
    if (
        start !== undefined &&
        end !== undefined &&
        end > start &&
        (track.duration === undefined || end <= track.duration)
    )
        track.loop = { start, end };
}

export function parseIndex(text: string, indexUrl: string, assetBase?: string): Library {
    let parsed: unknown;
    try {
        parsed = JSON.parse(text);
    } catch {
        throw new Error("Unavailable right now. The library index is not valid JSON.");
    }
    const root = record(parsed, "index");
    const index = httpUrl(indexUrl, globalThis.location?.href, "Index URL");
    const base = assetDirectory(index, assetBase, root.base_path);

    const uuids = new Set<string>();
    return {
        categories: list(root.items, "index.items").map((item, categoryIndex) => {
            const at = `index.items[${categoryIndex}]`;
            const category = record(item, at);
            return {
                name: nonempty(category.name, `${at}.name`),
                versions: list(category.items, `${at}.items`).map((item, versionIndex) => {
                    const atVersion = `${at}.items[${versionIndex}]`;
                    const version = record(item, atVersion);
                    const versionPath = relativePath(version.path, `${atVersion}.path`);
                    const directory = new URL(`${versionPath}/`, base);
                    return {
                        name: nonempty(version.name, `${atVersion}.name`),
                        tracks: list(version.audio, `${atVersion}.audio`).map((item, trackIndex) => {
                            const atTrack = `${atVersion}.audio[${trackIndex}]`;
                            const entry = record(item, atTrack);
                            const path = entry.path === undefined ? "file" : "path";
                            const filename = relativePath(entry[path], `${atTrack}.${path}`);
                            const type = nonempty(entry.type, `${atTrack}.type`);
                            const urls = [new URL(filename, directory).href];
                            const folder = pathSegment(type);
                            if (!filename.includes("/") && folder !== undefined) {
                                urls.push(new URL(`${folder}/${filename}`, directory).href);
                            }
                            const field = `${atTrack}.uuid`;
                            const uuid =
                                entry.uuid === undefined
                                    ? v5(JSON.stringify([versionPath, filename]), v5.URL)
                                    : nonempty(entry.uuid, field).toLowerCase();
                            if (!isUuid(uuid)) throw new Error(`${field} must be a valid UUID.`);
                            if (uuids.has(uuid)) throw new Error(`${field} duplicates another track UUID.`);
                            uuids.add(uuid);
                            const track: Track = { uuid, name: nonempty(entry.name, `${atTrack}.name`), type, urls };
                            const metadata = objectValue(entry.metadata);
                            if (metadata) {
                                track.metadata = metadata;
                                addTiming(track, metadata);
                            }
                            return track;
                        }),
                    };
                }),
            };
        }),
    };
}

export async function loadLibrary(
    indexUrl: string,
    assetBase: string | undefined,
    signal: AbortSignal,
): Promise<Library> {
    const url = httpUrl(indexUrl, globalThis.location?.href, "Index URL");
    const response = await fetch(url, { signal });
    if (!response.ok) throw new Error(`Could not load the library index (HTTP ${response.status}).`);
    return parseIndex(await response.text(), response.url || url.href, assetBase);
}
