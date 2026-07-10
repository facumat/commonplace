export type Pt = [number, number];

/**
 * Solid-font shape of a half stitch: the cell square with two opposite
 * corners cut off, leaving a chunky diagonal band from corner to corner.
 * Unit-cell coordinates (y down), wound clockwise on screen so the shapes
 * union with the traced full-cell outlines under nonzero fill.
 */
const HALF_HEXAGONS: Record<'/' | '\\', Pt[]> = {
  '/': [
    [0, 0.5],
    [0.5, 0],
    [1, 0],
    [1, 0.5],
    [0.5, 1],
    [0, 1],
  ],
  '\\': [
    [0, 0],
    [0.5, 0],
    [1, 0.5],
    [1, 1],
    [0.5, 1],
    [0, 0.5],
  ],
};

/** The half-stitch polygon for a given cell, in grid coordinates. */
export function halfStitchPolygon(type: '/' | '\\', col: number, row: number): Pt[] {
  return HALF_HEXAGONS[type].map(([x, y]) => [col + x, row + y]);
}
