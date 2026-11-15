import assert from 'node:assert/strict';
import test from 'node:test';
import { splitWrappedRoute } from '../src/shared/route-overlay';

test('splits a north-south map seam into boundary segments', () => {
    const segments = splitWrappedRoute([{ x: 2, y: 0 }, { x: 2, y: 15 }], 32, 16);
    assert.deepEqual(segments, [
        [{ x: 2.5, y: 0.5 }, { x: 2.5, y: 0 }],
        [{ x: 2.5, y: 16 }, { x: 2.5, y: 15.5 }],
    ]);
});

test('splits an east-west map seam into boundary segments', () => {
    const segments = splitWrappedRoute([{ x: 31, y: 4 }, { x: 0, y: 4 }], 32, 16);
    assert.deepEqual(segments, [
        [{ x: 31.5, y: 4.5 }, { x: 32, y: 4.5 }],
        [{ x: 0, y: 4.5 }, { x: 0.5, y: 4.5 }],
    ]);
});

test('keeps ordinary route steps in one segment', () => {
    assert.deepEqual(splitWrappedRoute([{ x: 2, y: 0 }, { x: 2, y: 1 }], 32, 16), [
        [{ x: 2.5, y: 0.5 }, { x: 2.5, y: 1.5 }],
    ]);
});
