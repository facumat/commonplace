import type { CustomGuide, GlyphData, GridMetrics, Project, StitchType } from './model';
import {
  STITCH_TYPES,
  clampGuides,
  clampMetrics,
  createProject,
  defaultMetrics,
  newGuideId,
} from './model';

const STORAGE_KEY = 'cross-stitch-font-project-v1';

interface ProjectJSON {
  version: 1;
  name: string;
  gridSize: number;
  metrics?: GridMetrics;
  guides?: CustomGuide[];
  /** stitches: legacy files store an array of keys (all full crosses), newer ones a key→type map */
  glyphs: Record<
    string,
    { stitches: string[] | Record<string, StitchType>; advanceWidth?: number }
  >;
}

function parseStitches(raw: unknown): Map<string, StitchType> {
  const map = new Map<string, StitchType>();
  if (Array.isArray(raw)) {
    // legacy format: plain list of keys, everything is a full cross
    for (const key of raw) if (typeof key === 'string') map.set(key, 'x');
  } else if (raw && typeof raw === 'object') {
    for (const [key, type] of Object.entries(raw)) {
      map.set(key, STITCH_TYPES.includes(type as StitchType) ? (type as StitchType) : 'x');
    }
  }
  return map;
}

function parseGuides(guides: unknown, gridSize: number): CustomGuide[] {
  if (!Array.isArray(guides)) return [];
  const valid = guides.filter(
    (g): g is CustomGuide =>
      g != null &&
      typeof g === 'object' &&
      ((g as CustomGuide).axis === 'h' || (g as CustomGuide).axis === 'v') &&
      typeof (g as CustomGuide).pos === 'number'
  );
  return clampGuides(
    valid.map((g) => ({ ...g, id: typeof g.id === 'string' ? g.id : newGuideId() })),
    gridSize
  );
}

function isMetrics(m: unknown): m is GridMetrics {
  if (!m || typeof m !== 'object') return false;
  const o = m as Record<string, unknown>;
  return (
    typeof o.baselineRow === 'number' &&
    typeof o.descenderRows === 'number' &&
    typeof o.xHeightRows === 'number' &&
    typeof o.capHeightRows === 'number'
  );
}

export function serializeProject(project: Project): string {
  const glyphs: ProjectJSON['glyphs'] = {};
  for (const [char, g] of Object.entries(project.glyphs)) {
    if (g.stitches.size === 0 && g.advanceWidth == null) continue;
    glyphs[char] = {
      stitches: Object.fromEntries(g.stitches),
      ...(g.advanceWidth != null ? { advanceWidth: g.advanceWidth } : {}),
    };
  }
  const data: ProjectJSON = {
    version: 1,
    name: project.name,
    gridSize: project.gridSize,
    metrics: project.metrics,
    guides: project.guides,
    glyphs,
  };
  return JSON.stringify(data, null, 2);
}

export function deserializeProject(json: string): Project {
  const data = JSON.parse(json) as ProjectJSON;
  if (!data || typeof data !== 'object' || typeof data.gridSize !== 'number') {
    throw new Error('Not a valid cross-stitch font project file.');
  }
  const glyphs: Record<string, GlyphData> = {};
  for (const [char, g] of Object.entries(data.glyphs ?? {})) {
    glyphs[char] = {
      char,
      stitches: parseStitches(g.stitches),
      ...(typeof g.advanceWidth === 'number' ? { advanceWidth: g.advanceWidth } : {}),
    };
  }
  return {
    name: typeof data.name === 'string' ? data.name : 'My Stitch Font',
    gridSize: data.gridSize,
    metrics: isMetrics(data.metrics)
      ? clampMetrics(data.metrics, data.gridSize)
      : defaultMetrics(data.gridSize),
    guides: parseGuides(data.guides, data.gridSize),
    glyphs,
  };
}

export function loadProject(): Project {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return deserializeProject(raw);
  } catch (err) {
    console.warn('Could not load saved project, starting fresh.', err);
  }
  return createProject();
}

export function saveProject(project: Project): void {
  try {
    localStorage.setItem(STORAGE_KEY, serializeProject(project));
  } catch (err) {
    console.warn('Could not save project.', err);
  }
}

export function clearSavedProject(): void {
  localStorage.removeItem(STORAGE_KEY);
}

// ---- unsaved per-glyph drafts (work not yet "burned" into the font) ----

const DRAFTS_KEY = 'cross-stitch-font-drafts-v1';

export type DraftMap = Map<string, Map<string, StitchType>>;

export function saveDrafts(drafts: DraftMap): void {
  try {
    const obj: Record<string, Record<string, StitchType>> = {};
    for (const [char, stitches] of drafts) obj[char] = Object.fromEntries(stitches);
    localStorage.setItem(DRAFTS_KEY, JSON.stringify(obj));
  } catch (err) {
    console.warn('Could not save drafts.', err);
  }
}

export function loadDrafts(): DraftMap {
  const drafts: DraftMap = new Map();
  try {
    const raw = localStorage.getItem(DRAFTS_KEY);
    if (!raw) return drafts;
    const obj = JSON.parse(raw) as Record<string, unknown>;
    if (obj && typeof obj === 'object') {
      for (const [char, stitches] of Object.entries(obj)) {
        drafts.set(char, parseStitches(stitches));
      }
    }
  } catch (err) {
    console.warn('Could not load drafts.', err);
  }
  return drafts;
}

export function clearSavedDrafts(): void {
  localStorage.removeItem(DRAFTS_KEY);
}

export function downloadProjectJSON(project: Project): void {
  const blob = new Blob([serializeProject(project)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${slugify(project.name)}.stitchfont.json`;
  a.click();
  URL.revokeObjectURL(url);
}

export function slugify(name: string): string {
  const slug = name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'stitch-font';
}
