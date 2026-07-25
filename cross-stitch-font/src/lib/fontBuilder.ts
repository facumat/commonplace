import { Font, Glyph, Path } from 'opentype.js';
import type { GlyphData, GridMetrics, Project, StitchMap } from './model';
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

// CPAL palette (index order): 50% black for muted stitches & the fabric grid,
// then full black. Muted stitches render as gray, everything else full black.
const GRAY_COLOR = '#00000080';
const BLACK_COLOR = '#000000ff';
const PAL_GRAY = 0;
const PAL_BLACK = 1;

// opentype.js 2.x palette/layer managers, missing from the 1.x type defs
interface ColorFontAPI {
  palettes: { add(colors: string[]): void };
  layers: { add(glyphIndex: number, layers: { glyph: Glyph; paletteIndex: number }[]): void };
}

type Pt = [number, number];

/** A glyph's thread split by color: solid/dotted go black, muted goes gray. */
interface Ink {
  black: Path;
  gray: Path;
}

const newInk = (): Ink => ({ black: new Path(), gray: new Path() });
const inkFor = (ink: Ink, shade: string): Path => (shade === 'muted' ? ink.gray : ink.black);

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

/** Block-variant geometry (merged filled squares), split into black and gray. */
function blockInk(glyph: GlyphData, gridSize: number, metrics: GridMetrics): Ink {
  const { baselineRow } = metrics;
  const scale = UNITS_PER_EM / gridSize;
  const ink = newInk();
  const addContour = (path: Path, contour: Pt[]) => {
    contour.forEach(([gx, gy], i) => {
      const x = Math.round(gx * scale);
      const y = Math.round((baselineRow - gy) * scale);
      if (i === 0) path.moveTo(x, y);
      else path.lineTo(x, y);
    });
    path.close();
  };

  // full crosses merge into solid rectilinear outlines, per color group
  const blackFull = new Set<string>();
  const grayFull = new Set<string>();
  for (const [key, s] of glyph.stitches) {
    if (s.type !== 'x') continue;
    (s.shade === 'muted' ? grayFull : blackFull).add(key);
  }
  traceOutlines(blackFull).forEach((c) => addContour(ink.black, c));
  traceOutlines(grayFull).forEach((c) => addContour(ink.gray, c));

  // half stitches become corner-to-corner diagonal bands (same winding as the
  // traced outlines, so touching shapes union under nonzero fill)
  for (const [key, s] of glyph.stitches) {
    if (s.type === 'x') continue;
    const [c, r] = parseKey(key);
    addContour(inkFor(ink, s.shade), halfStitchPolygon(s.type, c, r));
  }
  return ink;
}

/** Build the opentype path for one glyph, in font units (y up, baseline 0). */
export function glyphToPath(glyph: GlyphData, gridSize: number, metrics: GridMetrics): Path {
  return combineInk(blockInk(glyph, gridSize, metrics));
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

/** Flatten an Ink into a single monochrome Path (fallback for non-COLR). */
function combineInk(ink: Ink): Path {
  const p = new Path();
  p.commands = [...ink.black.commands, ...ink.gray.commands];
  return p;
}

/** Draw every stitched cell as thread: X = two crossed bars, halves = one bar. */
function stitchInk(stitches: StitchMap, gridSize: number, metrics: GridMetrics): Ink {
  const { baselineRow } = metrics;
  const scale = UNITS_PER_EM / gridSize;
  const inset = X_INSET * scale;
  const t = X_THICKNESS * scale;
  const ink = newInk();
  for (const [key, s] of stitches) {
    const [c, r] = parseKey(key);
    const target = inkFor(ink, s.shade);
    const x0 = c * scale + inset;
    const x1 = (c + 1) * scale - inset;
    const yTop = (baselineRow - r) * scale - inset;
    const yBot = (baselineRow - r - 1) * scale + inset;
    if (s.type !== '\\') addBar(target, x0, yBot, x1, yTop, t); // "/" leg
    if (s.type !== '/') addBar(target, x0, yTop, x1, yBot, t); // "\" leg
  }
  return ink;
}

/**
 * Draw every stitched cell as a hollow frame: thin bars along the edges of
 * the cell square (or of the half-stitch band). Bars sit centered on the
 * edges and extend half a thickness past each corner, so neighboring cells
 * share their boundary line and corners close cleanly.
 */
function outlineInk(stitches: StitchMap, gridSize: number, metrics: GridMetrics): Ink {
  const { baselineRow } = metrics;
  const scale = UNITS_PER_EM / gridSize;
  const t = Math.max(4, OUTLINE_THICKNESS * scale);
  const ink = newInk();
  for (const [key, s] of stitches) {
    const [c, r] = parseKey(key);
    const target = inkFor(ink, s.shade);
    let poly: Pt[];
    if (s.type === 'x') {
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
      poly = halfStitchPolygon(s.type, c, r).map(([gx, gy]) => [
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
      addBar(target, ax - ux, ay - uy, bx + ux, by + uy, t);
    }
  }
  return ink;
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
  type Layer = { glyph: Glyph; paletteIndex: number };
  const layerJobs: { base: Glyph; layers: Layer[] }[] = [];

  const pushGlyph = (name: string, path: Path, advanceWidth: number, unicode?: number): Glyph => {
    const g = new Glyph({ index: glyphs.length, name, advanceWidth, path, ...(unicode != null ? { unicode } : {}) });
    glyphs.push(g);
    return g;
  };

  for (const char of GLYPH_SET) {
    const data = project.glyphs[char];
    const hasInk = data != null && data.stitches.size > 0;
    // Space is always exported; other glyphs only once drawn.
    if (!hasInk && char !== ' ') continue;
    const advanceCells = getAdvanceCells(data, gridSize);
    const advanceWidth = Math.round(advanceCells * scale);
    const name = glyphName(char);

    // thread geometry, split into black (solid/dotted) and gray (muted)
    let ink: Ink = newInk();
    if (hasInk && data) {
      if (variant === 'solid') ink = blockInk(data, gridSize, metrics);
      else if (variant === 'outline') ink = outlineInk(data.stitches, gridSize, metrics);
      else ink = stitchInk(data.stitches, gridSize, metrics); // stitch + chart
    }
    // chart draws the fabric grid (always gray) behind the thread; space too,
    // so chart text reads as one continuous band
    const gridPath = variant === 'chart' ? new Path() : null;
    if (gridPath) addFabricGrid(gridPath, advanceCells, gridSize, metrics);

    // base glyph = everything, monochrome — the fallback for non-COLR renderers
    const basePath = new Path();
    basePath.commands = [
      ...(gridPath?.commands ?? []),
      ...ink.black.commands,
      ...ink.gray.commands,
    ];
    const base = pushGlyph(name, basePath, advanceWidth, char.codePointAt(0)!);

    // color layers: needed for the chart grid, or whenever muted stitches exist
    const hasGray = ink.gray.commands.length > 0;
    const hasBlack = ink.black.commands.length > 0;
    if (variant === 'chart' || hasGray) {
      const layers: Layer[] = [];
      if (gridPath && gridPath.commands.length > 0) {
        layers.push({ glyph: pushGlyph(`${name}.grid`, gridPath, advanceWidth), paletteIndex: PAL_GRAY });
      }
      if (hasGray) {
        layers.push({ glyph: pushGlyph(`${name}.mute`, ink.gray, advanceWidth), paletteIndex: PAL_GRAY });
      }
      if (hasBlack) {
        layers.push({ glyph: pushGlyph(`${name}.ink`, ink.black, advanceWidth), paletteIndex: PAL_BLACK });
      }
      if (layers.length > 0) layerJobs.push({ base, layers });
    }
  }

  const baseName = familyName || project.name || 'My Stitch Font';
  // The style shown within the family (Light / Bold-style slot).
  const styleLabel =
    variant === 'stitch'
      ? 'Cross'
      : variant === 'chart'
        ? 'Cross Grid'
        : variant === 'outline'
          ? 'Outline'
          : 'Block';
  // nameID 1 (legacy family) must stay unique per style so PostScript names
  // don't collide and old RIBBI-only apps don't overwrite each other.
  const legacyFamily = variant === 'solid' ? baseName : `${baseName} ${styleLabel}`;

  const font = new Font({
    familyName: legacyFamily,
    styleName: 'Regular',
    unitsPerEm: UNITS_PER_EM,
    ascender: Math.round(baselineRow * scale),
    descender: -Math.round(descenderRows * scale),
    glyphs,
  });

  // nameID 16/17 (typographic family + subfamily): all four variants share the
  // same family and differ only by subfamily, so modern font menus list them
  // as one family with four styles instead of four separate families.
  type NameTable = Record<'unicode' | 'macintosh' | 'windows', Record<string, { en: string }>>;
  const names = font.names as unknown as NameTable;
  for (const plat of ['unicode', 'macintosh', 'windows'] as const) {
    if (!names[plat]) continue;
    names[plat].preferredFamily = { en: baseName };
    names[plat].preferredSubfamily = { en: styleLabel };
  }

  if (layerJobs.length > 0) {
    // CPAL palette: 50% black (muted / fabric grid), then full black
    const colorFont = font as unknown as ColorFontAPI;
    colorFont.palettes.add([GRAY_COLOR, BLACK_COLOR]);
    for (const { base, layers } of layerJobs) colorFont.layers.add(base.index, layers);
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
