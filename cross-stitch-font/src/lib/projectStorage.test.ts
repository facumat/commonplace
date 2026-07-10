import { describe, expect, it } from 'vitest';
import { deserializeProject, serializeProject } from './projectStorage';
import { createProject } from './model';

describe('project serialization', () => {
  it('round-trips stitch types', () => {
    const project = createProject('Test', 16);
    project.glyphs['a'] = {
      char: 'a',
      stitches: new Map([
        ['0,10', 'x'],
        ['1,10', '/'],
        ['2,10', '\\'],
      ]),
    };
    const restored = deserializeProject(serializeProject(project));
    expect([...restored.glyphs['a'].stitches]).toEqual([
      ['0,10', 'x'],
      ['1,10', '/'],
      ['2,10', '\\'],
    ]);
  });

  it('migrates legacy array-format stitches to full crosses', () => {
    const legacy = JSON.stringify({
      version: 1,
      name: 'Old',
      gridSize: 16,
      glyphs: { a: { stitches: ['0,10', '1,11'] } },
    });
    const restored = deserializeProject(legacy);
    expect([...restored.glyphs['a'].stitches]).toEqual([
      ['0,10', 'x'],
      ['1,11', 'x'],
    ]);
    // legacy files predate metrics/guides; defaults fill in
    expect(restored.metrics.baselineRow).toBe(12);
    expect(restored.guides).toEqual([]);
  });
});
