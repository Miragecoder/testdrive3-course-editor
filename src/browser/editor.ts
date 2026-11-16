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
    writeMapEntity,
    writeOpponentRouteScript,
    type MapEntity,
    type MapEntityTable,
    type WritableMapEntityFields,
} from '@shared/map-inspection';
import { LoadPrimaryLutMode, LoadRemapTable, LoadTrailerTable, WeatherMode } from '@shared/color';
import { LoadObjects, maps } from '@shared/objects';
import { files, loadFiles } from '@shared/files';
import {
    PRIVATE_LANE_TILE_COUNT,
    isLaneEntry,
    isLaneExit,
    parseLaneBank,
    reverseLaneBank,
    rotatedSide,
    serializeLaneBank,
    type CardinalSide,
    type TileLane,
} from '@shared/lane-connectivity';
import { traceOpponentLaneRoute, type LaneRouteTrace } from '@shared/lane-routes';
import { pathsDivergeAndReconverge, probeOpponentPaths, type ProbedPath } from '@shared/route-probe';
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
import {
    readSceneLstStrings,
    writeCourseName,
    writeRouteName,
    writeUiStrings,
    createScene03LstFromScene01,
} from '@shared/scene-lst';
import {
    decodeSceneImageSlot,
    encodeSceneImageSlot,
    getSceneImageSlots,
    swapScene01LandscapeSetsAandC,
    tryReplaceSceneImageSlot,
    type SceneImageSlot,
} from '@shared/scene-dat-images';
import {
    applyPaletteLayer,
    createDefaultPalette,
    replaceTd3ImageSlot,
} from '@shared/td3-image';

const courseSelect = requiredElement<HTMLSelectElement>('course-select');
const legSelect = requiredElement<HTMLSelectElement>('leg-select');
const grid = requiredElement<HTMLDivElement>('map-grid');
const zoomInput = requiredElement<HTMLInputElement>('map-zoom');
const zoomValue = requiredElement<HTMLSpanElement>('map-zoom-value');
const tileIdInput = requiredElement<HTMLInputElement>('tile-id');
const rotationInput = requiredElement<HTMLSelectElement>('tile-rotation');
const elevationInput = requiredElement<HTMLInputElement>('tile-elevation');
const modeInput = requiredElement<HTMLSelectElement>('map-mode');
const paintInput = requiredElement<HTMLInputElement>('paint-mode');
const cellDetails = requiredElement<HTMLDivElement>('cell-details');
const status = requiredElement<HTMLDivElement>('status');
const fileInput = requiredElement<HTMLInputElement>('custom-dat');
const filenameLabel = requiredElement<HTMLSpanElement>('source-filename');
const lstFilenameLabel = requiredElement<HTMLSpanElement>('lst-filename');
const exportButton = requiredElement<HTMLButtonElement>('export-dat');
const exportLstButton = requiredElement<HTMLButtonElement>('export-lst');
const lstCourseNameInput = requiredElement<HTMLInputElement>('lst-course-name');
const lstRouteNamesEl = requiredElement<HTMLDivElement>('lst-route-names');
const lstUiStringsInput = requiredElement<HTMLTextAreaElement>('lst-ui-strings');
const lstFeedback = requiredElement<HTMLParagraphElement>('lst-feedback');
const applyLstButton = requiredElement<HTMLButtonElement>('apply-lst');
const resetLstButton = requiredElement<HTMLButtonElement>('reset-lst');
const exportLaneBankButton = requiredElement<HTMLButtonElement>('export-lane-bank');
const invertCourseButton = requiredElement<HTMLButtonElement>('invert-course');
const swapScene03LandscapesInput = requiredElement<HTMLInputElement>('swap-scene03-landscapes');
const resetLegButton = requiredElement<HTMLButtonElement>('reset-leg');
const resetAllButton = requiredElement<HTMLButtonElement>('reset-all');
const sceneImageSlotSelect = requiredElement<HTMLSelectElement>('scene-image-slot');
const sceneImagePreview = requiredElement<HTMLCanvasElement>('scene-image-preview');
const sceneImageInfo = requiredElement<HTMLParagraphElement>('scene-image-info');
const sceneImageExportButton = requiredElement<HTMLButtonElement>('scene-image-export');
const sceneImageReplaceButton = requiredElement<HTMLButtonElement>('scene-image-replace');
const sceneImageFitReplaceButton = requiredElement<HTMLButtonElement>('scene-image-fit-replace');
const sceneImageFileInput = requiredElement<HTMLInputElement>('scene-image-file');
const sceneImageFeedback = requiredElement<HTMLParagraphElement>('scene-image-feedback');
const paletteBankSelect = requiredElement<HTMLSelectElement>('palette-bank');
const tilePalette = requiredElement<HTMLDivElement>('tile-palette');
const showEntitiesInput = requiredElement<HTMLInputElement>('show-entities');
const showRoute1Input = requiredElement<HTMLInputElement>('show-route-1');
const showRoute2Input = requiredElement<HTMLInputElement>('show-route-2');
const showWaypointsInput = requiredElement<HTMLInputElement>('show-waypoints');
const entitySelect = requiredElement<HTMLSelectElement>('entity-select');
const entityDetails = requiredElement<HTMLElement>('entity-details');
const entitySummary = requiredElement<HTMLParagraphElement>('entity-summary');
const opponentScripts = requiredElement<HTMLDivElement>('opponent-scripts');
const routeSummary = requiredElement<HTMLParagraphElement>('route-summary');
const routeSource = requiredElement<HTMLParagraphElement>('route-source');
const routeTraces = requiredElement<HTMLDivElement>('route-traces');
const probeButton = requiredElement<HTMLButtonElement>('probe-routes');
const probeResults = requiredElement<HTMLDivElement>('probe-results');
const routeComparison = requiredElement<HTMLDivElement>('route-comparison');

const LANE_BANK_OFFSET = 0x3AD05;
const LANE_BANK_SIZE = 0x1E67;
const FINISH_FACE_MATERIAL = 0x1F;

let courseId: CourseId = 'SCENE01';
let sourceFilename = 'SCENE01.DAT';
let originalData: Uint8Array | null = null;
let workingData: Uint8Array | null = null;
let originalLstData: Uint8Array | null = null;
let workingLstData: Uint8Array | null = null;
let lstSourceFilename = 'SCENE01.LST';
let selectedCell: { x: number; y: number } | null = null;
let hoveredCell: { x: number; y: number } | null = null;
let tilePreviewAtlas: HTMLCanvasElement | null = null;
let paletteTileId: number | null = null;
let selectedEntitySlot: number | null = null;
let currentEntityTable: MapEntityTable | null = null;
let sharedLaneBank: readonly TileLane[] | null = null;
let laneBank: readonly TileLane[] | null = null;
let laneBankSource = 'shared SCENETTP.BIN';
let laneBankApproximate = false;
let inversionApplied = false;
let invertedLaneBankData: Uint8Array | null = null;
let inversionOriginalLaneBank: readonly TileLane[] | null = null;
let inversionOriginalLaneBankSource = '';
let inversionOriginalLaneBankApproximate = false;
let pendingSceneImageReplaceAutoFit = false;

function requiredElement<T extends HTMLElement>(id: string): T {
    const element = document.getElementById(id);
    if (!element) {
        throw new Error(`Missing editor element #${id}.`);
    }
    return element as T;
}

function getSceneImageCourseId(): 'SCENE01' | 'SCENE02' | null {
    if (courseId === 'SCENE01' || courseId === 'SCENE02') return courseId;
    return null;
}

function sceneImagePaletteForSlot(dat: Uint8Array, slot: SceneImageSlot): number[] {
    const palette = createDefaultPalette();
    if (slot.paletteOffset !== undefined) {
        // Scene landscape palettes are 112 colors loaded into indices 16..127 (low bank).
        applyPaletteLayer(palette, dat, slot.paletteOffset, 16, 112);
    }
    // Title/icon slots use default VGA palette as-is.
    return palette;
}

function sceneImageAllowedIndices(slot: SceneImageSlot): number[] | null {
    if (slot.paletteOffset !== undefined) {
        const indices: number[] = [];
        for (let i = 16; i < 128; i++) indices.push(i);
        return indices;
    }
    return null; // all indices allowed
}

function nearestPaletteIndex(r: number, g: number, b: number, palette: number[], allowed?: number[] | null): number {
    let best = 0;
    let bestDist = Infinity;
    const range = allowed ?? Array.from({ length: 256 }, (_, i) => i);
    for (const i of range) {
        const p = i * 3;
        const dr = r - (palette[p] ?? 0);
        const dg = g - (palette[p + 1] ?? 0);
        const db = b - (palette[p + 2] ?? 0);
        const dist = dr * dr + dg * dg + db * db;
        if (dist < bestDist) {
            bestDist = dist;
            best = i;
            if (dist === 0) break;
        }
    }
    return best;
}

function renderSceneImagePreview(slot: SceneImageSlot): void {
    sceneImageFeedback.textContent = '';
    sceneImageFeedback.classList.remove('error');
    if (!workingData) {
        sceneImageInfo.textContent = 'Open a course DAT file first.';
        sceneImageExportButton.disabled = true;
        sceneImageReplaceButton.disabled = true;
        const ctx = sceneImagePreview.getContext('2d');
        if (ctx) ctx.clearRect(0, 0, sceneImagePreview.width, sceneImagePreview.height);
        return;
    }

    try {
        const decoded = decodeSceneImageSlot(workingData, slot);
        const palette = sceneImagePaletteForSlot(workingData, slot);
        const width = slot.width;
        const height = slot.height ?? Math.floor(decoded.length / width);
        if (decoded.length !== width * height) {
            throw new Error(`Decoded image is ${decoded.length} pixels, expected ${width * height}.`);
        }

        sceneImagePreview.width = width;
        sceneImagePreview.height = height;
        const ctx = sceneImagePreview.getContext('2d');
        if (!ctx) throw new Error('Could not create canvas context for image preview.');
        const imageData = ctx.createImageData(width, height);
        for (let y = 0; y < height; y++) {
            const srcY = height - 1 - y; // TD3 images stored bottom-to-top
            for (let x = 0; x < width; x++) {
                const idx = decoded[srcY * width + x] ?? 0;
                const p = idx * 3;
                const di = (y * width + x) * 4;
                imageData.data[di + 0] = palette[p] ?? 0;
                imageData.data[di + 1] = palette[p + 1] ?? 0;
                imageData.data[di + 2] = palette[p + 2] ?? 0;
                imageData.data[di + 3] = 255;
            }
        }
        ctx.putImageData(imageData, 0, 0);

        const slotCourse = getSceneImageCourseId();
        const compressedSize = workingData ? slot.size : 0;
        sceneImageInfo.textContent = `${slotCourse ?? courseId} · ${slot.description} · ${width}×${height} · slot 0x${slot.offset.toString(16)} (${slot.size} bytes)`;
        void compressedSize;
        sceneImageExportButton.disabled = false;
        sceneImageReplaceButton.disabled = !slotCourse;
        sceneImageFitReplaceButton.disabled = !slotCourse;
    } catch (error) {
        sceneImageInfo.textContent = 'Could not decode this image slot.';
        sceneImageFeedback.textContent = error instanceof Error ? error.message : 'Decode failed.';
        sceneImageFeedback.classList.add('error');
        sceneImageExportButton.disabled = true;
        sceneImageReplaceButton.disabled = true;
        sceneImageFitReplaceButton.disabled = true;
    }
}

function refreshSceneImageUI(): void {
    const id = getSceneImageCourseId();
    sceneImageSlotSelect.replaceChildren();
    sceneImageFeedback.textContent = '';
    sceneImageFeedback.classList.remove('error');

    if (!id || !workingData) {
        const opt = document.createElement('option');
        opt.value = '';
        opt.textContent = id ? 'No data loaded' : 'Not available for this course';
        sceneImageSlotSelect.append(opt);
        sceneImageSlotSelect.disabled = true;
        sceneImageInfo.textContent = !id ? 'Scene UI bitmap slots are defined for SCENE01/SCENE02.' : 'Open a course DAT file first.';
        sceneImageExportButton.disabled = true;
        sceneImageReplaceButton.disabled = true;
        sceneImageFitReplaceButton.disabled = true;
        const ctx = sceneImagePreview.getContext('2d');
        if (ctx) ctx.clearRect(0, 0, sceneImagePreview.width, sceneImagePreview.height);
        return;
    }

    sceneImageSlotSelect.disabled = false;
    const slots = getSceneImageSlots(id);
    for (const slot of slots) {
        const opt = document.createElement('option');
        opt.value = slot.id;
        opt.textContent = `${slot.id} · ${slot.description} (${slot.width}×${slot.height ?? '?'})`;
        sceneImageSlotSelect.append(opt);
    }
    const current = slots.find(s => s.id === sceneImageSlotSelect.value) ?? slots[0];
    if (current) {
        sceneImageSlotSelect.value = current.id;
        renderSceneImagePreview(current);
    }
}

function selectedSceneImageSlot(): SceneImageSlot | null {
    const id = getSceneImageCourseId();
    if (!id) return null;
    const slots = getSceneImageSlots(id);
    return slots.find(s => s.id === sceneImageSlotSelect.value) ?? null;
}

function exportSceneImagePng(): void {
    const slot = selectedSceneImageSlot();
    if (!slot || !workingData) return;
    try {
        const url = sceneImagePreview.toDataURL('image/png');
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = `${getSceneImageCourseId() ?? courseId}_${slot.id}_0x${slot.offset.toString(16)}_${slot.width}x${slot.height ?? 0}.png`;
        anchor.click();
        sceneImageFeedback.textContent = `Exported ${anchor.download}.`;
        sceneImageFeedback.classList.remove('error');
    } catch (error) {
        sceneImageFeedback.textContent = error instanceof Error ? error.message : 'Could not export image.';
        sceneImageFeedback.classList.add('error');
    }
}

function paletteColorDistance(a: number, b: number, palette: number[]): number {
    const ap = a * 3;
    const bp = b * 3;
    const dr = (palette[ap] ?? 0) - (palette[bp] ?? 0);
    const dg = (palette[ap + 1] ?? 0) - (palette[bp + 1] ?? 0);
    const db = (palette[ap + 2] ?? 0) - (palette[bp + 2] ?? 0);
    return dr * dr + dg * dg + db * db;
}

function remapIndexedToAllowed(indexed: Uint8Array, allowed: number[], palette: number[]): Uint8Array {
    if (allowed.length === 0) return indexed.slice();
    const allowedSet = new Set(allowed);
    const map = new Map<number, number>();
    const getMapped = (idx: number): number => {
        if (allowedSet.has(idx)) return idx;
        const cached = map.get(idx);
        if (cached !== undefined) return cached;
        let best = allowed[0];
        let bestDist = Infinity;
        for (const a of allowed) {
            const d = paletteColorDistance(idx, a, palette);
            if (d < bestDist) {
                bestDist = d;
                best = a;
                if (d === 0) break;
            }
        }
        map.set(idx, best);
        return best;
    };
    const out = new Uint8Array(indexed.length);
    for (let i = 0; i < indexed.length; i++) {
        out[i] = getMapped(indexed[i]);
    }
    return out;
}

function fitIndexedPixelsToSlot(
    indexed: Uint8Array,
    slot: SceneImageSlot,
    palette: number[],
): { fitted: Uint8Array; encoded: Uint8Array; colors: number } | null {
    const direct = encodeSceneImageSlot(indexed, slot);
    if (direct.length <= slot.size) {
        const distinct = new Set(indexed).size;
        return { fitted: indexed, encoded: direct, colors: distinct };
    }

    const freq = new Map<number, number>();
    for (let i = 0; i < indexed.length; i++) {
        const v = indexed[i];
        freq.set(v, (freq.get(v) ?? 0) + 1);
    }
    const usedAll = [...freq.entries()].sort((a, b) => b[1] - a[1]).map(([idx]) => idx);
    const allowedRange = sceneImageAllowedIndices(slot);
    const used = allowedRange ? usedAll.filter(i => allowedRange.includes(i)) : usedAll;
    // Fallback: if nothing in allowed range (shouldn't happen), use allowed range directly
    const baseUsed = used.length > 0 ? used : (allowedRange ?? usedAll);

    // Try progressively fewer allowed colors (keep most frequent, remap others to nearest kept).
    for (let k = Math.min(baseUsed.length - 1, 255); k >= 1; k = k > 16 ? k - Math.max(1, Math.floor(k * 0.15)) : k - 1) {
        const allowed = baseUsed.slice(0, k);
        const candidate = remapIndexedToAllowed(indexed, allowed, palette);
        const enc = encodeSceneImageSlot(candidate, slot);
        if (enc.length <= slot.size) {
            return { fitted: candidate, encoded: enc, colors: k };
        }
    }

    // Extreme fallback: single most frequent color within allowed range.
    const mono = new Uint8Array(indexed.length).fill(baseUsed[0] ?? 0);
    const monoEnc = encodeSceneImageSlot(mono, slot);
    if (monoEnc.length <= slot.size) {
        return { fitted: mono, encoded: monoEnc, colors: 1 };
    }
    return null;
}

async function replaceSceneImageFromFile(file: File, autoFit: boolean): Promise<void> {
    const slot = selectedSceneImageSlot();
    if (!slot || !workingData) return;
    sceneImageFeedback.textContent = '';
    sceneImageFeedback.classList.remove('error');
    try {
        const bitmap = await createImageBitmap(file);
        try {
            const width = slot.width;
            const height = slot.height ?? Math.floor((decodeSceneImageSlot(workingData, slot).length) / width);
            if (bitmap.width !== width || bitmap.height !== height) {
                throw new Error(`Image must be ${width}×${height} pixels (got ${bitmap.width}×${bitmap.height}).`);
            }
            const canvas = document.createElement('canvas');
            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext('2d');
            if (!ctx) throw new Error('Could not read uploaded image.');
            ctx.drawImage(bitmap, 0, 0);
            const rgba = ctx.getImageData(0, 0, width, height).data;
            const palette = sceneImagePaletteForSlot(workingData, slot);
            const allowedIndices = sceneImageAllowedIndices(slot);

            // Convert top-to-bottom canvas pixels to TD3 bottom-to-top indexed pixels.
            // Canvas row 0 (top visual) -> TD3 buffer row (height-1).
            const indexed = new Uint8Array(width * height);
            for (let y = 0; y < height; y++) {
                const dstY = height - 1 - y;
                for (let x = 0; x < width; x++) {
                    const si = (y * width + x) * 4;
                    indexed[dstY * width + x] = nearestPaletteIndex(rgba[si], rgba[si + 1], rgba[si + 2], palette, allowedIndices);
                }
            }

            const direct = tryReplaceSceneImageSlot(workingData, slot, indexed);
            if (direct.ok) {
                renderSceneImagePreview(slot);
                updateStatus();
                sceneImageFeedback.textContent = `Replaced ${slot.id} (${direct.size}/${slot.size} bytes).`;
                sceneImageFeedback.classList.remove('error');
                return;
            }

            if (!autoFit) {
                throw new Error(`${direct.reason} Try "Fit & replace…" to simplify colors until it fits.`);
            }

            const fit = fitIndexedPixelsToSlot(indexed, slot, palette);
            if (!fit) {
                throw new Error(`${direct.reason} Could not auto-fit within slot size.`);
            }
            // Write fitted result
            replaceTd3ImageSlot(workingData, slot.offset, slot.size, fit.encoded);
            renderSceneImagePreview(slot);
            updateStatus();
            sceneImageFeedback.textContent = `Replaced ${slot.id} after fitting (${fit.encoded.length}/${slot.size} bytes, ~${fit.colors} colors).`;
            sceneImageFeedback.classList.remove('error');
        } finally {
            bitmap.close();
        }
    } catch (error) {
        sceneImageFeedback.textContent = error instanceof Error ? error.message : 'Could not replace image.';
        sceneImageFeedback.classList.add('error');
    }
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
    exportLstButton.disabled = !workingLstData;
    exportLaneBankButton.disabled = !inversionApplied || !invertedLaneBankData;
    invertCourseButton.disabled = inversionApplied || courseId !== 'SCENE01';
    resetLegButton.disabled = inversionApplied;
    resetAllButton.disabled = false;
    resetLstButton.disabled = !workingLstData;
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
    refreshSceneImageUI();
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
            button.addEventListener('mouseenter', () => setHoveredCell(x, y));
            button.addEventListener('mouseleave', () => {
                if (hoveredCell?.x === x && hoveredCell.y === y) setHoveredCell(null, null);
            });
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
    renderOpponentScriptEditors(mapOffset);
    refreshOpponentRouteViews(mapOffset);
    if (showWaypointsInput.checked) renderWaypointOverlay(mapOffset);
    if (showEntitiesInput.checked) renderEntityOverlay();
}

function setHoveredCell(x: number | null, y: number | null): void {
    const next = x === null || y === null ? null : { x, y };
    if (hoveredCell?.x === next?.x && hoveredCell?.y === next?.y) return;
    hoveredCell = next;
    if (!showWaypointsInput.checked || !workingData) return;
    grid.querySelector('.waypoint-overlay')?.remove();
    renderWaypointOverlay(selectedMapOffset());
}

function renderWaypointOverlay(mapOffset: number): void {
    if (!laneBank || !workingData) return;

    const laneByTile = new Map(laneBank.map((lane) => [lane.tileId, lane]));
    const overlay = document.createElement('div');
    overlay.className = 'waypoint-overlay';
    overlay.setAttribute('aria-label', 'Tile lane waypoints');

    if (!hoveredCell) {
        grid.append(overlay);
        return;
    }

    const { x, y } = hoveredCell;
    const cell = readMapCell(workingData, mapOffset, x, y);
    const lane = laneByTile.get(cell.tileId);
    if (!lane || lane.waypoints.length === 0) {
        grid.append(overlay);
        return;
    }

    const cellOverlay = document.createElement('div');
    cellOverlay.className = 'waypoint-cell';
    cellOverlay.style.left = `${(x / MAP_WIDTH) * 100}%`;
    cellOverlay.style.top = `${(y / MAP_HEIGHT) * 100}%`;
    cellOverlay.style.width = `${(1 / MAP_WIDTH) * 100}%`;
    cellOverlay.style.height = `${(1 / MAP_HEIGHT) * 100}%`;

    const sideBuckets: Record<CardinalSide, Array<{ waypoint: typeof lane.waypoints[number]; isExit: boolean }>> = {
        0: [], 1: [], 2: [], 3: [],
    };
    const internalWaypoints: typeof lane.waypoints[number][] = [];

    for (const waypoint of lane.waypoints) {
        const isExit = isLaneExit(waypoint);
        const isEntry = isLaneEntry(waypoint);
        if (isExit || isEntry) {
            const worldSide = rotatedSide(cell.rotation, waypoint.flags & 3) as CardinalSide;
            sideBuckets[worldSide].push({ waypoint, isExit });
        } else {
            internalWaypoints.push(waypoint);
        }
    }

    for (const side of [0, 1, 2, 3] as const) {
        const items = sideBuckets[side];
        items.forEach(({ waypoint, isExit }, index) => {
            const marker = document.createElement('span');
            marker.className = 'waypoint-marker';
            marker.textContent = String(waypoint.index);
            marker.classList.add(isExit ? 'waypoint-exit' : 'waypoint-entry');
            marker.classList.add(`side-${side}`);
            positionWaypointOnSide(marker, side, index, items.length);
            marker.title = `Cell (${x},${y}) tile 0x${cell.tileId.toString(16).padStart(2, '0')} wp ${waypoint.index} ${isExit ? 'exit' : 'entry'} side ${['N', 'E', 'S', 'W'][side]} flags 0x${waypoint.flags.toString(16).padStart(4, '0')}`;
            cellOverlay.append(marker);
        });
    }

    internalWaypoints.forEach((waypoint, index) => {
        const marker = document.createElement('span');
        marker.className = 'waypoint-marker waypoint-internal';
        marker.textContent = String(waypoint.index);
        const cols = Math.max(1, Math.ceil(Math.sqrt(internalWaypoints.length || 1)));
        const col = index % cols;
        const row = Math.floor(index / cols);
        const rows = Math.max(1, Math.ceil(internalWaypoints.length / cols));
        const left = ((col + 1) / (cols + 1)) * 100;
        const top = 20 + ((row + 0.5) / Math.max(rows, 1)) * 60;
        marker.style.left = `${left}%`;
        marker.style.top = `${Math.min(88, top)}%`;
        marker.title = `Cell (${x},${y}) tile 0x${cell.tileId.toString(16).padStart(2, '0')} wp ${waypoint.index} flags 0x${waypoint.flags.toString(16).padStart(4, '0')} x ${waypoint.x} z ${waypoint.z}`;
        cellOverlay.append(marker);
    });

    const count = document.createElement('span');
    count.className = 'waypoint-count';
    count.textContent = `${lane.waypoints.length}`;
    count.title = `Tile 0x${cell.tileId.toString(16).padStart(2, '0')} has ${lane.waypoints.length} lane waypoint(s)`;
    cellOverlay.append(count);
    overlay.append(cellOverlay);
    grid.append(overlay);
}

function positionWaypointOnSide(marker: HTMLElement, side: CardinalSide, index = 0, count = 1): void {
    const spread = count <= 1 ? 50 : 20 + (index / (count - 1)) * 60;
    if (side === 0) { marker.style.left = `${spread}%`; marker.style.top = '0%'; }
    else if (side === 1) { marker.style.left = '100%'; marker.style.top = `${spread}%`; }
    else if (side === 2) { marker.style.left = `${spread}%`; marker.style.top = '100%'; }
    else { marker.style.left = '0%'; marker.style.top = `${spread}%`; }
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

function renderOpponentScriptEditors(mapOffset: number): void {
    const scripts = readOpponentRouteScripts(activeData(), mapOffset);
    opponentScripts.replaceChildren();

    scripts.forEach((script, index) => {
        const card = document.createElement('article');
        card.className = 'route-script route-script-editor';

        const title = document.createElement('h3');
        title.textContent = `Opponent ${script.slot} · model ${script.slot + 1}`;

        const initialLabel = document.createElement('label');
        initialLabel.className = 'route-editor-label';
        initialLabel.textContent = 'Initial mode';
        const initialInput = document.createElement('input');
        initialInput.type = 'number';
        initialInput.min = '0';
        initialInput.max = '255';
        initialInput.step = '1';
        initialInput.value = String(script.initialMode);
        initialInput.className = 'route-editor-input';
        initialInput.setAttribute('aria-label', `Opponent ${script.slot} initial mode`);
        initialLabel.append(initialInput);

        const stepsLabel = document.createElement('label');
        stepsLabel.className = 'route-editor-label';
        stepsLabel.textContent = 'Branch steps';
        const stepsInput = document.createElement('input');
        stepsInput.type = 'text';
        stepsInput.value = formatBranchStepsInput(script);
        stepsInput.placeholder = 'e.g. 2, 3, 2';
        stepsInput.className = 'route-editor-input';
        stepsInput.setAttribute('aria-label', `Opponent ${script.slot} branch steps`);
        stepsLabel.append(stepsInput);

        const hint = document.createElement('p');
        hint.className = 'subtle';
        hint.textContent = 'Comma-separated modes. Use 0 to end the script after earlier steps.';

        const feedback = document.createElement('p');
        feedback.className = 'route-editor-feedback';
        feedback.setAttribute('aria-live', 'polite');

        const applyScript = (): void => {
            try {
                const parsed = parseOpponentScriptInputs(initialInput.value, stepsInput.value);
                writeOpponentRouteScript(activeData(), mapOffset, index as 0 | 1, parsed);
                feedback.textContent = '';
                feedback.classList.remove('error');
                updateStatus();
                refreshOpponentRouteViews(mapOffset);
            } catch (error) {
                feedback.textContent = error instanceof Error ? error.message : 'Could not update this script.';
                feedback.classList.add('error');
            }
        };

        initialInput.addEventListener('input', applyScript);
        stepsInput.addEventListener('input', applyScript);

        card.append(title, initialLabel, stepsLabel, hint, feedback);
        opponentScripts.append(card);
    });
}

function formatBranchStepsInput(script: { branchModes: readonly number[]; terminates: boolean }): string {
    const steps = [...script.branchModes];
    if (script.terminates) steps.push(0);
    return steps.join(', ');
}

function parseOpponentScriptInputs(initialValue: string, stepsValue: string): { initialMode: number; branchModes: number[]; terminates: boolean } {
    const initialMode = parseScriptByte(initialValue, 'Initial mode');
    const tokens = stepsValue
        .split(/[\s,]+/)
        .map((token) => token.trim())
        .filter((token) => token.length > 0);

    const branchModes: number[] = [];
    let terminates = false;
    for (const token of tokens) {
        const value = parseScriptByte(token, 'Branch step');
        if (value === 0) {
            terminates = true;
            break;
        }
        branchModes.push(value);
    }

    if (branchModes.length > 9) {
        throw new RangeError('Branch scripts can contain at most 9 steps before the terminator.');
    }

    return { initialMode, branchModes, terminates };
}

function parseScriptByte(value: string, label: string): number {
    if (!/^-?\d+$/.test(value.trim())) {
        throw new RangeError(`${label} must be an integer from 0 to 255.`);
    }
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed < 0 || parsed > 255) {
        throw new RangeError(`${label} must be an integer from 0 to 255.`);
    }
    return parsed;
}

function refreshOpponentRouteViews(mapOffset: number): void {
    renderRouteComparison();
    renderOpponentRouteTraces(mapOffset);
    updateRouteSummary(mapOffset);
}

function updateRouteSummary(mapOffset: number): void {
    const scripts = readOpponentRouteScripts(activeData(), mapOffset);
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

    if (showRoute1Input.checked || showRoute2Input.checked) {
        const overlay = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        overlay.classList.add('route-overlay');
        if (laneBankApproximate) overlay.classList.add('route-overlay-approximate');
        overlay.setAttribute('viewBox', `0 0 ${MAP_WIDTH} ${MAP_HEIGHT}`);
        overlay.setAttribute('preserveAspectRatio', 'none');
        overlay.setAttribute('aria-label', 'Opponent lane routes');

        for (const { entity, trace } of traces) {
            const opponentIndex = entity.modelId - 1;
            if ((opponentIndex === 1 && !showRoute1Input.checked) || (opponentIndex === 2 && !showRoute2Input.checked)) continue;
            if (trace.steps.length < 2) continue;
            for (const segment of splitWrappedRoute(trace.steps, MAP_WIDTH, MAP_HEIGHT)) {
                if (segment.length < 2) continue;
                const route = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
                route.classList.add(`route-opponent-${opponentIndex}`);
                route.setAttribute('points', segment.map(({ x, y }) => `${x},${y}`).join(' '));
                overlay.append(route);
            }
        }
        if (overlay.childElementCount > 0) grid.append(overlay);
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
        entityDetails.classList.add('subtle');
        entityDetails.replaceChildren(document.createTextNode('Select an entity or map marker to inspect its stored fields.'));
        return;
    }

    const entity = currentEntityTable.entities.find((item) => item.slot === selectedEntitySlot);
    if (!entity) {
        entityDetails.classList.add('subtle');
        entityDetails.replaceChildren(document.createTextNode('The selected entity is not in this leg.'));
        return;
    }

    entityDetails.classList.remove('subtle');
    entityDetails.replaceChildren();

    const behavior = (entity.flags >> 8) & 0x0F;
    const summary = document.createElement('p');
    summary.className = 'entity-editor-summary';
    summary.textContent = `Slot ${entity.slot} · ${entityName(entity.modelId)} · behavior ${behavior} · ${entity.aiProcessed ? 'in AI pass' : 'outside AI pass'} · map (${entity.mapX.toFixed(2)}, ${entity.mapY.toFixed(2)})`;

    const form = document.createElement('form');
    form.className = 'entity-editor';
    form.addEventListener('submit', (event) => event.preventDefault());

    const fields: Array<{ key: keyof WritableMapEntityFields; label: string; hint?: string; hex?: boolean }> = [
        { key: 'flags', label: 'Flags', hint: 'model id in low 6 bits', hex: true },
        { key: 'x', label: 'World X' },
        { key: 'z', label: 'World Z' },
        { key: 'y', label: 'World Y' },
        { key: 'heading', label: 'Heading/state', hex: true },
        { key: 'velocity', label: 'Velocity', hex: true },
        { key: 'cell', label: 'Cell' },
        { key: 'waypoint', label: 'Waypoint state', hint: 'low 6 bits = lane waypoint index', hex: true },
    ];

    const inputs = new Map<keyof WritableMapEntityFields, HTMLInputElement>();
    for (const field of fields) {
        const label = document.createElement('label');
        label.className = 'entity-editor-label';
        label.textContent = field.label;
        const input = document.createElement('input');
        input.type = field.hex ? 'text' : 'number';
        input.className = 'entity-editor-input';
        input.value = field.hex ? `0x${entity[field.key].toString(16).padStart(4, '0')}` : String(entity[field.key]);
        input.spellcheck = false;
        input.setAttribute('aria-label', `Entity ${entity.slot} ${field.label}`);
        label.append(input);
        if (field.hint) {
            const hint = document.createElement('small');
            hint.textContent = field.hint;
            label.append(hint);
        }
        inputs.set(field.key, input);
        form.append(label);
    }

    const feedback = document.createElement('p');
    feedback.className = 'route-editor-feedback';
    feedback.setAttribute('aria-live', 'polite');

    const applyEntity = (): void => {
        try {
            const updated: WritableMapEntityFields = {
                flags: parseEntityWord(inputs.get('flags')!.value, 'Flags'),
                x: parseEntityWord(inputs.get('x')!.value, 'World X'),
                z: parseEntityWord(inputs.get('z')!.value, 'World Z'),
                y: parseEntityWord(inputs.get('y')!.value, 'World Y'),
                heading: parseEntityWord(inputs.get('heading')!.value, 'Heading/state'),
                velocity: parseEntityWord(inputs.get('velocity')!.value, 'Velocity'),
                cell: parseEntityWord(inputs.get('cell')!.value, 'Cell'),
                waypoint: parseEntityWord(inputs.get('waypoint')!.value, 'Waypoint state'),
            };
            writeMapEntity(activeData(), selectedMapOffset(), entity.slot, updated);
            feedback.textContent = '';
            feedback.classList.remove('error');
            renderInspectionLayers();
            updateStatus();
        } catch (error) {
            feedback.textContent = error instanceof Error ? error.message : 'Could not update this entity.';
            feedback.classList.add('error');
        }
    };

    for (const input of inputs.values()) {
        input.addEventListener('change', applyEntity);
    }

    form.append(feedback);
    entityDetails.append(summary, form);
}

function parseEntityWord(value: string, label: string): number {
    const trimmed = value.trim().toLowerCase();
    const parsed = /^-?0x[0-9a-f]+$/.test(trimmed)
        ? Number.parseInt(trimmed, 16)
        : Number(trimmed);
    if (!Number.isInteger(parsed) || parsed < 0 || parsed > 0xFFFF) {
        throw new RangeError(`${label} must be an integer from 0 to 65535 (or 0x0000–0xffff).`);
    }
    return parsed;
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
    invertedLaneBankData = null;
    inversionOriginalLaneBank = null;
    inversionOriginalLaneBankSource = '';
    inversionOriginalLaneBankApproximate = false;
    selectedCell = null;
    paletteTileId = null;
    filenameLabel.textContent = sourceFilename;
    cellDetails.textContent = 'Select a cell to inspect or edit it.';
    loadCourseLst(id);
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

function downloadLaneBank(): void {
    if (!invertedLaneBankData) return;
    const buffer = new ArrayBuffer(invertedLaneBankData.byteLength);
    new Uint8Array(buffer).set(invertedLaneBankData);
    const blob = new Blob([buffer], { type: 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'SCENE03P.BIN';
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
    if (originalLstData) {
        workingLstData = originalLstData.slice();
        lstSourceFilename = `${courseId}.LST`;
        lstFilenameLabel.textContent = lstSourceFilename;
        renderLstEditor();
    }
    restoreInversionLaneBank();
    inversionApplied = false;
    selectedCell = null;
    cellDetails.textContent = 'Select a cell to inspect or edit it.';
    refreshTilePreviews();
}

function restoreInversionLaneBank(): void {
    if (inversionOriginalLaneBank) {
        laneBank = inversionOriginalLaneBank;
        laneBankSource = inversionOriginalLaneBankSource;
        laneBankApproximate = inversionOriginalLaneBankApproximate;
    }
    invertedLaneBankData = null;
    inversionOriginalLaneBank = null;
    inversionOriginalLaneBankSource = '';
    inversionOriginalLaneBankApproximate = false;
}

function invertCourse(): void {
    if (!workingData || courseId !== 'SCENE01' || inversionApplied) return;

    try {
        if (!sharedLaneBank || !laneBank) {
            throw new Error('The shared lane bank must be loaded before inverting Pacific.');
        }
        const reversedLaneBank = reverseLaneBank(sharedLaneBank);
        const reversedLaneBankData = serializeLaneBank(reversedLaneBank, PRIVATE_LANE_TILE_COUNT);
        const invertedData = invertPacificCourse(workingData);
        let swappedLandscapes = false;
        let swapWarning = '';
        if (swapScene03LandscapesInput.checked) {
            try {
                swapScene01LandscapeSetsAandC(invertedData);
                swappedLandscapes = true;
            } catch (swapError) {
                swapWarning = swapError instanceof Error ? swapError.message : 'Could not swap leg 1/5 landscapes.';
            }
        }
        inversionOriginalLaneBank = laneBank;
        inversionOriginalLaneBankSource = laneBankSource;
        inversionOriginalLaneBankApproximate = laneBankApproximate;
        laneBank = reversedLaneBank;
        laneBankSource = 'generated reversed SCENETTP.BIN';
        laneBankApproximate = false;
        invertedLaneBankData = reversedLaneBankData;
        workingData = invertedData;
        if (originalLstData) {
            workingLstData = createScene03LstFromScene01(originalLstData);
            lstSourceFilename = 'SCENE03.LST';
            lstFilenameLabel.textContent = 'SCENE03.LST';
            renderLstEditor();
        }
        inversionApplied = true;
        selectedCell = null;
        selectedEntitySlot = null;
        paletteTileId = null;
        legSelect.value = '0';
        cellDetails.textContent = 'Select a cell to inspect the reversed course.';
        refreshTilePreviews();
        const swapNote = swappedLandscapes ? ' landscapes/palettes swapped (leg 1↔5, set A↔C);' : '';
        const warningNote = swapWarning ? ` Landscape swap skipped: ${swapWarning}` : '';
        setStatus(`SCENE03 experiment ready ·${swapNote} reversed AI navigation bank generated. Export SCENE03.DAT, SCENE03.LST, and SCENE03P.BIN; routes still need validation.${warningNote}`, Boolean(swapWarning));
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

function applyMapZoom(): void {
    const cellSize = Number(zoomInput.value);
    if (!Number.isFinite(cellSize)) return;
    grid.style.setProperty('--map-cell-size', `${cellSize}px`);
    const percent = Math.round((cellSize / 18) * 100);
    zoomValue.textContent = `${percent}%`;
}

showEntitiesInput.addEventListener('change', () => {
    if (workingData) renderGrid();
});
showRoute1Input.addEventListener('change', () => {
    if (workingData) renderGrid();
});
showRoute2Input.addEventListener('change', () => {
    if (workingData) renderGrid();
});
showWaypointsInput.addEventListener('change', () => {
    if (workingData) renderGrid();
});
zoomInput.addEventListener('input', applyMapZoom);
applyMapZoom();
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
probeButton.addEventListener('click', probeAiPaths);
invertCourseButton.addEventListener('click', invertCourse);
paletteBankSelect.addEventListener('change', renderTilePalette);
sceneImageSlotSelect.addEventListener('change', () => {
    const slot = selectedSceneImageSlot();
    if (slot) renderSceneImagePreview(slot);
});
sceneImageExportButton.addEventListener('click', exportSceneImagePng);
sceneImageReplaceButton.addEventListener('click', () => {
    pendingSceneImageReplaceAutoFit = false;
    sceneImageFileInput.click();
});
sceneImageFitReplaceButton.addEventListener('click', () => {
    pendingSceneImageReplaceAutoFit = true;
    sceneImageFileInput.click();
});
sceneImageFileInput.addEventListener('change', async () => {
    const file = sceneImageFileInput.files?.[0];
    const autoFit = pendingSceneImageReplaceAutoFit;
    pendingSceneImageReplaceAutoFit = false;
    if (file) {
        await replaceSceneImageFromFile(file, autoFit);
    }
    sceneImageFileInput.value = '';
});
exportButton.addEventListener('click', downloadData);
exportLaneBankButton.addEventListener('click', downloadLaneBank);
exportLstButton.addEventListener('click', downloadLst);
applyLstButton.addEventListener('click', applyLstStrings);
resetLstButton.addEventListener('click', resetLstStrings);
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
        restoreInversionLaneBank();
        sourceFilename = file.name;
        originalData = bytes.slice();
        workingData = bytes.slice();
        inversionApplied = false;
        selectedCell = null;
        selectedEntitySlot = null;
        paletteTileId = null;
        filenameLabel.textContent = sourceFilename;
        cellDetails.textContent = 'Select a cell to inspect or edit it.';
        if (!workingLstData) loadCourseLst(selectedCourse);
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

function probeAiPaths(): void {
    probeResults.classList.remove('subtle');
    probeResults.replaceChildren();
    if (!workingData || !laneBank || !currentEntityTable) {
        probeResults.textContent = 'Map, lane bank, and entities must be loaded before generating paths.';
        return;
    }

    const mapOffset = selectedMapOffset();
    const sharedTileData = files.datab;
    const sceneTileData = courseId === 'SCENE01' ? files.scene01 : files.scene02;
    if (!sharedTileData || !sceneTileData) {
        probeResults.textContent = 'Tile geometry needed to locate the finish is unavailable.';
        return;
    }
    const finishTileId = findMapTileWithFaceMaterial(
        workingData, mapOffset, sharedTileData, sceneTileData, courseId, FINISH_FACE_MATERIAL,
    );
    if (finishTileId === null) {
        probeResults.textContent = 'No finish tile (surface material 0x1F) was found for this leg.';
        return;
    }

    const opponents = currentEntityTable.entities.filter((entity) => entity.modelId === 0x02 || entity.modelId === 0x03)
        .sort((a, b) => a.modelId - b.modelId);
    if (opponents.length < 2) {
        probeResults.textContent = 'Two opponent entities (models 0x02/0x03) are required to generate paths.';
        return;
    }

    const probeContext = {
        courseId,
        leg: Number(legSelect.value) + 1,
        mapOffset,
        finishTile: `0x${finishTileId.toString(16)}`,
        lane: { source: laneBankSource, approximate: laneBankApproximate, count: laneBank.length },
        opponents: opponents.map((e) => ({ slot: e.slot, modelId: e.modelId, cell: e.cell, waypoint: `0x${e.waypoint.toString(16)}`, x: e.x, z: e.z })),
    };
    console.group(`[path-probe] Generate AI paths · ${courseId} leg ${probeContext.leg}`);
    console.log('[path-probe] context ' + JSON.stringify(probeContext));

    const probed = opponents.map((entity) => {
        console.group(`[path-probe] Opponent ${entity.modelId - 1} (slot ${entity.slot})`);
        const paths = probeOpponentPaths(workingData!, mapOffset, laneBank!, entity, finishTileId, { maxResults: 12 });
        console.log('[path-probe] candidate paths ' + JSON.stringify(paths.map((p) => ({
            initialMode: p.initialMode,
            branchModes: p.branchModes,
            steps: p.steps,
            exitEntryLinks: p.exitEntryLinks,
            scriptControlPoints: p.scriptControlPoints,
            pathStart: p.pathCells.slice(0, 6),
            pathEnd: p.pathCells.slice(-6),
        }))));
        console.groupEnd();
        return { entity, paths };
    });

    if (probed.some((entry) => entry.paths.length === 0)) {
        probeResults.textContent = 'Could not find any finish-reaching path without U-turns for one or more opponents. Try adjusting start cell/waypoint or lane setup.';
        for (const entry of probed) {
            const line = document.createElement('p');
            line.textContent = `Opponent ${entry.entity.modelId - 1}: ${entry.paths.length} candidate path(s) found.`;
            probeResults.append(line);
        }
        console.warn('[path-probe] no valid path ' + JSON.stringify(probed.map((p) => ({ opponent: p.entity.modelId - 1, count: p.paths.length }))));
        console.groupEnd();
        return;
    }

    const aPaths = probed[0].paths;
    const bPaths = probed[1].paths;
    let chosen: [ProbedPath, ProbedPath] | null = null;
    let preferredPair = false;

    for (const a of aPaths) {
        const b = bPaths.find((candidate) => candidate.signature !== a.signature && pathsDivergeAndReconverge(a.pathCells, candidate.pathCells));
        if (b) { chosen = [a, b]; preferredPair = true; break; }
    }
    if (!chosen) {
        for (const a of aPaths) {
            const b = bPaths.find((candidate) => candidate.signature !== a.signature);
            if (b) { chosen = [a, b]; break; }
        }
    }
    if (!chosen) {
        chosen = [aPaths[0], bPaths[0]];
    }

    const singlePath = aPaths.length === 1 && bPaths.length === 1 && aPaths[0].signature === bPaths[0].signature;
    const sameRoute = chosen[0].signature === chosen[1].signature;
    const summary = document.createElement('p');
    if (singlePath || sameRoute) {
        summary.textContent = 'Only a single no-U-turn path was found for these starts (or no distinct alternative route). Both opponents can use the same branch script.';
    } else if (preferredPair) {
        summary.textContent = 'Generated two shortest no-U-turn paths that diverge and reconverge (shared start/finish allowed).';
    } else {
        summary.textContent = 'Generated two shortest no-U-turn paths with different routes/scripts.';
    }
    probeResults.append(summary);

    const selection = {
        singlePath,
        sameRoute,
        preferredDivergeReconverge: preferredPair,
        chosen: chosen.map((p, i) => ({ opponent: probed[i].entity.modelId - 1, initialMode: p.initialMode, branchModes: p.branchModes, steps: p.steps, exitEntryLinks: p.exitEntryLinks, scriptControlPoints: p.scriptControlPoints, signature: p.signature })),
    };
    console.log('[path-probe] selection ' + JSON.stringify(selection));
    console.log('[path-probe] COPY_SELECTION ' + JSON.stringify({ context: probeContext, selection }));
    console.groupEnd();

    const stats = document.createElement('p');
    const describe = (path: ProbedPath): string =>
        `${path.exitEntryLinks} exit/entry link(s), ${path.scriptControlPoints} scripted branch/control point(s), length ${path.steps}`;
    stats.textContent = sameRoute
        ? `Path: ${describe(chosen[0])}.`
        : `Path A: ${describe(chosen[0])}. Path B: ${describe(chosen[1])}.`;
    probeResults.append(stats);

    chosen.forEach((path, index) => {
        const entity = probed[index].entity;
        const card = document.createElement('article');
        card.className = 'route-script';
        const title = document.createElement('h3');
        title.textContent = `Suggested · Opponent ${entity.modelId - 1}`;
        const details = document.createElement('p');
        details.textContent = `initial ${path.initialMode}, steps [${path.branchModes.join(', ') || 'none'}], ${path.exitEntryLinks} exit/entry link(s), ${path.scriptControlPoints} scripted control point(s), length ${path.steps}`;
        const apply = document.createElement('button');
        apply.type = 'button';
        apply.className = 'secondary';
        apply.textContent = 'Apply to this opponent';
        apply.addEventListener('click', () => {
            writeOpponentRouteScript(activeData(), mapOffset, (entity.modelId - 2) as 0 | 1, {
                initialMode: path.initialMode,
                branchModes: [...path.branchModes],
                terminates: false,
            });
            renderInspectionLayers();
            updateStatus();
            probeAiPaths();
        });
        card.append(title, details, apply);
        probeResults.append(card);
    });

    if (!sameRoute) {
        const applyBoth = document.createElement('button');
        applyBoth.type = 'button';
        applyBoth.textContent = 'Apply both suggestions';
        applyBoth.addEventListener('click', () => {
            writeOpponentRouteScript(activeData(), mapOffset, 0, { initialMode: chosen![0].initialMode, branchModes: [...chosen![0].branchModes], terminates: false });
            writeOpponentRouteScript(activeData(), mapOffset, 1, { initialMode: chosen![1].initialMode, branchModes: [...chosen![1].branchModes], terminates: false });
            renderInspectionLayers();
            updateStatus();
            probeAiPaths();
        });
        probeResults.append(applyBoth);
    } else {
        const applySame = document.createElement('button');
        applySame.type = 'button';
        applySame.textContent = 'Apply to both opponents';
        applySame.addEventListener('click', () => {
            writeOpponentRouteScript(activeData(), mapOffset, 0, { initialMode: chosen![0].initialMode, branchModes: [...chosen![0].branchModes], terminates: false });
            writeOpponentRouteScript(activeData(), mapOffset, 1, { initialMode: chosen![0].initialMode, branchModes: [...chosen![0].branchModes], terminates: false });
            renderInspectionLayers();
            updateStatus();
            probeAiPaths();
        });
        probeResults.append(applySame);
    }
}


function loadCourseLst(id: CourseId): void {
    const source = id === 'SCENE01' ? files.scene01Lst : files.scene02Lst;
    if (!source) {
        originalLstData = null;
        workingLstData = null;
        lstSourceFilename = `${id}.LST`;
        lstFilenameLabel.textContent = `${id}.LST (unavailable)`;
        renderLstEditor();
        return;
    }
    originalLstData = source.slice();
    workingLstData = source.slice();
    lstSourceFilename = `${id}.LST`;
    lstFilenameLabel.textContent = lstSourceFilename;
    renderLstEditor();
}

function renderLstEditor(): void {
    lstRouteNamesEl.replaceChildren();
    lstFeedback.textContent = '';
    lstFeedback.classList.remove('error');
    if (!workingLstData) {
        lstCourseNameInput.value = '';
        lstUiStringsInput.value = '';
        lstCourseNameInput.disabled = true;
        lstUiStringsInput.disabled = true;
        applyLstButton.disabled = true;
        return;
    }
    lstCourseNameInput.disabled = false;
    lstUiStringsInput.disabled = false;
    applyLstButton.disabled = false;
    try {
        const strings = readSceneLstStrings(workingLstData);
        lstCourseNameInput.value = strings.courseName;
        lstUiStringsInput.value = strings.uiStrings.join('\n');
        for (let i = 0; i < strings.routeNames.length; i++) {
            const label = document.createElement('label');
            label.className = 'route-editor-label';
            label.textContent = `Route ${String(i).padStart(2, '0')}${i < 20 ? ` (map ${Math.floor(i / 4) + 1}, option ${(i % 4) + 1})` : ' (placeholder)'}`;
            const input = document.createElement('input');
            input.type = 'text';
            input.maxLength = 12;
            input.value = strings.routeNames[i];
            input.className = 'route-editor-input';
            input.dataset.routeIndex = String(i);
            label.append(input);
            lstRouteNamesEl.append(label);
        }
        updateStatus();
    } catch (error) {
        lstFeedback.textContent = error instanceof Error ? error.message : 'Could not read scene LST strings.';
        lstFeedback.classList.add('error');
    }
}

function applyLstStrings(): void {
    if (!workingLstData) return;
    const lst = workingLstData;
    try {
        writeCourseName(lst, lstCourseNameInput.value);
        lstRouteNamesEl.querySelectorAll<HTMLInputElement>('input[data-route-index]').forEach((input) => {
            const index = Number(input.dataset.routeIndex);
            writeRouteName(lst, index, input.value);
        });
        const uiStrings = lstUiStringsInput.value.length === 0 ? [] : lstUiStringsInput.value.split('\n');
        writeUiStrings(lst, uiStrings);
        lstFeedback.textContent = 'LST strings applied to the working copy.';
        lstFeedback.classList.remove('error');
        renderLstEditor();
        updateStatus();
    } catch (error) {
        lstFeedback.textContent = error instanceof Error ? error.message : 'Could not apply LST strings.';
        lstFeedback.classList.add('error');
    }
}

function resetLstStrings(): void {
    if (!originalLstData) return;
    if (inversionApplied) {
        workingLstData = createScene03LstFromScene01(originalLstData);
        lstSourceFilename = 'SCENE03.LST';
        lstFilenameLabel.textContent = 'SCENE03.LST';
    } else {
        workingLstData = originalLstData.slice();
        lstSourceFilename = `${courseId}.LST`;
        lstFilenameLabel.textContent = lstSourceFilename;
    }
    renderLstEditor();
    setStatus(`${lstSourceFilename} strings reset.`);
}

function downloadLst(): void {
    if (!workingLstData) return;
    try {
        const buffer = new ArrayBuffer(workingLstData.byteLength);
        new Uint8Array(buffer).set(workingLstData);
        const blob = new Blob([buffer], { type: 'application/octet-stream' });
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement('a');
        anchor.href = url;
        if (inversionApplied && /^SCENE03$/i.test(lstSourceFilename.replace(/\.LST$/i, ''))) {
            anchor.download = 'SCENE03.LST';
        } else {
            const stem = lstSourceFilename.replace(/\.LST$/i, '');
            anchor.download = `${stem}_EDITED.LST`;
        }
        anchor.click();
        window.setTimeout(() => URL.revokeObjectURL(url), 1000);
        setStatus(`Exported ${anchor.download}.`);
    } catch (error) {
        setStatus(error instanceof Error ? error.message : 'Could not export LST file.', true);
    }
}

function parseCourseId(value: string): CourseId | null {
    return value in COURSE_LAYOUTS ? value as CourseId : null;
}
