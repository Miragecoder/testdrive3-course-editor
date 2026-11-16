import {
    CAR_SLOT_COUNT,
    SCENE_SLOT_COUNT,
    createDefaultPlaydisk,
    readPlaydisk,
    writePlaydisk,
} from '@shared/playdisk';

function required<T extends HTMLElement>(id: string): T {
    const el = document.getElementById(id);
    if (!el) throw new Error(`Missing element #${id}`);
    return el as T;
}

const carSlotsEl = required<HTMLDivElement>('car-slots');
const sceneSlotsEl = required<HTMLDivElement>('scene-slots');
const statusEl = required<HTMLDivElement>('status');
const filenameEl = required<HTMLSpanElement>('playdisk-filename');
const fileInput = required<HTMLInputElement>('playdisk-file');

let current = readPlaydisk(createDefaultPlaydisk());

function setStatus(message: string, error = false): void {
    statusEl.textContent = message;
    statusEl.classList.toggle('error', error);
}

function parseByte(value: string, label: string): number {
    const v = value.trim().toLowerCase();
    const n = /^0x[0-9a-f]+$/.test(v) ? Number.parseInt(v, 16) : Number(v);
    if (!Number.isInteger(n) || n < 0 || n > 0xFF) throw new RangeError(`${label} must be a byte value (0-255).`);
    return n;
}

function renderSlots(): void {
    carSlotsEl.replaceChildren();
    for (let i = 0; i < CAR_SLOT_COUNT; i++) {
        const row = document.createElement('label');
        row.className = 'slot-row';
        const num = document.createElement('span');
        num.textContent = String(i).padStart(2, '0');
        const input = document.createElement('input');
        input.type = 'text';
        input.maxLength = 6;
        input.value = current.carSlots[i] ?? '';
        input.addEventListener('input', () => { current.carSlots[i] = input.value.toUpperCase(); input.value = current.carSlots[i]; });
        row.append(num, input);
        carSlotsEl.append(row);
    }
    sceneSlotsEl.replaceChildren();
    for (let i = 0; i < SCENE_SLOT_COUNT; i++) {
        const row = document.createElement('label');
        row.className = 'slot-row';
        const num = document.createElement('span');
        num.textContent = String(i).padStart(2, '0');
        const input = document.createElement('input');
        input.type = 'text';
        input.maxLength = 8;
        input.value = current.sceneSlots[i] ?? '';
        input.addEventListener('input', () => { current.sceneSlots[i] = input.value.toUpperCase(); input.value = current.sceneSlots[i]; });
        row.append(num, input);
        sceneSlotsEl.append(row);
    }
}

function renderState(): void {
    (required<HTMLInputElement>('selected-car')).value = String(current.selectedCarSlot);
    (required<HTMLInputElement>('unknown-word')).value = String(current.unknownWord);
    (required<HTMLInputElement>('selected-scene')).value = String(current.selectedSceneSlot);
    (required<HTMLInputElement>('skill-word')).value = String(current.skill);
    for (let i = 0; i < 5; i++) {
        (required<HTMLInputElement>(`tail-${i}`)).value = current.tail[i].toString(16).padStart(2, '0').toUpperCase();
    }
}

function collectState(): void {
    current.selectedCarSlot = Number(required<HTMLInputElement>('selected-car').value);
    current.unknownWord = Number(required<HTMLInputElement>('unknown-word').value);
    current.selectedSceneSlot = Number(required<HTMLInputElement>('selected-scene').value);
    current.skill = Number(required<HTMLInputElement>('skill-word').value);
    current.tail = new Uint8Array([0,1,2,3,4].map((i) => parseByte(required<HTMLInputElement>(`tail-${i}`).value, `Tail byte 0x${(0xAE + i).toString(16).toUpperCase()}`)));
}

function loadData(data: Uint8Array, name: string): void {
    current = readPlaydisk(data);
    filenameEl.textContent = name;
    renderSlots();
    renderState();
    setStatus(`Loaded ${name} (${data.length} bytes).`);
}

function download(): void {
    try {
        collectState();
        const bytes = writePlaydisk(current);
        const buffer = new ArrayBuffer(bytes.byteLength);
        new Uint8Array(buffer).set(bytes);
        const blob = new Blob([buffer], { type: 'application/octet-stream' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'PLAYDISK.DAT';
        a.click();
        window.setTimeout(() => URL.revokeObjectURL(url), 1000);
        setStatus('Exported PLAYDISK.DAT.');
    } catch (error) {
        setStatus(error instanceof Error ? error.message : 'Could not export PLAYDISK.DAT.', true);
    }
}

required<HTMLButtonElement>('open-playdisk').addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', async () => {
    const file = fileInput.files?.[0];
    if (!file) return;
    try {
        loadData(new Uint8Array(await file.arrayBuffer()), file.name);
    } catch (error) {
        setStatus(error instanceof Error ? error.message : 'Could not open PLAYDISK.DAT.', true);
    } finally {
        fileInput.value = '';
    }
});
required<HTMLButtonElement>('reset-playdisk').addEventListener('click', () => loadData(createDefaultPlaydisk(), 'Default template'));
required<HTMLButtonElement>('export-playdisk').addEventListener('click', download);

renderSlots();
renderState();
