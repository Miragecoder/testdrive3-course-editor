import assert from 'node:assert/strict';
import test from 'node:test';
import {
    CARDINAL_SIDES,
    entrySideForExit,
    isLaneEntry,
    isLaneExit,
    LANE_INDEX_SIZE,
    LANE_TILE_COUNT,
    MAX_LANE_TILE_COUNT,
    PRIVATE_LANE_TILE_COUNT,
    laneHeightDelta,
    neighborCell,
    parseLaneBank,
    reverseLaneBank,
    rotatedSide,
    serializeLaneBank,
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

test('rejects truncated or out-of-bank lane records', () => {
    const truncated = new Uint8Array(LANE_INDEX_SIZE + 1);
    writeWord(truncated, 0, LANE_INDEX_SIZE);
    truncated[LANE_INDEX_SIZE] = 0x81;
    assert.throws(() => parseLaneBank(truncated), /truncated/);

    const outside = new Uint8Array(LANE_INDEX_SIZE + 1);
    writeWord(outside, 0, outside.length);
    assert.throws(() => parseLaneBank(outside), /outside the bank/);
});

test('parses all 128 tile index entries for a scene-specific lane bank', () => {
    const data = new Uint8Array(MAX_LANE_TILE_COUNT * 2 + 1);
    for (let tileId = 0; tileId < MAX_LANE_TILE_COUNT; tileId++) {
        writeWord(data, tileId * 2, MAX_LANE_TILE_COUNT * 2);
    }

    const lanes = parseLaneBank(data, MAX_LANE_TILE_COUNT);
    assert.equal(lanes.length, MAX_LANE_TILE_COUNT);
    assert.equal(lanes.at(-1)?.tileId, 0x7F);
});

test('follows a lane pointer that overlaps the final tile-index word', () => {
    const data = new Uint8Array(0x190);
    for (let tileId = 0; tileId < MAX_LANE_TILE_COUNT; tileId++) {
        writeWord(data, tileId * 2, 0x100);
    }
    writeWord(data, 0x3D * 2, 0xFE);
    writeWord(data, 0x7F * 2, 0x188);
    data[0x100] = 0;
    data[0x188] = 0;

    const lanes = parseLaneBank(data, MAX_LANE_TILE_COUNT);
    assert.equal(lanes[0x3D].offset, 0xFE);
    assert.equal(lanes[0x3D].waypoints.length, 8);
});

test('parses a 127-entry private bank whose waypoint data begins after its index', () => {
    const data = new Uint8Array(0x140);
    for (let tileId = 0; tileId < PRIVATE_LANE_TILE_COUNT; tileId++) {
        writeWord(data, tileId * 2, PRIVATE_LANE_TILE_COUNT * 2);
    }
    data[PRIVATE_LANE_TILE_COUNT * 2] = 0x88;

    const lanes = parseLaneBank(data, PRIVATE_LANE_TILE_COUNT);
    assert.equal(lanes.length, PRIVATE_LANE_TILE_COUNT);
    assert.equal(lanes[0x3D].offset, PRIVATE_LANE_TILE_COUNT * 2);
    assert.equal(lanes[0x3D].waypoints.length, 8);
});

test('reverses lane waypoint order, endpoint direction, and signed branch offsets', () => {
    const lanes = parseLaneBank(createLaneBank());
    const [reversed] = reverseLaneBank(lanes);

    assert.deepEqual(reversed.waypoints, [
        { index: 0, flags: 0xC1, height: 0xABCD, x: 2, z: 3 },
        { index: 1, flags: 0x80, height: 0x1234, x: -1, z: -0x8000 },
    ]);

    const branch = parseLaneBank(createBranchLaneBank())[0];
    assert.equal(reverseLaneBank([branch])[0].waypoints[0].flags, 0x803E);
});

test('serializes reversed lanes as a parseable private bank with empty missing tiles', () => {
    const lanes = reverseLaneBank(parseLaneBank(createLaneBank()));
    const serialized = serializeLaneBank(lanes, PRIVATE_LANE_TILE_COUNT);
    const parsed = parseLaneBank(serialized, PRIVATE_LANE_TILE_COUNT);

    assert.equal(parsed.length, PRIVATE_LANE_TILE_COUNT);
    assert.deepEqual(parsed[0].waypoints, lanes[0].waypoints);
    assert.equal(parsed[PRIVATE_LANE_TILE_COUNT - 1].waypoints.length, 0);
});

function createBranchLaneBank(): Uint8Array {
    const data = new Uint8Array(LANE_INDEX_SIZE + 1 + 8);
    for (let tileId = 0; tileId < LANE_TILE_COUNT; tileId++) {
        writeWord(data, tileId * 2, LANE_INDEX_SIZE);
    }
    data[LANE_INDEX_SIZE] = 1;
    writeWord(data, LANE_INDEX_SIZE + 1, 0x8002);
    return data;
}
