import {
    COURSE_LAYOUTS,
    MAP_HEIGHT,
    MAP_RESOURCE_SIZE,
    MAP_WIDTH,
    readMapCell,
    readMapMode,
    writeMapCell,
    writeMapMode,
    type CourseId,
    type MapCell,
} from '@shared/course-map';
import { invertPacificCourse } from '@shared/course-inversion';
import {
    readMapEntityTable,
    readOpponentRouteScripts,
    type MapEntity,
    type MapEntityTable,
} from '@shared/map-inspection';
import { LoadPrimaryLutMode, LoadRemapTable, LoadTrailerTable, WeatherMode } from '@shared/color';
import { LoadObjects, maps } from '@shared/objects';
import { files, loadFiles } from '@shared/files';
import {
    PRIVATE_LANE_TILE_COUNT,
    parseLaneBank,
    type TileLane,
} from '@shared/lane-connectivity';
import { traceOpponentLaneRoute, type LaneRouteTrace } from '@shared/lane-routes';
import { splitWrappedRoute } from '@shared/route-overlay';
import { findMapTileWithFaceMaterial } from '@shared/tile-bank';
import {
    extractSceneArchiveEntry,
    isUnavailableSceneLaneBankResponse,
    requiresSceneSpecificLaneBank,
} from '@shared/scene-bank';
import {
    createTilePreviewAtlas,
    drawTilePreview,
    TILE_PREVIEW_SIZE,
    type TilePreviewBank,
} from './tile-previews';

const courseSelect = requiredElement<HTMLSelectElement>('course-select');
const legSelect = requiredElement<HTMLSelectElement>('leg-select');
const grid = requiredElement<HTMLDivElement>('map-grid');
const tileIdInput = requiredElement<HTMLInputElement>('tile-id');
const rotationInput = requiredElement<HTMLSelectElement>('tile-rotation');
const elevationInput = requiredElement<HTMLInputElement>('tile-elevation');
const modeInput = requiredElement<HTMLSelectElement>('map-mode');
const paintInput = requiredElement<HTMLInputElement>('paint-mode');
const cellDetails = requiredElement<HTMLDivElement>('cell-details');
const status = requiredElement<HTMLDivElement>('status');
const fileInput = requiredElement<HTMLInputElement>('custom-dat');
const filenameLabel = requiredElement<HTMLSpanElement>('source-filename');
const exportButton = requiredElement<HTMLButtonElement>('export-dat');
const invertCourseButton = requiredElement<HTMLButtonElement>('invert-course');
const resetLegButton = requiredElement<HTMLButtonElement>('reset-leg');
const resetAllButton = requiredElement<HTMLButtonElement>('reset-all');
const paletteBankSelect = requiredElement<HTMLSelectElement>('palette-bank');
const tilePalette = requiredElement<HTMLDivElement>('tile-palette');
const showEntitiesInput = requiredElement<HTMLInputElement>('show-entities');
const showRoutesInput = requiredElement<HTMLInputElement>('show-routes');
const entitySelect = requiredElement<HTMLSelectElement>('entity-select');
const entityDetails = requiredElement<HTMLDivElement>('entity-details');
const entitySummary = requiredElement<HTMLParagraphElement>('entity-summary');
const opponentScripts = requiredElement<HTMLDivElement>('opponent-scripts');
const routeSummary = requiredElement<HTMLParagraphElement>('route-summary');
const routeSource = requiredElement<HTMLParagraphElement>('route-source');
const routeTraces = requiredElement<HTMLDivElement>('route-traces');
const routeComparison = requiredElement<HTMLDivElement>('route-comparison');

const LANE_BANK_OFFSET = 0x3AD05;
const LANE_BANK_SIZE = 0x1E67;
const FINISH_FACE_MATERIAL = 0x1F;

let courseId: CourseId = 'SCENE01';
let sourceFilename = 'SCENE01.DAT';
let originalData: Uint8Array | null = null;
let workingData: Uint8Array | null = null;
let selectedCell: { x: number; y: number } | null = null;
let tilePreviewAtlas: HTMLCanvasElement | null = null;
let paletteTileId: number | null = null;
let selectedEntitySlot: number | null = null;
let currentEntityTable: MapEntityTable | null = null;
let sharedLaneBank: readonly TileLane[] | null = null;
let laneBank: readonly TileLane[] | null = null;
let laneBankSource = 'shared SCENETTP.BIN';
let laneBankApproximate = false;
let inversionApplied = false;

function requiredElement<T extends HTMLElement>(id: string): T {
    const element = document.getElementById(id);
    if (!element) {
        throw new Error(`Missing editor element #${id}.`);
    }
    return element as T;
}

function selectedMapOffset(): number {
    const leg = Number(legSelect.value);
    if (!Number.isInteger(leg) || leg < 0 || leg >= 5) {
        throw new Error(`Invalid leg selection: ${legSelect.value}`);
    }
    return COURSE_LAYOUTS[courseId].mapOffsets[leg];
}

function activeData(): Uint8Array {
    if (!workingData) {
        throw new Error('Open a course DAT file first.');
    }
    return workingData;
}

function setStatus(message: string, isError = false): void {
    status.textContent = message;
    status.classList.toggle('error', isError);
}

function countEditedCells(): number {
    if (!originalData || !workingData) return 0;
    let count = 0;
    for (const mapOffset of COURSE_LAYOUTS[courseId].mapOffsets) {
        for (let y = 0; y < MAP_HEIGHT; y++) {
            for (let x = 0; x < MAP_WIDTH; x++) {
                const offset = mapOffset + 0x00DF + (y * MAP_WIDTH + x) * 2;
                if (originalData[offset] !== workingData[offset]
                    || originalData[offset + 1] !== workingData[offset + 1]) {
                    count++;
                }
            }
        }
    }
    return count;
}

function updateStatus(): void {
    if (!workingData) return;
    const mode = readMapMode(workingData, selectedMapOffset());
    const modeLabel = mode === 0 ? 'Night/dark' : mode === 1 ? 'Day/light' : `Unknown (${mode})`;
    setStatus(`${sourceFilename} · ${modeLabel} · ${countEditedCells()} edited cells`);
    exportButton.disabled = false;
    exportButton.textContent = inversionApplied ? 'Export SCENE03.DAT' : 'Export edited DAT';
    invertCourseButton.disabled = inversionApplied || courseId !== 'SCENE01';
    resetLegButton.disabled = inversionApplied;
    resetAllButton.disabled = false;
}

function renderCell(x: number, y: number): void {
    const cell = readMapCell(activeData(), selectedMapOffset(), x, y);
    const button = grid.querySelector<HTMLButtonElement>(`button[data-x="${x}"][data-y="${y}"]`);
    if (!button) return;

    button.style.setProperty('--tile-hue', String((cell.tileId * 137.5) % 360));
    button.querySelector<HTMLSpanElement>('.tile-id')!.textContent = cell.tileId.toString(16).padStart(2, '0').toUpperCase();
    button.title = `Tile ${cell.tileId.toString(16).padStart(2, '0').toUpperCase()} · rotation ${cell.rotation * 90}° · elevation ${cell.elevation}`;
    button.classList.toggle('selected', selectedCell?.x === x && selectedCell.y === y);

    const preview = button.querySelector<HTMLCanvasElement>('.tile-preview')!;
    preview.width = TILE_PREVIEW_SIZE;
    preview.height = TILE_PREVIEW_SIZE;
    if (tilePreviewAtlas) {
        const context = preview.getContext('2d');
        if (context) {
            const bank: TilePreviewBank = cell.tileId < 0x40 ? 'shared' : courseId;
            const tileIndex = cell.tileId < 0x40 ? cell.tileId : cell.tileId - 0x40;
            drawTilePreview(context, tilePreviewAtlas, bank, tileIndex, cell.rotation, 0, 0, preview.width, preview.height);
        }
    }
}

function renderTilePalette(): void {
    if (!tilePreviewAtlas) return;

    const bank: TilePreviewBank = paletteBankSelect.value === 'shared' ? 'shared' : courseId;
    const tiles = bank === 'shared'
        ? maps.tiles2
        : bank === 'SCENE01' ? maps.tiles1 : maps.tiles3;
    tilePalette.replaceChildren();

    tiles.forEach((_tile, index) => {
        const tileId = bank === 'shared' ? index : index + 0x40;
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'palette-tile';
        button.title = `Use tile ${tileId.toString(16).padStart(2, '0').toUpperCase()}`;
        button.setAttribute('aria-label', button.title);
        button.classList.toggle('selected', paletteTileId === tileId);

        const preview = document.createElement('canvas');
        preview.width = TILE_PREVIEW_SIZE;
        preview.height = TILE_PREVIEW_SIZE;
        const context = preview.getContext('2d');
        if (context) {
            drawTilePreview(context, tilePreviewAtlas!, bank, index, 0, 0, 0, preview.width, preview.height);
        }

        const label = document.createElement('span');
        label.textContent = tileId.toString(16).padStart(2, '0').toUpperCase();
        button.append(preview, label);
        button.addEventListener('click', () => {
            paletteTileId = tileId;
            tileIdInput.value = String(tileId);
            tileIdInput.focus();
            tilePalette.querySelectorAll<HTMLButtonElement>('.palette-tile').forEach((tileButton) => {
                tileButton.classList.toggle('selected', tileButton === button);
            });
        });
        tilePalette.append(button);
    });
}

function refreshTilePreviews(): void {
    if (!workingData) return;
    const offset = selectedMapOffset();
    LoadObjects(
        LoadRemapTable(workingData, offset),
        LoadTrailerTable(workingData, offset),
        LoadPrimaryLutMode(workingData, offset),
        WeatherMode.Dry,
    );
    tilePreviewAtlas = createTilePreviewAtlas(maps.tiles2, maps.tiles1, maps.tiles3);
    renderTilePalette();
    renderGrid();
}

function renderGrid(): void {
    if (!workingData) return;
    grid.replaceChildren();

    for (let y = 0; y < MAP_HEIGHT; y++) {
        for (let x = 0; x < MAP_WIDTH; x++) {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'tile-cell';
            button.dataset.x = String(x);
            button.dataset.y = String(y);
            button.setAttribute('aria-label', `Tile at x ${x}, y ${y}`);
            button.innerHTML = '<canvas class="tile-preview" aria-hidden="true"></canvas><span class="tile-id"></span>';
            button.addEventListener('click', () => selectCell(x, y));
            grid.append(button);
            renderCell(x, y);
        }
    }

    renderInspectionLayers();
    const mode = readMapMode(workingData, selectedMapOffset());
    modeInput.value = mode === 0 || mode === 1 ? String(mode) : 'unknown';
    updateStatus();
}

function renderInspectionLayers(): void {
    if (!workingData) return;

    const mapOffset = selectedMapOffset();
    currentEntityTable = readMapEntityTable(workingData, mapOffset);
    renderEntityList();
    renderOpponentScripts(mapOffset);
    renderRouteComparison();
    if (showEntitiesInput.checked) renderEntityOverlay();
    renderOpponentRouteTraces(mapOffset);
}

function renderEntityList(): void {
    if (!currentEntityTable) return;

    entitySummary.textContent = `${currentEntityTable.entities.length} placed records · ${currentEntityTable.aiCount} AI/behavior records · ${currentEntityTable.lodCount} LOD records`;
    entitySelect.replaceChildren();
    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = 'Select an entity…';
    entitySelect.append(placeholder);

    for (const entity of currentEntityTable.entities) {
        const option = document.createElement('option');
        option.value = String(entity.slot);
        option.textContent = `#${String(entity.slot).padStart(3, '0')} · ${entityName(entity.modelId)} · ${entity.x}, ${entity.z}`;
        entitySelect.append(option);
    }

    const selectedExists = selectedEntitySlot !== null
        && currentEntityTable.entities.some((entity) => entity.slot === selectedEntitySlot);
    if (!selectedExists) selectedEntitySlot = null;
    entitySelect.value = selectedEntitySlot === null ? '' : String(selectedEntitySlot);
    renderEntityDetails();
}

function renderOpponentScripts(mapOffset: number): void {
    const scripts = readOpponentRouteScripts(activeData(), mapOffset);
    opponentScripts.replaceChildren();

    for (const script of scripts) {
        const card = document.createElement('article');
        card.className = 'route-script';
        const title = document.createElement('h3');
        title.textContent = `Opponent ${script.slot} · model ${script.slot + 1}`;
        const initial = document.createElement('p');
        initial.textContent = `Initial mode: ${routeModeDescription(script.initialMode)}`;
        const steps = document.createElement('p');
        steps.textContent = script.branchModes.length > 0
            ? `Branch steps: ${script.branchModes.map(routeModeDescription).join(' → ')}`
            : 'Branch steps: none';
        const end = document.createElement('p');
        end.textContent = script.terminates
            ? 'A 0 script value removes the opponent after its scripted route.'
            : 'No 0 terminator found in this script.';
        card.append(title, initial, steps, end);
        opponentScripts.append(card);
    }

    const [first, second] = scripts;
    const samePlan = first.initialMode === second.initialMode
        && first.terminates === second.terminates
        && first.branchModes.length === second.branchModes.length
        && first.branchModes.every((mode, index) => mode === second.branchModes[index]);
    routeSummary.textContent = samePlan
        ? 'The two opponent branch scripts are identical for this leg.'
        : 'The two opponent branch scripts differ for this leg.';
}

function renderRouteComparison(): void {
    const table = document.createElement('table');
    table.className = 'route-table';
    const head = document.createElement('thead');
    const headerRow = document.createElement('tr');
    for (const label of ['Leg', 'Opponent 1', 'Opponent 2', 'Scripts']) {
        const cell = document.createElement('th');
        cell.textContent = label;
        headerRow.append(cell);
    }
    head.append(headerRow);
    table.append(head);

    const body = document.createElement('tbody');
    COURSE_LAYOUTS[courseId].mapOffsets.forEach((offset, index) => {
        const [first, second] = readOpponentRouteScripts(activeData(), offset);
        const samePlan = first.initialMode === second.initialMode
            && first.terminates === second.terminates
            && first.branchModes.length === second.branchModes.length
            && first.branchModes.every((mode, modeIndex) => mode === second.branchModes[modeIndex]);
        const row = document.createElement('tr');
        const legCell = document.createElement('th');
        legCell.scope = 'row';
        legCell.textContent = String(index + 1);
        row.append(legCell);

        for (const script of [first, second]) {
            const cell = document.createElement('td');
            cell.textContent = [script.initialMode, ...script.branchModes, ...(script.terminates ? [0] : [])].join(' → ');
            row.append(cell);
        }

        const result = document.createElement('td');
        result.textContent = samePlan ? 'Same' : 'Different';
        result.className = samePlan ? 'route-same' : 'route-different';
        row.append(result);
        body.append(row);
    });

    table.append(body);
    routeComparison.replaceChildren(table);
}

function renderOpponentRouteTraces(mapOffset: number): void {
    grid.querySelector('.route-overlay')?.remove();
    routeTraces.replaceChildren();
    routeSource.textContent = laneBankApproximate
        ? `Approximate shared-bank trace: ${laneBankSource}.`
        : `Lane source: ${laneBankSource}.`;

    if (!laneBank || !currentEntityTable || !workingData) {
        routeTraces.textContent = 'The shared lane bank or map entities are unavailable.';
        return;
    }

    const data = workingData;
    const lanes = laneBank;
    const entities = currentEntityTable.entities;
    const sharedTileData = files.datab;
    const sceneTileData = courseId === 'SCENE01' ? files.scene01 : files.scene02;
    if (!sharedTileData || !sceneTileData) {
        routeTraces.textContent = 'The tile geometry needed to locate this course’s finish is unavailable.';
        return;
    }

    const finishTileId = findMapTileWithFaceMaterial(
        data,
        mapOffset,
        sharedTileData,
        sceneTileData,
        courseId,
        FINISH_FACE_MATERIAL,
    );
    if (finishTileId === null) {
        routeTraces.textContent = 'No tile with the finish surface (material 0x1F) was found in this leg.';
        return;
    }

    const scripts = readOpponentRouteScripts(data, mapOffset);
    const opponents = entities.filter((entity) => entity.modelId === 0x02 || entity.modelId === 0x03);
    if (opponents.length === 0) {
        routeTraces.textContent = 'No opponent model records were found in this leg.';
        return;
    }
    const traces = opponents.map((entity) => ({
        entity,
        trace: traceOpponentLaneRoute(
            data,
            mapOffset,
            lanes,
            entity,
            scripts[entity.modelId - 2],
            finishTileId,
        ),
    }));

    for (const { entity, trace } of traces) {
        const card = document.createElement('article');
        card.className = 'route-script';
        const title = document.createElement('h3');
        title.textContent = `Opponent ${entity.modelId - 1} · ${routeTraceDescription(trace.status)}`
            + (laneBankApproximate ? ' · candidate' : '');
        const details = document.createElement('p');
        details.textContent = `${trace.steps.length} waypoints · ${trace.uTurnCount} same-cell U-turn${trace.uTurnCount === 1 ? '' : 's'}`;
        card.append(title, details);
        routeTraces.append(card);
    }

    if (showRoutesInput.checked) {
        const overlay = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        overlay.classList.add('route-overlay');
        if (laneBankApproximate) overlay.classList.add('route-overlay-approximate');
        overlay.setAttribute('viewBox', `0 0 ${MAP_WIDTH} ${MAP_HEIGHT}`);
        overlay.setAttribute('preserveAspectRatio', 'none');
        overlay.setAttribute('aria-label', 'Opponent lane routes');

        for (const { entity, trace } of traces) {
            if (trace.steps.length < 2) continue;
            for (const segment of splitWrappedRoute(trace.steps, MAP_WIDTH, MAP_HEIGHT)) {
                if (segment.length < 2) continue;
                const route = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
                route.classList.add(`route-opponent-${entity.modelId - 1}`);
                route.setAttribute('points', segment.map(({ x, y }) => `${x},${y}`).join(' '));
                overlay.append(route);
            }
        }
        grid.append(overlay);
    }
}

function routeTraceDescription(status: LaneRouteTrace['status']): string {
    switch (status) {
        case 'finish': return 'reaches finish';
        case 'script-ended': return 'script ends before finish';
        case 'route-loop': return 'route loops';
        case 'unmatched-exit': return 'dead-end exit';
        case 'unindexed-tile': return 'tile has no lane index';
        case 'invalid-waypoint': return 'invalid waypoint';
        case 'nondeterministic-branch': return 'random branch diverges';
        case 'step-limit': return 'step limit reached';
    }
}

function renderEntityOverlay(): void {
    if (!currentEntityTable) return;

    const overlay = document.createElement('div');
    overlay.className = 'entity-overlay';
    overlay.setAttribute('aria-label', 'Placed entities');

    for (const entity of currentEntityTable.entities) {
        if (entity.mapX < 0 || entity.mapX >= MAP_WIDTH || entity.mapY < 0 || entity.mapY >= MAP_HEIGHT) continue;

        const marker = document.createElement('button');
        marker.type = 'button';
        marker.className = `entity-marker ${entityMarkerClass(entity)}`;
        marker.dataset.slot = String(entity.slot);
        marker.textContent = entityMarkerText(entity);
        marker.title = `#${entity.slot} · ${entityName(entity.modelId)} · world X ${entity.x}, Z ${entity.z}`;
        marker.setAttribute('aria-label', marker.title);
        marker.style.left = `${(entity.mapX / MAP_WIDTH) * 100}%`;
        marker.style.top = `${(entity.mapY / MAP_HEIGHT) * 100}%`;
        marker.classList.toggle('selected', selectedEntitySlot === entity.slot);
        marker.addEventListener('click', (event) => {
            event.stopPropagation();
            selectEntity(entity.slot);
        });
        overlay.append(marker);
    }

    grid.append(overlay);
}

function renderEntityDetails(): void {
    if (!currentEntityTable || selectedEntitySlot === null) {
        entityDetails.textContent = 'Select an entity or map marker to inspect its stored fields.';
        return;
    }

    const entity = currentEntityTable.entities.find((item) => item.slot === selectedEntitySlot);
    if (!entity) {
        entityDetails.textContent = 'The selected entity is not in this leg.';
        return;
    }

    const behavior = (entity.flags >> 8) & 0x0F;
    entityDetails.textContent = [
        `Slot ${entity.slot} · ${entityName(entity.modelId)}`,
        `Flags 0x${entity.flags.toString(16).padStart(4, '0')} · behavior ${behavior} · ${entity.aiProcessed ? 'in AI pass' : 'outside AI pass'}`,
        `World position X ${entity.x}, Z ${entity.z}, Y ${entity.y}`,
        `Map position (${entity.mapX.toFixed(2)}, ${entity.mapY.toFixed(2)})`,
        `Rotation/state 0x${entity.heading.toString(16).padStart(4, '0')} · velocity 0x${entity.velocity.toString(16).padStart(4, '0')}`,
        `Cell ${entity.cell} · waypoint state 0x${entity.waypoint.toString(16).padStart(4, '0')}`,
    ].join('\n');
}

function selectEntity(slot: number): void {
    selectedEntitySlot = slot;
    entitySelect.value = String(slot);
    renderEntityDetails();
    refreshSelectedEntityMarker();
}

function refreshSelectedEntityMarker(): void {
    grid.querySelectorAll<HTMLButtonElement>('.entity-marker').forEach((marker) => {
        marker.classList.toggle('selected', Number(marker.dataset.slot) === selectedEntitySlot);
    });
}

function entityName(modelId: number): string {
    if (modelId === 0x01) return 'Likely player start';
    if (modelId === 0x02) return 'Opponent 1';
    if (modelId === 0x03) return 'Opponent 2';
    if (modelId === 0x11 || modelId === 0x30) return 'Police';
    return `Object 0x${modelId.toString(16).padStart(2, '0')}`;
}

function entityMarkerClass(entity: MapEntity): string {
    if (entity.modelId === 0x01) return 'entity-marker-player';
    if (entity.modelId === 0x02 || entity.modelId === 0x03) return 'entity-marker-opponent';
    if (entity.modelId === 0x11 || entity.modelId === 0x30) return 'entity-marker-police';
    return entity.aiProcessed ? 'entity-marker-ai' : 'entity-marker-static';
}

function entityMarkerText(entity: MapEntity): string {
    if (entity.modelId === 0x01) return 'S';
    if (entity.modelId === 0x02) return '1';
    if (entity.modelId === 0x03) return '2';
    if (entity.modelId === 0x11 || entity.modelId === 0x30) return 'P';
    return '.';
}

function routeModeDescription(mode: number): string {
    if (mode === 0) return '0 (route ends)';
    if (mode === 2) return '2 (default branch mode)';
    if (mode === 3) return '3 (branch mode 1)';
    if (mode === 4) return '4 (branch mode 2)';
    return `${mode} (unclassified mode)`;
}

function selectCell(x: number, y: number): void {
    selectedCell = { x, y };
    if (paintInput.checked) {
        writeMapCell(activeData(), selectedMapOffset(), x, y, readCellControls());
        updateCellDetails(x, y, readMapCell(activeData(), selectedMapOffset(), x, y));
        renderGrid();
        return;
    }

    updateCellDetails(x, y, readMapCell(activeData(), selectedMapOffset(), x, y));
    renderGrid();
}

function updateCellDetails(x: number, y: number, cell: MapCell): void {
    tileIdInput.value = String(paletteTileId ?? cell.tileId);
    rotationInput.value = String(cell.rotation);
    elevationInput.value = String(cell.elevation);
    cellDetails.textContent = `Cell (${x}, ${y}) · shared tile ${cell.tileId.toString(16).padStart(2, '0').toUpperCase()}`;
    if (cell.tileId >= 0x40) {
        cellDetails.textContent = `Cell (${x}, ${y}) · course tile ${(cell.tileId - 0x40).toString(16).padStart(2, '0').toUpperCase()}`;
    }

}

function readCellControls(): MapCell {
    return {
        tileId: Number(tileIdInput.value),
        rotation: Number(rotationInput.value),
        elevation: Number(elevationInput.value),
    };
}

function applyCell(): void {
    if (!selectedCell) {
        setStatus('Select a map cell before applying edits.', true);
        return;
    }

    try {
        writeMapCell(activeData(), selectedMapOffset(), selectedCell.x, selectedCell.y, readCellControls());
        if (!paintInput.checked) paletteTileId = null;
        const { x, y } = selectedCell;
        updateCellDetails(x, y, readMapCell(activeData(), selectedMapOffset(), x, y));
        renderGrid();
    } catch (error) {
        setStatus(error instanceof Error ? error.message : 'Could not edit this cell.', true);
    }
}

async function loadCourseLaneBank(id: CourseId, sceneData: Uint8Array): Promise<void> {
    const sceneList = id === 'SCENE01' ? files.scene01Lst : files.scene02Lst;
    if (!sceneList || !sharedLaneBank) {
        throw new Error(`${id} lane-bank configuration or shared lane data is unavailable.`);
    }

    if (!requiresSceneSpecificLaneBank(sceneList)) {
        laneBank = sharedLaneBank;
        laneBankSource = 'shared SCENETTP.BIN';
        laneBankApproximate = false;
        return;
    }

    const filename = `${id}P.BIN`;
    const embeddedBank = extractSceneArchiveEntry(sceneList, sceneData, filename);
    if (embeddedBank) {
        laneBank = parseLaneBank(embeddedBank, PRIVATE_LANE_TILE_COUNT);
        laneBankSource = `${filename} embedded in ${id}.DAT`;
        laneBankApproximate = false;
        return;
    }

    const response = await fetch(new URL(`base/${filename}`, window.location.href));
    if (isUnavailableSceneLaneBankResponse(response.status, response.headers.get('content-type'))) {
        laneBank = sharedLaneBank;
        laneBankSource = `${filename} missing; using shared SCENETTP.BIN`;
        laneBankApproximate = true;
        return;
    }
    if (!response.ok) {
        throw new Error(`Could not load ${filename} (${response.status}).`);
    }

    laneBank = parseLaneBank(new Uint8Array(await response.arrayBuffer()), PRIVATE_LANE_TILE_COUNT);
    laneBankSource = filename;
    laneBankApproximate = false;
}

async function loadBuiltInCourse(id: CourseId): Promise<void> {
    const filename = `${id}.DAT`;
    const url = new URL(`base/${filename}`, window.location.href);
    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(`Could not load ${filename} (${response.status}).`);
    }

    const bytes = new Uint8Array(await response.arrayBuffer());
    validateCourseFile(bytes, id);
    await loadCourseLaneBank(id, bytes);
    courseId = id;
    sourceFilename = filename;
    originalData = bytes.slice();
    workingData = bytes.slice();
    inversionApplied = false;
    selectedCell = null;
    paletteTileId = null;
    filenameLabel.textContent = sourceFilename;
    cellDetails.textContent = 'Select a cell to inspect or edit it.';
    refreshTilePreviews();
}

function validateCourseFile(data: Uint8Array, id: CourseId): void {
    const lastMapOffset = COURSE_LAYOUTS[id].mapOffsets[4];
    const requiredLength = lastMapOffset + MAP_RESOURCE_SIZE;
    if (data.length < requiredLength) {
        throw new Error(`${id} DAT is too short to contain its five maps.`);
    }
}

function downloadData(): void {
    if (!workingData) return;
    const stem = sourceFilename.replace(/\.DAT$/i, '');
    const exportBuffer = new ArrayBuffer(workingData.byteLength);
    new Uint8Array(exportBuffer).set(workingData);
    const blob = new Blob([exportBuffer], { type: 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = inversionApplied ? 'SCENE03.DAT' : `${stem}_EDITED.DAT`;
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function resetCurrentLeg(): void {
    if (!originalData || !workingData || inversionApplied) return;
    const offset = selectedMapOffset();
    workingData.set(originalData.subarray(offset, offset + MAP_RESOURCE_SIZE), offset);
    selectedCell = null;
    cellDetails.textContent = 'Select a cell to inspect or edit it.';
    refreshTilePreviews();
}

function resetAll(): void {
    if (!originalData) return;
    workingData = originalData.slice();
    inversionApplied = false;
    selectedCell = null;
    cellDetails.textContent = 'Select a cell to inspect or edit it.';
    refreshTilePreviews();
}

function invertCourse(): void {
    if (!workingData || courseId !== 'SCENE01' || inversionApplied) return;

    try {
        workingData = invertPacificCourse(workingData);
        inversionApplied = true;
        selectedCell = null;
        selectedEntitySlot = null;
        paletteTileId = null;
        legSelect.value = '0';
        cellDetails.textContent = 'Select a cell to inspect the reversed course.';
        refreshTilePreviews();
        setStatus('SCENE03.DAT experiment ready · opponent lane direction is unmodified and unverified.');
    } catch (error) {
        setStatus(error instanceof Error ? error.message : 'Could not invert the Pacific course.', true);
    }
}

courseSelect.addEventListener('change', () => {
    const id = parseCourseId(courseSelect.value);
    if (!id) {
        setStatus(`Unknown course selection: ${courseSelect.value}`, true);
        return;
    }
    void (async () => {
        await editorReady;
        await loadBuiltInCourse(id);
    })().catch((error: unknown) => {
        setStatus(error instanceof Error ? error.message : 'Could not load course data or tile previews.', true);
    });
});

legSelect.addEventListener('change', () => {
    selectedCell = null;
    selectedEntitySlot = null;
    cellDetails.textContent = 'Select a cell to inspect or edit it.';
    if (workingData) refreshTilePreviews();
});

showEntitiesInput.addEventListener('change', () => {
    if (workingData) renderGrid();
});
showRoutesInput.addEventListener('change', () => {
    if (workingData) renderGrid();
});
entitySelect.addEventListener('change', () => {
    selectedEntitySlot = entitySelect.value === '' ? null : Number(entitySelect.value);
    renderEntityDetails();
    refreshSelectedEntityMarker();
});

requiredElement<HTMLButtonElement>('apply-cell').addEventListener('click', applyCell);
tileIdInput.addEventListener('input', () => {
    paletteTileId = null;
    tilePalette.querySelectorAll<HTMLButtonElement>('.palette-tile.selected').forEach((button) => {
        button.classList.remove('selected');
    });
});
requiredElement<HTMLButtonElement>('reset-cell').addEventListener('click', () => {
    if (!originalData || !workingData || !selectedCell) return;
    const offset = selectedMapOffset() + 0x00DF + (selectedCell.y * MAP_WIDTH + selectedCell.x) * 2;
    workingData[offset] = originalData[offset];
    workingData[offset + 1] = originalData[offset + 1];
    updateCellDetails(selectedCell.x, selectedCell.y, readMapCell(activeData(), selectedMapOffset(), selectedCell.x, selectedCell.y));
    renderGrid();
});
requiredElement<HTMLButtonElement>('set-mode').addEventListener('click', () => {
    if (!workingData) return;
    const mode = modeInput.value === '0' ? 0 : modeInput.value === '1' ? 1 : null;
    if (mode === null) return;
    writeMapMode(workingData, selectedMapOffset(), mode);
    refreshTilePreviews();
});
invertCourseButton.addEventListener('click', invertCourse);
paletteBankSelect.addEventListener('change', renderTilePalette);
exportButton.addEventListener('click', downloadData);
resetLegButton.addEventListener('click', resetCurrentLeg);
resetAllButton.addEventListener('click', resetAll);

requiredElement<HTMLButtonElement>('open-dat').addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', async () => {
    const file = fileInput.files?.[0];
    if (!file) return;

    try {
        await editorReady;
        const bytes = new Uint8Array(await file.arrayBuffer());
        const selectedCourse = parseCourseId(courseSelect.value);
        if (!selectedCourse) {
            throw new Error(`Unknown course layout: ${courseSelect.value}`);
        }
        validateCourseFile(bytes, selectedCourse);
        sourceFilename = file.name;
        originalData = bytes.slice();
        workingData = bytes.slice();
        inversionApplied = false;
        selectedCell = null;
        selectedEntitySlot = null;
        paletteTileId = null;
        filenameLabel.textContent = sourceFilename;
        cellDetails.textContent = 'Select a cell to inspect or edit it.';
        refreshTilePreviews();
    } catch (error) {
        setStatus(error instanceof Error ? error.message : 'Could not open DAT file.', true);
    } finally {
        fileInput.value = '';
    }
});

for (let leg = 1; leg <= 5; leg++) {
    const option = document.createElement('option');
    option.value = String(leg - 1);
    option.textContent = `Leg ${leg}`;
    legSelect.append(option);
}

const editorReady = (async () => {
    await loadFiles();
    if (!files.datab || files.datab.length < LANE_BANK_OFFSET + LANE_BANK_SIZE) {
        throw new Error('DATAB.DAT does not contain the shared SCENETTP lane bank.');
    }
    sharedLaneBank = parseLaneBank(files.datab.subarray(LANE_BANK_OFFSET, LANE_BANK_OFFSET + LANE_BANK_SIZE));
    await loadBuiltInCourse(courseId);
})();

editorReady.catch((error: unknown) => {
    setStatus(error instanceof Error ? error.message : 'Could not initialize the editor.', true);
});

function parseCourseId(value: string): CourseId | null {
    return value in COURSE_LAYOUTS ? value as CourseId : null;
}
