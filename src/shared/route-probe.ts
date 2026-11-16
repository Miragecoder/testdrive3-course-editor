import { MAP_HEIGHT, MAP_WIDTH, readMapCell } from './course-map';
import {
    entrySideForExit,
    isLaneExit,
    neighborCell,
    rotatedSide,
    type TileLane,
} from './lane-connectivity';
import type { MapEntity } from './map-inspection';

export interface ProbedPath {
    readonly initialMode: number;
    readonly branchModes: readonly number[];
    readonly terminates: boolean;
    readonly steps: number;
    readonly signature: string;
    readonly pathCells: readonly string[];
    readonly exitEntryLinks: number;
    readonly scriptControlPoints: number;
}

interface ProbeState {
    x: number;
    y: number;
    waypointIndex: number;
    scriptPosition: number;
    behavior: number;
    initialMode: number;
    branchModes: number[];
    steps: number;
    pathKey: string;
    pathCells: string[];
    exitEntryLinks: number;
    scriptControlPoints: number;
}

const DEFAULT_MODE_CANDIDATES = [2, 3, 4] as const;

function logJson(label: string, value: unknown): void {
    console.log(`${label} ${JSON.stringify(value)}`);
}

export function probeOpponentPaths(
    data: Uint8Array,
    mapOffset: number,
    lanes: readonly TileLane[],
    entity: Pick<MapEntity, 'cell' | 'waypoint'>,
    finishTileId: number,
    options?: { maxResults?: number; stepLimit?: number; maxStates?: number },
): readonly ProbedPath[] {
    const maxResults = options?.maxResults ?? 16;
    const stepLimit = options?.stepLimit ?? 4096;
    const maxStates = options?.maxStates ?? 30000;
    const laneByTile = new Map(lanes.map((lane) => [lane.tileId, lane]));
    const startX = entity.cell & 0x1F;
    const startY = (entity.cell >> 5) & 0x0F;
    const startWp = entity.waypoint & 0x3F;

    console.group(`[route-probe] start cell=${entity.cell} (${startX},${startY}) wp=${startWp} finishTile=0x${finishTileId.toString(16)} maxResults=${maxResults} stepLimit=${stepLimit} maxStates=${maxStates}`);
    if (startX < 0 || startX >= MAP_WIDTH || startY < 0 || startY >= MAP_HEIGHT) {
        console.warn('[route-probe] invalid start cell, aborting');
        console.groupEnd();
        return [];
    }

    const results: ProbedPath[] = [];
    const resultSeen = new Set<string>();
    const visited = new Set<string>();
    const queue: ProbeState[] = [];
    let states = 0;
    let rejectedUnmatchedExit = 0;
    let rejectedUnindexed = 0;
    let rejectedInvalidWaypoint = 0;
    let rejectedNoBranch = 0;
    let rejectedSameTileSpur = 0;
    let reachedFinishRaw = 0;

    for (const initialMode of DEFAULT_MODE_CANDIDATES) {
        const startKey = `${startX},${startY},${startWp}`;
        queue.push({
            x: startX,
            y: startY,
            waypointIndex: startWp,
            scriptPosition: 0,
            behavior: initialMode,
            initialMode,
            branchModes: [],
            steps: 0,
            pathKey: startKey,
            pathCells: [startKey],
            exitEntryLinks: 0,
            scriptControlPoints: 0,
        });
    }

    while (queue.length > 0 && states < maxStates && uniqueResultCount(results) < maxResults) {
        const state = queue.shift()!;
        states++;
        if (state.steps > stepLimit) continue;

        const cell = readMapCell(data, mapOffset, state.x, state.y);
        if (cell.tileId === finishTileId) {
            reachedFinishRaw++;
            const signature = state.pathKey;
            const dedupe = `${state.initialMode}|${state.branchModes.join(',')}|${signature}`;
            if (!resultSeen.has(dedupe)) {
                resultSeen.add(dedupe);
                const result: ProbedPath = {
                    initialMode: state.initialMode,
                    branchModes: [...state.branchModes],
                    terminates: false,
                    steps: state.steps,
                    signature,
                    pathCells: [...state.pathCells],
                    exitEntryLinks: state.exitEntryLinks,
                    scriptControlPoints: state.scriptControlPoints,
                };
                results.push(result);
                logJson('[route-probe] found path', {
                    initialMode: result.initialMode,
                    branchModes: result.branchModes,
                    steps: result.steps,
                    exitEntryLinks: result.exitEntryLinks,
                    scriptControlPoints: result.scriptControlPoints,
                    pathStart: result.pathCells.slice(0, 8),
                    pathTail: result.pathCells.slice(-8),
                });
            }
            continue;
        }

        const lane = laneByTile.get(cell.tileId);
        if (!lane) { rejectedUnindexed++; continue; }
        const waypoint = lane.waypoints[state.waypointIndex];
        if (!waypoint) { rejectedInvalidWaypoint++; continue; }

        const visitKey = `${state.x}:${state.y}:${state.waypointIndex}:${state.scriptPosition}:${state.behavior}:${state.branchModes.join(',')}`;
        if (visited.has(visitKey)) continue;
        visited.add(visitKey);

        if (isLaneExit(waypoint)) {
            const worldSide = rotatedSide(cell.rotation, waypoint.flags & 3);
            const neighbor = neighborCell(state.x, state.y, worldSide, MAP_WIDTH, MAP_HEIGHT);
            const targetCell = readMapCell(data, mapOffset, neighbor.x, neighbor.y);
            const targetLane = laneByTile.get(targetCell.tileId);
            const entryFlags = 0xC0 | entrySideForExit(worldSide, targetCell.rotation);
            const targetEntry = targetLane?.waypoints.find((candidate) => candidate.flags === entryFlags);
            if (targetEntry && targetLane) {
                const neighborTilePrefix = `${neighbor.x},${neighbor.y},`;
                if (state.pathCells.some((cellKey) => cellKey.startsWith(neighborTilePrefix))) {
                    rejectedSameTileSpur++;
                    continue;
                }
                const nextKey = `${neighbor.x},${neighbor.y},${targetEntry.index}`;
                queue.push({
                    ...state,
                    x: neighbor.x,
                    y: neighbor.y,
                    waypointIndex: targetEntry.index,
                    steps: state.steps + 1,
                    pathKey: `${state.pathKey}>${nextKey}`,
                    pathCells: [...state.pathCells, nextKey],
                    exitEntryLinks: state.exitEntryLinks + 1,
                });
            } else {
                rejectedUnmatchedExit++;
                if (states <= 30 || rejectedUnmatchedExit <= 10) {
                    logJson('[route-probe] rejected unmatched exit', {
                        at: `${state.x},${state.y},${state.waypointIndex}`,
                        tile: `0x${cell.tileId.toString(16)}`,
                        worldSide,
                        neighbor: `${neighbor.x},${neighbor.y}`,
                        neighborTile: `0x${targetCell.tileId.toString(16)}`,
                        wantedEntryFlags: `0x${entryFlags.toString(16)}`,
                        script: { initialMode: state.initialMode, branchModes: state.branchModes, behavior: state.behavior },
                    });
                }
            }
            continue;
        }

        const controlFlags = waypoint.flags & 0x80 ? 0 : waypoint.flags;
        const needsScriptChoice = (controlFlags & 0xBF3F) !== 0;

        // Mirror traceOpponentLaneRoute: branch offset is chosen using the current behavior
        // (state.behavior) at this waypoint; if it's a control point, the script provides the
        // next behavior stored for subsequent waypoints.
        const branchOffsets = getBranchOffsets(controlFlags, state.behavior);
        if (branchOffsets.length !== 1) { rejectedNoBranch++; continue; }
        const branchOffset = branchOffsets[0];
        const nextWaypointIndex = state.waypointIndex + branchOffset;
        if (nextWaypointIndex < 0 || nextWaypointIndex >= lane.waypoints.length) { rejectedInvalidWaypoint++; continue; }
        const nextKey = `${state.x},${state.y},${nextWaypointIndex}`;

        if (needsScriptChoice) {
            for (const nextBehavior of DEFAULT_MODE_CANDIDATES) {
                queue.push({
                    ...state,
                    waypointIndex: nextWaypointIndex,
                    scriptPosition: state.scriptPosition + 1,
                    behavior: nextBehavior,
                    branchModes: [...state.branchModes, nextBehavior],
                    steps: state.steps + 1,
                    pathKey: `${state.pathKey}>${nextKey}`,
                    pathCells: [...state.pathCells, nextKey],
                    scriptControlPoints: state.scriptControlPoints + 1,
                });
            }
        } else {
            queue.push({
                ...state,
                waypointIndex: nextWaypointIndex,
                steps: state.steps + 1,
                pathKey: `${state.pathKey}>${nextKey}`,
                pathCells: [...state.pathCells, nextKey],
            });
        }
    }

    results.sort((a, b) => a.steps - b.steps || a.scriptControlPoints - b.scriptControlPoints || a.branchModes.length - b.branchModes.length);
    const unique: ProbedPath[] = [];
    const signatures = new Set<string>();
    for (const result of results) {
        if (signatures.has(result.signature)) continue;
        signatures.add(result.signature);
        unique.push(result);
    }
    const out = unique.slice(0, maxResults);
    const summary = {
        statesExplored: states,
        queueRemaining: queue.length,
        reachedFinishRaw,
        uniqueResults: out.length,
        rejected: { unmatchedExitOrUturn: rejectedUnmatchedExit, unindexed: rejectedUnindexed, invalidWaypoint: rejectedInvalidWaypoint, noSingleBranch: rejectedNoBranch, sameTileSpur: rejectedSameTileSpur },
        results: out.map((r) => ({ initialMode: r.initialMode, branchModes: r.branchModes, steps: r.steps, exitEntryLinks: r.exitEntryLinks, scriptControlPoints: r.scriptControlPoints })),
    };
    logJson('[route-probe] summary', summary);
    console.log('[route-probe] COPY_SUMMARY ' + JSON.stringify(summary));
    console.groupEnd();
    return out;
}

function uniqueResultCount(results: readonly ProbedPath[]): number {
    return new Set(results.map((result) => result.signature)).size;
}

export function pathsDivergeAndReconverge(a: readonly string[], b: readonly string[]): boolean {
    if (a.length === 0 || b.length === 0 || a[0] !== b[0] || a[a.length - 1] !== b[b.length - 1]) return false;
    let firstDiff = -1;
    const min = Math.min(a.length, b.length);
    for (let i = 0; i < min; i++) {
        if (a[i] !== b[i]) { firstDiff = i; break; }
    }
    if (firstDiff <= 0) return a.join('|') !== b.join('|');
    for (let i = a.length - 1, j = b.length - 1; i > firstDiff && j > firstDiff; i--, j--) {
        if (a[i] === b[j]) return true;
    }
    return false;
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
