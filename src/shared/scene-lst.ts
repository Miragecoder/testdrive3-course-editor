export const SCENE_LST_SIZE = 1638;
export const COURSE_NAME_OFFSET = 0x0000;
export const COURSE_NAME_MAX = 18; // chars, plus null terminator at +18
export const ROUTE_NAMES_OFFSET = 0x0058;
export const ROUTE_NAME_COUNT = 36;
export const ROUTE_NAME_SIZE = 12;
export const UI_STRINGS_OFFSET = 0x03D6;
export const UI_STRINGS_SIZE = 250;

export interface SceneLstStrings {
    courseName: string;
    routeNames: string[];
    uiStrings: string[];
}

function readCString(data: Uint8Array, offset: number, maxLen: number): string {
    let end = offset;
    const limit = offset + maxLen;
    while (end < limit && data[end] !== 0) end++;
    return new TextDecoder('latin1').decode(data.slice(offset, end));
}

function readFixedField(data: Uint8Array, offset: number, size: number): string {
    const bytes = data.slice(offset, offset + size);
    let end = bytes.length;
    while (end > 0 && (bytes[end - 1] === 0 || bytes[end - 1] === 0x20)) end--;
    return new TextDecoder('latin1').decode(bytes.slice(0, end)).trim();
}

export function readSceneLstStrings(data: Uint8Array): SceneLstStrings {
    if (data.length !== SCENE_LST_SIZE) {
        throw new Error(`Expected a ${SCENE_LST_SIZE}-byte scene LST file.`);
    }
    const courseName = readCString(data, COURSE_NAME_OFFSET, COURSE_NAME_MAX + 1).trim();
    const routeNames: string[] = [];
    for (let i = 0; i < ROUTE_NAME_COUNT; i++) {
        routeNames.push(readFixedField(data, ROUTE_NAMES_OFFSET + i * ROUTE_NAME_SIZE, ROUTE_NAME_SIZE));
    }
    const uiStrings: string[] = [];
    let current = '';
    for (let i = 0; i < UI_STRINGS_SIZE; i++) {
        const byte = data[UI_STRINGS_OFFSET + i];
        if (byte === 0xAA) {
            uiStrings.push(current);
            current = '';
            continue;
        }
        if (byte === 0x00) {
            const restZero = data.slice(UI_STRINGS_OFFSET + i, UI_STRINGS_OFFSET + UI_STRINGS_SIZE).every((b) => b === 0);
            if (restZero) break;
            uiStrings.push(current);
            current = '';
            continue;
        }
        current += String.fromCharCode(byte);
    }
    if (current.length > 0) uiStrings.push(current);
    return { courseName, routeNames, uiStrings };
}

export function writeCourseName(data: Uint8Array, name: string): void {
    const bytes = new TextEncoder().encode(name);
    if (bytes.length > COURSE_NAME_MAX) {
        throw new RangeError(`Course name must be at most ${COURSE_NAME_MAX} characters.`);
    }
    data.fill(0, COURSE_NAME_OFFSET, COURSE_NAME_OFFSET + COURSE_NAME_MAX + 1);
    data.set(bytes, COURSE_NAME_OFFSET);
}

export function writeRouteName(data: Uint8Array, index: number, name: string): void {
    if (!Number.isInteger(index) || index < 0 || index >= ROUTE_NAME_COUNT) {
        throw new RangeError(`Route index must be between 0 and ${ROUTE_NAME_COUNT - 1}.`);
    }
    const bytes = new TextEncoder().encode(name);
    if (bytes.length > ROUTE_NAME_SIZE) {
        throw new RangeError(`Route names must be at most ${ROUTE_NAME_SIZE} characters.`);
    }
    const offset = ROUTE_NAMES_OFFSET + index * ROUTE_NAME_SIZE;
    data.fill(0x20, offset, offset + ROUTE_NAME_SIZE);
    data.set(bytes, offset);
}

export function writeUiStrings(data: Uint8Array, strings: string[]): void {
    const encoded: number[] = [];
    for (let i = 0; i < strings.length; i++) {
        const value = strings[i];
        for (let j = 0; j < value.length; j++) {
            const code = value.charCodeAt(j);
            if (code === 0 || code === 0xAA || code > 0xFF) {
                throw new RangeError('UI strings may only contain printable 8-bit characters.');
            }
            encoded.push(code);
        }
        if (i < strings.length - 1) {
            encoded.push(0xAA);
        }
    }
    if (encoded.length > UI_STRINGS_SIZE) {
        throw new RangeError(`UI strings are too long (${encoded.length} bytes); maximum is ${UI_STRINGS_SIZE} bytes.`);
    }
    data.fill(0, UI_STRINGS_OFFSET, UI_STRINGS_OFFSET + UI_STRINGS_SIZE);
    data.set(encoded, UI_STRINGS_OFFSET);
}

export function updateSceneLstArchiveHashes(data: Uint8Array, fromPrefix: string, toPrefix: string): Uint8Array {
    if (data.length !== SCENE_LST_SIZE) {
        throw new Error(`Expected a ${SCENE_LST_SIZE}-byte scene LST file.`);
    }
    if (fromPrefix.length !== toPrefix.length) {
        throw new RangeError('Scene prefixes must have the same length.');
    }
    const out = data.slice();
    const archiveOffset = 0x04D0;
    const entrySize = 14;
    const entryCount = 0x196 / entrySize;
    // Recompute hashes for directory entries by matching known name pattern is not stored;
    // caller should patch by renaming known archive names conceptually not possible here without names.
    // Instead, this helper is intentionally not used for blind hash rewrites.
    void archiveOffset; void entrySize; void entryCount; void fromPrefix; void toPrefix;
    return out;
}


const SCENE_ARCHIVE_OFFSET = 0x04D0;
const SCENE_ARCHIVE_ENTRY_SIZE = 14;
const SCENE_ARCHIVE_ENTRY_COUNT = 0x196 / SCENE_ARCHIVE_ENTRY_SIZE;

function signedByte(value: number): number {
    return value & 0x80 ? value - 0x100 : value;
}

function hashArchiveFilename(filename: string): readonly [number, number] {
    let h1 = 0;
    for (let index = filename.length - 1; index >= 0; index--) {
        h1 = (0x101 * h1 + signedByte(filename.charCodeAt(index))) & 0xFFFF;
    }
    let h2 = 0;
    for (let index = 0; index < filename.length - 1; index++) {
        h2 = (h2 + signedByte(filename.charCodeAt(index)) * index) & 0xFFFF;
    }
    return [h2, h1];
}

function readWord(data: Uint8Array, offset: number): number {
    return data[offset] | (data[offset + 1] << 8);
}

function writeWord(data: Uint8Array, offset: number, value: number): void {
    data[offset] = value & 0xFF;
    data[offset + 1] = (value >>> 8) & 0xFF;
}

function readDword(data: Uint8Array, offset: number): number {
    return (data[offset] | (data[offset + 1] << 8) | (data[offset + 2] << 16) | (data[offset + 3] << 24)) >>> 0;
}

function writeDword(data: Uint8Array, offset: number, value: number): void {
    const v = value >>> 0;
    data[offset] = v & 0xFF;
    data[offset + 1] = (v >>> 8) & 0xFF;
    data[offset + 2] = (v >>> 16) & 0xFF;
    data[offset + 3] = (v >>> 24) & 0xFF;
}

export interface SceneArchiveEntry {
    index: number;
    h2: number;
    h1: number;
    archiveChar: number;
    offset: number;
    size: number;
    resolvedName: string | null;
}

export function getSceneArchiveEntries(data: Uint8Array, resolveNames = true): SceneArchiveEntry[] {
    if (data.length !== SCENE_LST_SIZE) {
        throw new Error(`Expected a ${SCENE_LST_SIZE}-byte scene LST file.`);
    }
    const entries: SceneArchiveEntry[] = [];
    for (let index = 0; index < SCENE_ARCHIVE_ENTRY_COUNT; index++) {
        const entryOffset = SCENE_ARCHIVE_OFFSET + index * SCENE_ARCHIVE_ENTRY_SIZE;
        const h2 = readWord(data, entryOffset);
        const h1 = readWord(data, entryOffset + 2);
        if (h2 === 0 && h1 === 0) break;
        const archiveChar = data[entryOffset + 4];
        const offset = readDword(data, entryOffset + 6);
        const size = readDword(data, entryOffset + 10);
        const resolvedName = resolveNames ? resolveScene01ArchiveName(h2, h1) : null;
        entries.push({ index, h2, h1, archiveChar, offset, size, resolvedName });
    }
    return entries;
}

export function findSceneArchiveEntryByName(data: Uint8Array, filename: string): SceneArchiveEntry | null {
    const [h2, h1] = hashArchiveFilename(filename);
    const entries = getSceneArchiveEntries(data, false);
    return entries.find(e => e.h2 === h2 && e.h1 === h1) ?? null;
}

export function setSceneArchiveEntryOffsetSize(data: Uint8Array, index: number, newOffset: number, newSize: number): void {
    if (!Number.isInteger(index) || index < 0 || index >= SCENE_ARCHIVE_ENTRY_COUNT) {
        throw new RangeError(`Archive entry index must be between 0 and ${SCENE_ARCHIVE_ENTRY_COUNT - 1}.`);
    }
    const entryOffset = SCENE_ARCHIVE_OFFSET + index * SCENE_ARCHIVE_ENTRY_SIZE;
    writeDword(data, entryOffset + 6, newOffset >>> 0);
    writeDword(data, entryOffset + 10, newSize >>> 0);
}

export function shiftSceneArchiveEntriesAfter(data: Uint8Array, afterOffset: number, delta: number): void {
    if (delta === 0) return;
    const entries = getSceneArchiveEntries(data, false);
    for (const e of entries) {
        if (e.offset >= afterOffset) {
            setSceneArchiveEntryOffsetSize(data, e.index, e.offset + delta, e.size);
        }
    }
}

function resolveScene01ArchiveName(h2: number, h1: number): string | null {
    const preferred: string[] = [];
    const base = 'SCENE01';
    for (const suf of ['.ICN', '.SIC', 'T.BIN', 'O.BIN', 'P.BIN']) preferred.push(base + suf);
    for (const x of 'ABCDE12345') for (const ext of ['.DAT', '.BIN', '.COL', '.MUS']) preferred.push(base + x + ext);
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    for (let i = 0; i < chars.length; i++) for (let j = 0; j < chars.length; j++) {
        const ab = chars[i] + chars[j];
        for (const ext of ['.COL', '.DAT', '.BIN', '.LZ', '.MUS']) preferred.push(base + ab + ext);
    }
    for (const name of preferred) {
        const h = hashArchiveFilename(name);
        if (h[0] === h2 && h[1] === h1) return name;
    }
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789._';
    const tryLen = (len: number, prefix: string): string | null => {
        if (len === 0) {
            const name = base + prefix;
            const h = hashArchiveFilename(name);
            return h[0] === h2 && h[1] === h1 ? name : null;
        }
        for (let i = 0; i < alphabet.length; i++) {
            const found = tryLen(len - 1, prefix + alphabet[i]);
            if (found) return found;
        }
        return null;
    };
    for (let len = 1; len <= 6; len++) {
        const found = tryLen(len, '');
        if (found) return found;
    }
    return null;
}

function buildScene01NameLookup(): Map<string, string> {
    const base = 'SCENE01';
    const names: string[] = [];
    for (const suf of ['.ICN', '.SIC', 'T.BIN', 'O.BIN', 'P.BIN']) names.push(base + suf);
    for (const x of 'ABCDE12345') for (const ext of ['.DAT', '.BIN', '.COL', '.MUS', '.ALZ', '.BLZ']) names.push(base + x + ext);
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    for (let i = 0; i < chars.length; i++) for (let j = 0; j < chars.length; j++) {
        const ab = chars[i] + chars[j];
        for (const ext of ['.COL', '.DAT', '.BIN', '.LZ', '.MUS', '.ALZ', '.BLZ']) names.push(base + ab + ext);
    }
    const lookup = new Map<string, string>();
    for (const name of names) {
        const [h2, h1] = hashArchiveFilename(name);
        const key = `${h2},${h1}`;
        if (!lookup.has(key)) lookup.set(key, name);
    }
    return lookup;
}

export function createScene03LstFromScene01(scene01Lst: Uint8Array): Uint8Array {
    if (scene01Lst.length !== SCENE_LST_SIZE) {
        throw new Error(`Expected a ${SCENE_LST_SIZE}-byte scene LST file.`);
    }
    const out = scene01Lst.slice();
    // Generated SCENE03 experiment ships private O/P lane/object banks (SCENE03O.BIN, SCENE03P.BIN).
    // Mark the scene as owning its O/P sets so the engine loads them instead of shared banks.
    out[0x57] = 0x00;
    const nameLookup = buildScene01NameLookup();
    for (let index = 0; index < SCENE_ARCHIVE_ENTRY_COUNT; index++) {
        const entryOffset = SCENE_ARCHIVE_OFFSET + index * SCENE_ARCHIVE_ENTRY_SIZE;
        const h2 = readWord(out, entryOffset);
        const h1 = readWord(out, entryOffset + 2);
        if (h2 === 0 && h1 === 0) break;
        const name = nameLookup.get(`${h2},${h1}`);
        if (!name || !name.startsWith('SCENE01')) continue;
        const renamed = 'SCENE03' + name.slice('SCENE01'.length);
        const nh = hashArchiveFilename(renamed);
        writeWord(out, entryOffset, nh[0]);
        writeWord(out, entryOffset + 2, nh[1]);
    }
    return out;
}
