export const PLAYDISK_SIZE = 0xB3;
export const PLAYDISK_LABEL = 'MASTER PLAY DISK \0';
export const CAR_SLOT_OFFSET = 0x12;
export const CAR_SLOT_COUNT = 14;
export const CAR_SLOT_SIZE = 6;
export const SCENE_SLOT_OFFSET = 0x66;
export const SCENE_SLOT_COUNT = 8;
export const SCENE_SLOT_SIZE = 8;
export const SELECTED_CAR_OFFSET = 0xA6;
export const UNKNOWN_WORD_OFFSET = 0xA8;
export const SELECTED_SCENE_OFFSET = 0xAA;
export const SKILL_OFFSET = 0xAC;

export interface PlaydiskData {
    carSlots: string[];
    sceneSlots: string[];
    selectedCarSlot: number;
    unknownWord: number;
    selectedSceneSlot: number;
    skill: number;
    tail: Uint8Array; // 5 bytes at 0xAE
    raw: Uint8Array;
}

function readFixedAscii(data: Uint8Array, offset: number, size: number): string {
    let end = offset;
    const limit = offset + size;
    while (end < limit && data[end] !== 0) end++;
    return String.fromCharCode(...data.slice(offset, end));
}

function writeFixedAscii(data: Uint8Array, offset: number, size: number, value: string): void {
    const upper = value.toUpperCase();
    for (let i = 0; i < upper.length; i++) {
        const code = upper.charCodeAt(i);
        if (code < 0x20 || code > 0x7E) {
            throw new RangeError('Slot names must use printable ASCII characters.');
        }
    }
    const bytes = new TextEncoder().encode(upper);
    if (bytes.length > size) {
        throw new RangeError(`Value must be at most ${size} characters.`);
    }
    data.fill(0, offset, offset + size);
    data.set(bytes, offset);
}

export function createDefaultPlaydisk(): Uint8Array {
    // Based on a stock PLAYDISK.DAT layout (179 bytes).
    const data = new Uint8Array(PLAYDISK_SIZE);
    new TextEncoder().encode(PLAYDISK_LABEL).forEach((b, i) => { data[i] = b; });
    const cars = ['CCERV', 'CDIAB', 'CMYTH', 'CCNSX', 'CSTEL', '?????', '?????', '?????', '?????', '?????', '?????', '?????', '?????', '?????'];
    const scenes = ['SCENE01', 'SCENE02', '???????', '???????', '???????', '???????', '???????', '???????'];
    cars.forEach((name, i) => writeFixedAscii(data, CAR_SLOT_OFFSET + i * CAR_SLOT_SIZE, CAR_SLOT_SIZE, name));
    scenes.forEach((name, i) => writeFixedAscii(data, SCENE_SLOT_OFFSET + i * SCENE_SLOT_SIZE, SCENE_SLOT_SIZE, name));
    // Defaults: selected car 3 (CCNSX in stock sample showed 03 00), unknown 0, selected scene 0, skill 2, tail 05 02 01 01 04
    data[SELECTED_CAR_OFFSET] = 0x03; data[SELECTED_CAR_OFFSET + 1] = 0x00;
    data[UNKNOWN_WORD_OFFSET] = 0x00; data[UNKNOWN_WORD_OFFSET + 1] = 0x00;
    data[SELECTED_SCENE_OFFSET] = 0x00; data[SELECTED_SCENE_OFFSET + 1] = 0x00;
    data[SKILL_OFFSET] = 0x02; data[SKILL_OFFSET + 1] = 0x00;
    data.set([0x05, 0x02, 0x01, 0x01, 0x04], 0xAE);
    return data;
}

export function readPlaydisk(data: Uint8Array): PlaydiskData {
    if (data.length !== PLAYDISK_SIZE) {
        throw new Error(`Expected a ${PLAYDISK_SIZE}-byte PLAYDISK.DAT file.`);
    }
    const carSlots = Array.from({ length: CAR_SLOT_COUNT }, (_, i) => readFixedAscii(data, CAR_SLOT_OFFSET + i * CAR_SLOT_SIZE, CAR_SLOT_SIZE));
    const sceneSlots = Array.from({ length: SCENE_SLOT_COUNT }, (_, i) => readFixedAscii(data, SCENE_SLOT_OFFSET + i * SCENE_SLOT_SIZE, SCENE_SLOT_SIZE));
    return {
        carSlots,
        sceneSlots,
        selectedCarSlot: data[SELECTED_CAR_OFFSET] | (data[SELECTED_CAR_OFFSET + 1] << 8),
        unknownWord: data[UNKNOWN_WORD_OFFSET] | (data[UNKNOWN_WORD_OFFSET + 1] << 8),
        selectedSceneSlot: data[SELECTED_SCENE_OFFSET] | (data[SELECTED_SCENE_OFFSET + 1] << 8),
        skill: data[SKILL_OFFSET] | (data[SKILL_OFFSET + 1] << 8),
        tail: data.slice(0xAE, 0xB3),
        raw: data.slice(),
    };
}

export function writePlaydisk(parsed: PlaydiskData): Uint8Array {
    const data = parsed.raw.length === PLAYDISK_SIZE ? parsed.raw.slice() : createDefaultPlaydisk();
    parsed.carSlots.forEach((name, i) => writeFixedAscii(data, CAR_SLOT_OFFSET + i * CAR_SLOT_SIZE, CAR_SLOT_SIZE, name));
    parsed.sceneSlots.forEach((name, i) => writeFixedAscii(data, SCENE_SLOT_OFFSET + i * SCENE_SLOT_SIZE, SCENE_SLOT_SIZE, name));
    const setWord = (offset: number, value: number) => {
        if (!Number.isInteger(value) || value < 0 || value > 0xFFFF) throw new RangeError('Word values must be between 0 and 65535.');
        data[offset] = value & 0xFF;
        data[offset + 1] = (value >> 8) & 0xFF;
    };
    setWord(SELECTED_CAR_OFFSET, parsed.selectedCarSlot);
    setWord(UNKNOWN_WORD_OFFSET, parsed.unknownWord);
    setWord(SELECTED_SCENE_OFFSET, parsed.selectedSceneSlot);
    setWord(SKILL_OFFSET, parsed.skill);
    data.set(parsed.tail.slice(0, 5), 0xAE);
    return data;
}
