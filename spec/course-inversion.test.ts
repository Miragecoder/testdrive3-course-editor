import assert from 'node:assert/strict';
import test from 'node:test';
import {
    COURSE_LAYOUTS,
    MAP_HEIGHT,
    MAP_RESOURCE_SIZE,
    MAP_WIDTH,
    applyCanonicalSkySeeds,
    readMapCell,
    readMapMode,
    writeMapCell,
    writeMapMode,
} from '../src/shared/course-map';
import { invertPacificCourse } from '../src/shared/course-inversion';
import { MAP_ENTITY_LAYOUT, readMapEntityTable } from '../src/shared/map-inspection';

const mapOffsets = COURSE_LAYOUTS.SCENE01.mapOffsets;
const finishTileId = 0x59;

function writeWord(data: Uint8Array, offset: number, value: number): void {
    data[offset] = value & 0xFF;
    data[offset + 1] = value >>> 8;
}

function readWord(data: Uint8Array, offset: number): number {
    return data[offset] | (data[offset + 1] << 8);
}

function createPacificFixture(): Uint8Array {
    const data = new Uint8Array(mapOffsets[4] + MAP_RESOURCE_SIZE + 1);
    data[data.length - 1] = 0xA5;

    mapOffsets.forEach((mapOffset, leg) => {
        const start = { x: 2 + (leg % 3), y: 6 + leg };
        const finish = { x: 25 - leg, y: 2 + leg };
        for (let y = 0; y < MAP_HEIGHT; y++) {
            for (let x = 0; x < MAP_WIDTH; x++) {
                writeMapCell(data, mapOffset, x, y, {
                    tileId: (x + y) % 0x58,
                    rotation: (x + y) % 4,
                    elevation: (x * 3 + y) % 0x40,
                });
            }
        }
        writeMapCell(data, mapOffset, start.x, start.y, {
            tileId: leg === 2 ? 0x7A : 0x20 + leg,
            rotation: leg % 4,
            elevation: 5 + leg,
        });
        if (leg === 2) {
            writeMapCell(data, mapOffset, (start.x + MAP_WIDTH - 1) % MAP_WIDTH, start.y, {
                tileId: 0x30,
                rotation: 3,
                elevation: 5 + leg,
            });
        }
        writeMapCell(data, mapOffset, finish.x, finish.y, {
            tileId: finishTileId,
            rotation: leg === 4 ? (leg + 2) % 4 : (leg + 1) % 4,
            elevation: 12 + leg,
        });
        const mode = leg % 2 as 0 | 1;
        writeMapMode(data, mapOffset, mode);
        applyCanonicalSkySeeds(data, mapOffset, mode);
        writeWord(data, mapOffset + 0x32, 0x0203);
        writeWord(data, mapOffset + 0x1F27 + 0x23 * 2, 0x6767 + leg * 0x0101);
        for (let i = 0; i < 4; i++) {
            const offset = mapOffset + 0x2E + i;
            data[offset] = (data[offset] + leg + i) & 0xFF;
        }

        writeWord(data, mapOffset + MAP_ENTITY_LAYOUT.collision, 4);
        writeWord(data, mapOffset + MAP_ENTITY_LAYOUT.ai, 4);
        writeWord(data, mapOffset + MAP_ENTITY_LAYOUT.lod, 0);

        const centerX = (MAP_HEIGHT - 0.5 - start.y) * 1024;
        const centerZ = (start.x + 0.5) * 1024;
        const entities = [
            { flags: 0x2001, x: centerX + 64, z: centerZ + 32, cell: 0, heading: 0, waypoint: 0 },
            { flags: 0x62C2, x: centerX + 64, z: centerZ + 160, cell: start.y * MAP_WIDTH + start.x, heading: 0, waypoint: 0x43 },
            { flags: 0x63C3, x: centerX + 64, z: centerZ + 352, cell: start.y * MAP_WIDTH + start.x, heading: 0, waypoint: 0x43 },
            { flags: 0x2737, x: centerX + 150, z: centerZ + 500, cell: 355, heading: 0x0260, waypoint: 0 },
        ];
        for (const [slot, entity] of entities.entries()) {
            const arrayOffset = slot * 2;
            writeWord(data, mapOffset + MAP_ENTITY_LAYOUT.flags + arrayOffset, entity.flags);
            writeWord(data, mapOffset + MAP_ENTITY_LAYOUT.x + arrayOffset, entity.x);
            writeWord(data, mapOffset + MAP_ENTITY_LAYOUT.z + arrayOffset, entity.z);
            writeWord(data, mapOffset + MAP_ENTITY_LAYOUT.heading + arrayOffset, entity.heading);
            writeWord(data, mapOffset + MAP_ENTITY_LAYOUT.cell + arrayOffset, entity.cell);
            writeWord(data, mapOffset + MAP_ENTITY_LAYOUT.waypoint + arrayOffset, entity.waypoint);
        }
        writeWord(data, mapOffset + 0x0761, centerZ + 32);
        writeWord(data, mapOffset + 0x09E1, centerX + 64);
        writeWord(data, mapOffset + 0x0C61, 305 + (5 + leg) * 256);
    });

    return data;
}

function cellOfTile(data: Uint8Array, mapOffset: number, tileId: number): { x: number; y: number } {
    const matches: { x: number; y: number }[] = [];
    for (let y = 0; y < MAP_HEIGHT; y++) {
        for (let x = 0; x < MAP_WIDTH; x++) {
            if (readMapCell(data, mapOffset, x, y).tileId === tileId) matches.push({ x, y });
        }
    }
    assert.equal(matches.length, 1);
    return matches[0];
}

function reflected(cell: { x: number; y: number }): { x: number; y: number } {
    return { x: MAP_WIDTH - 1 - cell.x, y: MAP_HEIGHT - 1 - cell.y };
}

function rotateOffset(x: number, z: number, quarterTurns: number): { x: number; z: number } {
    switch (quarterTurns) {
        case 0: return { x, z };
        case 1: return { x: -z, z: x };
        case 2: return { x: -x, z: -z };
        default: return { x: z, z: -x };
    }
}

function rotateHeading(heading: number, quarterTurns: number): number {
    const turn = quarterTurns * 0x40;
    return ((((heading >>> 8) + turn) & 0xFF) << 8) | (((heading & 0xFF) + turn) & 0xFF);
}

function headingAdjustment(startTileId: number, startRotation: number, finishRotation: number): number {
    if (startTileId === 0x7A) return 0;
    const adjustment = (finishRotation - startRotation + 4) % 4;
    return adjustment === 2 ? 0 : adjustment;
}

test('inverts Pacific leg order, lighting, grid, finish, and racer placement', () => {
    const source = createPacificFixture();
    const original = source.slice();
    const inverted = invertPacificCourse(source);

    assert.deepEqual(source, original);
    assert.equal(inverted[inverted.length - 1], 0xA5);

    for (let destination = 0; destination < mapOffsets.length; destination++) {
        const sourceLeg = mapOffsets.length - 1 - destination;
        const sourceOffset = mapOffsets[sourceLeg];
        const destinationOffset = mapOffsets[destination];
        const sourceFinish = cellOfTile(source, sourceOffset, finishTileId);
        const sourceStartEntity = readMapEntityTable(source, sourceOffset).entities[0];
        const sourceStart = { x: Math.floor(sourceStartEntity.mapX), y: Math.floor(sourceStartEntity.mapY) };
        const targetStart = reflected(sourceFinish);
        const originalStartTile = readMapCell(source, sourceOffset, sourceStart.x, sourceStart.y);
        const sourceApproach = { x: (sourceStart.x + MAP_WIDTH - 1) % MAP_WIDTH, y: sourceStart.y };
        const targetFinish = originalStartTile.tileId === 0x7A
            ? reflected(sourceApproach)
            : reflected(sourceStart);

        assert.equal(readMapMode(inverted, destinationOffset), 1 - readMapMode(source, sourceOffset));
        const sourceFogColor = readWord(source, sourceOffset + 0x1F27 + 0x23 * 2);
        const expectedFogColor = sourceFogColor + (readMapMode(source, sourceOffset) === 0 ? 0x0101 : -0x0101);
        assert.equal(readWord(inverted, destinationOffset + 0x1F27 + 0x23 * 2), expectedFogColor);
        assert.equal(readMapCell(inverted, destinationOffset, targetFinish.x, targetFinish.y).tileId, finishTileId);

        const movedStartTile = readMapCell(inverted, destinationOffset, targetStart.x, targetStart.y);
        const movedFinishTile = readMapCell(inverted, destinationOffset, targetFinish.x, targetFinish.y);
        const originalFinishTile = readMapCell(source, sourceOffset, sourceFinish.x, sourceFinish.y);
        const originalApproachTile = readMapCell(source, sourceOffset, sourceApproach.x, sourceApproach.y);
        assert.equal(movedStartTile.tileId, originalStartTile.tileId === 0x7A
            ? originalApproachTile.tileId
            : originalStartTile.tileId);
        assert.equal(movedStartTile.rotation, (originalFinishTile.rotation + 2) % 4);
        assert.equal(movedStartTile.elevation, originalFinishTile.elevation);
        assert.equal(movedFinishTile.rotation, ((originalStartTile.tileId === 0x7A
            ? originalApproachTile.rotation
            : originalStartTile.rotation) + 2) % 4);
        assert.equal(movedFinishTile.elevation, originalStartTile.tileId === 0x7A
            ? originalApproachTile.elevation
            : originalStartTile.elevation);
        if (originalStartTile.tileId === 0x7A) {
            const preservedIntersection = reflected(sourceStart);
            assert.equal(readMapCell(inverted, destinationOffset, preservedIntersection.x, preservedIntersection.y).tileId, 0x7A);
        }

        const sourceCell = readMapCell(source, sourceOffset, 4, 4);
        const rotatedCell = readMapCell(inverted, destinationOffset, MAP_WIDTH - 5, MAP_HEIGHT - 5);
        assert.equal(rotatedCell.tileId, sourceCell.tileId);
        assert.equal(rotatedCell.rotation, (sourceCell.rotation + 2) % 4);
        assert.equal(rotatedCell.elevation, sourceCell.elevation);

        const sourceMode = readMapMode(source, sourceOffset);
        const skyDeltas = sourceMode === 0 ? [2, -1, 7, 6] : [-2, 1, -7, -6];
        const expectedSkyColors = Array.from(source.subarray(sourceOffset + 0x2E, sourceOffset + 0x32),
            (value, index) => (value + skyDeltas[index] + 0x100) % 0x100);
        assert.deepEqual(
            Array.from(inverted.subarray(destinationOffset + 0x2E, destinationOffset + 0x32)),
            expectedSkyColors,
        );

        const sourceEntities = readMapEntityTable(source, sourceOffset).entities;
        const invertedEntities = readMapEntityTable(inverted, destinationOffset).entities;
        const originalStartHeight = readMapCell(source, sourceOffset, sourceStart.x, sourceStart.y).elevation;
        const originalFinishHeight = readMapCell(source, sourceOffset, sourceFinish.x, sourceFinish.y).elevation;
        const sourceSpriteX = readWord(source, sourceOffset + 0x0761);
        const sourceSpriteZ = readWord(source, sourceOffset + 0x09E1);
        const sourceSpriteY = readWord(source, sourceOffset + 0x0C61);
        const targetSpriteX = readWord(inverted, destinationOffset + 0x0761);
        const targetSpriteZ = readWord(inverted, destinationOffset + 0x09E1);
        const targetSpriteY = readWord(inverted, destinationOffset + 0x0C61);
        const sourceCenterX = (MAP_HEIGHT - 0.5 - sourceStart.y) * 1024;
        const sourceCenterZ = (sourceStart.x + 0.5) * 1024;
        const targetCenterX = (MAP_HEIGHT - 0.5 - targetStart.y) * 1024;
        const targetCenterZ = (targetStart.x + 0.5) * 1024;
        const headingDelta = headingAdjustment(
            originalStartTile.tileId,
            originalStartTile.rotation,
            originalFinishTile.rotation,
        );
        const spriteOffset = rotateOffset(sourceSpriteZ - sourceCenterX, sourceSpriteX - sourceCenterZ, headingDelta);
        assert.equal(targetSpriteX, ((targetCenterZ + spriteOffset.z) % (MAP_WIDTH * 1024) + MAP_WIDTH * 1024) % (MAP_WIDTH * 1024));
        assert.equal(targetSpriteZ, ((targetCenterX + spriteOffset.x) % (MAP_HEIGHT * 1024) + MAP_HEIGHT * 1024) % (MAP_HEIGHT * 1024));
        assert.equal(targetSpriteY, sourceSpriteY + (originalFinishHeight - originalStartHeight) * 256);
        const expectedEntityYDelta = (originalFinishHeight - originalStartHeight) * 2048;
        for (const modelId of [1, 2, 3]) {
            const before = sourceEntities.find((entity) => entity.modelId === modelId)!;
            const after = invertedEntities.find((entity) => entity.modelId === modelId)!;
            assert.equal(Math.floor(after.mapX), targetStart.x);
            assert.equal(Math.floor(after.mapY), targetStart.y);
            assert.equal(after.heading, rotateHeading(before.heading, headingDelta));
            assert.equal(after.y, before.y + expectedEntityYDelta);
            if (originalStartTile.tileId === 0x7A && modelId !== 1) assert.equal(after.waypoint, 0x40);
            assert.equal(after.cell, modelId === 1 ? before.cell : targetStart.y * MAP_WIDTH + targetStart.x);
            const offset = rotateOffset(before.x - sourceCenterX, before.z - sourceCenterZ, headingDelta);
            const expectedMapX = ((targetStart.x + 0.5 + offset.z / 1024) % MAP_WIDTH + MAP_WIDTH) % MAP_WIDTH;
            const expectedMapY = ((targetStart.y + 0.5 - offset.x / 1024) % MAP_HEIGHT + MAP_HEIGHT) % MAP_HEIGHT;
            assert.ok(Math.abs(after.mapX - expectedMapX) < 0.001);
            assert.ok(Math.abs(after.mapY - expectedMapY) < 0.001);
        }
        assert.ok(invertedEntities.every((entity) =>
            entity.mapX >= 0 && entity.mapX < MAP_WIDTH && entity.mapY >= 0 && entity.mapY < MAP_HEIGHT));
    }
});

test('applying the Pacific inversion twice restores the original DAT', () => {
    const source = createPacificFixture();
    const restored = invertPacificCourse(invertPacificCourse(source));
    const differences: string[] = [];
    for (let offset = 0; offset < source.length && differences.length < 20; offset++) {
        if (restored[offset] !== source[offset]) {
            differences.push(`${offset.toString(16)}: ${source[offset]} -> ${restored[offset]}`);
        }
    }
    assert.deepEqual(restored, source, `First differing offsets: ${differences.join(', ')}`);
});

test('rejects a leg without exactly one finish tile', () => {
    const source = createPacificFixture();
    const sourceFinish = cellOfTile(source, mapOffsets[0], finishTileId);
    writeMapCell(source, mapOffsets[0], sourceFinish.x, sourceFinish.y, {
        tileId: 0x40,
        rotation: 0,
        elevation: 0,
    });

    assert.throws(() => invertPacificCourse(source), /Expected one Pacific finish tile/);
});
