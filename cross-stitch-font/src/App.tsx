import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CustomGuide, GridMetrics, Project, Stitch, StitchShade, StitchType } from './lib/model';
import {
  MAX_GRID_SIZE,
  MIN_GRID_SIZE,
  cellKey,
  clampGuides,
  clampMetrics,
  createProject,
  defaultMetrics,
  makeStitch,
  metricsEqual,
  parseKey,
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

type Stitches = Map<string, Stitch>;

interface GlyphHistory {
  past: Stitches[];
  future: Stitches[];
}

/** Copied stitches, stored relative to their bounding-box top-left. */
interface Clipboard {
  cells: { c: number; r: number; stitch: Stitch }[];
  w: number;
  h: number;
  originC: number;
  originR: number;
}

const TOOLS: { type: StitchType; label: string; title: string }[] = [
  { type: 'x', label: '✕', title: 'Full stitch' },
  { type: '/', label: '╱', title: 'Half stitch to the left' },
  { type: '\\', label: '╲', title: 'Half stitch to the right' },
];

const SHADES: { shade: StitchShade; label: string; title: string }[] = [
  { shade: 'solid', label: '■', title: 'Solid black' },
  { shade: 'muted', label: '■', title: '50% gray' },
];

const EMPTY_STITCHES: Stitches = new Map();

const TOOLBAR_TIP =
  'Click / drag to stitch · right-click or ⌥ to unpick · pick a stitch type and a ' +
  'shade (solid or 50% gray) · ⏎ saves the glyph · type a character to jump ' +
  'to it · ⇥ toggles select mode · in select mode: drag to select an area, drag the ' +
  'selection to move it, ⌘C / ⌘V copy and paste, ⌫ deletes it, Esc clears it';

export default function App() {
  const [project, setProject] = useState<Project>(loadProject);
  // unsaved, per-character work — only "Save glyph" burns a draft into the font
  const [drafts, setDrafts] = useState<DraftMap>(loadDrafts);
  const [currentChar, setCurrentChar] = useState('A');
  const [tool, setTool] = useState<StitchType>('x');
  const [shade, setShade] = useState<StitchShade>('solid');
  const [editMode, setEditMode] = useState<'stitch' | 'select'>('stitch');
  const [selection, setSelection] = useState<Set<string>>(new Set());
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
  const selectionRef = useRef(selection);
  selectionRef.current = selection;
  // copied stitches, kept across glyph switches so you can paste elsewhere
  const clipboardRef = useRef<Clipboard | null>(null);
  const [hasClipboard, setHasClipboard] = useState(false);
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

  // the selection belongs to one glyph; leaving it clears the selection
  useEffect(() => {
    setSelection(new Set());
  }, [currentChar]);

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

  /** Apply one atomic, undoable edit to the current draft. */
  const applyEdit = useCallback(
    (next: Stitches) => {
      const before = draftNow(currentChar);
      if (stitchesEqual(before, next)) return;
      pushHistory(currentChar, before);
      setDraft(currentChar, next);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [currentChar, setDraft]
  );

  const deleteSelection = useCallback(() => {
    const sel = selectionRef.current;
    if (sel.size === 0) return;
    const next = new Map(draftNow(currentChar));
    for (const key of sel) next.delete(key);
    applyEdit(next);
    setSelection(new Set());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentChar, applyEdit]);

  const restyleSelection = (type: StitchType) => {
    const sel = selectionRef.current;
    if (sel.size === 0) return;
    const next = new Map(draftNow(currentChar));
    for (const key of sel) {
      const s = next.get(key);
      if (s) next.set(key, makeStitch(type, s.shade));
    }
    applyEdit(next);
  };

  const reshadeSelection = (nextShade: StitchShade) => {
    const sel = selectionRef.current;
    if (sel.size === 0) return;
    const next = new Map(draftNow(currentChar));
    for (const key of sel) {
      const s = next.get(key);
      if (s) next.set(key, makeStitch(s.type, nextShade));
    }
    applyEdit(next);
  };

  /** Copy the selected stitches to the internal clipboard. */
  const copySelection = useCallback(() => {
    const sel = selectionRef.current;
    const draft = draftNow(currentChar);
    const raw: { c: number; r: number; stitch: Stitch }[] = [];
    let minC = Infinity,
      minR = Infinity,
      maxC = -Infinity,
      maxR = -Infinity;
    for (const key of sel) {
      const stitch = draft.get(key);
      if (stitch == null) continue;
      const [c, r] = parseKey(key);
      raw.push({ c, r, stitch });
      if (c < minC) minC = c;
      if (c > maxC) maxC = c;
      if (r < minR) minR = r;
      if (r > maxR) maxR = r;
    }
    if (raw.length === 0) return;
    clipboardRef.current = {
      cells: raw.map(({ c, r, stitch }) => ({ c: c - minC, r: r - minR, stitch })),
      w: maxC - minC + 1,
      h: maxR - minR + 1,
      originC: minC,
      originR: minR,
    };
    setHasClipboard(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentChar]);

  /** Paste the clipboard, nudged one cell down-right, and select the result. */
  const pasteClipboard = useCallback(() => {
    const clip = clipboardRef.current;
    if (!clip) return;
    const gs = projectRef.current.gridSize;
    const tc = Math.max(0, Math.min(gs - clip.w, clip.originC + 1));
    const tr = Math.max(0, Math.min(gs - clip.h, clip.originR + 1));
    const next = new Map(draftNow(currentChar));
    const pasted = new Set<string>();
    for (const { c, r, stitch } of clip.cells) {
      const col = tc + c;
      const row = tr + r;
      if (col < 0 || col >= gs || row < 0 || row >= gs) continue;
      const key = cellKey(col, row);
      next.set(key, stitch);
      pasted.add(key);
    }
    if (pasted.size === 0) return;
    applyEdit(next);
    setSelection(pasted);
    setEditMode('select');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentChar, applyEdit]);

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

  /** Burn every glyph with unsaved changes into the font at once. */
  const saveAllGlyphs = useCallback(() => {
    const toSave: [string, Stitches][] = [];
    for (const [char, draft] of draftsRef.current) {
      const burned = projectRef.current.glyphs[char]?.stitches ?? EMPTY_STITCHES;
      if (!stitchesEqual(draft, burned)) toSave.push([char, draft]);
    }
    if (toSave.length === 0) return;
    setProject((p) => {
      const glyphs = { ...p.glyphs };
      for (const [char, draft] of toSave) {
        glyphs[char] = { ...(glyphs[char] ?? { char }), char, stitches: draft };
      }
      return { ...p, glyphs };
    });
    setDrafts((d) => {
      const next = new Map(d);
      for (const [char] of toSave) next.delete(char);
      return next;
    });
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const typing =
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.tagName === 'SELECT';
      if (e.key === 'Escape') {
        if (selectionRef.current.size > 0) setSelection(new Set());
        else setTextFullSize(false);
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
        if (typing) return;
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
        return;
      }
      // select all stitches of the current draft
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'a') {
        if (typing) return;
        e.preventDefault();
        setSelection(new Set(draftNow(currentChar).keys()));
        setEditMode('select');
        return;
      }
      // copy the selection
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'c') {
        if (typing || selectionRef.current.size === 0) return;
        e.preventDefault();
        copySelection();
        return;
      }
      // paste the clipboard
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'v') {
        if (typing || !clipboardRef.current) return;
        e.preventDefault();
        pasteClipboard();
        return;
      }
      if (typing || e.metaKey || e.ctrlKey || e.altKey) return;
      // Tab toggles between stitching and selecting
      if (e.key === 'Tab') {
        e.preventDefault();
        setEditMode((m) => (m === 'select' ? 'stitch' : 'select'));
        return;
      }
      // Return always saves ("burns") the current draft
      if (e.key === 'Enter') {
        e.preventDefault();
        saveGlyph();
        return;
      }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (selectionRef.current.size > 0) {
          e.preventDefault();
          deleteSelection();
        }
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [undo, redo, saveGlyph, deleteSelection, copySelection, pasteClipboard, currentChar]);

  /** Empty the working draft; the saved glyph stays until "Save glyph". */
  const clearDraft = () => {
    const before = draftNow(currentChar);
    if (before.size === 0) return;
    pushHistory(currentChar, before);
    setDraft(currentChar, new Map());
    setSelection(new Set());
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
    setSelection(new Set());
    clearSavedDrafts();
    setProject((p) => ({ ...p, glyphs: {} }));
  };

  const resetProject = () => {
    historyRef.current.clear();
    setDrafts(new Map());
    setSelection(new Set());
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
            <div className="tool-group" role="group" aria-label="Tool">
              {TOOLS.map((t) => (
                <button
                  key={t.type}
                  className={
                    editMode === 'stitch' && tool === t.type ? 'btn tool is-active' : 'btn tool'
                  }
                  title={t.title}
                  onClick={() => {
                    setTool(t.type);
                    setEditMode('stitch');
                  }}
                >
                  {t.label}
                </button>
              ))}
              <button
                className={editMode === 'select' ? 'btn tool is-active' : 'btn tool'}
                title="Select area (Tab)"
                onClick={() => setEditMode('select')}
              >
                ⬚
              </button>
            </div>
            <div className="tool-group" role="group" aria-label="Shade">
              {SHADES.map((s) => (
                <button
                  key={s.shade}
                  className={`btn tool shade-${s.shade}${shade === s.shade ? ' is-active' : ''}`}
                  title={s.title}
                  onClick={() => setShade(s.shade)}
                >
                  {s.label}
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
            {selection.size > 0 && (
              <div className="selection-actions">
                <span>{selection.size} selected</span>
                {TOOLS.map((t) => (
                  <button
                    key={t.type}
                    className="btn btn-quiet"
                    title={`Change selection to: ${t.title.toLowerCase()}`}
                    onClick={() => restyleSelection(t.type)}
                  >
                    {t.label}
                  </button>
                ))}
                <span className="sel-divider" />
                {SHADES.map((s) => (
                  <button
                    key={s.shade}
                    className={`btn btn-quiet shade-${s.shade}`}
                    title={`Shade selection: ${s.title.toLowerCase()}`}
                    onClick={() => reshadeSelection(s.shade)}
                  >
                    {s.label}
                  </button>
                ))}
                <span className="sel-divider" />
                <button
                  className="btn btn-quiet"
                  title="Copy selection (⌘C)"
                  onClick={copySelection}
                >
                  Copy
                </button>
                <button
                  className="btn btn-quiet btn-danger"
                  title="Delete selection (⌫)"
                  onClick={deleteSelection}
                >
                  Delete
                </button>
              </div>
            )}
            {hasClipboard && (
              <button
                className="btn btn-quiet"
                title="Paste copied stitches (⌘V)"
                onClick={pasteClipboard}
              >
                Paste
              </button>
            )}
            <span className="toolbar-spacer" />
            <span className="info-tip" title={TOOLBAR_TIP}>
              ⓘ
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
            <button
              className="btn btn-save"
              onClick={saveAllGlyphs}
              disabled={dirtyChars.size === 0}
              title="Save every glyph with unsaved changes"
            >
              Save all{dirtyChars.size > 0 ? ` (${dirtyChars.size})` : ''}
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
              shade={shade}
              mode={editMode}
              selection={selection}
              onSelectionChange={setSelection}
              onChange={(next) => setDraft(currentChar, next)}
              onEdit={applyEdit}
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
                            stitches: new Map<string, Stitch>(),
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
              setSelection(new Set());
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
