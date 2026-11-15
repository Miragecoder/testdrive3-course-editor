import { MAP_HEIGHT, MAP_WIDTH, readMapCell, type CourseId } from './course-map';
import { TILE_BANK_LAYOUTS } from './tile-bank-layout';

export { TILE_BANK_LAYOUTS } from './tile-bank-layout';

export function findMapTileWithFaceMaterial(
    mapData: Uint8Array,
    mapOffset: number,
    sharedTileData: Uint8Array,
    sceneTileData: Uint8Array,
    courseId: CourseId,
    material: number,
): number | null {
    for (let y = 0; y < MAP_HEIGHT; y++) {
        for (let x = 0; x < MAP_WIDTH; x++) {
            const tileId = readMapCell(mapData, mapOffset, x, y).tileId;
            const bank = tileId < 0x40 ? TILE_BANK_LAYOUTS.shared : TILE_BANK_LAYOUTS[courseId];
            const tileIndex = tileId - bank.firstTileId;
            if (tileIndex < 0 || tileIndex >= bank.count) continue;

            const bankData = tileId < 0x40 ? sharedTileData : sceneTileData;
            if (tileHasFaceMaterial(bankData, bank.offset, bank.count, tileIndex, material)) {
                return tileId;
            }
        }
    }

    return null;
}

function tileHasFaceMaterial(
    data: Uint8Array,
    indexOffset: number,
    tileCount: number,
    tileIndex: number,
    material: number,
): boolean {
    if (!Number.isInteger(tileIndex) || tileIndex < 0 || tileIndex >= tileCount) {
        throw new RangeError('Tile index is outside the tile bank.');
    }
    requireRange(data, indexOffset, tileCount * 2, 'Tile model index');
    const pointerOffset = indexOffset + tileIndex * 2;
    let pointer = readWord(data, pointerOffset);
    let omittedFaces = 0;
    if (pointer <= 0x10) {
        omittedFaces = pointer;
        if (tileIndex === 0) return false;
        pointer = readWord(data, pointerOffset - 2);
    }

    const modelOffset = indexOffset + pointer;
    requireRange(data, modelOffset, 4, 'Tile model header');
    const faceCount = data[modelOffset] - omittedFaces;
    const vertexCount = data[modelOffset + 1];
    if (faceCount < 0) throw new Error('Tile model face count is invalid.');

    const facesOffset = modelOffset + 4 + vertexCount * 6;
    requireRange(data, facesOffset, faceCount * 8, 'Tile model faces');
    for (let face = 0; face < faceCount; face++) {
        if ((readWord(data, facesOffset + face * 8 + 6) >>> 11) === material) return true;
    }
    return false;
}

function readWord(data: Uint8Array, offset: number): number {
    requireRange(data, offset, 2, 'Tile model index');
    return data[offset] | (data[offset + 1] << 8);
}

function requireRange(data: Uint8Array, offset: number, length: number, label: string): void {
    if (!Number.isInteger(offset) || offset < 0 || offset + length > data.length) {
        throw new Error(`${label} is outside the tile bank.`);
    }
}
