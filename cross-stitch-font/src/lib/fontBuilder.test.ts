import { describe, expect, it } from 'vitest';
import { parse } from 'opentype.js';
import { buildFont, glyphToPath, traceOutlines, UNITS_PER_EM } from './fontBuilder';
import type { StitchType } from './model';
import { createProject, defaultMetrics } from './model';

/** Cell keys for the outline tracer (full crosses only). */
const stitchSet = (...keys: string[]) => new Set(keys);
/** Glyph stitches: keys become full crosses unless written as "key=type". */
const stitchMap = (...keys: string[]): Map<string, StitchType> =>
  new Map(
    keys.map((k) => {
      const [key, type] = k.split('=');
      return [key, (type ?? 'x') as StitchType];
    })
  );

/** opentype.js 2.x nests names per platform; the 1.x type defs don't know. */
const familyOf = (font: { names: unknown }) =>
  (font.names as { windows: { fontFamily: { en: string } } }).windows.fontFamily.en;

/** Sort contours and normalize rotation so comparisons ignore start point. */
function normalize(contours: [number, number][][]): string[] {
  return contours
    .map((contour) => {
      const strs = contour.map(([x, y]) => `${x},${y}`);
      // rotate so lexicographically smallest point comes first
      let minIdx = 0;
      for (let i = 1; i < strs.length; i++) if (strs[i] < strs[minIdx]) minIdx = i;
      return [...strs.slice(minIdx), ...strs.slice(0, minIdx)].join(' ');
    })
    .sort();
}

describe('traceOutlines', () => {
  it('traces a single cell as one square', () => {
    const contours = traceOutlines(stitchSet('0,0'));
    expect(normalize(contours)).toEqual(['0,0 1,0 1,1 0,1']);
  });

  it('merges a 2x1 horizontal domino into one rectangle', () => {
    const contours = traceOutlines(stitchSet('0,0', '1,0'));
    expect(normalize(contours)).toEqual(['0,0 2,0 2,1 0,1']);
  });

  it('merges a 2x2 block into one square', () => {
    const contours = traceOutlines(stitchSet('0,0', '1,0', '0,1', '1,1'));
    expect(normalize(contours)).toEqual(['0,0 2,0 2,2 0,2']);
  });

  it('produces an L shape with six corners', () => {
    const contours = traceOutlines(stitchSet('0,0', '0,1', '1,1'));
    expect(contours).toHaveLength(1);
    expect(contours[0]).toHaveLength(6);
  });

  it('keeps separate cells as separate contours', () => {
    const contours = traceOutlines(stitchSet('0,0', '2,0'));
    expect(contours).toHaveLength(2);
  });

  it('keeps diagonally touching cells as two non-crossing contours', () => {
    const contours = traceOutlines(stitchSet('0,0', '1,1'));
    expect(normalize(contours)).toEqual(['0,0 1,0 1,1 0,1', '1,1 2,1 2,2 1,2']);
  });

  it('produces an inner hole contour for a ring', () => {
    // 3x3 block with the center missing
    const ring = stitchSet('0,0', '1,0', '2,0', '0,1', '2,1', '0,2', '1,2', '2,2');
    const contours = traceOutlines(ring);
    expect(contours).toHaveLength(2);
    const areas = contours.map(signedArea).sort((a, b) => a - b);
    // outer 9 cells minus... outer contour area 9, hole area 1, opposite signs
    expect(areas).toEqual([-1, 9].sort((a, b) => a - b));
  });
});

/** Shoelace formula; sign encodes winding direction. */
function signedArea(contour: [number, number][]): number {
  let sum = 0;
  for (let i = 0; i < contour.length; i++) {
    const [x1, y1] = contour[i];
    const [x2, y2] = contour[(i + 1) % contour.length];
    sum += x1 * y2 - x2 * y1;
  }
  return sum / 2;
}

describe('glyphToPath', () => {
  it('maps grid coordinates to font units with baseline at y=0', () => {
    const gridSize = 16;
    const metrics = defaultMetrics(gridSize);
    const { baselineRow } = metrics; // 12 for a 16 grid
    const scale = UNITS_PER_EM / gridSize;
    // one stitch sitting directly on the baseline
    const path = glyphToPath(
      { char: 'x', stitches: stitchMap(`0,${baselineRow - 1}`) },
      gridSize,
      metrics
    );
    const box = path.getBoundingBox();
    expect(box.y1).toBe(0); // bottom sits on the baseline
    expect(box.y2).toBe(Math.round(scale)); // one cell tall
    expect(box.x2).toBe(Math.round(scale)); // one cell wide
  });

  it('renders half stitches as six-cornered diagonal bands', () => {
    const gridSize = 16;
    const metrics = defaultMetrics(gridSize);
    const scale = UNITS_PER_EM / gridSize;
    for (const type of ['/', '\\'] as const) {
      const path = glyphToPath(
        { char: 'x', stitches: stitchMap(`0,11=${type}`) },
        gridSize,
        metrics
      );
      const moves = path.commands.filter((c) => c.type === 'M');
      const lines = path.commands.filter((c) => c.type === 'L');
      expect(moves).toHaveLength(1);
      expect(lines).toHaveLength(5); // hexagon
      // still fills the whole cell's bounding box
      const box = path.getBoundingBox();
      expect(box.y1).toBe(0);
      expect(box.y2).toBe(Math.round(scale));
    }
  });

  it('mixes full and half stitches in one glyph', () => {
    const gridSize = 16;
    const path = glyphToPath(
      { char: 'x', stitches: stitchMap('0,11', '1,10=/') },
      gridSize,
      defaultMetrics(gridSize)
    );
    const moves = path.commands.filter((c) => c.type === 'M');
    expect(moves).toHaveLength(2); // one square + one hexagon
  });
});

describe('buildFont', () => {
  it('builds a parseable TTF with the drawn glyphs', () => {
    const project = createProject('Test Stitch', 16);
    project.glyphs['A'] = {
      char: 'A',
      stitches: stitchMap('0,8', '1,8', '2,8', '0,9', '2,9', '0,10', '1,10', '2,10', '0,11', '2,11'),
    };
    const font = buildFont(project);
    const buffer = font.toArrayBuffer();
    const parsed = parse(buffer);

    expect(parsed.unitsPerEm).toBe(UNITS_PER_EM);
    const glyphA = parsed.charToGlyph('A');
    expect(glyphA.name).toBe('A');
    expect(glyphA.advanceWidth).toBe(Math.round((2 + 2) * (UNITS_PER_EM / 16)));
    const box = glyphA.getPath(0, 0, UNITS_PER_EM).getBoundingBox();
    expect(box.x2 - box.x1).toBeGreaterThan(0);

    // space is always exported even when not drawn
    const space = parsed.charToGlyph(' ');
    expect(space.advanceWidth).toBeGreaterThan(0);
  });

  it('stitch variant draws two crossed bars per cell', () => {
    const project = createProject('Test Stitch', 16);
    project.glyphs['o'] = { char: 'o', stitches: stitchMap('0,10', '1,11') };
    const font = buildFont(project, 'stitch');
    const path = font.charToGlyph('o').path;
    // one contour per bar, two bars per stitch
    const moves = path.commands.filter((c) => c.type === 'M');
    expect(moves).toHaveLength(4);
    expect(familyOf(font)).toBe('Test Stitch Stitch');
  });

  it('stitch variant draws a single bar for half stitches', () => {
    const project = createProject('Test Stitch', 16);
    project.glyphs['o'] = { char: 'o', stitches: stitchMap('0,10=/', '1,11=\\') };
    const font = buildFont(project, 'stitch');
    const moves = font.charToGlyph('o').path.commands.filter((c) => c.type === 'M');
    expect(moves).toHaveLength(2); // one bar per half stitch
  });

  it('chart variant adds the fabric grid, even to the space', () => {
    const gridSize = 16;
    const project = createProject('Test Stitch', gridSize);
    project.glyphs['o'] = { char: 'o', stitches: stitchMap('0,10') };
    const font = buildFont(project, 'chart');
    expect(familyOf(font)).toBe('Test Stitch Chart');

    const { baselineRow, descenderRows } = project.metrics;
    const scale = UNITS_PER_EM / gridSize;
    // grid spans the full em height: ascender down to descender (± line width)
    const box = font.charToGlyph('o').path.getBoundingBox();
    expect(box.y2).toBeGreaterThanOrEqual(baselineRow * scale);
    expect(box.y1).toBeLessThanOrEqual(-descenderRows * scale);

    const space = font.charToGlyph(' ');
    expect(space.path.commands.length).toBeGreaterThan(0);
  });

  it('solid stays the default variant', () => {
    const project = createProject('Test Stitch', 16);
    project.glyphs['o'] = { char: 'o', stitches: stitchMap('0,10') };
    const font = buildFont(project);
    expect(familyOf(font)).toBe('Test Stitch');
    // a single solid cell is one square contour
    const moves = font.charToGlyph('o').path.commands.filter((c) => c.type === 'M');
    expect(moves).toHaveLength(1);
  });

  it('chart variant is a COLR color font: gray grid layer under black crosses', () => {
    const project = createProject('Test Stitch', 16);
    project.glyphs['o'] = { char: 'o', stitches: stitchMap('0,10') };
    const font = buildFont(project, 'chart');
    const parsed = parse(font.toArrayBuffer());

    // palette: 50% black for the fabric, full black for the crosses
    expect(parsed.tables.cpal.colorRecords).toEqual([0x00000080, 0x000000ff]);

    type LayerAPI = {
      layers: { get(i: number): { glyph: { name: string }; paletteIndex: number }[] };
    };
    const layered = parsed as unknown as LayerAPI;
    const oLayers = layered.layers.get(parsed.charToGlyphIndex('o'));
    expect(oLayers.map((l) => [l.glyph.name, l.paletteIndex])).toEqual([
      ['o.grid', 0],
      ['o.cross', 1],
    ]);
    // the space has a fabric layer only
    const spaceLayers = layered.layers.get(parsed.charToGlyphIndex(' '));
    expect(spaceLayers.map((l) => [l.glyph.name, l.paletteIndex])).toEqual([['space.grid', 0]]);
    // fallback outline (for non-COLR renderers) still carries everything
    expect(parsed.charToGlyph('o').path.commands.length).toBeGreaterThan(0);
  });

  it('exports Spanish characters with proper names and unicodes', () => {
    const project = createProject('Test Stitch', 16);
    project.glyphs['ñ'] = { char: 'ñ', stitches: stitchMap('0,10') };
    project.glyphs['¿'] = { char: '¿', stitches: stitchMap('0,10', '0,11') };
    project.glyphs['Á'] = { char: 'Á', stitches: stitchMap('1,3') };
    const parsed = parse(buildFont(project).toArrayBuffer());
    expect(parsed.charToGlyph('ñ').name).toBe('ntilde');
    expect(parsed.charToGlyph('¿').name).toBe('questiondown');
    expect(parsed.charToGlyph('Á').name).toBe('Aacute');
    expect(parsed.charToGlyph('ñ').unicode).toBe(0xf1);
  });

  it('uses the project’s custom metrics for baseline and vertical metrics', () => {
    const gridSize = 16;
    const scale = UNITS_PER_EM / gridSize;
    const project = createProject('Test Stitch', gridSize);
    project.metrics = { baselineRow: 10, descenderRows: 3, xHeightRows: 5, capHeightRows: 8 };
    // a stitch sitting on the custom baseline
    project.glyphs['n'] = { char: 'n', stitches: stitchMap('0,9') };
    const font = buildFont(project);
    expect(font.ascender).toBe(Math.round(10 * scale));
    expect(font.descender).toBe(-Math.round(3 * scale));
    const box = font.charToGlyph('n').path.getBoundingBox();
    expect(box.y1).toBe(0);
  });

  it('respects per-glyph advance overrides', () => {
    const project = createProject('Test Stitch', 16);
    project.glyphs['i'] = { char: 'i', stitches: stitchMap('0,8'), advanceWidth: 3 };
    const font = buildFont(project);
    const glyph = font.charToGlyph('i');
    expect(glyph.advanceWidth).toBe(Math.round(3 * (UNITS_PER_EM / 16)));
  });
});
