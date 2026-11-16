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


export function readSceneLstStrings(data: Uint8Array): SceneLstStrings {
    if (data.length !== SCENE_LST_SIZE) {
        throw new Error(`Expected a ${SCENE_LST_SIZE}-byte scene LST file.`);
    }
    const courseName = readCString(data, COURSE_NAME_OFFSET, COURSE_NAME_MAX + 1);
    const routeNames: string[] = [];
    for (let i = 0; i < ROUTE_NAME_COUNT; i++) {
        routeNames.push(readCString(data, ROUTE_NAMES_OFFSET + i * ROUTE_NAME_SIZE, ROUTE_NAME_SIZE));
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
    if (bytes.length >= ROUTE_NAME_SIZE) {
        throw new RangeError(`Route names must be shorter than ${ROUTE_NAME_SIZE} characters.`);
    }
    const offset = ROUTE_NAMES_OFFSET + index * ROUTE_NAME_SIZE;
    data.fill(0, offset, offset + ROUTE_NAME_SIZE);
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
