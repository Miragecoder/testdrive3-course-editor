export const LANE_TILE_COUNT = 0x7B;
export const MAX_LANE_TILE_COUNT = 0x80;
export const PRIVATE_LANE_TILE_COUNT = 0x7F;
export const LANE_INDEX_SIZE = LANE_TILE_COUNT * 2;
export const LANE_WAYPOINT_SIZE = 8;
export const LANE_ELEVATION_STEP = 0x100;

export const CARDINAL_SIDES = ['N', 'E', 'S', 'W'] as const;
export type CardinalSide = 0 | 1 | 2 | 3;

export interface LaneWaypoint {
    readonly index: number;
    readonly flags: number;
    readonly height: number;
    readonly x: number;
    readonly z: number;
}

export interface TileLane {
    readonly tileId: number;
    readonly offset: number;
    readonly header: number;
    readonly waypoints: readonly LaneWaypoint[];
}

export function parseLaneBank(data: Uint8Array, tileCount = LANE_TILE_COUNT): readonly TileLane[] {
    if (!Number.isInteger(tileCount) || tileCount < 1 || tileCount > MAX_LANE_TILE_COUNT) {
        throw new RangeError(`Lane tile count must be between 1 and ${MAX_LANE_TILE_COUNT}.`);
    }
    const indexSize = tileCount * 2;
    if (data.length < indexSize) {
        throw new Error(`Lane bank is too short to contain its ${tileCount}-entry tile index.`);
    }

    return Array.from({ length: tileCount }, (_, tileId) => {
        const offset = readWord(data, tileId * 2);
        if (offset >= data.length) {
            throw new Error(`Lane data for tile 0x${tileId.toString(16)} is outside the bank.`);
        }

        const header = data[offset];
        const count = header & 0x7F;
        if (offset + 1 + count * LANE_WAYPOINT_SIZE > data.length) {
            throw new Error(`Lane waypoints for tile 0x${tileId.toString(16)} are truncated.`);
        }

        const waypoints = Array.from({ length: count }, (_, index) => {
            const waypointOffset = offset + 1 + index * LANE_WAYPOINT_SIZE;
            return {
                index,
                flags: readWord(data, waypointOffset),
                height: readWord(data, waypointOffset + 2),
                x: readSignedWord(data, waypointOffset + 4),
                z: readSignedWord(data, waypointOffset + 6),
            };
        });

        return { tileId, offset, header, waypoints };
    });
}

export function reverseLaneBank(lanes: readonly TileLane[]): readonly TileLane[] {
    return lanes.map((lane) => ({
        ...lane,
        header: (lane.header & 0x80) | lane.waypoints.length,
        waypoints: lane.waypoints.slice().reverse().map((waypoint, index) => ({
            ...waypoint,
            index,
            flags: reverseWaypointFlags(waypoint.flags),
        })),
    }));
}

export function serializeLaneBank(
    lanes: readonly TileLane[],
    tileCount: number,
): Uint8Array {
    if (!Number.isInteger(tileCount) || tileCount < 1 || tileCount > MAX_LANE_TILE_COUNT) {
        throw new RangeError(`Lane tile count must be between 1 and ${MAX_LANE_TILE_COUNT}.`);
    }

    const laneByTile = new Map<number, TileLane>();
    for (const lane of lanes) {
        if (!Number.isInteger(lane.tileId) || lane.tileId < 0 || lane.tileId >= tileCount) {
            throw new RangeError(`Lane tile ID must be between 0 and ${tileCount - 1}.`);
        }
        if (laneByTile.has(lane.tileId)) {
            throw new Error(`Lane bank contains duplicate tile ID 0x${lane.tileId.toString(16)}.`);
        }
        if (lane.waypoints.length > 0x7F) {
            throw new RangeError(`Tile 0x${lane.tileId.toString(16)} has too many waypoints.`);
        }
        laneByTile.set(lane.tileId, lane);
    }

    const indexSize = tileCount * 2;
    const size = indexSize + Array.from({ length: tileCount }, (_, tileId) => {
        const lane = laneByTile.get(tileId);
        return 1 + (lane?.waypoints.length ?? 0) * LANE_WAYPOINT_SIZE;
    }).reduce((total, recordSize) => total + recordSize, 0);
    if (size > 0x10000) {
        throw new RangeError('Serialized lane bank exceeds the 16-bit offset limit.');
    }
    const data = new Uint8Array(size);
    let offset = indexSize;

    for (let tileId = 0; tileId < tileCount; tileId++) {
        const lane = laneByTile.get(tileId);
        writeWord(data, tileId * 2, offset);
        data[offset++] = ((lane?.header ?? 0) & 0x80) | (lane?.waypoints.length ?? 0);
        for (const waypoint of lane?.waypoints ?? []) {
            writeWord(data, offset, waypoint.flags);
            writeWord(data, offset + 2, waypoint.height);
            writeWord(data, offset + 4, waypoint.x);
            writeWord(data, offset + 6, waypoint.z);
            offset += LANE_WAYPOINT_SIZE;
        }
    }

    return data;
}

export function isLaneEntry(waypoint: LaneWaypoint): boolean {
    return (waypoint.flags & 0xC0) === 0xC0;
}

export function isLaneExit(waypoint: LaneWaypoint): boolean {
    return (waypoint.flags & 0xC0) === 0x80;
}

export function rotatedSide(rotation: number, localSide: number): CardinalSide {
    return ((rotation + localSide) & 3) as CardinalSide;
}

export function entrySideForExit(worldExitSide: number, neighborRotation: number): CardinalSide {
    return ((worldExitSide + 2 - neighborRotation + 8) & 3) as CardinalSide;
}

export function neighborCell(
    x: number,
    y: number,
    worldSide: CardinalSide,
    width: number,
    height: number,
): { x: number; y: number } {
    const dx = [0, 1, 0, -1][worldSide];
    const dy = [-1, 0, 1, 0][worldSide];
    return {
        x: ((x + dx) % width + width) % width,
        y: ((y + dy) % height + height) % height,
    };
}

export function worldLaneHeight(mapElevation: number, waypointHeight: number): number {
    return (mapElevation * LANE_ELEVATION_STEP + waypointHeight) & 0xFFFF;
}

export function signedLaneHeight(height: number): number {
    return height & 0x8000 ? height - 0x10000 : height;
}

export function laneHeightDelta(from: number, to: number): number {
    const delta = (to - from) & 0xFFFF;
    return delta & 0x8000 ? delta - 0x10000 : delta;
}

function readWord(data: Uint8Array, offset: number): number {
    return data[offset] | (data[offset + 1] << 8);
}

function readSignedWord(data: Uint8Array, offset: number): number {
    const value = readWord(data, offset);
    return value & 0x8000 ? value - 0x10000 : value;
}

function reverseWaypointFlags(flags: number): number {
    let reversed = flags;
    const direction = flags & 0xC0;
    if (direction === 0x80) reversed = (reversed & ~0xC0) | 0xC0;
    else if (direction === 0xC0) reversed = (reversed & ~0xC0) | 0x80;

    if ((flags & 0x80) === 0) {
        reversed = (reversed & ~0x3F) | negateSignedSixBit(flags & 0x3F);
        reversed = (reversed & ~0x3F00) | (negateSignedSixBit((flags >>> 8) & 0x3F) << 8);
    }
    return reversed;
}

function negateSignedSixBit(value: number): number {
    const signedValue = value & 0x20 ? value - 0x40 : value;
    return (-signedValue) & 0x3F;
}

function writeWord(data: Uint8Array, offset: number, value: number): void {
    data[offset] = value & 0xFF;
    data[offset + 1] = (value >>> 8) & 0xFF;
}
