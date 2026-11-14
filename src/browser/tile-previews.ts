import * as THREE from 'three';
import type { CourseId } from '@shared/course-map';
import type { Mesh } from '@shared/types';

export type TilePreviewBank = 'shared' | CourseId;

export const TILE_PREVIEW_SIZE = 48;

const ATLAS_COLUMNS = 16;
const BANK_ROWS = 4;

export function createTilePreviewAtlas(
    sharedTiles: Mesh[],
    scene01Tiles: Mesh[],
    scene02Tiles: Mesh[],
): HTMLCanvasElement {
    const atlas = document.createElement('canvas');
    atlas.width = ATLAS_COLUMNS * TILE_PREVIEW_SIZE;
    atlas.height = BANK_ROWS * 3 * TILE_PREVIEW_SIZE;

    const context = atlas.getContext('2d');
    if (!context) {
        throw new Error('Could not create the tile preview canvas.');
    }

    const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
    renderer.setPixelRatio(1);
    renderer.setSize(TILE_PREVIEW_SIZE, TILE_PREVIEW_SIZE);
    renderer.setClearColor(0x000000, 0);

    const scene = new THREE.Scene();
    scene.add(new THREE.AmbientLight(0xffffff, 0.8));
    const keyLight = new THREE.DirectionalLight(0xffffff, 0.6);
    keyLight.position.set(-1, -1, 2);
    scene.add(keyLight);

    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 100000);
    camera.up.set(0, 1, 0);

    try {
        renderBank(context, renderer, scene, camera, sharedTiles, 0);
        renderBank(context, renderer, scene, camera, scene01Tiles, 1);
        renderBank(context, renderer, scene, camera, scene02Tiles, 2);
    } finally {
        renderer.dispose();
    }

    return atlas;
}

function renderBank(
    context: CanvasRenderingContext2D,
    renderer: THREE.WebGLRenderer,
    scene: THREE.Scene,
    camera: THREE.OrthographicCamera,
    tiles: Mesh[],
    bank: number,
): void {
    tiles.forEach((tile, index) => {
        if (!tile.obj) return;

        const object = tile.obj.clone();
        const bounds = new THREE.Box3().setFromObject(object);
        if (bounds.isEmpty()) return;

        const size = bounds.getSize(new THREE.Vector3());
        const center = bounds.getCenter(new THREE.Vector3());
        const extent = Math.max(size.x, size.y, 1);
        const halfExtent = extent * 0.55;
        const cameraDistance = Math.max(size.z + extent, 100);

        object.position.sub(center);
        scene.add(object);

        camera.left = -halfExtent;
        camera.right = halfExtent;
        camera.top = halfExtent;
        camera.bottom = -halfExtent;
        camera.near = 0.1;
        camera.far = cameraDistance * 2 + size.z;
        camera.position.set(0, 0, cameraDistance);
        camera.lookAt(0, 0, 0);
        camera.updateProjectionMatrix();

        renderer.render(scene, camera);

        const x = (index % ATLAS_COLUMNS) * TILE_PREVIEW_SIZE;
        const y = (bank * BANK_ROWS + Math.floor(index / ATLAS_COLUMNS)) * TILE_PREVIEW_SIZE;
        context.drawImage(renderer.domElement, x, y);
        scene.remove(object);
    });
}

export function drawTilePreview(
    context: CanvasRenderingContext2D,
    atlas: HTMLCanvasElement,
    bank: TilePreviewBank,
    tileIndex: number,
    rotation: number,
    x: number,
    y: number,
    width: number,
    height: number,
): void {
    const bankIndex = bank === 'shared' ? 0 : bank === 'SCENE01' ? 1 : 2;
    const sourceX = (tileIndex % ATLAS_COLUMNS) * TILE_PREVIEW_SIZE;
    const sourceY = (bankIndex * BANK_ROWS + Math.floor(tileIndex / ATLAS_COLUMNS)) * TILE_PREVIEW_SIZE;

    context.clearRect(x, y, width, height);
    context.save();
    context.translate(x + width / 2, y + height / 2);
    // The map rotates models around world +Z by -90° per step; canvas Y points down.
    context.rotate(rotation * Math.PI / 2);
    context.drawImage(
        atlas,
        sourceX,
        sourceY,
        TILE_PREVIEW_SIZE,
        TILE_PREVIEW_SIZE,
        -width / 2,
        -height / 2,
        width,
        height,
    );
    context.restore();
}
