import assert from 'node:assert/strict';
import test from 'node:test';
import {
    CARDINAL_SIDES,
    entrySideForExit,
    isLaneEntry,
    isLaneExit,
    LANE_INDEX_SIZE,
    LANE_TILE_COUNT,
    laneHeightDelta,
    neighborCell,
    parseLaneBank,
    rotatedSide,
    worldLaneHeight,
} from '../src/shared/lane-connectivity';

function writeWord(data: Uint8Array, offset: number, value: number): void {
    data[offset] = value & 0xFF;
    data[offset + 1] = value >>> 8;
}

function createLaneBank(): Uint8Array {
    const data = new Uint8Array(LANE_INDEX_SIZE + 1 + 2 * 8);
    for (let tileId = 0; tileId < LANE_TILE_COUNT; tileId++) {
        writeWord(data, tileId * 2, LANE_INDEX_SIZE);
    }
    writeWord(data, 0, LANE_INDEX_SIZE);
    data[LANE_INDEX_SIZE] = 0x82;
    writeWord(data, LANE_INDEX_SIZE + 1, 0xC0);
    writeWord(data, LANE_INDEX_SIZE + 3, 0x1234);
    writeWord(data, LANE_INDEX_SIZE + 5, 0xFFFF);
    writeWord(data, LANE_INDEX_SIZE + 7, 0x8000);
    writeWord(data, LANE_INDEX_SIZE + 9, 0x81);
    writeWord(data, LANE_INDEX_SIZE + 11, 0xABCD);
    writeWord(data, LANE_INDEX_SIZE + 13, 0x0002);
    writeWord(data, LANE_INDEX_SIZE + 15, 0x0003);
    return data;
}

test('parses lane records and identifies entry and exit waypoints', () => {
    const [lane] = parseLaneBank(createLaneBank());

    assert.equal(lane.tileId, 0);
    assert.equal(lane.header, 0x82);
    assert.equal(lane.waypoints.length, 2);
    assert.deepEqual(lane.waypoints[0], {
        index: 0,
        flags: 0xC0,
        height: 0x1234,
        x: -1,
        z: -0x8000,
    });
    assert.equal(isLaneEntry(lane.waypoints[0]), true);
    assert.equal(isLaneExit(lane.waypoints[0]), false);
    assert.equal(isLaneEntry(lane.waypoints[1]), false);
    assert.equal(isLaneExit(lane.waypoints[1]), true);
});

test('computes rotated side, required entry, wrapped neighbors, and world height', () => {
    assert.deepEqual(CARDINAL_SIDES, ['N', 'E', 'S', 'W']);
    assert.equal(rotatedSide(3, 2), 1);
    assert.equal(entrySideForExit(1, 3), 0);
    assert.deepEqual(neighborCell(0, 0, 0, 32, 16), { x: 0, y: 15 });
    assert.deepEqual(neighborCell(31, 15, 1, 32, 16), { x: 0, y: 15 });
    assert.equal(worldLaneHeight(1, 75), 331);
    assert.equal(worldLaneHeight(0, 0xFFEE), 0xFFEE);
    assert.equal(laneHeightDelta(0xFFEE, 2), 20);
});

test('rejects truncated or out-of-index lane records', () => {
    const truncated = new Uint8Array(LANE_INDEX_SIZE + 1);
    writeWord(truncated, 0, LANE_INDEX_SIZE);
    truncated[LANE_INDEX_SIZE] = 0x81;
    assert.throws(() => parseLaneBank(truncated), /truncated/);

    const overlap = new Uint8Array(LANE_INDEX_SIZE);
    writeWord(overlap, 0, LANE_INDEX_SIZE - 1);
    overlap[LANE_INDEX_SIZE - 1] = 0x81;
    assert.throws(() => parseLaneBank(overlap), /overlaps the tile index/);
});
