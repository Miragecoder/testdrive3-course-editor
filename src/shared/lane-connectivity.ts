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

export interface TileEntryConnectivity {
    readonly entryWaypointIndex: number;
    readonly entryLocalSide: CardinalSide;
    readonly exitLocalSides: readonly CardinalSide[];
    readonly exitWaypointIndices: readonly number[];
}

export interface TileConnectivity {
    /** Reachable exits per entry waypoint, considering standard branch behaviors (2,3,4). */
    readonly byEntryWaypoint: readonly TileEntryConnectivity[];
}

const DEFAULT_BEHAVIORS = [2, 3, 4] as const;

export function getTileConnectivity(lane: TileLane): TileConnectivity {
    const byEntryWaypoint: TileEntryConnectivity[] = [];
    for (const waypoint of lane.waypoints) {
        if (!isLaneEntry(waypoint)) continue;
        const reachable = collectReachableExitWaypoints(lane, waypoint.index);
        const reachableIndices = [...reachable];
        const exitLocalSides = [...new Set(reachableIndices.map((idx) => (lane.waypoints[idx].flags & 3) as CardinalSide))]
            .sort((a, b) => a - b) as CardinalSide[];
        byEntryWaypoint.push({
            entryWaypointIndex: waypoint.index,
            entryLocalSide: (waypoint.flags & 3) as CardinalSide,
            exitLocalSides,
            exitWaypointIndices: reachableIndices.sort((a, b) => a - b),
        });
    }
    return { byEntryWaypoint };
}

function collectReachableExitWaypoints(lane: TileLane, startIndex: number): ReadonlySet<number> {
    const exits = new Set<number>();
    const queue: Array<{ index: number; behavior: number }> = [];
    const visited = new Set<string>();
    for (const behavior of DEFAULT_BEHAVIORS) queue.push({ index: startIndex, behavior });

    while (queue.length > 0) {
        const state = queue.shift()!;
        const key = `${state.index}:${state.behavior}`;
        if (visited.has(key)) continue;
        visited.add(key);

        const waypoint = lane.waypoints[state.index];
        if (!waypoint) continue;
        if (isLaneExit(waypoint)) {
            exits.add(state.index);
            continue;
        }

        const controlFlags = waypoint.flags & 0x80 ? 0 : waypoint.flags;
        const isControlPoint = (controlFlags & 0xBF3F) !== 0;
        const offsets = branchOffsetsForBehavior(controlFlags, state.behavior);
        for (const offset of offsets) {
            const nextIndex = state.index + offset;
            if (nextIndex < 0 || nextIndex >= lane.waypoints.length) continue;
            if (isControlPoint) {
                for (const nextBehavior of DEFAULT_BEHAVIORS) {
                    queue.push({ index: nextIndex, behavior: nextBehavior });
                }
            } else {
                queue.push({ index: nextIndex, behavior: state.behavior });
            }
        }
    }
    return exits;
}

function branchOffsetsForBehavior(flags: number, behavior: number): readonly number[] {
    const branchModes = behavior < 3
        ? [0]
        : behavior === 3
            ? [1]
            : behavior === 4
                ? [2]
                : behavior === 5
                    ? [0, 1]
                    : behavior === 6
                        ? [0, 2]
                        : [0, 1, 2];
    return [...new Set(branchModes.map((branchMode) => branchOffset(flags, behavior, branchMode)))];
}

function branchOffset(flags: number, behavior: number, branchMode: number): number {
    const lowOffset = signedSixBit(flags & 0x3F);
    const highOffset = signedSixBit((flags >>> 8) & 0x3F);
    if (branchMode === 1 && lowOffset !== 0) return lowOffset;
    if (branchMode > 1 && highOffset !== 0) return highOffset;

    if (flags & 0x8000) {
        let selectedFlags = flags;
        if ((behavior & 7) === 6) selectedFlags = swapBytesFlags(selectedFlags);
        if ((selectedFlags & 0x3F) === 0) selectedFlags = swapBytesFlags(selectedFlags);
        return signedSixBit(selectedFlags & 0x3F);
    }
    return 1;
}

function signedSixBit(value: number): number {
    const offset = value & 0x3F;
    return offset & 0x20 ? offset - 0x40 : offset;
}

function swapBytesFlags(value: number): number {
    return ((value & 0xFF) << 8) | (value >>> 8);
}

export function formatSideList(sides: readonly CardinalSide[]): string {
    return sides.map((side) => CARDINAL_SIDES[side]).join(', ') || '—';
}

/**
 * Patch tile 0x24 in a reversed lane bank so the west-approach branch that was
 * only reachable under behavior/mode 4 becomes reachable for behavior 4 at the
 * control point used by the reversed-tile flow, restoring the missing N exit in
 * the rot-270°/leg1 (6,13) SCENE03 case (and adjusting all 0x24 placements).
 *
 * In the reversed 0x24 record, waypoint 6 is a control point (flags 0x0005,
 * low6=+5, hi6=0). Setting hi6 to -4 (0x3C) makes behavior 4 take offset -4 to
 * waypoint 2 (local E exit) instead of +1, adding the previously unreachable
 * west→north turn for that orientation while preserving other branch options.
 */
export function patchReversedTile24(lanes: readonly TileLane[]): readonly TileLane[] {
    return lanes.map((lane) => {
        if (lane.tileId !== 0x24 || lane.waypoints.length <= 6) return lane;
        const waypoints = lane.waypoints.map((waypoint, index) => {
            if (index !== 6) return waypoint;
            const flags = (waypoint.flags & 0xC0FF) | (0x3C << 8);
            return flags === waypoint.flags ? waypoint : { ...waypoint, flags };
        });
        return { ...lane, waypoints };
    });
}

