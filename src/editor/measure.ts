// Measure tool state: a start/end pair in document space. The canvas view
// draws it with DOM elements (line, endpoint dots, distance label), so the
// graphics stay screen-sized and crisp at any zoom level.

export interface Measurement {
    startX: number;
    startY: number;
    endX: number;
    endY: number;
}

let measurement: Measurement | null = null;
let measuring = false;

export function beginMeasure(x: number, y: number): void {
    measurement = { startX: x, startY: y, endX: x, endY: y };
    measuring = true;
}

export function updateMeasure(x: number, y: number, snap = false): void {
    if (!measuring || !measurement) {
        return;
    }
    if (snap) {
        // Shift: constrain the line to 45° increments from the start point,
        // keeping the pointer's projection onto the snapped direction.
        const dx = x - measurement.startX;
        const dy = y - measurement.startY;
        if (dx !== 0 || dy !== 0) {
            const step = Math.PI / 4;
            const angle = Math.round(Math.atan2(dy, dx) / step) * step;
            const cos = Math.cos(angle);
            const sin = Math.sin(angle);
            const along = dx * cos + dy * sin;
            x = measurement.startX + cos * along;
            y = measurement.startY + sin * along;
        }
    }
    measurement.endX = x;
    measurement.endY = y;
}

export function endMeasure(): void {
    measuring = false;
}

export function isMeasuring(): boolean {
    return measuring;
}

export function getMeasurement(): Measurement | null {
    return measurement;
}

// Clears the measurement; returns true when there was one.
export function clearMeasurement(): boolean {
    const had = measurement !== null;
    measurement = null;
    measuring = false;
    return had;
}

export function measurementDistance(measurement: Measurement): number {
    return Math.round(Math.hypot(measurement.endX - measurement.startX, measurement.endY - measurement.startY));
}
