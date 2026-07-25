import type { Project, StitchMap, StitchShade } from '../lib/model';
import { getAdvanceCells, parseKey } from '../lib/model';
import { halfStitchPolygon } from '../lib/stitchShapes';

const inkClass = (shade: StitchShade) =>
  shade === 'muted' ? 'preview-ink preview-ink-muted' : 'preview-ink';

interface Props {
  project: Project;
  text: string;
  onTextChange: (text: string) => void;
  /** Pixels per stitch; the docked preview uses 5, the full-size view more. */
  cellPx?: number;
  /** Rows of the text input. */
  rows?: number;
}

/**
 * Typesets sample text with the saved glyph grids and real advance widths.
 * Supports multiple lines; empty lines become paragraph spacing.
 */
export default function TextPreview({ project, text, onTextChange, cellPx = 5, rows = 2 }: Props) {
  const { gridSize } = project;
  const { baselineRow } = project.metrics;
  const lineHeight = gridSize * cellPx + 8;

  interface Placed {
    x: number;
    char: string;
    missing: boolean;
    stitches: StitchMap;
  }

  const renderLine = (line: string, lineIdx: number) => {
    if (line.trim() === '') {
      return <div key={lineIdx} style={{ height: lineHeight / 2 }} />;
    }
    const placed: Placed[] = [];
    let pen = 0;
    for (const char of line) {
      const glyph = project.glyphs[char];
      const drawn = (glyph?.stitches.size ?? 0) > 0;
      if (char !== ' ') {
        placed.push({ x: pen, char, missing: !drawn, stitches: glyph?.stitches ?? new Map() });
      }
      pen += getAdvanceCells(glyph, gridSize);
    }
    const width = Math.max(pen * cellPx + 2, 60);

    return (
      <svg key={lineIdx} width={width} height={lineHeight}>
        <line
          x1={0}
          y1={4 + baselineRow * cellPx}
          x2={width}
          y2={4 + baselineRow * cellPx}
          className="preview-baseline"
        />
        {placed.map((p, i) =>
          p.missing ? (
            <rect
              key={i}
              x={p.x * cellPx + 1}
              y={4 + (baselineRow - Math.round(gridSize * 0.5)) * cellPx}
              width={Math.round(gridSize * 0.4) * cellPx}
              height={Math.round(gridSize * 0.5) * cellPx}
              className="preview-missing"
            />
          ) : (
            <g key={i}>
              {[...p.stitches].map(([key, s]) => {
                const [c, r] = parseKey(key);
                const cls = inkClass(s.shade);
                if (s.type === 'x') {
                  return (
                    <rect
                      key={key}
                      x={(p.x + c) * cellPx}
                      y={4 + r * cellPx}
                      width={cellPx}
                      height={cellPx}
                      className={cls}
                    />
                  );
                }
                const points = halfStitchPolygon(s.type, p.x + c, r)
                  .map(([px, py]) => `${px * cellPx},${4 + py * cellPx}`)
                  .join(' ');
                return <polygon key={key} points={points} className={cls} />;
              })}
            </g>
          )
        )}
      </svg>
    );
  };

  return (
    <div className="text-preview">
      <textarea
        value={text}
        rows={rows}
        onChange={(e) => onTextChange(e.target.value)}
        placeholder="Type sample text…"
      />
      <div className="text-preview-scroll">
        {text.split('\n').map((line, i) => renderLine(line, i))}
      </div>
    </div>
  );
}
