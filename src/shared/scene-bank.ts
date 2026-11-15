// This is the last byte of the 10-byte field loaded at DS:0B0C; race setup tests DS:0B15.
const SCENE_OWN_LANE_BANK_FLAG_OFFSET = 0x57;
const SCENE_ARCHIVE_OFFSET = 0x4D0;
const SCENE_ARCHIVE_ENTRY_SIZE = 14;
const SCENE_ARCHIVE_ENTRY_COUNT = 0x196 / SCENE_ARCHIVE_ENTRY_SIZE;
const SCENE_ARCHIVE_TYPE = 0x65;

export function requiresSceneSpecificLaneBank(sceneList: Uint8Array): boolean {
    if (sceneList.length <= SCENE_OWN_LANE_BANK_FLAG_OFFSET) {
        throw new Error('Scene LST is too short to contain the lane-bank selection flag.');
    }

    return sceneList[SCENE_OWN_LANE_BANK_FLAG_OFFSET] === 0;
}

export function isUnavailableSceneLaneBankResponse(status: number, contentType: string | null): boolean {
    const isHtmlFallback = status >= 200
        && status < 300
        && contentType?.split(';', 1)[0].trim().toLowerCase() === 'text/html';
    return status === 404 || isHtmlFallback;
}

export function extractSceneArchiveEntry(
    sceneList: Uint8Array,
    sceneData: Uint8Array,
    filename: string,
): Uint8Array | null {
    if (sceneList.length < SCENE_ARCHIVE_OFFSET + SCENE_ARCHIVE_ENTRY_COUNT * SCENE_ARCHIVE_ENTRY_SIZE) {
        throw new Error('Scene LST is too short to contain its archive directory.');
    }

    const [hashH2, hashH1] = hashArchiveFilename(filename);
    for (let index = 0; index < SCENE_ARCHIVE_ENTRY_COUNT; index++) {
        const entryOffset = SCENE_ARCHIVE_OFFSET + index * SCENE_ARCHIVE_ENTRY_SIZE;
        const entryHashH2 = readWord(sceneList, entryOffset);
        const entryHashH1 = readWord(sceneList, entryOffset + 2);
        if (entryHashH2 === 0 && entryHashH1 === 0) break;
        if (entryHashH2 !== hashH2 || entryHashH1 !== hashH1) continue;

        if (sceneList[entryOffset + 4] !== SCENE_ARCHIVE_TYPE) {
            throw new Error(`${filename} is not stored in this scene DAT archive.`);
        }

        const dataOffset = readDword(sceneList, entryOffset + 6);
        const storedSize = readWord(sceneList, entryOffset + 10);
        if (storedSize === 0) {
            throw new Error(`${filename} has an invalid archived size.`);
        }

        const dataSize = storedSize - 1;
        if (dataOffset + dataSize > sceneData.length) {
            throw new Error(`${filename} extends beyond the scene DAT file.`);
        }

        return sceneData.slice(dataOffset, dataOffset + dataSize);
    }

    return null;
}

function hashArchiveFilename(filename: string): readonly [number, number] {
    if (!/^[\x20-\x7E]+$/.test(filename)) {
        throw new Error('Archived filenames must contain printable ASCII characters.');
    }

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

function signedByte(value: number): number {
    return value & 0x80 ? value - 0x100 : value;
}

function readWord(data: Uint8Array, offset: number): number {
    return data[offset] | (data[offset + 1] << 8);
}

function readDword(data: Uint8Array, offset: number): number {
    return (data[offset] | (data[offset + 1] << 8) | (data[offset + 2] << 16) | (data[offset + 3] << 24)) >>> 0;
}
