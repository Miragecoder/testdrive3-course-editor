export const MAP_WIDTH = 32;
export const MAP_HEIGHT = 16;
export const MAP_HEADER_SIZE = 0x00DF;
export const MAP_RESOURCE_SIZE = 0x2137;

export const COURSE_LAYOUTS = {
    SCENE01: {
        label: 'Pacific Coast',
        mapOffsets: [0x10240, 0x1A1CC, 0x1C319, 0x21565, 0x236B2],
    },
    SCENE02: {
        label: 'Cape Cod',
        mapOffsets: [0x1014D, 0x2158F, 0x26273, 0x283C0, 0x2D87C],
    },
} as const;

export type CourseId = keyof typeof COURSE_LAYOUTS;

export interface MapCell {
    readonly tileId: number;
    readonly rotation: number;
    readonly elevation: number;
}

export function readMapCell(data: Uint8Array, mapOffset: number, x: number, y: number): MapCell {
    validateCellCoordinates(x, y);
    const offset = mapOffset + MAP_HEADER_SIZE + (y * MAP_WIDTH + x) * 2;
    if (offset + 1 >= data.length) {
        throw new Error(`Map cell at (${x}, ${y}) is outside the DAT file.`);
    }

    const orientation = data[offset + 1];
    return {
        tileId: data[offset],
        rotation: orientation >> 6,
        elevation: orientation & 0x3F,
    };
}

export function writeMapCell(
    data: Uint8Array,
    mapOffset: number,
    x: number,
    y: number,
    cell: MapCell,
): void {
    validateCellCoordinates(x, y);
    validateInteger('tile ID', cell.tileId, 0, 0xFF);
    validateInteger('rotation', cell.rotation, 0, 3);
    validateInteger('elevation', cell.elevation, 0, 0x3F);

    const offset = mapOffset + MAP_HEADER_SIZE + (y * MAP_WIDTH + x) * 2;
    if (offset + 1 >= data.length) {
        throw new Error(`Map cell at (${x}, ${y}) is outside the DAT file.`);
    }

    data[offset] = cell.tileId;
    data[offset + 1] = (cell.rotation << 6) | cell.elevation;
}

export const MAP_MODE_OFFSET = 0x35;
export const SKY_SEEDS_OFFSET = 0x2E;
export const SKY_FOG_SEED_OFFSET = 0x32;
export const COLOR_REMAP_TABLE_OFFSET = 0x1F27;
export const COLOR_REMAP_ENTRY_COUNT = 256;

export const CANONICAL_NIGHT_SKY_SEEDS = [0x09, 0x08, 0x72, 0x13] as const;
export const CANONICAL_DAY_SKY_SEEDS = [0x0B, 0x07, 0x79, 0x19] as const;

export function readMapMode(data: Uint8Array, mapOffset: number): number {
    const offset = mapOffset + MAP_MODE_OFFSET;
    if (offset >= data.length) {
        throw new Error('Map mode byte is outside the DAT file.');
    }
    return data[offset];
}

export function writeMapMode(data: Uint8Array, mapOffset: number, mode: 0 | 1): void {
    const offset = mapOffset + MAP_MODE_OFFSET;
    if (offset >= data.length) {
        throw new Error('Map mode byte is outside the DAT file.');
    }
    data[offset] = mode;
}

export function readSkySeeds(data: Uint8Array, mapOffset: number): [number, number, number, number] {
    const offset = mapOffset + SKY_SEEDS_OFFSET;
    if (offset + 3 >= data.length) {
        throw new Error('Sky seed bytes are outside the DAT file.');
    }
    return [data[offset], data[offset + 1], data[offset + 2], data[offset + 3]];
}

export function writeSkySeeds(
    data: Uint8Array,
    mapOffset: number,
    seeds: readonly [number, number, number, number],
): void {
    const offset = mapOffset + SKY_SEEDS_OFFSET;
    if (offset + 3 >= data.length) {
        throw new Error('Sky seed bytes are outside the DAT file.');
    }
    seeds.forEach((value, index) => validateInteger(`Sky seed byte ${index}`, value, 0, 0xFF));
    data.set(seeds, offset);
}

export function canonicalSkySeedsForMode(mode: 0 | 1): readonly [number, number, number, number] {
    return mode === 0 ? CANONICAL_NIGHT_SKY_SEEDS : CANONICAL_DAY_SKY_SEEDS;
}

export function applyCanonicalSkySeeds(data: Uint8Array, mapOffset: number, mode: 0 | 1): void {
    writeSkySeeds(data, mapOffset, canonicalSkySeedsForMode(mode));
}

export function applySkySeedDeltaForModeToggle(
    data: Uint8Array,
    mapOffset: number,
    fromMode: 0 | 1,
    toMode: 0 | 1,
): void {
    if (fromMode === toMode) return;
    const source = canonicalSkySeedsForMode(fromMode);
    const target = canonicalSkySeedsForMode(toMode);
    const current = readSkySeeds(data, mapOffset);
    const next = current.map((value, index) => (value + target[index] - source[index]) & 0xFF) as [number, number, number, number];
    writeSkySeeds(data, mapOffset, next);
}

export function readFogSeed(data: Uint8Array, mapOffset: number): number {
    const offset = mapOffset + SKY_FOG_SEED_OFFSET;
    if (offset + 1 >= data.length) {
        throw new Error('Sky/fog gradient seed is outside the DAT file.');
    }
    return data[offset] | (data[offset + 1] << 8);
}

export function writeFogSeed(data: Uint8Array, mapOffset: number, seed: number): void {
    const offset = mapOffset + SKY_FOG_SEED_OFFSET;
    if (offset + 1 >= data.length) {
        throw new Error('Sky/fog gradient seed is outside the DAT file.');
    }
    validateInteger('Sky/fog gradient seed', seed, 0, 0xFFFF);
    data[offset] = seed & 0xFF;
    data[offset + 1] = (seed >>> 8) & 0xFF;
}

export function fogRemapIndex(fogSeed: number): number {
    return (fogSeed & 0x0F) | (((fogSeed >>> 8) & 0x0F) << 4);
}

export function readRemapEntry(data: Uint8Array, mapOffset: number, index: number): number {
    validateInteger('Remap index', index, 0, COLOR_REMAP_ENTRY_COUNT - 1);
    const offset = mapOffset + COLOR_REMAP_TABLE_OFFSET + index * 2;
    if (offset + 1 >= data.length) {
        throw new Error('Remap table entry is outside the DAT file.');
    }
    return data[offset] | (data[offset + 1] << 8);
}

export function writeRemapEntry(data: Uint8Array, mapOffset: number, index: number, value: number): void {
    validateInteger('Remap index', index, 0, COLOR_REMAP_ENTRY_COUNT - 1);
    validateInteger('Remap entry', value, 0, 0xFFFF);
    const offset = mapOffset + COLOR_REMAP_TABLE_OFFSET + index * 2;
    if (offset + 1 >= data.length) {
        throw new Error('Remap table entry is outside the DAT file.');
    }
    data[offset] = value & 0xFF;
    data[offset + 1] = (value >>> 8) & 0xFF;
}

function validateCellCoordinates(x: number, y: number): void {
    validateInteger('x coordinate', x, 0, MAP_WIDTH - 1);
    validateInteger('y coordinate', y, 0, MAP_HEIGHT - 1);
}

function validateInteger(label: string, value: number, min: number, max: number): void {
    if (!Number.isInteger(value) || value < min || value > max) {
        throw new RangeError(`${label} must be an integer from ${min} to ${max}.`);
    }
}
