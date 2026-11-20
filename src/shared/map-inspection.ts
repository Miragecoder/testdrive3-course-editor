import { MAP_HEIGHT, MAP_RESOURCE_SIZE, MAP_WIDTH } from './course-map';

export const MAP_ENTITY_LAYOUT = {
    collision: 0x0EE1,
    ai: 0x0EE3,
    lod: 0x0EE5,
    flags: 0x0EE7,
    z: 0x1027,
    x: 0x1167,
    y: 0x12A7,
    heading: 0x13E7,
    velocity: 0x1667,
    cell: 0x17A7,
    waypoint: 0x18E7,
    fieldStride: 0x140,
    maxEntities: 160,
} as const;

const OPPONENT_SCRIPT_OFFSET = 0x05;
const OPPONENT_SCRIPT_LENGTH = 10;

export interface MapEntity {
    readonly slot: number;
    readonly flags: number;
    readonly modelId: number;
    readonly x: number;
    readonly z: number;
    readonly y: number;
    readonly heading: number;
    readonly velocity: number;
    readonly cell: number;
    readonly waypoint: number;
    readonly aiProcessed: boolean;
    readonly mapX: number;
    readonly mapY: number;
}

export interface MapEntityTable {
    readonly collisionCount: number;
    readonly aiCount: number;
    readonly lodCount: number;
    readonly entities: readonly MapEntity[];
}

export interface OpponentRouteScript {
    readonly slot: 1 | 2;
    readonly initialMode: number;
    readonly branchModes: readonly number[];
    readonly terminates: boolean;
}

function readWord(data: Uint8Array, offset: number, label: string): number {
    if (offset < 0 || offset + 1 >= data.length) {
        throw new Error(`${label} is outside the DAT file.`);
    }

    return data[offset] | (data[offset + 1] << 8);
}

function writeWord(data: Uint8Array, offset: number, value: number, label: string): void {
    if (offset < 0 || offset + 1 >= data.length) {
        throw new Error(`${label} is outside the DAT file.`);
    }
    if (!Number.isInteger(value) || value < 0 || value > 0xFFFF) {
        throw new RangeError(`${label} must be an integer from 0 to 65535.`);
    }

    data[offset] = value & 0xFF;
    data[offset + 1] = value >>> 8;
}

function readByte(data: Uint8Array, offset: number, label: string): number {
    if (offset < 0 || offset >= data.length) {
        throw new Error(`${label} is outside the DAT file.`);
    }

    return data[offset];
}

function writeByte(data: Uint8Array, offset: number, value: number, label: string): void {
    if (offset < 0 || offset >= data.length) {
        throw new Error(`${label} is outside the DAT file.`);
    }
    if (!Number.isInteger(value) || value < 0 || value > 0xFF) {
        throw new RangeError(`${label} must be an integer from 0 to 255.`);
    }

    data[offset] = value;
}

function validateMap(data: Uint8Array, mapOffset: number): void {
    if (!Number.isInteger(mapOffset) || mapOffset < 0 || mapOffset + MAP_RESOURCE_SIZE > data.length) {
        throw new Error('Map resource is outside the DAT file.');
    }
}

function positiveModulo(value: number, modulus: number): number {
    return ((value % modulus) + modulus) % modulus;
}

export function readMapEntityTable(data: Uint8Array, mapOffset: number): MapEntityTable {
    validateMap(data, mapOffset);

    const collisionCount = readWord(data, mapOffset + MAP_ENTITY_LAYOUT.collision, 'Collision entity count');
    const aiCount = readWord(data, mapOffset + MAP_ENTITY_LAYOUT.ai, 'AI entity count');
    const lodCount = readWord(data, mapOffset + MAP_ENTITY_LAYOUT.lod, 'LOD entity count');
    if (collisionCount > MAP_ENTITY_LAYOUT.maxEntities
        || aiCount > MAP_ENTITY_LAYOUT.maxEntities
        || lodCount > MAP_ENTITY_LAYOUT.maxEntities) {
        throw new Error('Map entity count exceeds the 160 available records.');
    }

    const entities: MapEntity[] = [];
    for (let slot = 0; slot < collisionCount; slot++) {
        const offset = slot * 2;
        const flags = readWord(data, mapOffset + MAP_ENTITY_LAYOUT.flags + offset, `Entity ${slot} flags`);
        const x = readWord(data, mapOffset + MAP_ENTITY_LAYOUT.x + offset, `Entity ${slot} X`);
        const z = readWord(data, mapOffset + MAP_ENTITY_LAYOUT.z + offset, `Entity ${slot} Z`);
        entities.push({
            slot,
            flags,
            modelId: flags & 0x3F,
            x,
            z,
            y: readWord(data, mapOffset + MAP_ENTITY_LAYOUT.y + offset, `Entity ${slot} Y`),
            heading: readWord(data, mapOffset + MAP_ENTITY_LAYOUT.heading + offset, `Entity ${slot} heading`),
            velocity: readWord(data, mapOffset + MAP_ENTITY_LAYOUT.velocity + offset, `Entity ${slot} velocity`),
            cell: readWord(data, mapOffset + MAP_ENTITY_LAYOUT.cell + offset, `Entity ${slot} cell`),
            waypoint: readWord(data, mapOffset + MAP_ENTITY_LAYOUT.waypoint + offset, `Entity ${slot} waypoint`),
            aiProcessed: slot < aiCount,
            mapX: positiveModulo(z / 1024, MAP_WIDTH),
            mapY: positiveModulo(MAP_HEIGHT - x / 1024, MAP_HEIGHT),
        });
    }

    return { collisionCount, aiCount, lodCount, entities };
}

export interface WritableMapEntityFields {
    readonly flags: number;
    readonly x: number;
    readonly z: number;
    readonly y: number;
    readonly heading: number;
    readonly velocity: number;
    readonly cell: number;
    readonly waypoint: number;
}

export function writeMapEntity(
    data: Uint8Array,
    mapOffset: number,
    slot: number,
    entity: WritableMapEntityFields,
): void {
    validateMap(data, mapOffset);

    const collisionCount = readWord(data, mapOffset + MAP_ENTITY_LAYOUT.collision, 'Collision entity count');
    if (!Number.isInteger(slot) || slot < 0 || slot >= collisionCount) {
        throw new RangeError(`Entity slot must be between 0 and ${Math.max(collisionCount - 1, 0)}.`);
    }

    const offset = slot * 2;
    writeWord(data, mapOffset + MAP_ENTITY_LAYOUT.flags + offset, entity.flags, `Entity ${slot} flags`);
    writeWord(data, mapOffset + MAP_ENTITY_LAYOUT.z + offset, entity.z, `Entity ${slot} Z`);
    writeWord(data, mapOffset + MAP_ENTITY_LAYOUT.x + offset, entity.x, `Entity ${slot} X`);
    writeWord(data, mapOffset + MAP_ENTITY_LAYOUT.y + offset, entity.y, `Entity ${slot} Y`);
    writeWord(data, mapOffset + MAP_ENTITY_LAYOUT.heading + offset, entity.heading, `Entity ${slot} heading`);
    writeWord(data, mapOffset + MAP_ENTITY_LAYOUT.velocity + offset, entity.velocity, `Entity ${slot} velocity`);
    writeWord(data, mapOffset + MAP_ENTITY_LAYOUT.cell + offset, entity.cell, `Entity ${slot} cell`);
    writeWord(data, mapOffset + MAP_ENTITY_LAYOUT.waypoint + offset, entity.waypoint, `Entity ${slot} waypoint`);
}

export function readOpponentRouteScripts(data: Uint8Array, mapOffset: number): readonly OpponentRouteScript[] {
    validateMap(data, mapOffset);

    return ([0, 1] as const).map((index) => {
        const offset = mapOffset + OPPONENT_SCRIPT_OFFSET + index * OPPONENT_SCRIPT_LENGTH;
        const initialMode = readByte(data, offset, `Opponent ${index + 1} initial route mode`);
        const branchModes: number[] = [];
        let terminates = false;

        for (let step = 1; step < OPPONENT_SCRIPT_LENGTH; step++) {
            const mode = readByte(data, offset + step, `Opponent ${index + 1} route step ${step}`);
            if (mode === 0) {
                terminates = true;
                break;
            }
            branchModes.push(mode);
        }

        return {
            slot: (index + 1) as 1 | 2,
            initialMode,
            branchModes,
            terminates,
        };
    });
}

export function writeOpponentRouteScript(
    data: Uint8Array,
    mapOffset: number,
    opponentIndex: 0 | 1,
    script: Pick<OpponentRouteScript, 'initialMode' | 'branchModes' | 'terminates'>,
): void {
    validateMap(data, mapOffset);

    const offset = mapOffset + OPPONENT_SCRIPT_OFFSET + opponentIndex * OPPONENT_SCRIPT_LENGTH;
    writeByte(data, offset, script.initialMode, `Opponent ${opponentIndex + 1} initial route mode`);

    if (script.branchModes.length > OPPONENT_SCRIPT_LENGTH - 1) {
        throw new RangeError(`Opponent ${opponentIndex + 1} branch script can contain at most ${OPPONENT_SCRIPT_LENGTH - 1} steps.`);
    }

    for (let step = 1; step < OPPONENT_SCRIPT_LENGTH; step++) {
        const mode = script.branchModes[step - 1];
        if (mode === undefined) {
            writeByte(data, offset + step, 0, `Opponent ${opponentIndex + 1} route step ${step}`);
            continue;
        }
        if (mode === 0) {
            throw new RangeError(`Opponent ${opponentIndex + 1} branch step ${step} must not be 0; use terminates to end the script.`);
        }
        writeByte(data, offset + step, mode, `Opponent ${opponentIndex + 1} route step ${step}`);
    }

    if (script.terminates) {
        const terminatorStep = Math.min(script.branchModes.length + 1, OPPONENT_SCRIPT_LENGTH - 1);
        writeByte(data, offset + terminatorStep, 0, `Opponent ${opponentIndex + 1} route terminator`);
    }

    // Keep the opponent entity's runtime behavior nibble in sync with the script's
    // initial mode. The engine derives branch mode from (flags >> 8) & 0x0F for the
    // current waypoint step and consumes script bytes at control points as future
    // behavior, so a mismatched entity behavior can take the wrong initial branch.
    const collisionCount = readWord(data, mapOffset + MAP_ENTITY_LAYOUT.collision, 'Collision entity count');
    const targetModelId = opponentIndex + 2;
    for (let slot = 0; slot < collisionCount; slot++) {
        const flagsOffset = mapOffset + MAP_ENTITY_LAYOUT.flags + slot * 2;
        const flags = readWord(data, flagsOffset, `Entity ${slot} flags`);
        if ((flags & 0x3F) !== targetModelId) continue;
        const syncedFlags = (flags & 0xF0FF) | ((script.initialMode & 0x0F) << 8);
        if (syncedFlags !== flags) {
            writeWord(data, flagsOffset, syncedFlags, `Entity ${slot} flags`);
        }
        break;
    }
}
