import { Font, Glyph, Path } from 'opentype.js';
import type { GlyphData, GridMetrics, Project, StitchType } from './model';
import { defaultMetrics, getAdvanceCells, parseKey } from './model';
import { GLYPH_SET, glyphName } from './glyphSet';
import { halfStitchPolygon } from './stitchShapes';

export const UNITS_PER_EM = 1000;

/**
 * solid   — merged squares, the "real" font
 * stitch  — every cell drawn as an X cross
 * chart   — X crosses plus the underlying fabric grid
 * outline — every cell drawn as a hollow square frame
 */
export type FontVariant = 'solid' | 'stitch' | 'chart' | 'outline';

// X-cross proportions, as fractions of one cell
const X_INSET = 0.15;
const X_THICKNESS = 0.28;
// fabric grid line thickness in font units
const GRID_LINE_UNITS = 4;
// outline variant frame thickness, as a fraction of one cell
const OUTLINE_THICKNESS = 0.08;

// chart variant colors (CPAL palette): fabric at 50% black, crosses full black
const CHART_GRID_COLOR = '#00000080';
const CHART_INK_COLOR = '#000000ff';

// opentype.js 2.x palette/layer managers, missing from the 1.x type defs
interface ColorFontAPI {
  palettes: { add(colors: string[]): void };
  layers: { add(glyphIndex: number, layers: { glyph: Glyph; paletteIndex: number }[]): void };
}

type Pt = [number, number];

const ptKey = (p: Pt) => `${p[0]},${p[1]}`;

/**
 * Convert a set of on-cells into closed rectilinear contours (in grid
 * coordinates, y down). Adjacent cells merge into a single outline via edge
 * cancellation: every boundary edge of every on-cell is emitted directed so
 * the filled area sits on its right (clockwise on screen); edges shared by
 * two on-cells cancel out, and the survivors are chained into contours.
 * Holes come out wound the opposite way, which is what nonzero fill needs.
 */
export function traceOutlines(stitches: Set<string>): Pt[][] {
  const on = (c: number, r: number) => stitches.has(`${c},${r}`);
  const edges = new Map<string, Pt[]>();
  const addEdge = (from: Pt, to: Pt) => {
    const k = ptKey(from);
    const list = edges.get(k);
    if (list) list.push(to);
    else edges.set(k, [to]);
  };

  for (const key of stitches) {
    const [c, r] = parseKey(key);
    if (!on(c, r - 1)) addEdge([c, r], [c + 1, r]); // top
    if (!on(c + 1, r)) addEdge([c + 1, r], [c + 1, r + 1]); // right
    if (!on(c, r + 1)) addEdge([c + 1, r + 1], [c, r + 1]); // bottom
    if (!on(c - 1, r)) addEdge([c, r + 1], [c, r]); // left
  }

  const takeEdge = (from: Pt, prevDir: Pt | null): Pt | null => {
    const k = ptKey(from);
    const outs = edges.get(k);
    if (!outs || outs.length === 0) return null;
    let pick = 0;
    if (outs.length > 1 && prevDir) {
      // At a point where contours touch diagonally, prefer the sharpest
      // right turn so each contour stays simple instead of crossing itself.
      const [dx, dy] = prevDir;
      const preferred: Pt[] = [
        [-dy, dx], // right turn (clockwise, y-down)
        [dx, dy], // straight
        [dy, -dx], // left turn
      ];
      outer: for (const want of preferred) {
        for (let i = 0; i < outs.length; i++) {
          const d: Pt = [
            Math.sign(outs[i][0] - from[0]),
            Math.sign(outs[i][1] - from[1]),
          ];
          if (d[0] === want[0] && d[1] === want[1]) {
            pick = i;
            break outer;
          }
        }
      }
    }
    const to = outs[pick];
    outs.splice(pick, 1);
    if (outs.length === 0) edges.delete(k);
    return to;
  };

  const contours: Pt[][] = [];
  while (edges.size > 0) {
    const startKey: string = edges.keys().next().value!;
    const start = parseKey(startKey) as Pt;
    const contour: Pt[] = [start];
    let current = start;
    let dir: Pt | null = null;
    for (;;) {
      const next = takeEdge(current, dir);
      if (!next) break; // shouldn't happen with well-formed edge sets
      dir = [Math.sign(next[0] - current[0]), Math.sign(next[1] - current[1])];
      current = next;
      if (ptKey(current) === startKey) break;
      contour.push(current);
    }
    contours.push(simplifyContour(contour));
  }
  return contours;
}

/** Drop points that sit on a straight line between their neighbors. */
function simplifyContour(points: Pt[]): Pt[] {
  if (points.length <= 4) return points;
  const out: Pt[] = [];
  const n = points.length;
  for (let i = 0; i < n; i++) {
    const prev = points[(i - 1 + n) % n];
    const cur = points[i];
    const next = points[(i + 1) % n];
    const collinear =
      (prev[0] === cur[0] && cur[0] === next[0]) ||
      (prev[1] === cur[1] && cur[1] === next[1]);
    if (!collinear) out.push(cur);
  }
  return out;
}

/** Build the opentype path for one glyph, in font units (y up, baseline 0). */
export function glyphToPath(glyph: GlyphData, gridSize: number, metrics: GridMetrics): Path {
  const { baselineRow } = metrics;
  const scale = UNITS_PER_EM / gridSize;
  const path = new Path();
  const addContour = (contour: Pt[]) => {
    contour.forEach(([gx, gy], i) => {
      const x = Math.round(gx * scale);
      const y = Math.round((baselineRow - gy) * scale);
      if (i === 0) path.moveTo(x, y);
      else path.lineTo(x, y);
    });
    path.close();
  };

  // full crosses merge into solid rectilinear outlines
  const fullCells = new Set<string>();
  for (const [key, type] of glyph.stitches) if (type === 'x') fullCells.add(key);
  traceOutlines(fullCells).forEach(addContour);

  // half stitches become corner-to-corner diagonal bands (same winding as the
  // traced outlines, so touching shapes union under nonzero fill)
  for (const [key, type] of glyph.stitches) {
    if (type === 'x') continue;
    const [c, r] = parseKey(key);
    addContour(halfStitchPolygon(type, c, r));
  }
  return path;
}

/**
 * All quads are emitted clockwise (in y-up font coordinates) so overlapping
 * shapes union under nonzero fill instead of cancelling into holes.
 */
function addQuad(path: Path, points: Pt[]): void {
  points.forEach(([x, y], i) => {
    if (i === 0) path.moveTo(Math.round(x), Math.round(y));
    else path.lineTo(Math.round(x), Math.round(y));
  });
  path.close();
}

/** Axis-aligned rectangle, clockwise. */
function addRect(path: Path, x0: number, y0: number, x1: number, y1: number): void {
  addQuad(path, [
    [x0, y1],
    [x1, y1],
    [x1, y0],
    [x0, y0],
  ]);
}

/** A straight bar of the given thickness from (ax,ay) to (bx,by), clockwise. */
function addBar(path: Path, ax: number, ay: number, bx: number, by: number, t: number): void {
  const len = Math.hypot(bx - ax, by - ay);
  if (len === 0) return;
  const px = (-(by - ay) / len) * (t / 2);
  const py = ((bx - ax) / len) * (t / 2);
  addQuad(path, [
    [ax + px, ay + py],
    [bx + px, by + py],
    [bx - px, by - py],
    [ax - px, ay - py],
  ]);
}

/** Draw every stitched cell as thread: X = two crossed bars, halves = one bar. */
function addStitchCrosses(
  path: Path,
  stitches: Map<string, StitchType>,
  gridSize: number,
  metrics: GridMetrics
): void {
  const { baselineRow } = metrics;
  const scale = UNITS_PER_EM / gridSize;
  const inset = X_INSET * scale;
  const t = X_THICKNESS * scale;
  for (const [key, type] of stitches) {
    const [c, r] = parseKey(key);
    const x0 = c * scale + inset;
    const x1 = (c + 1) * scale - inset;
    const yTop = (baselineRow - r) * scale - inset;
    const yBot = (baselineRow - r - 1) * scale + inset;
    if (type !== '\\') addBar(path, x0, yBot, x1, yTop, t); // "/" leg
    if (type !== '/') addBar(path, x0, yTop, x1, yBot, t); // "\" leg
  }
}

/**
 * Draw every stitched cell as a hollow frame: thin bars along the edges of
 * the cell square (or of the half-stitch band). Bars sit centered on the
 * edges and extend half a thickness past each corner, so neighboring cells
 * share their boundary line and corners close cleanly.
 */
function addOutlinedCells(
  path: Path,
  stitches: Map<string, StitchType>,
  gridSize: number,
  metrics: GridMetrics
): void {
  const { baselineRow } = metrics;
  const scale = UNITS_PER_EM / gridSize;
  const t = Math.max(4, OUTLINE_THICKNESS * scale);
  for (const [key, type] of stitches) {
    const [c, r] = parseKey(key);
    let poly: Pt[];
    if (type === 'x') {
      const x0 = c * scale;
      const x1 = (c + 1) * scale;
      const yTop = (baselineRow - r) * scale;
      const yBot = (baselineRow - r - 1) * scale;
      poly = [
        [x0, yTop],
        [x1, yTop],
        [x1, yBot],
        [x0, yBot],
      ];
    } else {
      poly = halfStitchPolygon(type, c, r).map(([gx, gy]) => [
        gx * scale,
        (baselineRow - gy) * scale,
      ]);
    }
    for (let i = 0; i < poly.length; i++) {
      const [ax, ay] = poly[i];
      const [bx, by] = poly[(i + 1) % poly.length];
      const len = Math.hypot(bx - ax, by - ay);
      const ux = ((bx - ax) / len) * (t / 2);
      const uy = ((by - ay) / len) * (t / 2);
      addBar(path, ax - ux, ay - uy, bx + ux, by + uy, t);
    }
  }
}

/**
 * The fabric grid behind a glyph: horizontal lines on every row across the
 * full advance width, vertical lines on every column. The right-edge column
 * is skipped and the left edge straddles x=0, so adjacent glyphs share their
 * boundary line and text sets as one continuous band of fabric.
 */
function addFabricGrid(
  path: Path,
  advanceCells: number,
  gridSize: number,
  metrics: GridMetrics
): void {
  const { baselineRow } = metrics;
  const scale = UNITS_PER_EM / gridSize;
  const g = GRID_LINE_UNITS;
  const advance = advanceCells * scale;
  const yTop = baselineRow * scale;
  const yBot = (baselineRow - gridSize) * scale;
  for (let row = 0; row <= gridSize; row++) {
    const y = (baselineRow - row) * scale;
    addRect(path, 0, y - g / 2, advance, y + g / 2);
  }
  for (let col = 0; col < advanceCells; col++) {
    const x = col * scale;
    addRect(path, x - g / 2, yBot, x + g / 2, yTop);
  }
}

export function buildFont(
  project: Project,
  variant: FontVariant = 'solid',
  familyName?: string
): Font {
  const { gridSize } = project;
  const metrics = project.metrics ?? defaultMetrics(gridSize);
  const { baselineRow, descenderRows } = metrics;
  const scale = UNITS_PER_EM / gridSize;

  const notdef = new Glyph({
    index: 0,
    name: '.notdef',
    unicode: 0,
    advanceWidth: Math.round(UNITS_PER_EM / 2),
    path: new Path(),
  });

  // Explicit indices are required: constructed fonts never assign glyph.index,
  // and the COLR layer records below are written from it.
  const glyphs: Glyph[] = [notdef];
  const layerJobs: { base: Glyph; grid: Glyph; cross: Glyph | null }[] = [];

  for (const char of GLYPH_SET) {
    const data = project.glyphs[char];
    const hasInk = data != null && data.stitches.size > 0;
    // Space is always exported; other glyphs only once drawn.
    if (!hasInk && char !== ' ') continue;
    const advanceCells = getAdvanceCells(data, gridSize);
    const advanceWidth = Math.round(advanceCells * scale);

    let path = new Path();
    let gridPath: Path | null = null;
    let crossPath: Path | null = null;
    if (variant === 'solid') {
      if (hasInk) path = glyphToPath(data, gridSize, metrics);
    } else if (variant === 'stitch') {
      if (hasInk) addStitchCrosses(path, data.stitches, gridSize, metrics);
    } else if (variant === 'outline') {
      if (hasInk) addOutlinedCells(path, data.stitches, gridSize, metrics);
    } else {
      // the space gets fabric too, so chart text reads as one continuous band
      gridPath = new Path();
      addFabricGrid(gridPath, advanceCells, gridSize, metrics);
      if (hasInk) {
        crossPath = new Path();
        addStitchCrosses(crossPath, data.stitches, gridSize, metrics);
      }
      // base glyph carries everything as the fallback for non-COLR renderers
      path.commands = [...gridPath.commands, ...(crossPath?.commands ?? [])];
    }

    const base = new Glyph({
      index: glyphs.length,
      name: glyphName(char),
      unicode: char.codePointAt(0)!,
      advanceWidth,
      path,
    });
    glyphs.push(base);

    if (gridPath) {
      const grid = new Glyph({
        index: glyphs.length,
        name: `${glyphName(char)}.grid`,
        advanceWidth,
        path: gridPath,
      });
      glyphs.push(grid);
      let cross: Glyph | null = null;
      if (crossPath) {
        cross = new Glyph({
          index: glyphs.length,
          name: `${glyphName(char)}.cross`,
          advanceWidth,
          path: crossPath,
        });
        glyphs.push(cross);
      }
      layerJobs.push({ base, grid, cross });
    }
  }

  const baseName = familyName || project.name || 'My Stitch Font';
  const suffix =
    variant === 'stitch'
      ? ' Stitch'
      : variant === 'chart'
        ? ' Chart'
        : variant === 'outline'
          ? ' Outline'
          : '';

  const font = new Font({
    familyName: baseName + suffix,
    styleName: 'Regular',
    unitsPerEm: UNITS_PER_EM,
    ascender: Math.round(baselineRow * scale),
    descender: -Math.round(descenderRows * scale),
    glyphs,
  });

  if (layerJobs.length > 0) {
    // COLR/CPAL color layers: fabric grid at 50% black under full-black crosses
    const colorFont = font as unknown as ColorFontAPI;
    colorFont.palettes.add([CHART_GRID_COLOR, CHART_INK_COLOR]);
    for (const { base, grid, cross } of layerJobs) {
      const layers = [{ glyph: grid, paletteIndex: 0 }];
      if (cross) layers.push({ glyph: cross, paletteIndex: 1 });
      colorFont.layers.add(base.index, layers);
    }
  }

  return font;
}

export function downloadFont(font: Font, filename: string): void {
  const buffer = font.toArrayBuffer();
  const blob = new Blob([buffer], { type: 'font/ttf' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
