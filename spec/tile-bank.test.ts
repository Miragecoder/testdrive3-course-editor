import assert from 'node:assert/strict';
import test from 'node:test';
import {
    MAP_HEADER_SIZE,
    MAP_HEIGHT,
    MAP_WIDTH,
    writeMapCell,
    type CourseId,
} from '../src/shared/course-map';
import { findMapTileWithFaceMaterial, TILE_BANK_LAYOUTS } from '../src/shared/tile-bank';

function createTileBank(
    layout: (typeof TILE_BANK_LAYOUTS)[keyof typeof TILE_BANK_LAYOUTS],
    tileIndex: number,
    material: number,
): Uint8Array {
    const modelOffset = layout.offset + layout.count * 2;
    const data = new Uint8Array(modelOffset + 12);
    writeWord(data, layout.offset + tileIndex * 2, layout.count * 2);
    data[modelOffset] = 1;
    data[modelOffset + 1] = 0;
    writeWord(data, modelOffset + 10, material << 11);
    return data;
}

function createMap(tileId: number): Uint8Array {
    const data = new Uint8Array(MAP_HEADER_SIZE + MAP_WIDTH * MAP_HEIGHT * 2);
    for (let y = 0; y < MAP_HEIGHT; y++) {
        for (let x = 0; x < MAP_WIDTH; x++) {
            writeMapCell(data, 0, x, y, { tileId, rotation: 0, elevation: 0 });
        }
    }
    return data;
}

function writeWord(data: Uint8Array, offset: number, value: number): void {
    data[offset] = value & 0xFF;
    data[offset + 1] = value >>> 8;
}

for (const fixture of [
    { courseId: 'SCENE01', tileId: 0x59 },
    { courseId: 'SCENE02', tileId: 0x51 },
] as const satisfies readonly { courseId: CourseId; tileId: number }[]) {
    test(`finds the finish-material tile in ${fixture.courseId}`, () => {
        const layout = TILE_BANK_LAYOUTS[fixture.courseId];
        const tileIndex = fixture.tileId - layout.firstTileId;
        const sceneData = createTileBank(layout, tileIndex, 0x1F);
        const sharedData = createTileBank(TILE_BANK_LAYOUTS.shared, 0, 0x08);

        assert.equal(
            findMapTileWithFaceMaterial(
                createMap(fixture.tileId),
                0,
                sharedData,
                sceneData,
                fixture.courseId,
                0x1F,
            ),
            fixture.tileId,
        );
    });
}

test('does not mistake an ordinary material for the finish surface', () => {
    const layout = TILE_BANK_LAYOUTS.SCENE02;
    const sceneData = createTileBank(layout, 0x51 - layout.firstTileId, 0x08);
    const sharedData = createTileBank(TILE_BANK_LAYOUTS.shared, 0, 0x08);

    assert.equal(
        findMapTileWithFaceMaterial(createMap(0x51), 0, sharedData, sceneData, 'SCENE02', 0x1F),
        null,
    );
});
