import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CustomGuide, GridMetrics, Project, StitchType } from './lib/model';
import {
  MAX_GRID_SIZE,
  MIN_GRID_SIZE,
  clampGuides,
  clampMetrics,
  createProject,
  defaultMetrics,
  metricsEqual,
  stitchesEqual,
} from './lib/model';
import type { DraftMap } from './lib/projectStorage';
import {
  clearSavedDrafts,
  clearSavedProject,
  loadDrafts,
  loadProject,
  saveDrafts,
  saveProject,
} from './lib/projectStorage';
import { GLYPH_SET, SAMPLER_TEXT } from './lib/glyphSet';
import GlyphNavigator from './components/GlyphNavigator';
import StitchGrid from './components/StitchGrid';
import GlyphPreview from './components/GlyphPreview';
import TextPreview from './components/TextPreview';
import ExportPanel from './components/ExportPanel';
import MetricsPanel from './components/MetricsPanel';

type Stitches = Map<string, StitchType>;

interface GlyphHistory {
  past: Stitches[];
  future: Stitches[];
}

const TOOLS: { type: StitchType; label: string; title: string }[] = [
  { type: 'x', label: '✕', title: 'Full stitch' },
  { type: '/', label: '╱', title: 'Half stitch to the left' },
  { type: '\\', label: '╲', title: 'Half stitch to the right' },
];

const EMPTY_STITCHES: Stitches = new Map();

export default function App() {
  const [project, setProject] = useState<Project>(loadProject);
  // unsaved, per-character work — only "Save glyph" burns a draft into the font
  const [drafts, setDrafts] = useState<DraftMap>(loadDrafts);
  const [currentChar, setCurrentChar] = useState('A');
  const [tool, setTool] = useState<StitchType>('x');
  const [leftTab, setLeftTab] = useState<'chars' | 'grid'>('chars');
  const [rightTab, setRightTab] = useState<'glyph' | 'text'>('glyph');
  const [sampleText, setSampleText] = useState('Abc 123');
  const [textFullSize, setTextFullSize] = useState(false);

  const historyRef = useRef(new Map<string, GlyphHistory>());
  const strokeStartRef = useRef<Stitches | null>(null);
  // latest state, readable from event handlers without going through setState
  const projectRef = useRef(project);
  projectRef.current = project;
  const draftsRef = useRef(drafts);
  draftsRef.current = drafts;
  // bump to re-render undo/redo button state after history mutations
  const [, setHistoryTick] = useState(0);

  // autosave, debounced
  useEffect(() => {
    const t = setTimeout(() => saveProject(project), 400);
    return () => clearTimeout(t);
  }, [project]);
  useEffect(() => {
    const t = setTimeout(() => saveDrafts(drafts), 400);
    return () => clearTimeout(t);
  }, [drafts]);

  const burnedStitches = useCallback(
    (char: string): Stitches => project.glyphs[char]?.stitches ?? EMPTY_STITCHES,
    [project]
  );

  const currentDraft = drafts.get(currentChar) ?? burnedStitches(currentChar);
  const isDirty = !stitchesEqual(currentDraft, burnedStitches(currentChar));

  const dirtyChars = useMemo(() => {
    const set = new Set<string>();
    for (const [char, draft] of drafts) {
      if (!stitchesEqual(draft, project.glyphs[char]?.stitches ?? EMPTY_STITCHES)) set.add(char);
    }
    return set;
  }, [drafts, project]);

  /** Current draft for a char, read through refs (safe inside event handlers). */
  const draftNow = (char: string): Stitches =>
    draftsRef.current.get(char) ??
    projectRef.current.glyphs[char]?.stitches ??
    EMPTY_STITCHES;

  const setDraft = useCallback((char: string, stitches: Stitches) => {
    setDrafts((d) => {
      const next = new Map(d);
      next.set(char, stitches);
      return next;
    });
  }, []);

  const historyFor = (char: string): GlyphHistory => {
    let h = historyRef.current.get(char);
    if (!h) {
      h = { past: [], future: [] };
      historyRef.current.set(char, h);
    }
    return h;
  };

  const pushHistory = (char: string, before: Stitches) => {
    const h = historyFor(char);
    h.past.push(before);
    h.future = [];
    setHistoryTick((t) => t + 1);
  };

  const handleStrokeStart = () => {
    strokeStartRef.current = currentDraft;
  };

  const handleStrokeEnd = () => {
    const before = strokeStartRef.current;
    strokeStartRef.current = null;
    if (!before) return;
    if (!stitchesEqual(before, draftNow(currentChar))) pushHistory(currentChar, before);
  };

  const undo = useCallback(() => {
    const h = historyFor(currentChar);
    const prev = h.past.pop();
    if (!prev) return;
    h.future.push(draftNow(currentChar));
    setDraft(currentChar, prev);
    setHistoryTick((t) => t + 1);
  }, [currentChar, setDraft]);

  const redo = useCallback(() => {
    const h = historyFor(currentChar);
    const next = h.future.pop();
    if (!next) return;
    h.past.push(draftNow(currentChar));
    setDraft(currentChar, next);
    setHistoryTick((t) => t + 1);
  }, [currentChar, setDraft]);

  /** Burn the current draft into the font (set, previews, export). */
  const saveGlyph = useCallback(() => {
    const char = currentChar;
    const draft = draftNow(char);
    const burned = projectRef.current.glyphs[char]?.stitches ?? EMPTY_STITCHES;
    if (stitchesEqual(draft, burned)) return;
    setProject((p) => ({
      ...p,
      glyphs: {
        ...p.glyphs,
        [currentChar]: {
          ...(p.glyphs[currentChar] ?? { char: currentChar }),
          char: currentChar,
          stitches: draft,
        },
      },
    }));
    setDrafts((d) => {
      const next = new Map(d);
      next.delete(currentChar);
      return next;
    });
  }, [currentChar]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setTextFullSize(false);
        return;
      }
      const target = e.target as HTMLElement;
      const typing =
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.tagName === 'SELECT';
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
        if (typing) return;
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
        return;
      }
      if (typing || e.metaKey || e.ctrlKey || e.altKey) return;
      // Return saves ("burns") the current draft
      if (e.key === 'Enter') {
        if (target.tagName === 'BUTTON') return; // focused buttons keep Enter
        saveGlyph();
        return;
      }
      // typing a character jumps straight to it
      if (e.key.length === 1 && GLYPH_SET.includes(e.key)) {
        if (e.key === ' ' && target.tagName === 'BUTTON') return; // space activates buttons
        e.preventDefault();
        setCurrentChar(e.key);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [undo, redo, saveGlyph]);

  /** Empty the working draft; the saved glyph stays until "Save glyph". */
  const clearDraft = () => {
    const before = draftNow(currentChar);
    if (before.size === 0) return;
    pushHistory(currentChar, before);
    setDraft(currentChar, new Map());
  };

  const changeGridSize = (size: number) => {
    const next = Math.min(MAX_GRID_SIZE, Math.max(MIN_GRID_SIZE, Math.round(size)));
    if (next === project.gridSize) return;
    const hasInk = Object.values(project.glyphs).some((g) => g.stitches.size > 0);
    if (
      hasInk &&
      !window.confirm(
        'Change grid size? Existing stitches keep their positions; anything outside the new grid will be clipped from the font.'
      )
    ) {
      return;
    }
    setProject((p) => ({
      ...p,
      gridSize: next,
      // untouched metrics follow the new grid; customized ones just get clamped
      metrics: metricsEqual(p.metrics, defaultMetrics(p.gridSize))
        ? defaultMetrics(next)
        : clampMetrics(p.metrics, next),
      guides: clampGuides(p.guides, next),
    }));
  };

  const changeMetrics = (patch: Partial<GridMetrics>) => {
    setProject((p) => ({
      ...p,
      metrics: clampMetrics({ ...p.metrics, ...patch }, p.gridSize),
    }));
  };

  const changeGuides = (guides: CustomGuide[]) => {
    setProject((p) => ({ ...p, guides: clampGuides(guides, p.gridSize) }));
  };

  /** Delete all saved glyphs and drafts, keeping name and grid settings. */
  const clearFont = () => {
    historyRef.current.clear();
    setDrafts(new Map());
    clearSavedDrafts();
    setProject((p) => ({ ...p, glyphs: {} }));
  };

  const resetProject = () => {
    historyRef.current.clear();
    setDrafts(new Map());
    clearSavedDrafts();
    clearSavedProject();
    setProject(createProject());
    setCurrentChar('A');
  };

  const h = historyRef.current.get(currentChar);

  return (
    <div className="app">
      <header className="app-header">
        <h1>Cross-Stitch Font Editor</h1>
        <label className="field field-inline">
          Font name
          <input
            type="text"
            value={project.name}
            onChange={(e) => setProject((p) => ({ ...p, name: e.target.value }))}
          />
        </label>
      </header>

      <div className="app-main">
        <div className="left-col">
          <section className="panel tabbed-panel">
            <div className="tabs">
              <button
                className={leftTab === 'chars' ? 'tab is-active' : 'tab'}
                onClick={() => setLeftTab('chars')}
              >
                Characters
              </button>
              <button
                className={leftTab === 'grid' ? 'tab is-active' : 'tab'}
                onClick={() => setLeftTab('grid')}
              >
                Grid &amp; guides
              </button>
            </div>
            <div className="tab-body">
              {leftTab === 'chars' ? (
                <GlyphNavigator
                  project={project}
                  currentChar={currentChar}
                  dirtyChars={dirtyChars}
                  onSelect={setCurrentChar}
                />
              ) : (
                <MetricsPanel
                  project={project}
                  onGridSizeChange={changeGridSize}
                  onMetricsChange={changeMetrics}
                  onGuidesChange={changeGuides}
                />
              )}
            </div>
          </section>
        </div>

        <main className="editor">
          <div className="editor-toolbar">
            <span className="editing-char">
              {currentChar === ' ' ? '␣ space' : currentChar}
              {isDirty && (
                <span className="dirty-dot" title="Unsaved changes">
                  ●
                </span>
              )}
            </span>
            <div className="tool-group" role="group" aria-label="Stitch type">
              {TOOLS.map((t) => (
                <button
                  key={t.type}
                  className={tool === t.type ? 'btn tool is-active' : 'btn tool'}
                  title={t.title}
                  onClick={() => setTool(t.type)}
                >
                  {t.label}
                </button>
              ))}
            </div>
            <button className="btn btn-quiet" onClick={undo} disabled={!h || h.past.length === 0}>
              Undo
            </button>
            <button
              className="btn btn-quiet"
              onClick={redo}
              disabled={!h || h.future.length === 0}
            >
              Redo
            </button>
            <span className="hint toolbar-hint">
              click / drag to stitch · ⌥ to unpick · ⏎ saves · type a character to jump to it
            </span>
            <button
              className="btn btn-quiet"
              onClick={clearDraft}
              disabled={currentDraft.size === 0}
            >
              Clear
            </button>
            <button
              className="btn btn-save"
              onClick={saveGlyph}
              disabled={!isDirty}
              title="Save glyph (Return)"
            >
              Save glyph ⏎
            </button>
          </div>
          {currentChar === ' ' ? (
            <p className="space-note">
              The space has no stitches — set its width with the advance field on the right.
            </p>
          ) : (
            <StitchGrid
              gridSize={project.gridSize}
              metrics={project.metrics}
              guides={project.guides}
              stitches={currentDraft}
              tool={tool}
              onChange={(next) => setDraft(currentChar, next)}
              onStrokeStart={handleStrokeStart}
              onStrokeEnd={handleStrokeEnd}
            />
          )}
        </main>

        <aside className="sidebar">
          <section className="panel tabbed-panel">
            <div className="tabs">
              <button
                className={rightTab === 'glyph' ? 'tab is-active' : 'tab'}
                onClick={() => setRightTab('glyph')}
              >
                Glyph
              </button>
              <button
                className={rightTab === 'text' ? 'tab is-active' : 'tab'}
                onClick={() => setRightTab('text')}
              >
                Text
              </button>
              {rightTab === 'text' && (
                <button
                  className="tab-action"
                  title="Full-size preview"
                  onClick={() => setTextFullSize(true)}
                >
                  ⤢ Full size
                </button>
              )}
            </div>
            <div className="tab-body">
              {rightTab === 'glyph' ? (
                <GlyphPreview
                  glyph={project.glyphs[currentChar]}
                  char={currentChar}
                  gridSize={project.gridSize}
                  metrics={project.metrics}
                  onAdvanceChange={(advance) =>
                    setProject((p) => ({
                      ...p,
                      glyphs: {
                        ...p.glyphs,
                        [currentChar]: {
                          ...(p.glyphs[currentChar] ?? {
                            char: currentChar,
                            stitches: new Map<string, StitchType>(),
                          }),
                          advanceWidth: advance,
                        },
                      },
                    }))
                  }
                />
              ) : (
                <TextPreview project={project} text={sampleText} onTextChange={setSampleText} />
              )}
            </div>
          </section>
          <ExportPanel
            project={project}
            onImport={(p) => {
              historyRef.current.clear();
              setDrafts(new Map());
              clearSavedDrafts();
              setProject(p);
            }}
            onReset={resetProject}
            onClearFont={clearFont}
          />
        </aside>
      </div>

      {textFullSize && (
        <div className="fullscreen-overlay">
          <div className="overlay-head">
            <h2>Text preview</h2>
            <button className="btn" onClick={() => setSampleText(SAMPLER_TEXT)}>
              Insert sampler
            </button>
            <button className="btn" onClick={() => setTextFullSize(false)}>
              ✕ Close
            </button>
          </div>
          <TextPreview
            project={project}
            text={sampleText}
            onTextChange={setSampleText}
            cellPx={10}
            rows={4}
          />
        </div>
      )}
    </div>
  );
}
