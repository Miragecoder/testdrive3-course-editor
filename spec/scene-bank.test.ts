import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
    extractSceneArchiveEntry,
    isUnavailableSceneLaneBankResponse,
    requiresSceneSpecificLaneBank,
} from '../src/shared/scene-bank';
import { PRIVATE_LANE_TILE_COUNT, parseLaneBank } from '../src/shared/lane-connectivity';

function writeWord(data: Uint8Array, offset: number, value: number): void {
    data[offset] = value & 0xFF;
    data[offset + 1] = value >>> 8;
}

function writeDword(data: Uint8Array, offset: number, value: number): void {
    writeWord(data, offset, value & 0xFFFF);
    writeWord(data, offset + 2, value >>> 16);
}

test('reads the scene-specific lane-bank flag from the final LST digit byte', () => {
    const sceneList = new Uint8Array(0x58);
    sceneList[0x57] = 0;
    assert.equal(requiresSceneSpecificLaneBank(sceneList), true);

    sceneList[0x57] = 1;
    assert.equal(requiresSceneSpecificLaneBank(sceneList), false);
});

test('rejects an LST without the lane-bank selection byte', () => {
    assert.throws(() => requiresSceneSpecificLaneBank(new Uint8Array(0x57)), /lane-bank selection flag/);
});

test('recognizes missing optional banks served as a 404 or an HTML app fallback', () => {
    assert.equal(isUnavailableSceneLaneBankResponse(404, 'text/plain'), true);
    assert.equal(isUnavailableSceneLaneBankResponse(200, 'text/html; charset=utf-8'), true);
    assert.equal(isUnavailableSceneLaneBankResponse(200, 'application/octet-stream'), false);
    assert.equal(isUnavailableSceneLaneBankResponse(500, 'text/html'), false);
});

test('extracts an archived scene resource using the game filename hash and size convention', () => {
    const sceneList = new Uint8Array(0x666);
    const entryOffset = 0x4D0;
    writeWord(sceneList, entryOffset, 0x0DB3);
    writeWord(sceneList, entryOffset + 2, 0x1027);
    sceneList[entryOffset + 4] = 0x65;
    writeDword(sceneList, entryOffset + 6, 12);
    writeDword(sceneList, entryOffset + 10, 5);

    const sceneData = Uint8Array.from([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 2, 3, 4]);
    assert.deepEqual(extractSceneArchiveEntry(sceneList, sceneData, 'SCENE02P.BIN'), Uint8Array.from([1, 2, 3, 4]));
    assert.equal(extractSceneArchiveEntry(sceneList, sceneData, 'MISSING.BIN'), null);
});

test('extracts and parses the private Cape Cod lane bank embedded in SCENE02.DAT', () => {
    const sceneList = new Uint8Array(readFileSync(new URL('../public/base/SCENE02.LST', import.meta.url)));
    const sceneData = new Uint8Array(readFileSync(new URL('../public/base/SCENE02.DAT', import.meta.url)));
    const laneData = extractSceneArchiveEntry(sceneList, sceneData, 'SCENE02P.BIN');

    assert.ok(laneData);
    const lanes = parseLaneBank(laneData, PRIVATE_LANE_TILE_COUNT);
    assert.equal(lanes.length, PRIVATE_LANE_TILE_COUNT);
    assert.equal(lanes[0x3D].waypoints.length, 8);
});

