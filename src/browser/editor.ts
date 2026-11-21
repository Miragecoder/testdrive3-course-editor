import {
    COURSE_LAYOUTS,
    MAP_HEIGHT,
    MAP_RESOURCE_SIZE,
    MAP_WIDTH,
    applyCanonicalSkySeeds,
    applySkySeedDeltaForModeToggle,
    canonicalSkySeedsForMode,
    fogRemapIndex,
    readFogSeed,
    readMapCell,
    readMapMode,
    readRemapEntry,
    readRouteTiles,
    readSkySeeds,
    writeFogSeed,
    writeMapCell,
    writeMapMode,
    writeRemapEntry,
    writeRouteTile,
    writeSkySeeds,
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
import { LoadPrimaryLutMode, LoadRemapTable, LoadTrailerTable, WeatherMode, indexForSkyFog, lookupPair } from '@shared/color';
import { paletteColor } from '@shared/palette';
import { LoadObjects, maps } from '@shared/objects';
import { files, loadFiles } from '@shared/files';
import {
    CARDINAL_SIDES,
    PRIVATE_LANE_TILE_COUNT,
    getTileConnectivity,
    isLaneEntry,
    isLaneExit,
    parseLaneBank,
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
const mapScroll = requiredElement<HTMLDivElement>('map-scroll');
const zoomInput = requiredElement<HTMLInputElement>('map-zoom');
const zoomValue = requiredElement<HTMLSpanElement>('map-zoom-value');
const zoomOutButton = requiredElement<HTMLButtonElement>('map-zoom-out');
const zoomInButton = requiredElement<HTMLButtonElement>('map-zoom-in');
const zoomFitButton = requiredElement<HTMLButtonElement>('map-zoom-fit');
const zoomResetButton = requiredElement<HTMLButtonElement>('map-zoom-reset');
const propertiesPopup = requiredElement<HTMLDivElement>('map-properties-popup');
const popupTitle = requiredElement<HTMLHeadingElement>('map-popup-title');
const popupCloseButton = requiredElement<HTMLButtonElement>('map-popup-close');
const popupCellSection = requiredElement<HTMLElement>('map-popup-cell');
const popupEntitySection = requiredElement<HTMLElement>('map-popup-entity');
const tileIdInput = requiredElement<HTMLInputElement>('tile-id');
const rotationInput = requiredElement<HTMLSelectElement>('tile-rotation');
const elevationInput = requiredElement<HTMLInputElement>('tile-elevation');
const routeTileInputs = [0, 1, 2].map((index) => requiredElement<HTMLInputElement>(`route-tile-${index}`));
const routeTileLabels = [0, 1, 2].map((index) => requiredElement<HTMLSpanElement>(`route-tile-label-${index}`));
const modeInput = requiredElement<HTMLSelectElement>('map-mode');
const horizonPreview = requiredElement<HTMLCanvasElement>('horizon-preview');
const horizonPreviewLabel = requiredElement<HTMLParagraphElement>('horizon-preview-label');
const horizonPreviewWarning = requiredElement<HTMLParagraphElement>('horizon-preview-warning');
const skySeed2eInput = requiredElement<HTMLInputElement>('sky-seed-2e');
const skySeed2fInput = requiredElement<HTMLInputElement>('sky-seed-2f');
const skySeed30Input = requiredElement<HTMLInputElement>('sky-seed-30');
const skySeed31Input = requiredElement<HTMLInputElement>('sky-seed-31');
const skyFogSeedInput = requiredElement<HTMLInputElement>('sky-fog-seed');
const skyRemapIndexInput = requiredElement<HTMLInputElement>('sky-remap-index');
const skyRemapEntryInput = requiredElement<HTMLInputElement>('sky-remap-entry');
const applyModeToggleButton = requiredElement<HTMLButtonElement>('apply-mode-toggle');
const horizonPreserveVariantInput = requiredElement<HTMLInputElement>('horizon-preserve-variant');
const applyModeCanonicalButton = requiredElement<HTMLButtonElement>('apply-mode-canonical');
const applyHorizonButton = requiredElement<HTMLButtonElement>('apply-horizon');
const resetHorizonLegButton = requiredElement<HTMLButtonElement>('reset-horizon-leg');
const copyHorizonLegsContainer = requiredElement<HTMLDivElement>('copy-horizon-legs');
const copyHorizonButton = requiredElement<HTMLButtonElement>('copy-horizon');
const copyHorizonLegSelect = requiredElement<HTMLSelectElement>('copy-horizon-leg');
const horizonPresetSelect = requiredElement<HTMLSelectElement>('horizon-preset');
const applyHorizonPresetButton = requiredElement<HTMLButtonElement>('apply-horizon-preset');
const horizonFeedback = requiredElement<HTMLParagraphElement>('horizon-feedback');
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
const exportObjectBankButton = requiredElement<HTMLButtonElement>('export-object-bank');
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
const OBJECT_BANK_OFFSET = 0x32F1A;
const OBJECT_BANK_SIZE = 0x7DEA;
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
type PropertiesPopupTarget = { kind: 'cell'; x: number; y: number } | { kind: 'entity'; slot: number };
let propertiesPopupTarget: PropertiesPopupTarget | null = null;
let suppressNextMapClick = false;
let currentEntityTable: MapEntityTable | null = null;
let sharedLaneBank: readonly TileLane[] | null = null;
let sharedObjectBankData: Uint8Array | null = null;
let laneBank: readonly TileLane[] | null = null;
let laneBankSource = 'shared SCENETTP.BIN';
let laneBankApproximate = false;
let inversionApplied = false;
let invertedLaneBankData: Uint8Array | null = null;
let invertedObjectBankData: Uint8Array | null = null;
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

function formatHexByte(value: number): string {
    return `0x${(value & 0xFF).toString(16).padStart(2, '0').toUpperCase()}`;
}

function formatHexWord(value: number): string {
    return `0x${(value & 0xFFFF).toString(16).padStart(4, '0').toUpperCase()}`;
}

function parseIntegerInput(value: string, label: string, min: number, max: number): number {
    const trimmed = value.trim().toLowerCase();
    if (trimmed.length === 0) {
        throw new Error(`${label} is required.`);
    }
    const parsed = trimmed.startsWith('0x') ? Number.parseInt(trimmed, 16) : Number.parseInt(trimmed, 10);
    if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
        throw new RangeError(`${label} must be an integer from ${min} to ${max}.`);
    }
    return parsed;
}

function setHorizonFeedback(message: string, isError = false): void {
    horizonFeedback.textContent = message;
    horizonFeedback.classList.toggle('error', isError);
}

interface HorizonDraft {
    mode: 0 | 1;
    seeds: [number, number, number, number];
    fogSeed: number;
    remapValue: number;
}

function tryParseHorizonDraft(): HorizonDraft | null {
    if (!workingData) return null;
    try {
        const modeValue = modeInput.value === '0' ? 0 : modeInput.value === '1' ? 1 : null;
        if (modeValue === null) return null;
        const seeds: [number, number, number, number] = [
            parseIntegerInput(skySeed2eInput.value, 'Day sky base', 0, 0xFF),
            parseIntegerInput(skySeed2fInput.value, 'Night sky base', 0, 0xFF),
            parseIntegerInput(skySeed30Input.value, 'Day sky accent', 0, 0xFF),
            parseIntegerInput(skySeed31Input.value, 'Night sky accent', 0, 0xFF),
        ];
        const fogSeed = parseIntegerInput(skyFogSeedInput.value, 'Gradient selector', 0, 0xFFFF);
        const remapValue = parseIntegerInput(skyRemapEntryInput.value, 'Horizon color value', 0, 0xFFFF);
        return { mode: modeValue, seeds, fogSeed, remapValue };
    } catch {
        return null;
    }
}

function buildPreviewDataFromDraft(data: Uint8Array, mapOffset: number, draft: HorizonDraft): Uint8Array {
    const preview = data.slice();
    writeMapMode(preview, mapOffset, draft.mode);
    writeSkySeeds(preview, mapOffset, draft.seeds);
    writeFogSeed(preview, mapOffset, draft.fogSeed);
    writeRemapEntry(preview, mapOffset, fogRemapIndex(draft.fogSeed), draft.remapValue);
    return preview;
}

function getHorizonGradientWarning(activeComp: number): string | null {
    const warningWindow = 48;
    for (let step = 1; step <= warningWindow; step++) {
        if (((activeComp + step) & 0xFF) === 0x00) {
            return 'In-game VGA gradient may cross palette 0x00 (black), which can appear as a dark/black band. Try a different sky accent or preset.';
        }
    }
    return null;
}

function renderHorizonPreview(data: Uint8Array, mapOffset: number, isDraft = false): void {
    const ctx = horizonPreview.getContext('2d');
    if (!ctx) return;

    const mode = readMapMode(data, mapOffset);
    const seeds = readSkySeeds(data, mapOffset);
    const fogSeed = readFogSeed(data, mapOffset);
    const idx = fogRemapIndex(fogSeed);
    const remapValue = readRemapEntry(data, mapOffset, idx);
    const table = LoadRemapTable(data, mapOffset);

    const [, , skyCompDay, skyCompNight] = seeds;
    const activeComp = mode === 0 ? skyCompNight : skyCompDay;

    const safePaletteColor = (value: number) => paletteColor(Math.max(0, Math.min(255, value & 0xFF)));
    const toCss = (c: { r: number; g: number; b: number }) => {
        const r = Number.isFinite(c.r) ? c.r : 0;
        const g = Number.isFinite(c.g) ? c.g : 0;
        const b = Number.isFinite(c.b) ? c.b : 0;
        return `rgb(${Math.round(Math.max(0, Math.min(1, r)) * 255)},${Math.round(Math.max(0, Math.min(1, g)) * 255)},${Math.round(Math.max(0, Math.min(1, b)) * 255)})`;
    };

    const baseColor = safePaletteColor(activeComp);
    const fogPair = lookupPair(table, (fogSeed >>> 8) & 0xFF, fogSeed & 0xFF).toColor();

    // Simulate VGA sub_11408 banded sky gradient: in mode 13h the sky starts at
    // the accent pair and steps by +0x0101 in 5 groups of 4 scanlines near the
    // horizon. The exact band count can vary with horizon geometry, so we render
    // the canonical 20-line band and warn over a wider step window.
    const bandGroups = 5;
    const linesPerGroup = 4;
    const bandSteps = bandGroups * linesPerGroup;
    const bandIndices: number[] = [];
    for (let i = 0; i < bandSteps; i++) {
        const group = Math.floor(i / linesPerGroup) + 1;
        bandIndices.push((activeComp + group) & 0xFF);
    }
    const warning = getHorizonGradientWarning(activeComp);

    const w = horizonPreview.width;
    const h = horizonPreview.height;
    const horizonY = Math.floor(h * 0.58);
    const bandHeight = Math.max(8, Math.floor(h * 0.18));
    const bandTop = Math.max(0, horizonY - bandHeight);

    // Sky
    ctx.fillStyle = toCss(baseColor);
    ctx.fillRect(0, 0, w, bandTop);

    // Banded transition (palette-stepped, not RGB-interpolated)
    for (let y = bandTop; y < horizonY; y++) {
        const t = (y - bandTop) / Math.max(1, horizonY - bandTop);
        const step = Math.min(bandSteps - 1, Math.floor(t * bandSteps));
        const c = safePaletteColor(bandIndices[step]);
        ctx.fillStyle = toCss(c);
        ctx.fillRect(0, y, w, 1);
    }

    // Ground/fog
    ctx.fillStyle = toCss(fogPair);
    ctx.fillRect(0, horizonY, w, h - horizonY);

    // subtle horizon line
    ctx.fillStyle = 'rgba(255,255,255,0.10)';
    ctx.fillRect(0, horizonY, w, 1);

    // labeled swatches
    const drawSwatch = (x: number, color: { r: number; g: number; b: number }, label: string) => {
        const sw = 16;
        const sy = h - 22;
        ctx.fillStyle = toCss(color);
        ctx.fillRect(x, sy, sw, sw);
        ctx.strokeStyle = 'rgba(255,255,255,0.4)';
        ctx.strokeRect(x + 0.5, sy + 0.5, sw - 1, sw - 1);
        ctx.fillStyle = 'rgba(10,14,20,0.7)';
        ctx.fillRect(x + 18, sy - 1, 52, 18);
        ctx.fillStyle = '#eef2f8';
        ctx.font = '10px ui-monospace, monospace';
        ctx.fillText(label, x + 22, sy + 11);
    };
    drawSwatch(6, baseColor, 'Sky');
    drawSwatch(84, fogPair, 'Horizon');

    const modeLabel = mode === 0 ? 'Night' : 'Day';
    const draftLabel = isDraft ? ' (editing preview)' : '';
    horizonPreviewLabel.textContent =
        `${modeLabel}${draftLabel}\nSky accent ${formatHexByte(activeComp)} · horizon color ${formatHexWord(remapValue)} (slot ${formatHexByte(idx)}) · gradient ${formatHexWord(fogSeed)}`;
    horizonPreviewWarning.textContent = warning ?? '';
}

function refreshHorizonPreview(): void {
    if (!workingData) {
        const ctx = horizonPreview.getContext('2d');
        if (ctx) ctx.clearRect(0, 0, horizonPreview.width, horizonPreview.height);
        horizonPreviewLabel.textContent = 'Open a course to inspect sky & horizon.';
        horizonPreviewWarning.textContent = '';
        return;
    }
    const mapOffset = selectedMapOffset();
    const draft = tryParseHorizonDraft();
    if (draft) {
        const previewData = buildPreviewDataFromDraft(workingData, mapOffset, draft);
        renderHorizonPreview(previewData, mapOffset, true);
        skyRemapIndexInput.value = formatHexByte(fogRemapIndex(draft.fogSeed));
    } else {
        renderHorizonPreview(workingData, mapOffset, false);
    }
}

function renderHorizonLegChips(): void {
    copyHorizonLegsContainer.replaceChildren();
    const currentLeg = Number(legSelect.value);
    for (let i = 0; i < 5; i++) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'horizon-leg-chip';
        if (i === currentLeg) button.classList.add('current');
        button.textContent = `Leg ${i + 1}`;
        button.title = `Copy sky & horizon from Leg ${i + 1}`;
        button.addEventListener('click', () => {
            copyHorizonLegSelect.value = String(i);
            copyHorizonFromLeg(i);
            copyHorizonLegsContainer.querySelectorAll<HTMLButtonElement>('.horizon-leg-chip').forEach((chip, idx) => {
                chip.classList.toggle('active', idx === i);
            });
        });
        copyHorizonLegsContainer.append(button);
    }
}

function refreshHorizonUI(): void {
    if (!workingData) {
        skySeed2eInput.value = '';
        skySeed2fInput.value = '';
        skySeed30Input.value = '';
        skySeed31Input.value = '';
        skyFogSeedInput.value = '';
        skyRemapIndexInput.value = '';
        skyRemapEntryInput.value = '';
        renderHorizonLegChips();
        refreshHorizonPreview();
        return;
    }
    const mapOffset = selectedMapOffset();
    const [s2e, s2f, s30, s31] = readSkySeeds(workingData, mapOffset);
    const fogSeed = readFogSeed(workingData, mapOffset);
    const idx = fogRemapIndex(fogSeed);
    const remapValue = readRemapEntry(workingData, mapOffset, idx);
    skySeed2eInput.value = formatHexByte(s2e);
    skySeed2fInput.value = formatHexByte(s2f);
    skySeed30Input.value = formatHexByte(s30);
    skySeed31Input.value = formatHexByte(s31);
    skyFogSeedInput.value = formatHexWord(fogSeed);
    skyRemapIndexInput.value = formatHexByte(idx);
    skyRemapEntryInput.value = formatHexWord(remapValue);
    renderHorizonLegChips();
    renderHorizonPreview(workingData, mapOffset, false);
}

function applyHorizonInputs(): void {
    if (!workingData) return;
    try {
        const draft = tryParseHorizonDraft();
        if (!draft) {
            throw new Error('Please enter valid sky & horizon values (hex like 0x09 or decimal).');
        }
        const mapOffset = selectedMapOffset();
        writeMapMode(workingData, mapOffset, draft.mode);
        writeSkySeeds(workingData, mapOffset, draft.seeds);
        writeFogSeed(workingData, mapOffset, draft.fogSeed);
        writeRemapEntry(workingData, mapOffset, fogRemapIndex(draft.fogSeed), draft.remapValue);
        const activeComp = draft.mode === 0 ? draft.seeds[3] : draft.seeds[2];
        const warning = getHorizonGradientWarning(activeComp);
        setHorizonFeedback(warning
            ? `Applied sky & horizon changes to this leg. Warning: ${warning}`
            : 'Applied sky & horizon changes to this leg.');
        updateStatus();
        refreshTilePreviews();
    } catch (error) {
        setHorizonFeedback(error instanceof Error ? error.message : 'Could not apply horizon values.', true);
    }
}

function copyHorizonFromLeg(sourceLeg: number): void {
    if (!workingData) return;
    try {
        if (!Number.isInteger(sourceLeg) || sourceLeg < 0 || sourceLeg >= 5) {
            throw new RangeError('Source leg must be between 1 and 5.');
        }
        const targetLeg = Number(legSelect.value);
        if (sourceLeg === targetLeg) {
            setHorizonFeedback(`Leg ${sourceLeg + 1} is already selected.`);
            return;
        }
        const targetOffset = selectedMapOffset();
        const sourceOffset = COURSE_LAYOUTS[courseId].mapOffsets[sourceLeg];
        writeMapMode(workingData, targetOffset, (readMapMode(workingData, sourceOffset) === 0 ? 0 : 1));
        writeSkySeeds(workingData, targetOffset, readSkySeeds(workingData, sourceOffset));
        const fogSeed = readFogSeed(workingData, sourceOffset);
        writeFogSeed(workingData, targetOffset, fogSeed);
        const idx = fogRemapIndex(fogSeed);
        writeRemapEntry(workingData, targetOffset, idx, readRemapEntry(workingData, sourceOffset, idx));
        setHorizonFeedback(`Copied sky & horizon from Leg ${sourceLeg + 1}.`);
        updateStatus();
        refreshTilePreviews();
    } catch (error) {
        setHorizonFeedback(error instanceof Error ? error.message : 'Could not copy horizon settings.', true);
    }
}

function applyHorizonPreset(): void {
    if (!workingData) return;
    const preset = horizonPresetSelect.value;
    if (!preset) {
        setHorizonFeedback('Select a safe preset to apply.', true);
        return;
    }

    const mapOffset = selectedMapOffset();
    const fogSeed = readFogSeed(workingData, mapOffset);
    const idx = fogRemapIndex(fogSeed);

    if (preset === 'day-clear') {
        writeMapMode(workingData, mapOffset, 1);
        writeSkySeeds(workingData, mapOffset, [0x0B, 0x07, 0x79, 0x19]);
        // Keep current fog/remap slot, but ensure a smooth solid horizon value.
        writeRemapEntry(workingData, mapOffset, idx, readRemapEntry(workingData, mapOffset, idx));
    } else if (preset === 'night-clear') {
        writeMapMode(workingData, mapOffset, 0);
        writeSkySeeds(workingData, mapOffset, [0x09, 0x08, 0x72, 0x13]);
        writeRemapEntry(workingData, mapOffset, idx, readRemapEntry(workingData, mapOffset, idx));
    } else if (preset === 'dusk-warm') {
        writeMapMode(workingData, mapOffset, 1);
        writeSkySeeds(workingData, mapOffset, [0x03, 0x08, 0x74, 0x13]);
        writeRemapEntry(workingData, mapOffset, idx, readRemapEntry(workingData, mapOffset, idx));
    } else {
        setHorizonFeedback('Unknown horizon preset.', true);
        return;
    }

    setHorizonFeedback('Applied safe horizon preset. Review the preview, then adjust if needed.');
    updateStatus();
    refreshTilePreviews();
    refreshHorizonUI();
}

function resetHorizonForCurrentLeg(): void {
    if (!workingData || !originalData) return;
    const mapOffset = selectedMapOffset();
    const originalMode = readMapMode(originalData, mapOffset) === 0 ? 0 : 1;
    writeMapMode(workingData, mapOffset, originalMode);
    writeSkySeeds(workingData, mapOffset, readSkySeeds(originalData, mapOffset));
    const originalFog = readFogSeed(originalData, mapOffset);
    const currentFog = readFogSeed(workingData, mapOffset);
    writeFogSeed(workingData, mapOffset, originalFog);
    const originalIdx = fogRemapIndex(originalFog);
    writeRemapEntry(workingData, mapOffset, originalIdx, readRemapEntry(originalData, mapOffset, originalIdx));
    const currentIdx = fogRemapIndex(currentFog);
    if (currentIdx !== originalIdx) {
        writeRemapEntry(workingData, mapOffset, currentIdx, readRemapEntry(originalData, mapOffset, currentIdx));
    }
    setHorizonFeedback('Reset this leg’s sky & horizon to its original values.');
    updateStatus();
    refreshTilePreviews();
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
    exportObjectBankButton.disabled = !inversionApplied || !invertedObjectBankData;
    invertCourseButton.disabled = inversionApplied || courseId !== 'SCENE01';
    resetLegButton.disabled = inversionApplied;
    resetAllButton.disabled = false;
    resetLstButton.disabled = !workingLstData;
    refreshHorizonUI();
}

function renderCell(x: number, y: number): void {
    const cell = readMapCell(activeData(), selectedMapOffset(), x, y);
    const button = grid.querySelector<HTMLButtonElement>(`button[data-x="${x}"][data-y="${y}"]`);
    if (!button) return;

    const routeTiles = readRouteTiles(activeData(), selectedMapOffset());
    const routeMarkerIndex = routeTiles.indexOf(cell.tileId);
    button.style.setProperty('--tile-hue', String((cell.tileId * 137.5) % 360));
    button.querySelector<HTMLSpanElement>('.tile-id')!.textContent = cell.tileId.toString(16).padStart(2, '0').toUpperCase();
    const routeMarkerLabel = routeMarkerIndex === -1 ? '' : ` · route marker ${routeMarkerIndex}`;
    button.title = `Tile ${cell.tileId.toString(16).padStart(2, '0').toUpperCase()} · rotation ${cell.rotation * 90}° · elevation ${cell.elevation}${routeMarkerLabel}`;
    button.classList.toggle('selected', selectedCell?.x === x && selectedCell.y === y);
    button.classList.toggle('route-tile-marker', routeMarkerIndex !== -1);
    button.classList.toggle('route-tile-marker-0', routeMarkerIndex === 0);
    button.classList.toggle('route-tile-marker-1', routeMarkerIndex === 1);
    button.classList.toggle('route-tile-marker-2', routeMarkerIndex === 2);

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

function refreshRouteMarkerUI(): void {
    if (!workingData) return;
    const mapOffset = selectedMapOffset();
    const routeTiles = readRouteTiles(workingData, mapOffset);
    const leg = Number(legSelect.value);
    const lstStrings = workingLstData ? readSceneLstStrings(workingLstData) : null;
    for (let index = 0; index < routeTileInputs.length; index++) {
        routeTileInputs[index].value = String(routeTiles[index]);
        // LST stores 4 names per leg: [main/leg route, alt 1, alt 2, alt 3].
        // The 3 route-marker tile IDs correspond to the 3 selectable alternatives.
        const routeName = lstStrings?.routeNames[leg * 4 + index + 1];
        routeTileLabels[index].textContent = routeName ? `Route ${index}: ${routeName}` : `Route ${index}`;
    }
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
            button.addEventListener('click', (event) => {
                if (consumeSuppressedMapClick()) return;
                selectCell(x, y);
            });
            button.addEventListener('dblclick', (event) => {
                event.preventDefault();
                selectCell(x, y, { openPopup: true, anchorClientX: event.clientX, anchorClientY: event.clientY });
            });
            button.addEventListener('contextmenu', (event) => {
                event.preventDefault();
                selectCell(x, y, { openPopup: true, anchorClientX: event.clientX, anchorClientY: event.clientY });
            });
            button.addEventListener('keydown', (event) => {
                if (event.key === 'Enter') {
                    event.preventDefault();
                    if (selectedCell?.x === x && selectedCell.y === y) {
                        openPropertiesPopup({ kind: 'cell', x, y });
                    } else {
                        selectCell(x, y, { openPopup: true });
                    }
                }
            });
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
    refreshRouteMarkerUI();
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
    const connectivity = getTileConnectivity(lane);
    const byWorldEntry = new Map<CardinalSide, Set<CardinalSide>>();
    for (const entry of connectivity.byEntryWaypoint) {
        const worldEntry = rotatedSide(cell.rotation, entry.entryLocalSide);
        if (!byWorldEntry.has(worldEntry)) byWorldEntry.set(worldEntry, new Set());
        const exits = byWorldEntry.get(worldEntry)!;
        for (const localExit of entry.exitLocalSides) exits.add(rotatedSide(cell.rotation, localExit));
    }
    const sideOrder: CardinalSide[] = [0, 1, 2, 3];
    const routes = sideOrder
        .filter((side) => byWorldEntry.has(side))
        .map((side) => `${CARDINAL_SIDES[side]}→${[...(byWorldEntry.get(side) ?? [])].sort((a,b)=>a-b).map((s) => CARDINAL_SIDES[s]).join('/') || '—'}`);
    const routeSummary = routes.length > 0 ? ` Routes: ${routes.join(', ')}.` : '';
    count.title = `Tile 0x${cell.tileId.toString(16).padStart(2, '0')} has ${lane.waypoints.length} lane waypoint(s).${routeSummary}`;
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
    if (!selectedExists) {
        selectedEntitySlot = null;
        if (isPropertiesPopupOpen() && propertiesPopupTarget?.kind === 'entity') closePropertiesPopup();
    }
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
    grid.querySelector('.route-decision-overlay')?.remove();
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

        const decisionOverlay = document.createElement('div');
        decisionOverlay.className = 'route-decision-overlay';
        decisionOverlay.setAttribute('aria-label', 'AI route script decision points');

        for (const { entity, trace } of traces) {
            const opponentIndex = entity.modelId - 1;
            if ((opponentIndex === 1 && !showRoute1Input.checked) || (opponentIndex === 2 && !showRoute2Input.checked)) continue;
            const script = scripts[entity.modelId - 2];

            if (trace.steps.length >= 2) {
                for (const segment of splitWrappedRoute(trace.steps, MAP_WIDTH, MAP_HEIGHT)) {
                    if (segment.length < 2) continue;
                    const route = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
                    route.classList.add(`route-opponent-${opponentIndex}`);
                    route.setAttribute('points', segment.map(({ x, y }) => `${x},${y}`).join(' '));
                    overlay.append(route);
                }
            }

            const decisions = getRouteDecisionMarkers(trace, script);
            decisions.forEach((decision, index) => {
                const marker = document.createElement('span');
                marker.className = `route-decision route-decision-opponent-${opponentIndex}`;
                marker.textContent = String(decision.label);
                marker.style.left = `${((decision.x + 0.5) / MAP_WIDTH) * 100}%`;
                marker.style.top = `${((decision.y + 0.5) / MAP_HEIGHT) * 100}%`;
                // Offset slightly so opponent 1/2 markers don't perfectly overlap on same cell.
                const offset = opponentIndex === 1 ? -6 : 6;
                marker.style.transform = `translate(calc(-50% + ${offset}px), calc(-50% + ${index % 2 === 0 ? -6 : 6}px))`;
                marker.title = `Opponent ${opponentIndex} ${decision.kind} · ${decision.detail} @ cell (${decision.x},${decision.y})`;
                decisionOverlay.append(marker);
            });
        }
        if (overlay.childElementCount > 0) grid.append(overlay);
        if (decisionOverlay.childElementCount > 0) grid.append(decisionOverlay);
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

interface RouteDecisionMarker {
    x: number;
    y: number;
    label: string | number;
    kind: string;
    detail: string;
}

function getRouteDecisionMarkers(
    trace: LaneRouteTrace,
    script: { initialMode: number; branchModes: readonly number[]; terminates: boolean },
): RouteDecisionMarker[] {
    if (trace.steps.length === 0) return [];
    const markers: RouteDecisionMarker[] = [];
    const start = trace.steps[0];
    markers.push({
        x: start.x,
        y: start.y,
        label: script.initialMode,
        kind: 'initial mode',
        detail: `script[0]=initial ${script.initialMode}`,
    });

    for (const step of trace.steps) {
        if (step.scriptStepIndex === undefined) continue;
        const value = step.scriptStepMode ?? script.branchModes[step.scriptStepIndex];
        markers.push({
            x: step.x,
            y: step.y,
            label: value ?? '?',
            kind: 'branch decision',
            detail: `script[${step.scriptStepIndex + 1}]=${value} (branch step ${step.scriptStepIndex + 1})`,
        });
    }
    return markers;
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
            if (consumeSuppressedMapClick()) return;
            selectEntity(entity.slot);
        });
        marker.addEventListener('dblclick', (event) => {
            event.preventDefault();
            event.stopPropagation();
            selectEntity(entity.slot, { openPopup: true, anchorClientX: event.clientX, anchorClientY: event.clientY });
        });
        marker.addEventListener('contextmenu', (event) => {
            event.preventDefault();
            event.stopPropagation();
            selectEntity(entity.slot, { openPopup: true, anchorClientX: event.clientX, anchorClientY: event.clientY });
        });
        marker.addEventListener('keydown', (event) => {
            if (event.key === 'Enter') {
                event.preventDefault();
                event.stopPropagation();
                selectEntity(entity.slot, { openPopup: true });
            }
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

function selectEntity(slot: number, options?: { openPopup?: boolean; anchorClientX?: number; anchorClientY?: number }): void {
    selectedEntitySlot = slot;
    entitySelect.value = String(slot);
    renderEntityDetails();
    refreshSelectedEntityMarker();
    if (options?.openPopup) {
        openPropertiesPopup({ kind: 'entity', slot }, options?.anchorClientX, options?.anchorClientY);
    } else if (isPropertiesPopupOpen() && propertiesPopupTarget?.kind === 'entity') {
        setPopupTarget({ kind: 'entity', slot });
        positionPropertiesPopup();
    }
}

function refreshSelectedEntityMarker(): void {
    grid.querySelectorAll<HTMLButtonElement>('.entity-marker').forEach((marker) => {
        marker.classList.toggle('selected', Number(marker.dataset.slot) === selectedEntitySlot);
    });
}

const SCENE01_OBJECT_NAMES: Partial<Record<number, string>> = {
    0x04: 'Highway shield sign (Highway 49)',
    0x05: 'Traffic lights',
    0x06: 'Stop sign',
    0x08: '55 Speed Sign',
    0x0a: 'Turn right sign',
    0x0c: 'Turn left sign',
    0x0d: 'Highway shield sign (Highway 33)',
    0x0e: 'Highway shield sign (Highway 120)',
    0x0f: 'Lighthouse (lights on)',
    0x10: 'Railroad crossing gate',
    0x12: 'Train (locomotive)',
    0x13: 'Train',
    0x14: 'Train',
    0x15: 'Lightning impact point (marker)',
    0x16: 'Chevron right sign',
    0x17: 'Chevron left sign',
    0x18: 'Crossroads sign',
    0x19: 'Intersection sign (N, E, S)',
    0x1a: 'Intersection sign (N, W, S)',
    0x1b: 'Power pole',
    0x1c: '35 Speed Sign',
    0x1d: 'Small boat',
    0x1e: 'Sail boat',
    0x1f: 'Right lane branches / Entering highway sign',
    0x20: 'Two right lanes merge / Leaving highway sign',
    0x22: 'Rain trigger',
    0x23: 'Snow trigger',
    0x25: 'Mist/Fog cloud',
    0x26: 'Mailbox',
    0x28: 'Traffic cone',
    0x2a: 'Highway shield sign (Highway 5)',
    0x2b: 'Farmer/worker',
    0x2c: 'Road Closed barrier',
    0x2e: 'Traffic car (pick-up truck)',
    0x2f: 'Traffic car (blue hatchback)',
    0x31: '"Don\'t drink and drive" billboard',
    0x32: 'Dip sign',
    0x33: 'Farm barn',
    0x34: 'White villa',
    0x35: 'Blue house',
    0x36: 'White house with wooden porch',
    0x37: 'Traffic car (station wagon)',
    0x38: 'Chicken',
    0x3a: 'Brown cow',
    0x3b: 'Street lantern (lights on)',
    0x3c: 'Highway shield sign (Highway 1)',
    0x3d: 'Highway shield sign (Highway 101)',
    0x3e: 'Highway shield sign (Highway 156)',
    0x3f: 'Highway shield sign (Highway 140)',
};

function entityName(modelId: number): string {
    if (modelId === 0x01) return 'Likely player start';
    if (modelId === 0x02) return 'Opponent 1';
    if (modelId === 0x03) return 'Opponent 2';
    if (modelId === 0x11 || modelId === 0x30) return 'Police';
    if (courseId === 'SCENE01') {
        const sceneName = SCENE01_OBJECT_NAMES[modelId];
        if (sceneName) return sceneName;
    }
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

function consumeSuppressedMapClick(): boolean {
    if (!suppressNextMapClick) return false;
    suppressNextMapClick = false;
    return true;
}

function isPropertiesPopupOpen(): boolean {
    return !propertiesPopup.hidden && propertiesPopupTarget !== null;
}

function closePropertiesPopup(): void {
    propertiesPopup.hidden = true;
    propertiesPopupTarget = null;
    delete propertiesPopup.dataset.anchorX;
    delete propertiesPopup.dataset.anchorY;
    delete propertiesPopup.dataset.anchorSlot;
}

function setPopupTarget(target: PropertiesPopupTarget): void {
    propertiesPopupTarget = target;
    popupCellSection.hidden = target.kind !== 'cell';
    popupEntitySection.hidden = target.kind !== 'entity';
    if (target.kind === 'cell') {
        popupTitle.textContent = `Cell (${target.x}, ${target.y})`;
        propertiesPopup.dataset.anchorX = String(target.x);
        propertiesPopup.dataset.anchorY = String(target.y);
        delete propertiesPopup.dataset.anchorSlot;
        updateCellDetails(target.x, target.y, readMapCell(activeData(), selectedMapOffset(), target.x, target.y));
    } else {
        popupTitle.textContent = `Entity #${target.slot}`;
        propertiesPopup.dataset.anchorSlot = String(target.slot);
        delete propertiesPopup.dataset.anchorX;
        delete propertiesPopup.dataset.anchorY;
        renderEntityDetails();
    }
}

function positionPropertiesPopup(anchorClientX?: number, anchorClientY?: number): void {
    const panelRect = grid.closest('.map-panel')?.getBoundingClientRect();
    if (!panelRect) return;
    propertiesPopup.style.maxWidth = `${Math.max(240, Math.floor(panelRect.width - 24))}px`;
    const popupRect = propertiesPopup.getBoundingClientRect();
    const width = popupRect.width || 320;
    const height = popupRect.height || 240;

    let left = 16;
    let top = 16;
    if (propertiesPopupTarget?.kind === 'cell') {
        const cellButton = grid.querySelector<HTMLButtonElement>(`button.tile-cell[data-x="${propertiesPopupTarget.x}"][data-y="${propertiesPopupTarget.y}"]`);
        if (cellButton) {
            const rect = cellButton.getBoundingClientRect();
            left = rect.right - panelRect.left + 10;
            top = rect.top - panelRect.top - 8;
            if (left + width > panelRect.width - 8) {
                left = rect.left - panelRect.left - width - 10;
            }
        }
    } else if (propertiesPopupTarget?.kind === 'entity') {
        const marker = grid.querySelector<HTMLButtonElement>(`.entity-marker[data-slot="${propertiesPopupTarget.slot}"]`);
        if (marker) {
            const rect = marker.getBoundingClientRect();
            left = rect.right - panelRect.left + 10;
            top = rect.top - panelRect.top - 8;
            if (left + width > panelRect.width - 8) {
                left = rect.left - panelRect.left - width - 10;
            }
        }
    } else if (anchorClientX !== undefined && anchorClientY !== undefined) {
        left = anchorClientX - panelRect.left + 12;
        top = anchorClientY - panelRect.top + 12;
    }

    left = Math.max(8, Math.min(left, panelRect.width - width - 8));
    top = Math.max(8, Math.min(top, panelRect.height - height - 8));
    propertiesPopup.style.left = `${Math.round(left)}px`;
    propertiesPopup.style.top = `${Math.round(top)}px`;
}

function openPropertiesPopup(target: PropertiesPopupTarget, anchorClientX?: number, anchorClientY?: number): void {
    propertiesPopup.hidden = false;
    setPopupTarget(target);
    positionPropertiesPopup(anchorClientX, anchorClientY);
    requestAnimationFrame(() => {
        if (propertiesPopup.hidden) return;
        positionPropertiesPopup(anchorClientX, anchorClientY);
        const focusTarget = target.kind === 'cell'
            ? tileIdInput
            : propertiesPopup.querySelector<HTMLElement>('input, select, textarea, button:not(.map-popup-close)');
        focusTarget?.focus({ preventScroll: true });
    });
}

function refreshPropertiesPopup(): void {
    if (!isPropertiesPopupOpen() || !propertiesPopupTarget) return;
    if (propertiesPopupTarget.kind === 'cell') {
        if (!workingData) return;
        const { x, y } = propertiesPopupTarget;
        popupTitle.textContent = `Cell (${x}, ${y})`;
        updateCellDetails(x, y, readMapCell(activeData(), selectedMapOffset(), x, y));
    } else {
        popupTitle.textContent = `Entity #${propertiesPopupTarget.slot}`;
        renderEntityDetails();
    }
    positionPropertiesPopup();
}

function selectCell(x: number, y: number, options?: { openPopup?: boolean; anchorClientX?: number; anchorClientY?: number }): void {
    selectedCell = { x, y };
    if (paintInput.checked) {
        writeMapCell(activeData(), selectedMapOffset(), x, y, readCellControls());
        updateCellDetails(x, y, readMapCell(activeData(), selectedMapOffset(), x, y));
        renderGrid();
        if (options?.openPopup || (isPropertiesPopupOpen() && propertiesPopupTarget?.kind === 'cell')) {
            openPropertiesPopup({ kind: 'cell', x, y }, options?.anchorClientX, options?.anchorClientY);
        }
        return;
    }

    updateCellDetails(x, y, readMapCell(activeData(), selectedMapOffset(), x, y));
    renderGrid();
    if (options?.openPopup) {
        openPropertiesPopup({ kind: 'cell', x, y }, options?.anchorClientX, options?.anchorClientY);
    } else if (isPropertiesPopupOpen() && propertiesPopupTarget?.kind === 'cell') {
        setPopupTarget({ kind: 'cell', x, y });
        positionPropertiesPopup();
    }
}

function updateCellDetails(x: number, y: number, cell: MapCell): void {
    tileIdInput.value = String(paletteTileId ?? cell.tileId);
    rotationInput.value = String(cell.rotation);
    elevationInput.value = String(cell.elevation);

    const tileHex = cell.tileId.toString(16).padStart(2, '0').toUpperCase();
    const tileLabel = cell.tileId >= 0x40
        ? `course tile ${(cell.tileId - 0x40).toString(16).padStart(2, '0').toUpperCase()} (0x${tileHex})`
        : `shared tile 0x${tileHex}`;

    const routeTiles = readRouteTiles(activeData(), selectedMapOffset());
    const routeMarkerIndex = routeTiles.indexOf(cell.tileId);
    const routeMarkerText = routeMarkerIndex === -1 ? '' : ` · Route marker ${routeMarkerIndex}`;
    const lines = [`Cell (${x}, ${y}) · ${tileLabel}${routeMarkerText}`, `Rotation ${cell.rotation * 90}° · elevation ${cell.elevation}`];

    const lane = laneBank?.find((item) => item.tileId === cell.tileId);
    if (!lane) {
        lines.push('', 'Lane connectivity: no lane record for this tile in the current bank.');
    } else if (lane.waypoints.length === 0) {
        lines.push('', 'Lane connectivity: tile has no waypoints.');
    } else {
        const connectivity = getTileConnectivity(lane);
        const byWorldEntry = new Map<CardinalSide, Set<CardinalSide>>();
        for (const entry of connectivity.byEntryWaypoint) {
            const worldEntry = rotatedSide(cell.rotation, entry.entryLocalSide);
            if (!byWorldEntry.has(worldEntry)) byWorldEntry.set(worldEntry, new Set());
            const exits = byWorldEntry.get(worldEntry)!;
            for (const localExit of entry.exitLocalSides) {
                exits.add(rotatedSide(cell.rotation, localExit));
            }
        }

        lines.push('', 'Entry → available exits (world sides):');
        if (byWorldEntry.size === 0) {
            lines.push('• No entry waypoints on this tile.');
        } else {
            const sideOrder: CardinalSide[] = [0, 1, 2, 3];
            for (const side of sideOrder) {
                const exits = byWorldEntry.get(side);
                if (!exits) continue;
                const exitLabels = [...exits].sort((a, b) => a - b).map((s) => CARDINAL_SIDES[s]).join(', ');
                lines.push(`• ${CARDINAL_SIDES[side]} → ${exitLabels || '—'}`);
            }
            const exitSides = [0, 1, 2, 3].filter((side) =>
                lane.waypoints.some((wp) => isLaneExit(wp) && rotatedSide(cell.rotation, wp.flags & 3) === side)
            ) as CardinalSide[];
            const entrySides = new Set(byWorldEntry.keys());
            const exitsWithoutEntries = exitSides.filter((side) => !entrySides.has(side));
            if (exitsWithoutEntries.length > 0) {
                lines.push(`• Exit-only sides: ${exitsWithoutEntries.map((s) => CARDINAL_SIDES[s]).join(', ')}`);
            }
        }
        lines.push('', `(${lane.waypoints.length} waypoint${lane.waypoints.length === 1 ? '' : 's'} total; behavior-dependent branches considered)`);
    }

    cellDetails.textContent = lines.join('\n');
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
    invertedObjectBankData = null;
    inversionOriginalLaneBank = null;
    inversionOriginalLaneBankSource = '';
    inversionOriginalLaneBankApproximate = false;
    selectedCell = null;
    closePropertiesPopup();
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

function downloadObjectBank(): void {
    if (!invertedObjectBankData) return;
    const buffer = new ArrayBuffer(invertedObjectBankData.byteLength);
    new Uint8Array(buffer).set(invertedObjectBankData);
    const blob = new Blob([buffer], { type: 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'SCENE03O.BIN';
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function resetCurrentLeg(): void {
    if (!originalData || !workingData || inversionApplied) return;
    const offset = selectedMapOffset();
    workingData.set(originalData.subarray(offset, offset + MAP_RESOURCE_SIZE), offset);
    selectedCell = null;
    closePropertiesPopup();
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
    closePropertiesPopup();
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
    invertedObjectBankData = null;
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
        if (!sharedObjectBankData) {
            throw new Error('The shared object bank must be loaded before inverting Pacific.');
        }
        // Use the same lane bank as SCENE01 (shared/un-reversed), with no mirroring or tile patches.
        const scene03LaneBank = sharedLaneBank;
        const scene03LaneBankData = serializeLaneBank(scene03LaneBank, PRIVATE_LANE_TILE_COUNT);
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
        laneBank = scene03LaneBank;
        laneBankSource = 'shared SCENETTP.BIN (SCENE01 lane bank)';
        laneBankApproximate = false;
        invertedLaneBankData = scene03LaneBankData;
        invertedObjectBankData = sharedObjectBankData.slice();
        let sceneDat = invertedData;
        if (originalLstData) {
            workingLstData = createScene03LstFromScene01(originalLstData);
            sceneDat = embedPrivateBanksInSceneDat(workingLstData, sceneDat, invertedObjectBankData, invertedLaneBankData);
            lstSourceFilename = 'SCENE03.LST';
            lstFilenameLabel.textContent = 'SCENE03.LST';
            renderLstEditor();
        }
        workingData = sceneDat;
        inversionApplied = true;
        selectedCell = null;
        selectedEntitySlot = null;
        closePropertiesPopup();
        paletteTileId = null;
        legSelect.value = '0';
        cellDetails.textContent = 'Select a cell to inspect the reversed course.';
        refreshTilePreviews();
        const swapNote = swappedLandscapes ? ' landscapes/palettes swapped (leg 1↔5, set A↔C);' : '';
        const warningNote = swapWarning ? ` Landscape swap skipped: ${swapWarning}` : '';
        setStatus(`SCENE03 experiment ready ·${swapNote} using SCENE01 shared lane bank (un-reversed, no mirroring), LST set to private O/P banks (0x57=0), and SCENE03O.BIN/SCENE03P.BIN embedded into SCENE03.DAT. Export SCENE03.DAT and SCENE03.LST (O/P BIN exports are optional). Routes still need validation.${warningNote}`, Boolean(swapWarning));
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
    closePropertiesPopup();
    cellDetails.textContent = 'Select a cell to inspect or edit it.';
    if (workingData) refreshTilePreviews();
});

const MIN_MAP_CELL_SIZE = 12;
const MAX_MAP_CELL_SIZE = 108;
const DEFAULT_MAP_CELL_SIZE = 18;

function clampMapCellSize(size: number): number {
    return Math.max(MIN_MAP_CELL_SIZE, Math.min(MAX_MAP_CELL_SIZE, Math.round(size)));
}

function applyMapZoom(): void {
    const cellSize = clampMapCellSize(Number(zoomInput.value));
    zoomInput.value = String(cellSize);
    grid.style.setProperty('--map-cell-size', `${cellSize}px`);
    const percent = Math.round((cellSize / DEFAULT_MAP_CELL_SIZE) * 100);
    zoomValue.textContent = `${percent}%`;
    if (isPropertiesPopupOpen()) positionPropertiesPopup();
}

function setMapZoom(nextSize: number, anchor?: { clientX: number; clientY: number }): void {
    const currentSize = clampMapCellSize(Number(zoomInput.value));
    const clamped = clampMapCellSize(nextSize);
    if (clamped === currentSize) return;

    if (anchor) {
        const rect = mapScroll.getBoundingClientRect();
        const offsetX = anchor.clientX - rect.left + mapScroll.scrollLeft;
        const offsetY = anchor.clientY - rect.top + mapScroll.scrollTop;
        const ratio = clamped / currentSize;
        zoomInput.value = String(clamped);
        applyMapZoom();
        mapScroll.scrollLeft = offsetX * ratio - (anchor.clientX - rect.left);
        mapScroll.scrollTop = offsetY * ratio - (anchor.clientY - rect.top);
        if (isPropertiesPopupOpen()) positionPropertiesPopup();
        return;
    }

    zoomInput.value = String(clamped);
    applyMapZoom();
}

function fitMapToView(): void {
    const padding = 10;
    const availableWidth = Math.max(64, mapScroll.clientWidth - padding);
    const availableHeight = Math.max(64, mapScroll.clientHeight - padding);
    const gap = 2;
    const sizeByWidth = (availableWidth - gap * (MAP_WIDTH - 1)) / MAP_WIDTH;
    const sizeByHeight = (availableHeight - gap * (MAP_HEIGHT - 1)) / MAP_HEIGHT;
    setMapZoom(Math.floor(Math.min(sizeByWidth, sizeByHeight)));
    mapScroll.scrollLeft = 0;
    mapScroll.scrollTop = 0;
    if (isPropertiesPopupOpen()) positionPropertiesPopup();
}

function resetMapZoom(): void {
    setMapZoom(DEFAULT_MAP_CELL_SIZE);
}

popupCloseButton.addEventListener('click', closePropertiesPopup);
zoomOutButton.addEventListener('click', () => setMapZoom(clampMapCellSize(Number(zoomInput.value)) - 2));
zoomInButton.addEventListener('click', () => setMapZoom(clampMapCellSize(Number(zoomInput.value)) + 2));
zoomFitButton.addEventListener('click', fitMapToView);
zoomResetButton.addEventListener('click', resetMapZoom);

document.addEventListener('pointerdown', (event) => {
    if (!isPropertiesPopupOpen()) return;
    const target = event.target as Node | null;
    if (target && propertiesPopup.contains(target)) return;
    closePropertiesPopup();
    if (event.button !== 0) return;
    suppressNextMapClick = true;
    document.addEventListener('click', (clickEvent) => {
        if (!suppressNextMapClick) return;
        suppressNextMapClick = false;
        const clickTarget = clickEvent.target as Node | null;
        if (clickTarget instanceof Element && (clickTarget.closest('.tile-cell') || clickTarget.closest('.entity-marker'))) {
            clickEvent.preventDefault();
            clickEvent.stopPropagation();
        }
    }, { capture: true, once: true });
}, true);

document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && isPropertiesPopupOpen()) {
        event.preventDefault();
        closePropertiesPopup();
        return;
    }
    if (event.key === 'Enter' && !isPropertiesPopupOpen()) {
        const target = event.target as HTMLElement | null;
        if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable)) return;
        if (target && target.closest('#map-properties-popup')) return;
        if (selectedEntitySlot !== null && target?.closest('.entity-marker, #entity-select')) {
            event.preventDefault();
            selectEntity(selectedEntitySlot, { openPopup: true });
            return;
        }
        if (selectedCell) {
            event.preventDefault();
            openPropertiesPopup({ kind: 'cell', x: selectedCell.x, y: selectedCell.y });
        }
    }
});

propertiesPopup.addEventListener('pointerdown', (event) => {
    event.stopPropagation();
});

propertiesPopup.addEventListener('wheel', (event) => {
    event.stopPropagation();
}, { passive: true });

mapScroll.addEventListener('wheel', (event) => {
    if (event.ctrlKey) return;
    event.preventDefault();
    const direction = event.deltaY < 0 ? 1 : -1;
    const step = event.shiftKey ? 4 : 2;
    setMapZoom(clampMapCellSize(Number(zoomInput.value)) + direction * step, {
        clientX: event.clientX,
        clientY: event.clientY,
    });
}, { passive: false });

mapScroll.addEventListener('scroll', () => {
    if (isPropertiesPopupOpen()) positionPropertiesPopup();
});

window.addEventListener('resize', () => {
    if (isPropertiesPopupOpen()) positionPropertiesPopup();
});

let isSpacePanning = false;
let activePan: { pointerId: number; startX: number; startY: number; scrollLeft: number; scrollTop: number } | null = null;

window.addEventListener('keydown', (event) => {
    if (event.code !== 'Space') return;
    const target = event.target as HTMLElement | null;
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable)) return;
    if (!isSpacePanning) {
        isSpacePanning = true;
        mapScroll.classList.add('pan-ready');
    }
    if (event.target === document.body || mapScroll.contains(target) || target === mapScroll) {
        event.preventDefault();
    }
});

window.addEventListener('keyup', (event) => {
    if (event.code !== 'Space') return;
    isSpacePanning = false;
    if (!activePan) mapScroll.classList.remove('pan-ready', 'panning');
});

mapScroll.addEventListener('pointerdown', (event) => {
    const isMiddle = event.button === 1;
    const isSpaceDrag = event.button === 0 && isSpacePanning;
    if (!isMiddle && !isSpaceDrag) return;
    if (isPropertiesPopupOpen()) {
        const target = event.target as Node | null;
        if (target && propertiesPopup.contains(target)) return;
    }
    activePan = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        scrollLeft: mapScroll.scrollLeft,
        scrollTop: mapScroll.scrollTop,
    };
    mapScroll.classList.add('panning');
    mapScroll.setPointerCapture(event.pointerId);
    event.preventDefault();
});

mapScroll.addEventListener('pointermove', (event) => {
    if (!activePan || activePan.pointerId !== event.pointerId) return;
    mapScroll.scrollLeft = activePan.scrollLeft - (event.clientX - activePan.startX);
    mapScroll.scrollTop = activePan.scrollTop - (event.clientY - activePan.startY);
});

function endMapPan(event?: PointerEvent): void {
    if (!activePan) return;
    if (event && activePan.pointerId !== event.pointerId) return;
    if (event && mapScroll.hasPointerCapture(event.pointerId)) mapScroll.releasePointerCapture(event.pointerId);
    activePan = null;
    mapScroll.classList.remove('panning');
    if (!isSpacePanning) mapScroll.classList.remove('pan-ready');
}

mapScroll.addEventListener('pointerup', endMapPan);
mapScroll.addEventListener('pointercancel', endMapPan);
mapScroll.addEventListener('lostpointercapture', () => endMapPan());

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
    const slot = entitySelect.value === '' ? null : Number(entitySelect.value);
    if (slot === null) {
        selectedEntitySlot = null;
        renderEntityDetails();
        refreshSelectedEntityMarker();
        if (isPropertiesPopupOpen() && propertiesPopupTarget?.kind === 'entity') closePropertiesPopup();
        return;
    }
    selectEntity(slot, { openPopup: true });
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
routeTileInputs.forEach((input, index) => {
    input.addEventListener('change', () => {
        if (!workingData) return;
        try {
            writeRouteTile(workingData, selectedMapOffset(), index, Number(input.value));
            renderGrid();
        } catch (error) {
            setStatus(error instanceof Error ? error.message : 'Could not update route tile.', true);
            refreshRouteMarkerUI();
        }
    });
});
const onHorizonInputChanged = () => {
    refreshHorizonPreview();
};

applyModeToggleButton.addEventListener('click', () => {
    if (!workingData) return;
    const toMode = modeInput.value === '0' ? 0 : modeInput.value === '1' ? 1 : null;
    if (toMode === null) return;
    const mapOffset = selectedMapOffset();
    const fromMode = readMapMode(workingData, mapOffset) === 0 ? 0 : 1;
    if (fromMode === toMode) {
        setHorizonFeedback(`This leg is already set to ${toMode === 0 ? 'night' : 'day'}.`);
        return;
    }
    if (horizonPreserveVariantInput.checked) {
        applySkySeedDeltaForModeToggle(workingData, mapOffset, fromMode, toMode);
        const fogSeed = readFogSeed(workingData, mapOffset);
        const idx = fogRemapIndex(fogSeed);
        const remap = readRemapEntry(workingData, mapOffset, idx);
        if (remap > 0x0F0F) {
            const adjustment = fromMode === 0 ? 0x0101 : -0x0101;
            writeRemapEntry(workingData, mapOffset, idx, (remap + adjustment) & 0xFFFF);
        }
        setHorizonFeedback(`Switched to ${toMode === 0 ? 'night' : 'day'} while keeping this leg’s horizon variant.`);
    } else {
        setHorizonFeedback(`Switched to ${toMode === 0 ? 'night' : 'day'} (horizon values kept as-is).`);
    }
    writeMapMode(workingData, mapOffset, toMode);
    updateStatus();
    refreshTilePreviews();
});

applyModeCanonicalButton.addEventListener('click', () => {
    if (!workingData) return;
    const mode = modeInput.value === '0' ? 0 : modeInput.value === '1' ? 1 : null;
    if (mode === null) return;
    const mapOffset = selectedMapOffset();
    writeMapMode(workingData, mapOffset, mode);
    applyCanonicalSkySeeds(workingData, mapOffset, mode);
    setHorizonFeedback(`Applied canonical ${mode === 0 ? 'night' : 'day'} sky colors to this leg.`);
    updateStatus();
    refreshTilePreviews();
});

applyHorizonButton.addEventListener('click', applyHorizonInputs);
resetHorizonLegButton.addEventListener('click', resetHorizonForCurrentLeg);
applyHorizonPresetButton.addEventListener('click', applyHorizonPreset);

copyHorizonButton.addEventListener('click', () => {
    const selected = copyHorizonLegsContainer.querySelector<HTMLButtonElement>('.horizon-leg-chip.active');
    const leg = selected ? Number.parseInt(selected.textContent?.replace(/\D/g, '') ?? '', 10) - 1 : Number(copyHorizonLegSelect.value);
    if (Number.isInteger(leg)) copyHorizonFromLeg(leg);
});

[modeInput, skySeed2eInput, skySeed2fInput, skySeed30Input, skySeed31Input, skyRemapEntryInput].forEach((el) => {
    el.addEventListener('input', onHorizonInputChanged);
    el.addEventListener('change', onHorizonInputChanged);
});

skyFogSeedInput.addEventListener('input', () => {
    try {
        const fogSeed = parseIntegerInput(skyFogSeedInput.value, 'Gradient selector', 0, 0xFFFF);
        const idx = fogRemapIndex(fogSeed);
        skyRemapIndexInput.value = formatHexByte(idx);
        if (workingData) {
            skyRemapEntryInput.value = formatHexWord(readRemapEntry(workingData, selectedMapOffset(), idx));
        }
    } catch {
        skyRemapIndexInput.value = '—';
    }
    onHorizonInputChanged();
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
exportObjectBankButton.addEventListener('click', downloadObjectBank);
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
        closePropertiesPopup();
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
    if (!files.datab || files.datab.length < OBJECT_BANK_OFFSET + OBJECT_BANK_SIZE) {
        throw new Error('DATAB.DAT does not contain the shared SCENETT0 object bank.');
    }
    sharedLaneBank = parseLaneBank(files.datab.subarray(LANE_BANK_OFFSET, LANE_BANK_OFFSET + LANE_BANK_SIZE));
    sharedObjectBankData = files.datab.slice(OBJECT_BANK_OFFSET, OBJECT_BANK_OFFSET + OBJECT_BANK_SIZE);
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
        const startX = entity.cell & 0x1F;
        const startY = (entity.cell >> 5) & 0x0F;
        const startCell = readMapCell(workingData!, mapOffset, startX, startY);
        const startLane = laneBank!.find((l) => l.tileId === startCell.tileId);
        const currentWp = entity.waypoint & 0x3F;
        const wpCandidates = new Set<number>([currentWp]);
        if (startLane) {
            for (let i = 0; i < startLane.waypoints.length; i++) wpCandidates.add(i);
        }
        let bestWp = currentWp;
        let bestPaths: typeof probeOpponentPaths extends (...args: any) => infer R ? R : never = [] as any;
        let bestScore = Number.POSITIVE_INFINITY;
        for (const wp of wpCandidates) {
            const paths = probeOpponentPaths(workingData!, mapOffset, laneBank!, entity, finishTileId, { maxResults: 12, startWaypointIndex: wp });
            const top = paths[0];
            if (top) {
                const score = top.steps * 100000 + top.scriptControlPoints * 1000 + top.branchModes.length;
                if (score < bestScore) { bestScore = score; bestWp = wp; bestPaths = paths; }
            } else if (bestPaths.length === 0 && wp === currentWp) {
                bestPaths = paths;
            }
        }
        console.log('[path-probe] chosen start waypoint index ' + String(bestWp) + ' (was ' + String(currentWp) + ')');
        const paths = bestPaths;
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
        return { entity, paths, chosenWaypointIndex: bestWp };
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

    const selection = {
        singlePath,
        sameRoute,
        preferredDivergeReconverge: preferredPair,
        chosen: chosen.map((p, i) => ({ opponent: probed[i].entity.modelId - 1, initialMode: p.initialMode, branchModes: p.branchModes, steps: p.steps, exitEntryLinks: p.exitEntryLinks, scriptControlPoints: p.scriptControlPoints, signature: p.signature })),
    };
    console.log('[path-probe] selection ' + JSON.stringify(selection));
    console.log('[path-probe] COPY_SELECTION ' + JSON.stringify({ context: probeContext, selection }));
    console.groupEnd();

    for (let i = 0; i < probed.length; i++) {
        const p = probed[i] as typeof probed[number] & { chosenWaypointIndex: number };
        const newWp = (p.entity.waypoint & ~0x3F) | (p.chosenWaypointIndex & 0x3F);
        writeMapEntity(activeData(), mapOffset, p.entity.slot, {
            flags: p.entity.flags,
            x: p.entity.x,
            z: p.entity.z,
            y: p.entity.y,
            heading: p.entity.heading,
            velocity: p.entity.velocity,
            cell: p.entity.cell,
            waypoint: newWp,
        });
        writeOpponentRouteScript(activeData(), mapOffset, (p.entity.modelId - 2) as 0 | 1, {
            initialMode: chosen[i].initialMode,
            branchModes: [...chosen[i].branchModes],
            terminates: false,
        });
    }

    renderInspectionLayers();
    updateStatus();

    const summary = document.createElement('p');
    if (singlePath || sameRoute) {
        summary.textContent = 'Generated and applied the same AI path to both opponents.';
    } else if (preferredPair) {
        summary.textContent = 'Generated and applied two shortest no-U-turn paths that diverge and reconverge.';
    } else {
        summary.textContent = 'Generated and applied two shortest no-U-turn paths with different routes/scripts.';
    }
    probeResults.append(summary);

    const describe = (path: ProbedPath): string =>
        `initial ${path.initialMode}, steps [${path.branchModes.join(', ') || 'none'}], ${path.exitEntryLinks} exit/entry link(s), ${path.scriptControlPoints} scripted branch/control point(s), length ${path.steps}`;
    const stats = document.createElement('p');
    stats.textContent = sameRoute
        ? `Applied path: ${describe(chosen[0])}.`
        : `Opponent 1: ${describe(chosen[0])}. Opponent 2: ${describe(chosen[1])}.`;
    probeResults.append(stats);
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
        refreshRouteMarkerUI();
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

function embedPrivateBanksInSceneDat(
    lst: Uint8Array,
    dat: Uint8Array,
    oBank: Uint8Array,
    pBank: Uint8Array,
): Uint8Array {
    const SCENE_ARCHIVE_OFFSET = 0x04D0;
    const SCENE_ARCHIVE_ENTRY_SIZE = 14;
    const SCENE_ARCHIVE_ENTRY_COUNT = 0x196 / SCENE_ARCHIVE_ENTRY_SIZE;

    const outDat = new Uint8Array(dat.length + oBank.length + pBank.length);
    outDat.set(dat, 0);
    outDat.set(oBank, dat.length);
    outDat.set(pBank, dat.length + oBank.length);

    updateArchiveEntry(lst, 'SCENE03O.BIN', dat.length, oBank.length + 1, SCENE_ARCHIVE_OFFSET, SCENE_ARCHIVE_ENTRY_SIZE, SCENE_ARCHIVE_ENTRY_COUNT);
    updateArchiveEntry(lst, 'SCENE03P.BIN', dat.length + oBank.length, pBank.length + 1, SCENE_ARCHIVE_OFFSET, SCENE_ARCHIVE_ENTRY_SIZE, SCENE_ARCHIVE_ENTRY_COUNT);

    return outDat;
}

function updateArchiveEntry(
    lst: Uint8Array,
    filename: string,
    dataOffset: number,
    storedSize: number,
    archiveOffset: number,
    entrySize: number,
    entryCount: number,
): void {
    const [hashH2, hashH1] = hashSceneArchiveFilename(filename);
    for (let index = 0; index < entryCount; index++) {
        const entryOffset = archiveOffset + index * entrySize;
        const entryHashH2 = readWord(lst, entryOffset);
        const entryHashH1 = readWord(lst, entryOffset + 2);
        if (entryHashH2 === 0 && entryHashH1 === 0) break;
        if (entryHashH2 !== hashH2 || entryHashH1 !== hashH1) continue;
        lst[entryOffset + 4] = 0x65;
        writeDword(lst, entryOffset + 6, dataOffset >>> 0);
        writeWord(lst, entryOffset + 10, storedSize & 0xFFFF);
        return;
    }
    throw new Error(`Archive entry for ${filename} was not found in scene LST.`);
}

function hashSceneArchiveFilename(filename: string): readonly [number, number] {
    let h1 = 0;
    for (let index = filename.length - 1; index >= 0; index--) {
        h1 = (0x101 * h1 + signedByte(filename.charCodeAt(index))) & 0xFFFF;
    }
    let h2 = 0;
    for (let index = 0; index < filename.length - 1; index++) {
        h2 = (h2 + signedByte(filename.charCodeAt(index)) * index) & 0xFFFF;
    }
    return [h2, h1];
}

function signedByte(value: number): number {
    return value & 0x80 ? value - 0x100 : value;
}

function readWord(data: Uint8Array, offset: number): number {
    return data[offset] | (data[offset + 1] << 8);
}

function writeWord(data: Uint8Array, offset: number, value: number): void {
    data[offset] = value & 0xFF;
    data[offset + 1] = (value >>> 8) & 0xFF;
}

function writeDword(data: Uint8Array, offset: number, value: number): void {
    data[offset] = value & 0xFF;
    data[offset + 1] = (value >>> 8) & 0xFF;
    data[offset + 2] = (value >>> 16) & 0xFF;
    data[offset + 3] = (value >>> 24) & 0xFF;
}

function parseCourseId(value: string): CourseId | null {
    return value in COURSE_LAYOUTS ? value as CourseId : null;
}

type ToolboxMode = 'tiles' | 'entities' | 'routes-ai' | 'leg-properties';

function initEditorShell(): void {
    const workspace = document.getElementById('workspace');
    const toolboxPane = document.getElementById('toolbox-pane');
    const toolboxBody = document.getElementById('toolbox-body');
    const collapseButton = document.getElementById('toolbox-collapse');
    const resizer = document.getElementById('workspace-resizer');
    const courseToolsToggle = document.getElementById('course-tools-toggle');
    const courseToolsDialog = document.getElementById('course-tools-dialog');
    const courseToolsClose = document.getElementById('course-tools-close');

    if (courseToolsToggle instanceof HTMLButtonElement && courseToolsDialog instanceof HTMLDialogElement) {
        const closeDialog = (): void => {
            if (courseToolsDialog.open) courseToolsDialog.close();
            courseToolsToggle.setAttribute('aria-expanded', 'false');
        };
        courseToolsToggle.addEventListener('click', () => {
            if (courseToolsDialog.open) {
                closeDialog();
                return;
            }
            courseToolsDialog.showModal();
            courseToolsToggle.setAttribute('aria-expanded', 'true');
        });
        courseToolsClose?.addEventListener('click', closeDialog);
        courseToolsDialog.addEventListener('close', () => {
            courseToolsToggle.setAttribute('aria-expanded', 'false');
        });
        courseToolsDialog.addEventListener('click', (event) => {
            if (event.target === courseToolsDialog) closeDialog();
        });
    }

    const toolboxTabs = Array.from(document.querySelectorAll<HTMLButtonElement>('.toolbox-tab[data-mode]'));
    const toolboxModes = Array.from(document.querySelectorAll<HTMLElement>('.toolbox-mode[data-mode]'));
    const validModes: ToolboxMode[] = ['tiles', 'entities', 'routes-ai', 'leg-properties'];
    let activeToolboxMode: ToolboxMode = 'tiles';

    const setToolboxMode = (mode: ToolboxMode): void => {
        activeToolboxMode = mode;
        for (const tab of toolboxTabs) {
            const tabMode = tab.dataset.mode;
            const active = tabMode === mode;
            tab.classList.toggle('active', active);
            tab.setAttribute('aria-selected', String(active));
            tab.tabIndex = active ? 0 : -1;
        }
        for (const panel of toolboxModes) {
            const active = panel.dataset.mode === mode;
            panel.hidden = !active;
        }
    };

    for (const tab of toolboxTabs) {
        tab.addEventListener('click', () => {
            const mode = tab.dataset.mode;
            if (mode && (validModes as string[]).includes(mode)) {
                setToolboxMode(mode as ToolboxMode);
            }
        });
    }

    if (toolboxTabs.length > 0 && toolboxModes.length > 0) {
        setToolboxMode(activeToolboxMode);
    }

    if (!(workspace instanceof HTMLElement) || !(toolboxPane instanceof HTMLElement) || !(collapseButton instanceof HTMLButtonElement)) {
        return;
    }

    const minToolboxWidth = 240;
    const maxToolboxWidth = 560;
    let lastToolboxWidth = 320;

    const setToolboxWidth = (width: number): void => {
        const clamped = Math.max(minToolboxWidth, Math.min(maxToolboxWidth, Math.round(width)));
        lastToolboxWidth = clamped;
        workspace.style.setProperty('--toolbox-width', `${clamped}px`);
    };

    const setCollapsed = (collapsed: boolean): void => {
        toolboxPane.classList.toggle('collapsed', collapsed);
        workspace.classList.toggle('toolbox-collapsed', collapsed);
        collapseButton.textContent = collapsed ? '»' : '«';
        collapseButton.title = collapsed ? 'Expand toolbox' : 'Collapse toolbox';
        collapseButton.setAttribute('aria-expanded', String(!collapsed));
        if (toolboxBody instanceof HTMLElement) {
            toolboxBody.hidden = collapsed;
        }
        if (resizer instanceof HTMLElement) {
            resizer.setAttribute('aria-disabled', String(collapsed));
            resizer.tabIndex = collapsed ? -1 : 0;
        }
    };

    collapseButton.addEventListener('click', () => {
        setCollapsed(!toolboxPane.classList.contains('collapsed'));
    });

    if (resizer instanceof HTMLElement) {
        let pointerId: number | null = null;
        let startX = 0;
        let startWidth = lastToolboxWidth;

        const stopResize = (): void => {
            if (pointerId === null) return;
            if (resizer.hasPointerCapture(pointerId)) resizer.releasePointerCapture(pointerId);
            pointerId = null;
            workspace.classList.remove('resizing');
        };

        resizer.addEventListener('pointerdown', (event) => {
            if (toolboxPane.classList.contains('collapsed')) return;
            if (event.button !== 0) return;
            pointerId = event.pointerId;
            startX = event.clientX;
            startWidth = toolboxPane.getBoundingClientRect().width;
            workspace.classList.add('resizing');
            resizer.setPointerCapture(event.pointerId);
            event.preventDefault();
        });

        resizer.addEventListener('pointermove', (event) => {
            if (pointerId !== event.pointerId) return;
            setToolboxWidth(startWidth + (event.clientX - startX));
        });

        resizer.addEventListener('pointerup', stopResize);
        resizer.addEventListener('pointercancel', stopResize);

        resizer.addEventListener('keydown', (event) => {
            if (toolboxPane.classList.contains('collapsed')) return;
            if (event.key === 'ArrowLeft') {
                event.preventDefault();
                setToolboxWidth(lastToolboxWidth - 16);
            } else if (event.key === 'ArrowRight') {
                event.preventDefault();
                setToolboxWidth(lastToolboxWidth + 16);
            } else if (event.key === 'Home') {
                event.preventDefault();
                setToolboxWidth(minToolboxWidth);
            } else if (event.key === 'End') {
                event.preventDefault();
                setToolboxWidth(maxToolboxWidth);
            }
        });
    }

    setToolboxWidth(lastToolboxWidth);
    setCollapsed(false);
}

initEditorShell();
