import assert from 'node:assert/strict';
import test from 'node:test';
import {
    LANE_INDEX_SIZE,
    LANE_TILE_COUNT,
    parseLaneBank,
    type LaneWaypoint,
} from '../src/shared/lane-connectivity';
import { traceOpponentLaneRoute } from '../src/shared/lane-routes';
import {
    MAP_HEIGHT,
    MAP_HEADER_SIZE,
    MAP_WIDTH,
    writeMapCell,
} from '../src/shared/course-map';
import type { OpponentRouteScript } from '../src/shared/map-inspection';

interface LaneFixture {
    tileId: number;
    waypoints: readonly Pick<LaneWaypoint, 'flags' | 'height' | 'x' | 'z'>[];
}

function createLaneBank(records: readonly LaneFixture[]): Uint8Array {
    const dataSize = 1 + records.reduce((sum, record) => sum + 1 + record.waypoints.length * 8, 0);
    const data = new Uint8Array(LANE_INDEX_SIZE + dataSize);
    for (let tileId = 0; tileId < LANE_TILE_COUNT; tileId++) {
        writeWord(data, tileId * 2, LANE_INDEX_SIZE);
    }

    let offset = LANE_INDEX_SIZE;
    data[offset++] = 0;
    for (const record of records) {
        writeWord(data, record.tileId * 2, offset);
        data[offset++] = record.waypoints.length;
        for (const waypoint of record.waypoints) {
            writeWord(data, offset, waypoint.flags);
            writeWord(data, offset + 2, waypoint.height);
            writeWord(data, offset + 4, waypoint.x);
            writeWord(data, offset + 6, waypoint.z);
            offset += 8;
        }
    }
    return data;
}

function createMap(): Uint8Array {
    return new Uint8Array(MAP_HEADER_SIZE + MAP_WIDTH * MAP_HEIGHT * 2);
}

function waypoint(flags: number): Pick<LaneWaypoint, 'flags' | 'height' | 'x' | 'z'> {
    return { flags, height: 2, x: 0, z: 0 };
}

const script: OpponentRouteScript = {
    slot: 1,
    initialMode: 2,
    branchModes: [],
    terminates: false,
};

test('traces an opponent from its start waypoint through a matched lane exit to the finish', () => {
    const data = createMap();
    writeMapCell(data, 0, 0, 0, { tileId: 0x30, rotation: 0, elevation: 1 });
    writeMapCell(data, 0, 1, 0, { tileId: 0x59, rotation: 0, elevation: 1 });
    const lanes = createLaneBank([
        { tileId: 0x30, waypoints: [waypoint(0), waypoint(0x81)] },
        { tileId: 0x59, waypoints: [waypoint(0xC3)] },
    ]);

    const trace = traceOpponentLaneRoute(
        data,
        0,
        parseLaneBank(lanes),
        { cell: 0, waypoint: 0x40 },
        script,
        0x59,
    );

    assert.equal(trace.status, 'finish');
    assert.deepEqual(trace.steps.map((step) => [step.x, step.y, step.waypointIndex]), [
        [0, 0, 0],
        [0, 0, 1],
        [1, 0, 0],
    ]);
    assert.equal(trace.steps[2].enteredBy, 'lane-link');
    assert.equal(trace.steps[2].heightDelta, 0);
});

test('follows the branch selected by the opponent script', () => {
    const data = createMap();
    writeMapCell(data, 0, 0, 0, { tileId: 0x30, rotation: 0, elevation: 1 });
    writeMapCell(data, 0, 1, 0, { tileId: 0x59, rotation: 0, elevation: 1 });
    const lanes = createLaneBank([
        { tileId: 0x30, waypoints: [waypoint(0x8002), waypoint(0), waypoint(0x81)] },
        { tileId: 0x59, waypoints: [waypoint(0xC3)] },
    ]);

    const trace = traceOpponentLaneRoute(
        data,
        0,
        parseLaneBank(lanes),
        { cell: 0, waypoint: 0x40 },
        { ...script, branchModes: [3] },
        0x59,
    );

    assert.equal(trace.status, 'finish');
    assert.deepEqual(trace.steps.map((step) => step.waypointIndex), [0, 2, 0]);
    assert.equal(trace.steps[1].enteredBy, 'branch');
});

test('does not consume route-script steps at lane-entry waypoints', () => {
    const data = createMap();
    writeMapCell(data, 0, 0, 0, { tileId: 0x30, rotation: 0, elevation: 1 });
    writeMapCell(data, 0, 1, 0, { tileId: 0x59, rotation: 0, elevation: 1 });
    const lanes = createLaneBank([
        { tileId: 0x30, waypoints: [waypoint(0xC3), waypoint(0), waypoint(0x81)] },
        { tileId: 0x59, waypoints: [waypoint(0xC3)] },
    ]);

    const trace = traceOpponentLaneRoute(
        data,
        0,
        parseLaneBank(lanes),
        { cell: 0, waypoint: 0x40 },
        script,
        0x59,
    );

    assert.equal(trace.status, 'finish');
    assert.deepEqual(trace.steps.map((step) => step.waypointIndex), [0, 1, 2, 0]);
});

test('chooses a waypoint branch using the behavior active before the next script value', () => {
    const data = createMap();
    writeMapCell(data, 0, 0, 0, { tileId: 0x30, rotation: 0, elevation: 1 });
    writeMapCell(data, 0, 1, 0, { tileId: 0x59, rotation: 0, elevation: 1 });
    const lanes = createLaneBank([
        { tileId: 0x30, waypoints: [waypoint(0x8001), waypoint(0x0002), waypoint(0x80), waypoint(0x81)] },
        { tileId: 0x59, waypoints: [waypoint(0xC3)] },
    ]);

    const trace = traceOpponentLaneRoute(
        data,
        0,
        parseLaneBank(lanes),
        { cell: 0, waypoint: 0x40 },
        { ...script, branchModes: [3, 4] },
        0x59,
    );

    assert.equal(trace.status, 'finish');
    assert.deepEqual(trace.steps.map((step) => step.waypointIndex), [0, 1, 3, 0]);
});

test('records the engine’s same-cell U-turn when an exit has no neighbor entry', () => {
    const data = createMap();
    writeMapCell(data, 0, 1, 1, { tileId: 0x30, rotation: 0, elevation: 1 });
    const lanes = createLaneBank([
        { tileId: 0x30, waypoints: [waypoint(0xC0), waypoint(0x80)] },
    ]);

    const trace = traceOpponentLaneRoute(
        data,
        0,
        parseLaneBank(lanes),
        { cell: 33, waypoint: 0x41 },
        script,
        0x59,
    );

    assert.equal(trace.status, 'route-loop');
    assert.equal(trace.uTurnCount, 1);
    assert.equal(trace.steps[1].enteredBy, 'same-cell-u-turn');
});

test('starts from the stored tile cell instead of rounded world coordinates', () => {
    const data = createMap();
    writeMapCell(data, 0, 3, 1, { tileId: 0x30, rotation: 0, elevation: 1 });
    writeMapCell(data, 0, 4, 1, { tileId: 0x59, rotation: 0, elevation: 1 });
    const lanes = createLaneBank([
        { tileId: 0x30, waypoints: [waypoint(0), waypoint(0x81)] },
        { tileId: 0x59, waypoints: [waypoint(0xC3)] },
    ]);

    const trace = traceOpponentLaneRoute(
        data,
        0,
        parseLaneBank(lanes),
        { cell: (1 << 5) | 3, waypoint: 0x40 },
        script,
        0x59,
    );

    assert.equal(trace.status, 'finish');
    assert.deepEqual(trace.steps.map((step) => [step.x, step.y]), [[3, 1], [3, 1], [4, 1]]);
});

function writeWord(data: Uint8Array, offset: number, value: number): void {
    data[offset] = value & 0xFF;
    data[offset + 1] = value >>> 8;
}
