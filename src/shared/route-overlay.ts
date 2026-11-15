import type { LaneRouteStep } from './lane-routes';

export interface RouteOverlayPoint {
    readonly x: number;
    readonly y: number;
}

export function splitWrappedRoute(
    steps: readonly Pick<LaneRouteStep, 'x' | 'y'>[],
    width: number,
    height: number,
): readonly (readonly RouteOverlayPoint[])[] {
    if (steps.length === 0) return [];

    const segments: RouteOverlayPoint[][] = [];
    let segment: RouteOverlayPoint[] = [cellCenter(steps[0])];

    for (let index = 1; index < steps.length; index++) {
        const previous = steps[index - 1];
        const current = steps[index];
        const dx = current.x - previous.x;
        const dy = current.y - previous.y;

        if (Math.abs(dx) === width - 1 && dy === 0) {
            const exitsLeft = previous.x === 0;
            segment.push({ x: exitsLeft ? 0 : width, y: previous.y + 0.5 });
            segments.push(segment);
            segment = [
                { x: exitsLeft ? width : 0, y: current.y + 0.5 },
                cellCenter(current),
            ];
        } else if (Math.abs(dy) === height - 1 && dx === 0) {
            const exitsTop = previous.y === 0;
            segment.push({ x: previous.x + 0.5, y: exitsTop ? 0 : height });
            segments.push(segment);
            segment = [
                { x: current.x + 0.5, y: exitsTop ? height : 0 },
                cellCenter(current),
            ];
        } else {
            segment.push(cellCenter(current));
        }
    }

    segments.push(segment);
    return segments;
}

function cellCenter(step: Pick<LaneRouteStep, 'x' | 'y'>): RouteOverlayPoint {
    return { x: step.x + 0.5, y: step.y + 0.5 };
}
