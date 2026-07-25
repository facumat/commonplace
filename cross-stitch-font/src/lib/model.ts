/** 'x' = full cross, '/' = half stitch to the left, '\\' = half stitch to the right. */
export type StitchType = 'x' | '/' | '\\';

export const STITCH_TYPES: StitchType[] = ['x', '/', '\\'];

/** 'solid' = full black, 'muted' = 50% black. */
export type StitchShade = 'solid' | 'muted';

export const STITCH_SHADES: StitchShade[] = ['solid', 'muted'];

export interface Stitch {
  type: StitchType;
  shade: StitchShade;
}

export const makeStitch = (type: StitchType, shade: StitchShade = 'solid'): Stitch => ({
  type,
  shade,
});

export type StitchMap = Map<string, Stitch>;

export interface GlyphData {
  char: string;
  /** Stitched cells, keyed as "col,row" (row 0 = top of the grid). */
  stitches: StitchMap;
  /** Optional per-glyph advance width override, in grid cells. */
  advanceWidth?: number;
}

export interface Project {
  name: string;
  /** Stitches per em — the grid is gridSize × gridSize. */
  gridSize: number;
  metrics: GridMetrics;
  /** User-added ruler lines, drawing aids only — they don't affect the font. */
  guides: CustomGuide[];
  glyphs: Record<string, GlyphData>;
}

export interface CustomGuide {
  id: string;
  /** 'h' = horizontal line at a row, 'v' = vertical line at a column. */
  axis: 'h' | 'v';
  /** Grid line index: rows from the top / columns from the left, 0..gridSize. */
  pos: number;
}

export interface GridMetrics {
  /** Grid line (counting from the top) that glyphs sit on. */
  baselineRow: number;
  /** Descender line, in rows below the baseline. */
  descenderRows: number;
  /** x-height line, in rows above the baseline. */
  xHeightRows: number;
  /** Cap line, in rows above the baseline. */
  capHeightRows: number;
}

export const MIN_GRID_SIZE = 4;
export const MAX_GRID_SIZE = 64;

export const cellKey = (col: number, row: number) => `${col},${row}`;

export function parseKey(key: string): [number, number] {
  const i = key.indexOf(',');
  return [Number(key.slice(0, i)), Number(key.slice(i + 1))];
}

export function defaultMetrics(gridSize: number): GridMetrics {
  const descenderRows = Math.max(2, Math.round(gridSize / 4));
  const baselineRow = gridSize - descenderRows;
  const xHeightRows = Math.round(baselineRow * 0.58);
  const capHeightRows = Math.round(baselineRow * 0.85);
  return { baselineRow, descenderRows, xHeightRows, capHeightRows };
}

const clamp = (v: number, min: number, max: number) =>
  Math.min(max, Math.max(min, Math.round(v)));

/** Force metric lines into positions that make sense for the given grid. */
export function clampMetrics(metrics: GridMetrics, gridSize: number): GridMetrics {
  const baselineRow = clamp(metrics.baselineRow, 1, gridSize);
  return {
    baselineRow,
    descenderRows: clamp(metrics.descenderRows, 0, gridSize - baselineRow),
    xHeightRows: clamp(metrics.xHeightRows, 1, baselineRow),
    capHeightRows: clamp(metrics.capHeightRows, 1, baselineRow),
  };
}

export const newGuideId = () => Math.random().toString(36).slice(2, 10);

export function clampGuides(guides: CustomGuide[], gridSize: number): CustomGuide[] {
  return guides.map((g) => ({ ...g, pos: clamp(g.pos, 0, gridSize) }));
}

export function metricsEqual(a: GridMetrics, b: GridMetrics): boolean {
  return (
    a.baselineRow === b.baselineRow &&
    a.descenderRows === b.descenderRows &&
    a.xHeightRows === b.xHeightRows &&
    a.capHeightRows === b.capHeightRows
  );
}

export function inkBounds(
  stitches: StitchMap
): { minCol: number; maxCol: number; minRow: number; maxRow: number } | null {
  if (stitches.size === 0) return null;
  let minCol = Infinity,
    maxCol = -Infinity,
    minRow = Infinity,
    maxRow = -Infinity;
  for (const key of stitches.keys()) {
    const [c, r] = parseKey(key);
    if (c < minCol) minCol = c;
    if (c > maxCol) maxCol = c;
    if (r < minRow) minRow = r;
    if (r > maxRow) maxRow = r;
  }
  return { minCol, maxCol, minRow, maxRow };
}

/**
 * Advance width in grid cells. Uses the per-glyph override when set;
 * otherwise ink width as drawn plus one cell of right side bearing.
 * Empty glyphs (space) get a third of the grid.
 */
export function getAdvanceCells(glyph: GlyphData | undefined, gridSize: number): number {
  if (glyph?.advanceWidth != null && glyph.advanceWidth > 0) return glyph.advanceWidth;
  const bounds = glyph ? inkBounds(glyph.stitches) : null;
  if (!bounds) return Math.max(2, Math.round(gridSize / 3));
  return bounds.maxCol + 2;
}

export function createProject(name = 'My Stitch Font', gridSize = 16): Project {
  return { name, gridSize, metrics: defaultMetrics(gridSize), guides: [], glyphs: {} };
}

export function stitchesEqual(a: StitchMap, b: StitchMap): boolean {
  if (a.size !== b.size) return false;
  for (const [k, v] of a) {
    const o = b.get(k);
    if (!o || o.type !== v.type || o.shade !== v.shade) return false;
  }
  return true;
}
