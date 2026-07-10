import { useRef, useState } from 'react';
import type { CustomGuide, GridMetrics, StitchType } from '../lib/model';
import { cellKey, parseKey } from '../lib/model';

interface Props {
  gridSize: number;
  metrics: GridMetrics;
  guides: CustomGuide[];
  stitches: Map<string, StitchType>;
  /** Stitch type painted by the left mouse button. */
  tool: StitchType;
  onChange: (next: Map<string, StitchType>) => void;
  onStrokeStart: () => void;
  onStrokeEnd: () => void;
}

const PAD = 8; // breathing room inside the svg, px
const LABEL_W = 64; // space to the right of the grid for guide labels

export default function StitchGrid({
  gridSize,
  metrics,
  guides,
  stitches,
  tool,
  onChange,
  onStrokeStart,
  onStrokeEnd,
}: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const modeRef = useRef<'paint' | 'erase' | null>(null);
  const stitchesRef = useRef(stitches);
  stitchesRef.current = stitches;
  const [hoverCell, setHoverCell] = useState<string | null>(null);

  const cell = Math.max(10, Math.min(34, Math.floor(544 / gridSize)));
  const gridPx = cell * gridSize;
  const width = PAD * 2 + gridPx + LABEL_W;
  const height = PAD * 2 + gridPx;

  const cellFromEvent = (e: React.PointerEvent): string | null => {
    const rect = svgRef.current!.getBoundingClientRect();
    const col = Math.floor((e.clientX - rect.left - PAD) / cell);
    const row = Math.floor((e.clientY - rect.top - PAD) / cell);
    if (col < 0 || col >= gridSize || row < 0 || row >= gridSize) return null;
    return cellKey(col, row);
  };

  const applyCell = (key: string) => {
    const current = stitchesRef.current;
    const mode = modeRef.current;
    if (!mode) return;
    if (mode === 'paint' ? current.get(key) === tool : !current.has(key)) return;
    const next = new Map(current);
    if (mode === 'paint') next.set(key, tool);
    else next.delete(key);
    onChange(next);
  };

  const handlePointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0 && e.button !== 2) return;
    const key = cellFromEvent(e);
    if (!key) return;
    e.preventDefault();
    try {
      svgRef.current!.setPointerCapture(e.pointerId);
    } catch {
      // synthetic events may carry an unknown pointerId; dragging still works
    }
    const erase = e.button === 2 || e.altKey;
    // clicking a cell that already has the active tool's stitch unpicks it
    modeRef.current =
      erase ? 'erase' : stitchesRef.current.get(key) === tool ? 'erase' : 'paint';
    onStrokeStart();
    applyCell(key);
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    const key = cellFromEvent(e);
    setHoverCell(key);
    if (modeRef.current && key) applyCell(key);
  };

  const endStroke = () => {
    if (modeRef.current) {
      modeRef.current = null;
      onStrokeEnd();
    }
  };

  const gx = (c: number) => PAD + c * cell;
  const gy = (r: number) => PAD + r * cell;

  const metricGuides: { row: number; label: string; className: string }[] = [
    { row: metrics.baselineRow - metrics.capHeightRows, label: 'caps', className: 'guide-cap' },
    { row: metrics.baselineRow - metrics.xHeightRows, label: 'x-height', className: 'guide-xheight' },
    { row: metrics.baselineRow, label: 'baseline', className: 'guide-baseline' },
    { row: metrics.baselineRow + metrics.descenderRows, label: 'descender', className: 'guide-descender' },
  ];

  return (
    <svg
      ref={svgRef}
      className="stitch-grid"
      width={width}
      height={height}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={endStroke}
      onPointerCancel={endStroke}
      onPointerLeave={() => setHoverCell(null)}
      onContextMenu={(e) => e.preventDefault()}
    >
      {/* fabric background */}
      <rect x={gx(0)} y={gy(0)} width={gridPx} height={gridPx} className="grid-fabric" />

      {/* grid lines, heavier every 5 like Aida charts */}
      {Array.from({ length: gridSize + 1 }, (_, i) => (
        <g key={i} className={i % 5 === 0 ? 'grid-line grid-line-major' : 'grid-line'}>
          <line x1={gx(i)} y1={gy(0)} x2={gx(i)} y2={gy(gridSize)} />
          <line x1={gx(0)} y1={gy(i)} x2={gx(gridSize)} y2={gy(i)} />
        </g>
      ))}

      {/* custom ruler lines */}
      {guides.map((g) =>
        g.axis === 'h' ? (
          <line
            key={g.id}
            className="guide-custom"
            x1={gx(0)}
            y1={gy(g.pos)}
            x2={gx(gridSize)}
            y2={gy(g.pos)}
          />
        ) : (
          <line
            key={g.id}
            className="guide-custom"
            x1={gx(g.pos)}
            y1={gy(0)}
            x2={gx(g.pos)}
            y2={gy(gridSize)}
          />
        )
      )}

      {/* metric guides */}
      {metricGuides.map((g) => (
        <g key={g.label} className={`guide ${g.className}`}>
          <line x1={gx(0)} y1={gy(g.row)} x2={gx(gridSize)} y2={gy(g.row)} />
          <text x={gx(gridSize) + 6} y={gy(g.row) + 4}>
            {g.label}
          </text>
        </g>
      ))}

      {/* hover highlight */}
      {hoverCell &&
        (() => {
          const [c, r] = parseKey(hoverCell);
          return (
            <rect className="cell-hover" x={gx(c)} y={gy(r)} width={cell} height={cell} />
          );
        })()}

      {/* stitches: X = both legs, half stitches = one leg */}
      <g className="stitches">
        {[...stitches].map(([key, type]) => {
          const [c, r] = parseKey(key);
          if (c < 0 || c >= gridSize || r < 0 || r >= gridSize) return null;
          const inset = cell * 0.18;
          const x0 = gx(c) + inset;
          const y0 = gy(r) + inset;
          const x1 = gx(c + 1) - inset;
          const y1 = gy(r + 1) - inset;
          return (
            <g key={key}>
              <rect x={gx(c)} y={gy(r)} width={cell} height={cell} className="cell-fill" />
              {type !== '/' && (
                <line x1={x0} y1={y0} x2={x1} y2={y1} strokeWidth={cell * 0.2} />
              )}
              {type !== '\\' && (
                <line x1={x0} y1={y1} x2={x1} y2={y0} strokeWidth={cell * 0.2} />
              )}
            </g>
          );
        })}
      </g>
    </svg>
  );
}
