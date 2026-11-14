import fs from 'node:fs';
import {
    CARDINAL_SIDES,
    entrySideForExit,
    isLaneEntry,
    isLaneExit,
    laneHeightDelta,
    neighborCell,
    parseLaneBank,
    rotatedSide,
    signedLaneHeight,
    worldLaneHeight,
    type LaneWaypoint,
} from '../shared/lane-connectivity';
import {
    COURSE_LAYOUTS,
    MAP_HEIGHT,
    MAP_WIDTH,
    readMapCell,
    type CourseId,
} from '../shared/course-map';
import { invertPacificCourse } from '../shared/course-inversion';
import { readMapEntityTable } from '../shared/map-inspection';

const SCENETTP_OFFSET = 0x3AD05;
const SCENETTP_SIZE = 0x1E67;
const args = process.argv.slice(2);
if (args.length !== 3 && args.length !== 5) {
    throw new Error('Usage: lane-analysis.ts <DATAB.DAT> <SCENE01.DAT> <SCENE02.DAT> [--output <report.md>]');
}
const outputIndex = args.indexOf('--output');
if (outputIndex >= 0 && (args.length !== 5 || outputIndex !== 3 || !args[4])) {
    throw new Error('The optional --output flag must be followed by a markdown file path.');
}
if (outputIndex < 0 && args.length !== 3) {
    throw new Error('The optional report path must be specified with --output.');
}

const [dataPath, pacificPath, capeCodPath] = args;
const outputPath = outputIndex >= 0 ? args[4] : undefined;
const dataFile = fs.readFileSync(dataPath);
if (dataFile.length < SCENETTP_OFFSET + SCENETTP_SIZE) {
    throw new Error(`${dataPath} is too short to contain SCENETTP.BIN.`);
}
const lanes = parseLaneBank(dataFile.subarray(SCENETTP_OFFSET, SCENETTP_OFFSET + SCENETTP_SIZE));
const laneByTile = new Map(lanes.map((lane) => [lane.tileId, lane]));
const courses: { id: CourseId; data: Uint8Array }[] = [
    { id: 'SCENE01', data: new Uint8Array(fs.readFileSync(pacificPath)) },
    { id: 'SCENE02', data: new Uint8Array(fs.readFileSync(capeCodPath)) },
];

const activeLanes = lanes.filter((lane) => lane.waypoints.length > 0);
const emptyLanes = lanes.filter((lane) => lane.waypoints.length === 0);
const uniqueOffsets = new Set(activeLanes.map((lane) => lane.offset));
const entryCount = activeLanes.reduce((sum, lane) => sum + lane.waypoints.filter(isLaneEntry).length, 0);
const exitCount = activeLanes.reduce((sum, lane) => sum + lane.waypoints.filter(isLaneExit).length, 0);
const lines = [
    '# Test Drive III lane connectivity',
    '',
    'Generated from `SCENETTP.BIN` embedded in `DATAB.DAT` and the supplied Pacific/Cape Cod map files.',
    'The game can load a scene-specific `<scene>P.BIN` instead; none was supplied in this workspace, so this',
    'report describes the shared bank and marks that limitation where relevant.',
    '',
    '## Lane-bank format and connection rule',
    '',
    `The shared bank has ${lanes.length} tile-index entries (tile IDs 0x00–0x7A) and ${activeLanes.length} tile IDs with waypoints`,
    `(${uniqueOffsets.size} distinct lane records: ${entryCount} entry ports and ${exitCount} exit ports).`,
    `The ${emptyLanes.length} indexed tile IDs with no waypoints are: ${emptyLanes.map((lane) => `0x${hexByte(lane.tileId)}`).join(', ')}.`,
    'Each record has an 8-byte waypoint: 16-bit flags, 16-bit local height, signed 16-bit local X and Z.',
    'The lane header low 7 bits give its waypoint count; the high bit is retained as a lane/header flag.',
    '',
    'Flags with `(flags & 0xC0) == 0x80` are exits; `(flags & 0xC0) == 0xC0` are entries. Local sides',
    '0–3 are north/east/south/west. A cell rotation adds to the local side modulo 4. For an exit side `d`',
    'and adjacent cell rotation `r`, the required entry flag is',
    '`0xC0 | (((d ^ 2) - r) & 3)`. This is the exact key the game searches for in `sim_traffic.c`.',
    '',
    'The simulation wraps adjacent map-cell indices at the 32×16 map edges. It matches entry flags only:',
    'it does not reject a link because lane heights differ. The target height is',
    '`(map elevation * 256 + waypoint height) & 0xFFFF` (then scaled by 8 for runtime); the catalog',
    'shows stored waypoint words as signed two’s-complement values for readability. A nonzero height delta is a',
    'grade/vertical discontinuity to inspect, not a failed link by the game. If no entry key exists, the',
    'traffic routine searches back in the current tile for the opposite entry and turns around there.',
    '',
    '## Tile port catalog',
    '',
    'Sides below are in the tile-local orientation; rotate them using the rule above. `index@side:height`',
    'identifies a waypoint record. Interior waypoint heights are included because they expose ramps and',
    'overpasses even when their ports are at matching elevations.',
    '',
    '| Tile | Header | Waypoints | Entries | Exits | Interior heights |',
    '|---|---:|---:|---|---|---|',
];

for (const lane of activeLanes) {
    const entries = lane.waypoints.filter(isLaneEntry);
    const exits = lane.waypoints.filter(isLaneExit);
    const interiorHeights = [...new Set(lane.waypoints
        .filter((waypoint) => !isLaneEntry(waypoint) && !isLaneExit(waypoint))
        .map((waypoint) => signedLaneHeight(waypoint.height)))];
    lines.push([
        `| 0x${lane.tileId.toString(16).padStart(2, '0')} | 0x${lane.header.toString(16).padStart(2, '0')} | ${lane.waypoints.length} |`,
        `${formatPorts(entries)} | ${formatPorts(exits)} | ${interiorHeights.join(', ') || '—'} |`,
    ].join(' '));
}

lines.push(
    '',
    '## Course-map edge audit',
    '',
    'Counts are for every exit waypoint in each shipped map, including unused branches and dead-end spurs.',
    'They are not a judgment that every missing edge is a design error.',
    '',
    'Tile IDs `0x7B`–`0x7F` have no index entries in this shared bank. Their map cells are excluded',
    'as source lanes, and links pointing to them are reported as unresolved rather than claimed unmatched.',
    '',
    '| Course | Leg | Indexed exit records | Matching neighbor entry | No matching entry | Unindexed source cells | Unindexed target | Nonzero height pairs |',
    '|---|---:|---:|---:|---:|---:|---:|---:|',
);

const auditNotes: string[] = [];
for (const course of courses) {
    const layout = COURSE_LAYOUTS[course.id];
    const courseMissing: string[] = [];
    for (const [leg, mapOffset] of layout.mapOffsets.entries()) {
        const audit = auditMap(course.data, mapOffset);
        lines.push(`| ${layout.label} | ${leg + 1} | ${audit.exits} | ${audit.matched} | ${audit.missingCount} | `
            + `${audit.unindexedCells} | ${audit.unindexedTargets} | ${audit.nonzeroHeightPairs} |`);
        courseMissing.push(...audit.missing.slice(0, 5).map((missing) =>
            `- ${layout.label} leg ${leg + 1}: tile 0x${hexByte(missing.fromTile)} at (${missing.x},${missing.y}) `
            + `exits ${CARDINAL_SIDES[missing.worldSide]} to tile 0x${hexByte(missing.toTile)} at `
            + `(${missing.toX},${missing.toY}); no entry 0x${missing.entryFlags.toString(16).padStart(2, '0')}.`));
    }
    if (courseMissing.length > 0) {
        auditNotes.push('', `Unmatched-edge examples for ${layout.label}:`, '', ...courseMissing);
    }
}
lines.push('', ...auditNotes);

const pacific = courses.find((course) => course.id === 'SCENE01')!;
const invertedPacific = invertPacificCourse(pacific.data);
lines.push(
    '',
    '## Pacific opponent start-port check',
    '',
    'The two opponent records in the Pacific maps start with waypoint state `0x43` in the supplied DAT.',
    'The low six bits select the initial waypoint index. The table follows that waypoint to its first lane',
    'exit and checks the neighboring entry using the engine’s edge key; it does not simulate later branches.',
    '',
    '| Pacific stage | Start tile / rotation | Start waypoint (opp 1 / 2) | First exit | Neighbor / required entry | Result |',
    '|---:|---|---|---|---|---|',
);

for (const [label, data] of [['Original', pacific.data], ['Inverted', invertedPacific]] as const) {
    const layout = COURSE_LAYOUTS.SCENE01;
    for (const [leg, mapOffset] of layout.mapOffsets.entries()) {
        const opponents = readMapEntityTable(data, mapOffset).entities.filter((entity) =>
            entity.modelId === 2 || entity.modelId === 3);
        const start = opponents.find((entity) => entity.modelId === 2);
        const secondOpponent = opponents.find((entity) => entity.modelId === 3);
        if (!start || !secondOpponent) throw new Error(`Pacific leg ${leg + 1} has incomplete opponent start records.`);
        const x = Math.floor(start.mapX);
        const y = Math.floor(start.mapY);
        if (Math.floor(secondOpponent.mapX) !== x
            || Math.floor(secondOpponent.mapY) !== y
            || secondOpponent.waypoint !== start.waypoint) {
            throw new Error(`Pacific leg ${leg + 1} opponents do not share the same initial lane state.`);
        }
        const cell = readMapCell(data, mapOffset, x, y);
        const lane = laneByTile.get(cell.tileId);
        if (!lane) {
            lines.push(`| ${label} ${leg + 1} | 0x${hexByte(cell.tileId)} / ${cell.rotation} | `
                + `${hexWord(start.waypoint)} / ${hexWord(secondOpponent.waypoint)} | no lane index in shared bank | — | **unresolved** |`);
            continue;
        }
        const waypointIndex = start.waypoint & 0x3F;
        const waypoint = lane.waypoints[waypointIndex];
        if (!waypoint) {
            lines.push(`| ${label} ${leg + 1} | 0x${hexByte(cell.tileId)} / ${cell.rotation} | `
                + `${hexWord(start.waypoint)} / ${hexWord(secondOpponent.waypoint)} | index ${waypointIndex} is out of range `
                + `(count ${lane.waypoints.length}) | — | **invalid index** |`);
            continue;
        }

        const exit = lane.waypoints.slice(waypointIndex).find(isLaneExit);
        if (!exit) {
            lines.push(`| ${label} ${leg + 1} | 0x${hexByte(cell.tileId)} / ${cell.rotation} | `
                + `${hexWord(start.waypoint)} / ${hexWord(secondOpponent.waypoint)} | no later exit in tile | — | **no exit** |`);
            continue;
        }

        const worldSide = rotatedSide(cell.rotation, exit.flags & 3);
        const neighbor = neighborCell(x, y, worldSide, MAP_WIDTH, MAP_HEIGHT);
        const target = readMapCell(data, mapOffset, neighbor.x, neighbor.y);
        const targetLane = laneByTile.get(target.tileId);
        if (!targetLane) {
            lines.push(`| ${label} ${leg + 1} | 0x${hexByte(cell.tileId)} / ${cell.rotation} | `
                + `${hexWord(start.waypoint)} / ${hexWord(secondOpponent.waypoint)} (index ${waypointIndex}) | `
                + `${exit.index}@${CARDINAL_SIDES[worldSide]} h${signedLaneHeight(exit.height)} | `
                + `0x${hexByte(target.tileId)} at (${neighbor.x},${neighbor.y}); no shared-bank index | **unresolved** |`);
            continue;
        }
        const entrySide = entrySideForExit(worldSide, target.rotation);
        const entryFlags = 0xC0 | entrySide;
        const entries = targetLane.waypoints.filter((candidate) => candidate.flags === entryFlags);
        const sourceHeight = worldLaneHeight(cell.elevation, exit.height);
        const heightDeltas = entries.map((entry) =>
            laneHeightDelta(sourceHeight, worldLaneHeight(target.elevation, entry.height)));
        const result = entries.length === 0
            ? '**no match; engine falls back to a same-cell U-turn**'
            : `match; height delta ${heightDeltas.join(', ')}`;
        lines.push(`| ${label} ${leg + 1} | 0x${hexByte(cell.tileId)} / ${cell.rotation} | `
            + `${hexWord(start.waypoint)} / ${hexWord(secondOpponent.waypoint)} (index ${waypointIndex}) | `
            + `${exit.index}@${CARDINAL_SIDES[worldSide]} h${signedLaneHeight(exit.height)} | `
            + `0x${hexByte(target.tileId)} at (${neighbor.x},${neighbor.y}), entry 0x${entryFlags.toString(16)} | ${result} |`);
    }
}

lines.push(
    '',
    'These initial exits are only a first-step check. A successful entry match rules out the game’s',
    'same-cell dead-end fallback at that first edge, but not a later route/script branch, a visually',
    'misleading turn, or a difference in a scene-specific `P.BIN`. The workspace contains the shared',
    '`SCENETTP.BIN` bank but not the scene-specific lane banks loaded by `stage_load_objects()` when present.',
    '',
    '## Leg 3 endpoint example',
    '',
    'Pacific leg 3 starts on tile `0x7A`, rotation 2, elevation 1. Its ground-level exit waypoint 2',
    '(local side 1, height 2) rotates to world side 3 and connects to tile `0x30` at `(31,13)`, entry',
    'side 2, height 2. Its other exit waypoint 5 (local side 3, height 66) rotates to world side 1 and',
    'connects to tile `0x78` at `(1,13)`, entry side 3, height 75: the nine-unit rise is the overpass.',
    'After inversion, the ground-level neighbor is `(0,2)` and the overpass remains at `(30,2)`, with',
    'the intersection at `(31,2)`. The finish belongs on the ground-level exit, not the overpass.',
    '',
    '## References',
    '',
    '- `../../testdrive3-enhanced/src/game/sim_traffic.c`: `lane_list_for_cell()` and `vehicle_follow_lane()`.',
    '- `../../testdrive3-enhanced/src/game/flow_race.c`: per-scene `P.BIN` loading.',
    '- `../repos/testdrive3-course-editor/src/shared/lane-connectivity.ts`: parser and edge-key helpers.',
);

const report = `${lines.join('\n')}\n`;
if (outputPath) {
    fs.writeFileSync(outputPath, report, 'utf8');
    process.stdout.write(`Wrote lane connectivity report to ${outputPath}\n`);
} else {
    process.stdout.write(report);
}

function formatPorts(waypoints: readonly LaneWaypoint[]): string {
    if (waypoints.length === 0) return '—';
    return waypoints.map((waypoint) =>
        `${waypoint.index}@${CARDINAL_SIDES[waypoint.flags & 3]}:${signedLaneHeight(waypoint.height)}`).join(', ');
}

function auditMap(data: Uint8Array, mapOffset: number): {
    exits: number;
    matched: number;
    missingCount: number;
    unindexedCells: number;
    missing: {
        x: number;
        y: number;
        fromTile: number;
        worldSide: number;
        toX: number;
        toY: number;
        toTile: number;
        entryFlags: number;
    }[];
    unindexedTargets: number;
    nonzeroHeightPairs: number;
} {
    let exits = 0;
    let matched = 0;
    let missingCount = 0;
    let unindexedCells = 0;
    let unindexedTargets = 0;
    let nonzeroHeightPairs = 0;
    const missing: {
        x: number;
        y: number;
        fromTile: number;
        worldSide: number;
        toX: number;
        toY: number;
        toTile: number;
        entryFlags: number;
    }[] = [];

    for (let y = 0; y < MAP_HEIGHT; y++) {
        for (let x = 0; x < MAP_WIDTH; x++) {
            const cell = readMapCell(data, mapOffset, x, y);
            const lane = laneByTile.get(cell.tileId);
            if (!lane) {
                unindexedCells++;
                continue;
            }
            for (const exit of lane.waypoints.filter(isLaneExit)) {
                exits++;
                const worldSide = rotatedSide(cell.rotation, exit.flags & 3);
                const neighbor = neighborCell(x, y, worldSide, MAP_WIDTH, MAP_HEIGHT);
                const target = readMapCell(data, mapOffset, neighbor.x, neighbor.y);
                const targetLane = laneByTile.get(target.tileId);
                if (!targetLane) {
                    unindexedTargets++;
                    continue;
                }
                const entrySide = entrySideForExit(worldSide, target.rotation);
                const entryFlags = 0xC0 | entrySide;
                const entries = targetLane.waypoints.filter((candidate) => candidate.flags === entryFlags);
                if (entries.length === 0) {
                    missingCount++;
                    if (missing.length < 20) {
                        missing.push({
                            x,
                            y,
                            fromTile: cell.tileId,
                            worldSide,
                            toX: neighbor.x,
                            toY: neighbor.y,
                            toTile: target.tileId,
                            entryFlags,
                        });
                    }
                    continue;
                }

                matched++;
                const sourceHeight = worldLaneHeight(cell.elevation, exit.height);
                nonzeroHeightPairs += entries.filter((entry) =>
                    laneHeightDelta(sourceHeight, worldLaneHeight(target.elevation, entry.height)) !== 0).length;
            }
        }
    }

    return { exits, matched, missingCount, missing, unindexedCells, unindexedTargets, nonzeroHeightPairs };
}

function hexByte(value: number): string {
    return value.toString(16).padStart(2, '0');
}

function hexWord(value: number): string {
    return `0x${value.toString(16).padStart(4, '0')}`;
}
