import { MAP_HEIGHT, MAP_WIDTH, readMapCell } from './course-map';
import {
    entrySideForExit,
    isLaneExit,
    laneHeightDelta,
    neighborCell,
    rotatedSide,
    worldLaneHeight,
    type TileLane,
} from './lane-connectivity';
import type { MapEntity, OpponentRouteScript } from './map-inspection';

export type LaneRouteStatus =
    | 'finish'
    | 'script-ended'
    | 'route-loop'
    | 'unmatched-exit'
    | 'unindexed-tile'
    | 'invalid-waypoint'
    | 'nondeterministic-branch'
    | 'step-limit';

export type LaneRouteEntry =
    | 'start'
    | 'waypoint'
    | 'branch'
    | 'lane-link'
    | 'same-cell-u-turn';

export interface LaneRouteStep {
    readonly x: number;
    readonly y: number;
    readonly tileId: number;
    readonly rotation: number;
    readonly elevation: number;
    readonly waypointIndex: number;
    readonly flags: number;
    readonly enteredBy: LaneRouteEntry;
    readonly heightDelta?: number;
    /** Index in script.branchModes consumed at this waypoint's control point, if any. */
    readonly scriptStepIndex?: number;
    /** Script mode value consumed at this waypoint's control point, if any. */
    readonly scriptStepMode?: number;
}

export interface LaneRouteTrace {
    readonly status: LaneRouteStatus;
    readonly steps: readonly LaneRouteStep[];
    readonly uTurnCount: number;
}

interface RouteState {
    x: number;
    y: number;
    waypointIndex: number;
    scriptPosition: number;
    behavior: number;
    enteredBy: LaneRouteEntry;
    heightDelta?: number;
}

export function traceOpponentLaneRoute(
    data: Uint8Array,
    mapOffset: number,
    lanes: readonly TileLane[],
    entity: Pick<MapEntity, 'cell' | 'waypoint'>,
    script: OpponentRouteScript,
    finishTileId: number,
    stepLimit = 8192,
): LaneRouteTrace {
    const laneByTile = new Map(lanes.map((lane) => [lane.tileId, lane]));
    const startX = entity.cell & 0x1F;
    const startY = (entity.cell >> 5) & 0x0F;
    if (startX < 0 || startX >= MAP_WIDTH || startY < 0 || startY >= MAP_HEIGHT) {
        return { status: 'invalid-waypoint', steps: [], uTurnCount: 0 };
    }

    let state: RouteState = {
        x: startX,
        y: startY,
        waypointIndex: entity.waypoint & 0x3F,
        scriptPosition: 0,
        behavior: script.initialMode,
        enteredBy: 'start',
    };
    let uTurnCount = 0;
    const visited = new Set<string>();
    const steps: LaneRouteStep[] = [];

    for (let count = 0; count < stepLimit; count++) {
        const cell = readMapCell(data, mapOffset, state.x, state.y);
        if (cell.tileId === finishTileId) {
            steps.push({
                ...state,
                tileId: cell.tileId,
                rotation: cell.rotation,
                elevation: cell.elevation,
                flags: 0,
            });
            return { status: 'finish', steps, uTurnCount };
        }

        const lane = laneByTile.get(cell.tileId);
        if (!lane) return { status: 'unindexed-tile', steps, uTurnCount };
        const waypoint = lane.waypoints[state.waypointIndex];
        if (!waypoint) return { status: 'invalid-waypoint', steps, uTurnCount };

        const stateKey = `${state.x}:${state.y}:${state.waypointIndex}:${state.scriptPosition}:${state.behavior}`;
        if (visited.has(stateKey)) return { status: 'route-loop', steps, uTurnCount };
        visited.add(stateKey);

        const controlFlags = waypoint.flags & 0x80 ? 0 : waypoint.flags;
        const consumesScript = !isLaneExit(waypoint) && (controlFlags & 0xBF3F) !== 0;
        const scriptStepIndex = consumesScript ? state.scriptPosition : undefined;
        const scriptStepMode = consumesScript ? script.branchModes[state.scriptPosition] : undefined;

        steps.push({
            ...state,
            tileId: cell.tileId,
            rotation: cell.rotation,
            elevation: cell.elevation,
            flags: waypoint.flags,
            ...(scriptStepIndex !== undefined ? { scriptStepIndex } : {}),
            ...(scriptStepMode !== undefined ? { scriptStepMode } : {}),
        });

        if (isLaneExit(waypoint)) {
            const worldSide = rotatedSide(cell.rotation, waypoint.flags & 3);
            const neighbor = neighborCell(state.x, state.y, worldSide, MAP_WIDTH, MAP_HEIGHT);
            const targetCell = readMapCell(data, mapOffset, neighbor.x, neighbor.y);
            const targetLane = laneByTile.get(targetCell.tileId);
            const entryFlags = 0xC0 | entrySideForExit(worldSide, targetCell.rotation);
            const targetEntry = targetLane?.waypoints.find((candidate) => candidate.flags === entryFlags);
            if (targetEntry && targetLane) {
                state = {
                    ...state,
                    x: neighbor.x,
                    y: neighbor.y,
                    waypointIndex: targetEntry.index,
                    enteredBy: 'lane-link',
                    heightDelta: laneHeightDelta(
                        worldLaneHeight(cell.elevation, waypoint.height),
                        worldLaneHeight(targetCell.elevation, targetEntry.height),
                    ),
                };
                continue;
            }

            const reverseEntryFlags = 0xC0 | (waypoint.flags & 3);
            const reverseEntry = lane.waypoints.find((candidate) => candidate.flags === reverseEntryFlags);
            if (!reverseEntry) return { status: 'unmatched-exit', steps, uTurnCount };
            uTurnCount++;
            state = {
                ...state,
                waypointIndex: reverseEntry.index,
                enteredBy: 'same-cell-u-turn',
                heightDelta: undefined,
            };
            continue;
        }

        let behavior = state.behavior;
        let scriptPosition = state.scriptPosition;
        if (consumesScript) {
            const nextMode = script.branchModes[state.scriptPosition];
            if (nextMode === undefined) {
                return {
                    status: script.terminates ? 'script-ended' : 'nondeterministic-branch',
                    steps,
                    uTurnCount,
                };
            }
            if (nextMode === 0) return { status: 'script-ended', steps, uTurnCount };
            behavior = nextMode;
            scriptPosition++;
        }

        const branchOffsets = getBranchOffsets(controlFlags, state.behavior);
        if (branchOffsets.length !== 1) {
            return { status: 'nondeterministic-branch', steps, uTurnCount };
        }
        const branchOffset = branchOffsets[0];
        const nextWaypointIndex = state.waypointIndex + branchOffset;
        if (nextWaypointIndex < 0 || nextWaypointIndex >= lane.waypoints.length) {
            return { status: 'invalid-waypoint', steps, uTurnCount };
        }
        state = {
            ...state,
            waypointIndex: nextWaypointIndex,
            scriptPosition,
            behavior,
            enteredBy: branchOffset !== 1 ? 'branch' : 'waypoint',
            heightDelta: undefined,
        };
    }

    return { status: 'step-limit', steps, uTurnCount };
}

function getBranchOffsets(flags: number, behavior: number): readonly number[] {
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
    return [...new Set(branchModes.map((branchMode) => getBranchOffset(flags, behavior, branchMode)))];
}

function getBranchOffset(flags: number, behavior: number, branchMode: number): number {
    const lowOffset = signedSixBit(flags & 0x3F);
    const highOffset = signedSixBit((flags >>> 8) & 0x3F);
    if (branchMode === 1 && lowOffset !== 0) return lowOffset;
    if (branchMode > 1 && highOffset !== 0) return highOffset;

    if (flags & 0x8000) {
        let selectedFlags = flags;
        if ((behavior & 7) === 6) selectedFlags = swapBytes(selectedFlags);
        if ((selectedFlags & 0x3F) === 0) selectedFlags = swapBytes(selectedFlags);
        return signedSixBit(selectedFlags & 0x3F);
    }
    return 1;
}

function signedSixBit(value: number): number {
    const offset = value & 0x3F;
    return offset & 0x20 ? offset - 0x40 : offset;
}

function swapBytes(value: number): number {
    return ((value & 0xFF) << 8) | (value >>> 8);
}
