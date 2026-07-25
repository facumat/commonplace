import type { GlyphData, GridMetrics, StitchMap, StitchShade } from '../lib/model';
import { getAdvanceCells, parseKey } from '../lib/model';
import { halfStitchPolygon } from '../lib/stitchShapes';

// block preview mirrors the solid font: muted stitches are gray, everything
// else (solid and dotted, which can't be dotted in a fill) is black.
const inkClass = (shade: StitchShade) =>
  shade === 'muted' ? 'preview-ink preview-ink-muted' : 'preview-ink';

interface Props {
  glyph: GlyphData | undefined;
  char: string;
  gridSize: number;
  metrics: GridMetrics;
  onAdvanceChange: (advance: number | undefined) => void;
}

/**
 * Shows the saved ("burned") glyph the way the exported font will render it,
 * with the advance width marked, plus the per-glyph advance control.
 */
export default function GlyphPreview({
  glyph,
  char,
  gridSize,
  metrics,
  onAdvanceChange,
}: Props) {
  const cell = Math.floor(160 / gridSize);
  const { baselineRow } = metrics;
  const advance = getAdvanceCells(glyph, gridSize);
  const stitches: StitchMap = glyph?.stitches ?? new Map();
  const width = Math.max(gridSize, advance) * cell + 2;
  const height = gridSize * cell + 2;

  return (
    <div className="glyph-preview">
      <h2>
        Saved glyph <span className="current-char">{char === ' ' ? '␣ space' : char}</span>
      </h2>
      {stitches.size === 0 && char !== ' ' && (
        <p className="hint">Nothing saved yet — draw on the grid and press “Save glyph”.</p>
      )}
      <svg width={width} height={height}>
        <rect x={0} y={0} width={width} height={height} className="preview-bg" />
        {[...stitches].map(([key, s]) => {
          const [c, r] = parseKey(key);
          const cls = inkClass(s.shade);
          if (s.type === 'x') {
            return (
              <rect
                key={key}
                x={1 + c * cell}
                y={1 + r * cell}
                width={cell}
                height={cell}
                className={cls}
              />
            );
          }
          const points = halfStitchPolygon(s.type, c, r)
            .map(([px, py]) => `${1 + px * cell},${1 + py * cell}`)
            .join(' ');
          return <polygon key={key} points={points} className={cls} />;
        })}
        <line
          x1={0}
          y1={1 + baselineRow * cell}
          x2={width}
          y2={1 + baselineRow * cell}
          className="preview-baseline"
        />
        <line
          x1={1 + advance * cell}
          y1={0}
          x2={1 + advance * cell}
          y2={height}
          className="preview-advance"
        />
      </svg>
      <label className="field">
        Advance width (cells)
        <input
          type="number"
          min={1}
          max={gridSize * 2}
          placeholder={`auto (${advance})`}
          value={glyph?.advanceWidth ?? ''}
          onChange={(e) => {
            const v = e.target.value;
            onAdvanceChange(v === '' ? undefined : Math.max(1, Number(v)));
          }}
        />
      </label>
    </div>
  );
}
