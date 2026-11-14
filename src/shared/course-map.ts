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

export function readMapMode(data: Uint8Array, mapOffset: number): number {
    const offset = mapOffset + 0x35;
    if (offset >= data.length) {
        throw new Error('Map mode byte is outside the DAT file.');
    }
    return data[offset];
}

export function writeMapMode(data: Uint8Array, mapOffset: number, mode: 0 | 1): void {
    const offset = mapOffset + 0x35;
    if (offset >= data.length) {
        throw new Error('Map mode byte is outside the DAT file.');
    }

    data[offset] = mode;
    const seeds = mode === 0
        ? [0x09, 0x08, 0x72, 0x13]
        : [0x0B, 0x07, 0x79, 0x19];
    data.set(seeds, mapOffset + 0x2E);
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
