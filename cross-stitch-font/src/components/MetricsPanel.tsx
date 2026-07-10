import { useEffect, useState } from 'react';
import type { CustomGuide, GridMetrics, Project } from '../lib/model';
import { MAX_GRID_SIZE, MIN_GRID_SIZE, newGuideId } from '../lib/model';

interface Props {
  project: Project;
  onGridSizeChange: (size: number) => void;
  onMetricsChange: (patch: Partial<GridMetrics>) => void;
  onGuidesChange: (guides: CustomGuide[]) => void;
}

/** Project-wide grid and guide-line settings. */
export default function MetricsPanel({
  project,
  onGridSizeChange,
  onMetricsChange,
  onGuidesChange,
}: Props) {
  const { gridSize, metrics, guides } = project;

  const addGuide = () =>
    onGuidesChange([
      ...guides,
      { id: newGuideId(), axis: 'h', pos: Math.round(gridSize / 2) },
    ]);

  const updateGuide = (id: string, patch: Partial<CustomGuide>) =>
    onGuidesChange(guides.map((g) => (g.id === id ? { ...g, ...patch } : g)));

  const removeGuide = (id: string) => onGuidesChange(guides.filter((g) => g.id !== id));

  // grid size commits on blur/Enter so typing "24" doesn't apply a transient "2"
  const [gridDraft, setGridDraft] = useState(String(gridSize));
  useEffect(() => setGridDraft(String(gridSize)), [gridSize]);

  const commitGridSize = () => {
    const v = Number(gridDraft);
    // snap the draft back; if the change is accepted the effect re-syncs it
    setGridDraft(String(gridSize));
    if (Number.isFinite(v) && v !== gridSize) onGridSizeChange(v);
  };

  const metricField = (
    label: string,
    key: keyof GridMetrics,
    min: number,
    max: number,
    hint: string
  ) => (
    <label className="field" title={hint}>
      {label}
      <input
        type="number"
        min={min}
        max={max}
        value={metrics[key]}
        onChange={(e) => {
          const v = Number(e.target.value);
          if (e.target.value !== '' && Number.isFinite(v)) onMetricsChange({ [key]: v });
        }}
      />
    </label>
  );

  return (
    <div className="metrics-panel">
      <label className="field">
        Grid size (stitches per em, {MIN_GRID_SIZE}–{MAX_GRID_SIZE})
        <input
          type="number"
          min={MIN_GRID_SIZE}
          max={MAX_GRID_SIZE}
          value={gridDraft}
          onChange={(e) => setGridDraft(e.target.value)}
          onBlur={commitGridSize}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          }}
        />
      </label>
      {metricField(
        'Baseline (rows from top)',
        'baselineRow',
        1,
        gridSize,
        'Grid line the letters sit on, counted from the top of the grid'
      )}
      {metricField(
        'x-height (rows above baseline)',
        'xHeightRows',
        1,
        metrics.baselineRow,
        'Height of lowercase letters'
      )}
      {metricField(
        'Cap line (rows above baseline)',
        'capHeightRows',
        1,
        metrics.baselineRow,
        'Height of capital letters'
      )}
      {metricField(
        'Descender (rows below baseline)',
        'descenderRows',
        0,
        gridSize - metrics.baselineRow,
        'How far tails like g, p, y reach below the baseline'
      )}
      <p className="hint">Guides keep letters consistent and set the exported font’s metrics.</p>

      <h2>Custom rulers</h2>
      {guides.map((g) => (
        <div className="ruler-row" key={g.id}>
          <select
            value={g.axis}
            title="Direction"
            onChange={(e) => updateGuide(g.id, { axis: e.target.value as CustomGuide['axis'] })}
          >
            <option value="h">— row</option>
            <option value="v">| col</option>
          </select>
          <input
            type="number"
            min={0}
            max={gridSize}
            value={g.pos}
            title={g.axis === 'h' ? 'Rows from the top' : 'Columns from the left'}
            onChange={(e) => {
              const v = Number(e.target.value);
              if (e.target.value !== '' && Number.isFinite(v)) updateGuide(g.id, { pos: v });
            }}
          />
          <button
            className="btn btn-quiet ruler-remove"
            title="Delete ruler"
            onClick={() => removeGuide(g.id)}
          >
            ✕
          </button>
        </div>
      ))}
      <button className="btn" onClick={addGuide}>
        Add ruler
      </button>
      <p className="hint">Drawing aids only — rulers don’t affect the exported font.</p>
    </div>
  );
}
