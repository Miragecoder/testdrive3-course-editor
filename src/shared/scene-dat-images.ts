import {
    applyPixelBase,
    decodeTd3Image,
    encodeTd3Image,
    removePixelBase,
    replaceTd3ImageSlot,
} from './td3-image.js';

export interface SceneImageSlot {
    id: string;
    offset: number;
    size: number;
    width: number;
    height?: number;
    description: string;
    pixelBase: number;
    paletteOffset?: number; // 112-color palette offset in same DAT, if applicable
}

export interface ScenePaletteSlot {
    offset: number;
    size: number;
    description: string;
}

export const SCENE01_IMAGE_SLOTS: SceneImageSlot[] = [
    { id: 'title', offset: 0x00000, size: 0x029A, width: 320, height: 33, description: 'Route title image', pixelBase: 0 },
    { id: 'icon', offset: 0x0029A, size: 0x01C1, width: 72, height: 40, description: 'Route icon image', pixelBase: 0 },
    { id: 'landA', offset: 0x124C9, size: 0x1D6B, width: 320, height: 50, description: 'Landscape A (ground, set 1)', pixelBase: 0, paletteOffset: 0x12378 },
    { id: 'landB', offset: 0x14234, size: 0x125C, width: 320, height: 19, description: 'Landscape B (sky, set 1)', pixelBase: 0, paletteOffset: 0x12378 },
    { id: 'landC', offset: 0x1E5A2, size: 0x1C0A, width: 320, height: 50, description: 'Landscape C (ground, set 2)', pixelBase: 0, paletteOffset: 0x1E451 },
    { id: 'landD', offset: 0x201AC, size: 0x13B9, width: 320, height: 19, description: 'Landscape D (sky, set 2)', pixelBase: 0, paletteOffset: 0x1E451 },
    { id: 'landE', offset: 0x2593B, size: 0x2C57, width: 320, height: 50, description: 'Landscape E (ground, set 3)', pixelBase: 0, paletteOffset: 0x257EA },
    { id: 'landF', offset: 0x28592, size: 0x1053, width: 320, height: 19, description: 'Landscape F (sky, set 3)', pixelBase: 0, paletteOffset: 0x257EA },
];

export const SCENE02_IMAGE_SLOTS: SceneImageSlot[] = [
    { id: 'title', offset: 0x00000, size: 0x02BD, width: 320, height: 33, description: 'Route title image', pixelBase: 0 },
    { id: 'icon', offset: 0x002BD, size: 0x01CB, width: 72, height: 40, description: 'Route icon image', pixelBase: 0 },
    { id: 'landA', offset: 0x23818, size: 0x02172, width: 320, height: 50, description: 'Landscape A (ground, set 1)', pixelBase: 0, paletteOffset: 0x236C7 },
    { id: 'landB', offset: 0x2598A, size: 0x008E9, width: 320, height: 19, description: 'Landscape B (sky, set 1)', pixelBase: 0, paletteOffset: 0x236C7 },
    { id: 'landC', offset: 0x2A649, size: 0x02319, width: 320, height: 50, description: 'Landscape C (ground, set 2)', pixelBase: 0, paletteOffset: 0x2A4F8 },
    { id: 'landD', offset: 0x2C962, size: 0x00F1A, width: 320, height: 19, description: 'Landscape D (sky, set 2)', pixelBase: 0, paletteOffset: 0x2A4F8 },
    { id: 'landE', offset: 0x2FB05, size: 0x027DB, width: 320, height: 50, description: 'Landscape E (ground, set 3)', pixelBase: 0, paletteOffset: 0x2F9B4 },
    { id: 'landF', offset: 0x322E0, size: 0x00F6B, width: 320, height: 19, description: 'Landscape F (sky, set 3)', pixelBase: 0, paletteOffset: 0x2F9B4 },
];

export function getSceneImageSlots(courseId: 'SCENE01' | 'SCENE02'): SceneImageSlot[] {
    return courseId === 'SCENE01' ? SCENE01_IMAGE_SLOTS : SCENE02_IMAGE_SLOTS;
}

export function decodeSceneImageSlot(dat: Uint8Array, slot: SceneImageSlot): Uint8Array {
    const compressed = dat.slice(slot.offset, slot.offset + slot.size);
    const decoded = decodeTd3Image(compressed, slot.width);
    return applyPixelBase(decoded.indexedPixels, slot.pixelBase);
}

export function encodeSceneImageSlot(indexedPixels: Uint8Array, slot: SceneImageSlot): Uint8Array {
    if (slot.height !== undefined && indexedPixels.length !== slot.width * slot.height) {
        throw new Error(`Image must be ${slot.width}x${slot.height} (${slot.width * slot.height} pixels).`);
    }
    const raw = removePixelBase(indexedPixels, slot.pixelBase);
    return encodeTd3Image(raw);
}

export function tryReplaceSceneImageSlot(dat: Uint8Array, slot: SceneImageSlot, indexedPixels: Uint8Array): { ok: true; size: number } | { ok: false; reason: string } {
    const encoded = encodeSceneImageSlot(indexedPixels, slot);
    if (encoded.length > slot.size) {
        return { ok: false, reason: `Encoded ${encoded.length} bytes but slot allows ${slot.size} bytes.` };
    }
    replaceTd3ImageSlot(dat, slot.offset, slot.size, encoded);
    return { ok: true, size: encoded.length };
}

function copyBytes(dat: Uint8Array, offset: number, length: number): Uint8Array {
    return dat.slice(offset, offset + length);
}

function decodeRawForSlot(dat: Uint8Array, slot: SceneImageSlot): Uint8Array {
    const compressed = dat.slice(slot.offset, slot.offset + slot.size);
    return decodeTd3Image(compressed, slot.width).indexedPixels; // un-adjusted (pixelBase not applied)
}

function encodeRawForSlot(rawPixels: Uint8Array): Uint8Array {
    return encodeTd3Image(rawPixels);
}

/**
 * Swap SCENE01 landscape set A (leg 1, Pacific coast) with set C (leg 5, Yosemite):
 * palettes 0x12378 <-> 0x257EA and image pairs (landA,landB) <-> (landE,landF).
 * Images are re-encoded to fit destination slot sizes (throws if not possible).
 */
export function swapScene01LandscapeSetsAandC(dat: Uint8Array): void {
    const palAOff = 0x12378, palCOff = 0x257EA, palSize = 336;
    const slot = (id: string) => SCENE01_IMAGE_SLOTS.find(s => s.id === id)!;
    const landA = slot('landA'), landB = slot('landB'), landE = slot('landE'), landF = slot('landF');

    // Decode raw (slot-space) pixels and copy palettes before mutating
    const palA = copyBytes(dat, palAOff, palSize);
    const palC = copyBytes(dat, palCOff, palSize);
    const pixA = decodeRawForSlot(dat, landA);
    const pixB = decodeRawForSlot(dat, landB);
    const pixE = decodeRawForSlot(dat, landE);
    const pixF = decodeRawForSlot(dat, landF);

    // Re-encode into destination slots
    const encAtoE = encodeRawForSlot(pixA);
    const encBtoF = encodeRawForSlot(pixB);
    const encEtoA = encodeRawForSlot(pixE);
    const encFtoB = encodeRawForSlot(pixF);

    // Validate all fit before writing
    const checks: [string, Uint8Array, SceneImageSlot][] = [
        ['Landscape A->E', encAtoE, landE], ['Landscape B->F', encBtoF, landF],
        ['Landscape E->A', encEtoA, landA], ['Landscape F->B', encFtoB, landB],
    ];
    for (const [label, enc, dst] of checks) {
        if (enc.length > dst.size) {
            throw new Error(`${label} needs ${enc.length} bytes but destination slot allows ${dst.size}.`);
        }
    }

    // Swap palettes
    dat.set(palC, palAOff);
    dat.set(palA, palCOff);
    // Write re-encoded images into swapped slots
    replaceTd3ImageSlot(dat, landE.offset, landE.size, encAtoE);
    replaceTd3ImageSlot(dat, landF.offset, landF.size, encBtoF);
    replaceTd3ImageSlot(dat, landA.offset, landA.size, encEtoA);
    replaceTd3ImageSlot(dat, landB.offset, landB.size, encFtoB);
}
