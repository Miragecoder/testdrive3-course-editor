import { MAP_HEIGHT, MAP_RESOURCE_SIZE } from './course-map';

const ENTITY_COUNTS = {
    collision: 0x0EE1,
    ai: 0x0EE3,
    lod: 0x0EE5,
} as const;

const ENTITY_FIELDS = {
    flags: 0x0EE7,
    z: 0x1027,
    x: 0x1167,
    y: 0x12A7,
    heading: 0x13E7,
    velocity: 0x1667,
    cell: 0x17A7,
    waypoint: 0x18E7,
} as const;

const ENTITY_FIELD_STRIDE = 0x140;
const MAX_ENTITIES = ENTITY_FIELD_STRIDE / 2;
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

function readByte(data: Uint8Array, offset: number, label: string): number {
    if (offset < 0 || offset >= data.length) {
        throw new Error(`${label} is outside the DAT file.`);
    }

    return data[offset];
}

function validateMap(data: Uint8Array, mapOffset: number): void {
    if (!Number.isInteger(mapOffset) || mapOffset < 0 || mapOffset + MAP_RESOURCE_SIZE > data.length) {
        throw new Error('Map resource is outside the DAT file.');
    }
}

export function readMapEntityTable(data: Uint8Array, mapOffset: number): MapEntityTable {
    validateMap(data, mapOffset);

    const collisionCount = readWord(data, mapOffset + ENTITY_COUNTS.collision, 'Collision entity count');
    const aiCount = readWord(data, mapOffset + ENTITY_COUNTS.ai, 'AI entity count');
    const lodCount = readWord(data, mapOffset + ENTITY_COUNTS.lod, 'LOD entity count');
    if (collisionCount > MAX_ENTITIES || aiCount > MAX_ENTITIES || lodCount > MAX_ENTITIES) {
        throw new Error('Map entity count exceeds the 160 available records.');
    }

    const entities: MapEntity[] = [];
    for (let slot = 0; slot < collisionCount; slot++) {
        const offset = slot * 2;
        const flags = readWord(data, mapOffset + ENTITY_FIELDS.flags + offset, `Entity ${slot} flags`);
        const x = readWord(data, mapOffset + ENTITY_FIELDS.x + offset, `Entity ${slot} X`);
        const z = readWord(data, mapOffset + ENTITY_FIELDS.z + offset, `Entity ${slot} Z`);
        entities.push({
            slot,
            flags,
            modelId: flags & 0x3F,
            x,
            z,
            y: readWord(data, mapOffset + ENTITY_FIELDS.y + offset, `Entity ${slot} Y`),
            heading: readWord(data, mapOffset + ENTITY_FIELDS.heading + offset, `Entity ${slot} heading`),
            velocity: readWord(data, mapOffset + ENTITY_FIELDS.velocity + offset, `Entity ${slot} velocity`),
            cell: readWord(data, mapOffset + ENTITY_FIELDS.cell + offset, `Entity ${slot} cell`),
            waypoint: readWord(data, mapOffset + ENTITY_FIELDS.waypoint + offset, `Entity ${slot} waypoint`),
            aiProcessed: slot < aiCount,
            mapX: 0.5 + z / 1024,
            mapY: MAP_HEIGHT - 0.5 - x / 1024,
        });
    }

    return { collisionCount, aiCount, lodCount, entities };
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
