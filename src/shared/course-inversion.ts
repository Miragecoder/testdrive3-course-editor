import {
    COURSE_LAYOUTS,
    MAP_HEIGHT,
    MAP_RESOURCE_SIZE,
    MAP_WIDTH,
    readMapCell,
    readMapMode,
    writeMapCell,
} from './course-map';
import {
    MAP_ENTITY_LAYOUT,
    readMapEntityTable,
    type MapEntity,
} from './map-inspection';

const PACIFIC_FINISH_TILE_ID = 0x59;
const PACIFIC_INTERSECTION_TILE_ID = 0x7A;
const PACIFIC_INTERSECTION_FINISH_TILE_ID = 0x30;
const SKY_FOG_SEED_OFFSET = 0x32;
const COLOR_REMAP_TABLE_OFFSET = 0x1F27;
const NIGHT_SKY_COLORS = [0x09, 0x08, 0x72, 0x13] as const;
const DAY_SKY_COLORS = [0x0B, 0x07, 0x79, 0x19] as const;
const POSITION_SCALE = 1024;
const ENTITY_HEIGHT_SCALE = POSITION_SCALE * 2;
const X_PERIOD = MAP_HEIGHT * POSITION_SCALE;
const Z_PERIOD = MAP_WIDTH * POSITION_SCALE;
const PLAYER_SPRITE_X_OFFSET = 0x0761;
const PLAYER_SPRITE_Z_OFFSET = 0x09E1;
const PLAYER_SPRITE_Y_OFFSET = 0x0C61;

interface CellPosition {
    x: number;
    y: number;
}

interface RacerRecords {
    player: MapEntity;
    opponents: readonly [MapEntity, MapEntity];
    playerSpriteStart: {
        x: number;
        z: number;
        y: number;
    };
}

function writeWord(data: Uint8Array, offset: number, value: number, label: string): void {
    if (!Number.isInteger(offset) || offset < 0 || offset + 1 >= data.length) {
        throw new Error(`${label} is outside the DAT file.`);
    }
    if (!Number.isInteger(value) || value < 0 || value > 0xFFFF) {
        throw new RangeError(`${label} must fit in an unsigned 16-bit word.`);
    }
    data[offset] = value & 0xFF;
    data[offset + 1] = value >>> 8;
}

function readWord(data: Uint8Array, offset: number, label: string): number {
    if (!Number.isInteger(offset) || offset < 0 || offset + 1 >= data.length) {
        throw new Error(`${label} is outside the DAT file.`);
    }
    return data[offset] | (data[offset + 1] << 8);
}

function positiveModulo(value: number, modulus: number): number {
    return ((value % modulus) + modulus) % modulus;
}

function rotateRacerOffset(x: number, z: number, quarterTurns: number): { x: number; z: number } {
    switch (quarterTurns) {
        case 0: return { x, z };
        case 1: return { x: -z, z: x };
        case 2: return { x: -x, z: -z };
        default: return { x: z, z: -x };
    }
}

function rotateRacerHeading(heading: number, quarterTurns: number): number {
    const turn = quarterTurns * 0x40;
    const lowByte = ((heading & 0xFF) + turn) & 0xFF;
    const highByte = (((heading >>> 8) + turn) & 0xFF) << 8;
    return highByte | lowByte;
}

function racerHeadingAdjustment(startTileId: number, startRotation: number, finishRotation: number): number {
    if (startTileId === PACIFIC_INTERSECTION_TILE_ID) return 0;
    const adjustment = (finishRotation - startRotation + 4) % 4;
    return adjustment === 2 ? 0 : adjustment;
}

function cellIndex(cell: CellPosition): number {
    return cell.y * MAP_WIDTH + cell.x;
}

function rotateCell(cell: CellPosition): CellPosition {
    return { x: MAP_WIDTH - 1 - cell.x, y: MAP_HEIGHT - 1 - cell.y };
}

function entityCell(entity: MapEntity): CellPosition {
    const x = Math.floor(entity.mapX);
    const y = Math.floor(entity.mapY);
    if (x < 0 || x >= MAP_WIDTH || y < 0 || y >= MAP_HEIGHT) {
        throw new Error(`Entity ${entity.slot} is outside the map grid.`);
    }
    return { x, y };
}

function finishCell(map: Uint8Array): CellPosition {
    const cells: CellPosition[] = [];
    for (let y = 0; y < MAP_HEIGHT; y++) {
        for (let x = 0; x < MAP_WIDTH; x++) {
            if (readMapCell(map, 0, x, y).tileId === PACIFIC_FINISH_TILE_ID) {
                cells.push({ x, y });
            }
        }
    }
    if (cells.length !== 1) {
        throw new Error(`Expected one Pacific finish tile (0x59); found ${cells.length}.`);
    }
    return cells[0];
}

function racerRecords(map: Uint8Array): RacerRecords {
    const table = readMapEntityTable(map, 0);
    const byModel = new Map<number, MapEntity>();
    for (const entity of table.entities) {
        if (entity.modelId < 1 || entity.modelId > 3) continue;
        if (byModel.has(entity.modelId)) {
            throw new Error(`Found more than one racer start for model ${entity.modelId}.`);
        }
        byModel.set(entity.modelId, entity);
    }

    const player = byModel.get(1);
    const opponent1 = byModel.get(2);
    const opponent2 = byModel.get(3);
    if (!player || player.slot !== 0 || !opponent1 || !opponent2) {
        throw new Error('Expected player start in slot 0 and one start for each opponent model 0x02/0x03.');
    }

    const start = entityCell(player);
    if (entityCell(opponent1).x !== start.x || entityCell(opponent1).y !== start.y
        || entityCell(opponent2).x !== start.x || entityCell(opponent2).y !== start.y) {
        throw new Error('The three racer starts must occupy the same start cell.');
    }

    const playerSpriteStart = {
        x: readWord(map, PLAYER_SPRITE_X_OFFSET, 'Player start sprite X'),
        z: readWord(map, PLAYER_SPRITE_Z_OFFSET, 'Player start sprite Z'),
        y: readWord(map, PLAYER_SPRITE_Y_OFFSET, 'Player start sprite Y'),
    };
    const spriteCell = {
        x: Math.floor(positiveModulo(playerSpriteStart.x / POSITION_SCALE, MAP_WIDTH)),
        y: Math.floor(positiveModulo(MAP_HEIGHT - playerSpriteStart.z / POSITION_SCALE, MAP_HEIGHT)),
    };
    if (spriteCell.x !== start.x || spriteCell.y !== start.y) {
        throw new Error('The player sprite start does not share the racer start cell.');
    }

    return { player, opponents: [opponent1, opponent2], playerSpriteStart };
}

function transformEntityTable(data: Uint8Array, mapOffset: number, entities: readonly MapEntity[]): void {
    for (const entity of entities) {
        if (entity.x >= X_PERIOD || entity.z >= Z_PERIOD) {
            throw new Error(`Entity ${entity.slot} has coordinates outside the Pacific map range.`);
        }

        const arrayOffset = entity.slot * 2;
        const xOffset = mapOffset + MAP_ENTITY_LAYOUT.x + arrayOffset;
        const zOffset = mapOffset + MAP_ENTITY_LAYOUT.z + arrayOffset;
        const headingOffset = mapOffset + MAP_ENTITY_LAYOUT.heading + arrayOffset;
        const cellOffset = mapOffset + MAP_ENTITY_LAYOUT.cell + arrayOffset;

        writeWord(data, xOffset, positiveModulo(X_PERIOD - entity.x, X_PERIOD), `Entity ${entity.slot} X`);
        writeWord(data, zOffset, positiveModulo(Z_PERIOD - entity.z, Z_PERIOD), `Entity ${entity.slot} Z`);
        const racerStart = entity.modelId >= 1 && entity.modelId <= 3;
        const heading = racerStart ? entity.heading : entity.heading ^ 0x8080;
        writeWord(data, headingOffset, heading, `Entity ${entity.slot} heading`);
        if (entity.slot !== 0 && entity.cell < MAP_WIDTH * MAP_HEIGHT) {
            writeWord(data, cellOffset, MAP_WIDTH * MAP_HEIGHT - 1 - entity.cell, `Entity ${entity.slot} cell`);
        }
    }
}

function relocateRacers(
    data: Uint8Array,
    mapOffset: number,
    sourceStart: CellPosition,
    targetStart: CellPosition,
    sourceStartElevation: number,
    headingDelta: number,
    opponentWaypoint: number | undefined,
    racers: RacerRecords,
): void {
    const sourceCenterX = (MAP_HEIGHT - 0.5 - sourceStart.y) * POSITION_SCALE;
    const sourceCenterZ = (sourceStart.x + 0.5) * POSITION_SCALE;
    const targetCenterX = (MAP_HEIGHT - 0.5 - targetStart.y) * POSITION_SCALE;
    const targetCenterZ = (targetStart.x + 0.5) * POSITION_SCALE;
    const targetStartElevation = readMapCell(data, mapOffset, targetStart.x, targetStart.y).elevation;
    const elevationDelta = targetStartElevation - sourceStartElevation;
    const racerEntities = [racers.player, ...racers.opponents];

    for (const entity of racerEntities) {
        const offset = rotateRacerOffset(entity.x - sourceCenterX, entity.z - sourceCenterZ, headingDelta);
        const x = positiveModulo(targetCenterX + offset.x, X_PERIOD);
        const z = positiveModulo(targetCenterZ + offset.z, Z_PERIOD);
        const arrayOffset = entity.slot * 2;
        writeWord(data, mapOffset + MAP_ENTITY_LAYOUT.x + arrayOffset, x, `Racer ${entity.slot} X`);
        writeWord(data, mapOffset + MAP_ENTITY_LAYOUT.z + arrayOffset, z, `Racer ${entity.slot} Z`);
        writeWord(data, mapOffset + MAP_ENTITY_LAYOUT.y + arrayOffset,
            entity.y + elevationDelta * ENTITY_HEIGHT_SCALE, `Racer ${entity.slot} Y`);
        const heading = rotateRacerHeading(entity.heading, headingDelta);
        writeWord(data, mapOffset + MAP_ENTITY_LAYOUT.heading + arrayOffset, heading, `Racer ${entity.slot} heading`);
        if (entity.slot !== 0) {
            writeWord(data, mapOffset + MAP_ENTITY_LAYOUT.cell + arrayOffset, cellIndex(targetStart), `Racer ${entity.slot} cell`);
            if (opponentWaypoint !== undefined) {
                writeWord(data, mapOffset + MAP_ENTITY_LAYOUT.waypoint + arrayOffset,
                    opponentWaypoint, `Racer ${entity.slot} waypoint`);
            }
        }
    }

    const spriteOffset = rotateRacerOffset(
        racers.playerSpriteStart.z - sourceCenterX,
        racers.playerSpriteStart.x - sourceCenterZ,
        headingDelta,
    );
    const playerSpriteX = positiveModulo(
        targetCenterZ + spriteOffset.z,
        Z_PERIOD,
    );
    const playerSpriteZ = positiveModulo(
        targetCenterX + spriteOffset.x,
        X_PERIOD,
    );
    const playerSpriteY = racers.playerSpriteStart.y + elevationDelta * 256;
    writeWord(data, mapOffset + PLAYER_SPRITE_X_OFFSET, playerSpriteX, 'Player start sprite X');
    writeWord(data, mapOffset + PLAYER_SPRITE_Z_OFFSET, playerSpriteZ, 'Player start sprite Z');
    writeWord(data, mapOffset + PLAYER_SPRITE_Y_OFFSET, playerSpriteY, 'Player start sprite Y');
}

function rotateMap(map: Uint8Array, data: Uint8Array, mapOffset: number): void {
    for (let y = 0; y < MAP_HEIGHT; y++) {
        for (let x = 0; x < MAP_WIDTH; x++) {
            const cell = readMapCell(map, 0, x, y);
            writeMapCell(data, mapOffset, MAP_WIDTH - 1 - x, MAP_HEIGHT - 1 - y, {
                ...cell,
                rotation: (cell.rotation + 2) % 4,
            });
        }
    }
}

function swapCells(data: Uint8Array, mapOffset: number, first: CellPosition, second: CellPosition): void {
    const firstCell = readMapCell(data, mapOffset, first.x, first.y);
    const secondCell = readMapCell(data, mapOffset, second.x, second.y);
    writeMapCell(data, mapOffset, first.x, first.y, {
        ...secondCell,
        rotation: firstCell.rotation,
        elevation: firstCell.elevation,
    });
    writeMapCell(data, mapOffset, second.x, second.y, {
        ...firstCell,
        rotation: secondCell.rotation,
        elevation: secondCell.elevation,
    });
}

function replaceCellTileId(data: Uint8Array, mapOffset: number, cell: CellPosition, tileId: number): void {
    const mapCell = readMapCell(data, mapOffset, cell.x, cell.y);
    writeMapCell(data, mapOffset, cell.x, cell.y, { ...mapCell, tileId });
}

function finishIsBesideIntersection(data: Uint8Array, mapOffset: number, finish: CellPosition): boolean {
    return [
        { x: positiveModulo(finish.x - 1, MAP_WIDTH), y: finish.y },
        { x: positiveModulo(finish.x + 1, MAP_WIDTH), y: finish.y },
        { x: finish.x, y: positiveModulo(finish.y - 1, MAP_HEIGHT) },
        { x: finish.x, y: positiveModulo(finish.y + 1, MAP_HEIGHT) },
    ].some((neighbor) => readMapCell(data, mapOffset, neighbor.x, neighbor.y).tileId === PACIFIC_INTERSECTION_TILE_ID);
}

function toggleMapLighting(data: Uint8Array, mapOffset: number, mode: 0 | 1): void {
    const sourceColors = mode === 0 ? NIGHT_SKY_COLORS : DAY_SKY_COLORS;
    const targetColors = mode === 0 ? DAY_SKY_COLORS : NIGHT_SKY_COLORS;
    for (let i = 0; i < sourceColors.length; i++) {
        const offset = mapOffset + 0x2E + i;
        data[offset] = positiveModulo(data[offset] + targetColors[i] - sourceColors[i], 0x100);
    }
    const seed = readWord(data, mapOffset + SKY_FOG_SEED_OFFSET, 'Sky/fog gradient seed');
    const remapIndex = (seed & 0x0F) | (((seed >>> 8) & 0x0F) << 4);
    const remapOffset = mapOffset + COLOR_REMAP_TABLE_OFFSET + remapIndex * 2;
    const remapColor = readWord(data, remapOffset, 'Sky/fog remap entry');
    if (remapColor > 0x0F0F) {
        const adjustment = mode === 0 ? 0x0101 : -0x0101;
        writeWord(data, remapOffset, remapColor + adjustment, 'Sky/fog remap entry');
    }
    data[mapOffset + 0x35] = mode === 0 ? 1 : 0;
}

export function invertPacificCourse(data: Uint8Array): Uint8Array {
    const mapOffsets = COURSE_LAYOUTS.SCENE01.mapOffsets;
    const requiredLength = mapOffsets[mapOffsets.length - 1] + MAP_RESOURCE_SIZE;
    if (data.length < requiredLength) {
        throw new Error('SCENE01 DAT is too short to contain its five maps.');
    }

    const sourceMaps = mapOffsets.map((offset) => data.slice(offset, offset + MAP_RESOURCE_SIZE));
    const output = data.slice();

    for (let destinationLeg = 0; destinationLeg < mapOffsets.length; destinationLeg++) {
        const source = sourceMaps[mapOffsets.length - 1 - destinationLeg];
        const destinationOffset = mapOffsets[destinationLeg];
        const mode = readMapMode(source, 0);
        if (mode !== 0 && mode !== 1) {
            throw new Error(`Pacific leg ${mapOffsets.length - destinationLeg} has an unknown day/night mode.`);
        }

        const startRacers = racerRecords(source);
        const startCell = entityCell(startRacers.player);
        const finish = finishCell(source);
        if (startCell.x === finish.x && startCell.y === finish.y) {
            throw new Error('The player start and finish tile occupy the same cell.');
        }

        const table = readMapEntityTable(source, 0);
        output.set(source, destinationOffset);
        rotateMap(source, output, destinationOffset);

        const newStart = rotateCell(finish);
        const newFinish = rotateCell(startCell);
        const sourceStartTile = readMapCell(source, 0, startCell.x, startCell.y);
        const sourceFinishTile = readMapCell(source, 0, finish.x, finish.y);
        const intersectionStart = sourceStartTile.tileId === PACIFIC_INTERSECTION_TILE_ID;
        const extendedIntersectionFinish = intersectionStart && destinationLeg === 2;
        const inverseIntersectionFinish = destinationLeg === 2 && finishIsBesideIntersection(source, 0, finish);
        const headingDelta = intersectionStart || inverseIntersectionFinish
            ? 0
            : racerHeadingAdjustment(sourceStartTile.tileId, sourceStartTile.rotation, sourceFinishTile.rotation);
        const racerTargetStart = inverseIntersectionFinish
            ? { x: (newStart.x + 1) % MAP_WIDTH, y: newStart.y }
            : newStart;
        const opponentWaypoint = extendedIntersectionFinish ? 0x40
            : inverseIntersectionFinish ? 0x43
                : undefined;
        if (racerTargetStart.x < 0 || racerTargetStart.x >= MAP_WIDTH) {
            throw new Error('Pacific leg 3 reverse start falls outside the map.');
        }
        if (extendedIntersectionFinish) {
            const finishApproach = { x: (startCell.x + MAP_WIDTH - 1) % MAP_WIDTH, y: startCell.y };
            if (readMapCell(source, 0, finishApproach.x, finishApproach.y).tileId !== PACIFIC_INTERSECTION_FINISH_TILE_ID) {
                throw new Error('Expected Pacific leg 3 finish road to approach its start intersection from tile 0x30.');
            }
            const finishBeyondIntersection = rotateCell(finishApproach);
            const finishApproachTileId = readMapCell(source, 0, finishApproach.x, finishApproach.y).tileId;
            replaceCellTileId(output, destinationOffset, newStart, finishApproachTileId);
            replaceCellTileId(output, destinationOffset, finishBeyondIntersection, sourceFinishTile.tileId);
        } else {
            swapCells(output, destinationOffset, newStart, newFinish);
        }
        transformEntityTable(output, destinationOffset, table.entities);
        const sourceStartElevation = readMapCell(source, 0, startCell.x, startCell.y).elevation;
        relocateRacers(
            output,
            destinationOffset,
            startCell,
            racerTargetStart,
            sourceStartElevation,
            headingDelta,
            opponentWaypoint,
            startRacers,
        );
        toggleMapLighting(output, destinationOffset, mode);
    }

    return output;
}
