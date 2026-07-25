import { describe, expect, it } from 'vitest';
import { deserializeProject, serializeProject } from './projectStorage';
import type { Stitch } from './model';
import { createProject, makeStitch } from './model';

describe('project serialization', () => {
  it('round-trips stitch types and shades', () => {
    const project = createProject('Test', 16);
    project.glyphs['a'] = {
      char: 'a',
      stitches: new Map<string, Stitch>([
        ['0,10', makeStitch('x')],
        ['1,10', makeStitch('/', 'muted')],
        ['2,10', makeStitch('\\')],
        ['3,10', makeStitch('x', 'muted')],
      ]),
    };
    const restored = deserializeProject(serializeProject(project));
    expect([...restored.glyphs['a'].stitches]).toEqual([
      ['0,10', makeStitch('x')],
      ['1,10', makeStitch('/', 'muted')],
      ['2,10', makeStitch('\\')],
      ['3,10', makeStitch('x', 'muted')],
    ]);
  });

  it('serializes solid stitches compactly as bare type strings', () => {
    const project = createProject('Test', 16);
    project.glyphs['a'] = {
      char: 'a',
      stitches: new Map<string, Stitch>([
        ['0,10', makeStitch('x')],
        ['1,10', makeStitch('x', 'muted')],
      ]),
    };
    const json = JSON.parse(serializeProject(project));
    expect(json.glyphs.a.stitches['0,10']).toBe('x'); // solid → bare string
    expect(json.glyphs.a.stitches['1,10']).toEqual({ t: 'x', s: 'muted' }); // shaded → object
  });

  it('migrates legacy array-format stitches to solid full crosses', () => {
    const legacy = JSON.stringify({
      version: 1,
      name: 'Old',
      gridSize: 16,
      glyphs: { a: { stitches: ['0,10', '1,11'] } },
    });
    const restored = deserializeProject(legacy);
    expect([...restored.glyphs['a'].stitches]).toEqual([
      ['0,10', makeStitch('x')],
      ['1,11', makeStitch('x')],
    ]);
    // legacy files predate metrics/guides; defaults fill in
    expect(restored.metrics.baselineRow).toBe(12);
    expect(restored.guides).toEqual([]);
  });

  it('migrates the string-map format (types without shades) to solid', () => {
    const older = JSON.stringify({
      version: 1,
      name: 'Older',
      gridSize: 16,
      glyphs: { a: { stitches: { '0,10': 'x', '1,10': '/' } } },
    });
    const restored = deserializeProject(older);
    expect([...restored.glyphs['a'].stitches]).toEqual([
      ['0,10', makeStitch('x')],
      ['1,10', makeStitch('/')],
    ]);
  });
});
