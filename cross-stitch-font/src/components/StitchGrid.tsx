import { useRef, useState } from 'react';
import type { CustomGuide, GridMetrics, Stitch, StitchMap, StitchShade, StitchType } from '../lib/model';
import { cellKey, makeStitch, parseKey } from '../lib/model';

interface Props {
  gridSize: number;
  metrics: GridMetrics;
  guides: CustomGuide[];
  stitches: StitchMap;
  /** Stitch type painted by the left mouse button. */
  tool: StitchType;
  /** Shade applied to newly painted stitches. */
  shade: StitchShade;
  /** 'stitch' paints; 'select' drags a marquee / moves the selection. */
  mode: 'stitch' | 'select';
  selection: Set<string>;
  onSelectionChange: (selection: Set<string>) => void;
  onChange: (next: StitchMap) => void;
  /** Atomic, undoable edit (used when committing a selection move). */
  onEdit: (next: StitchMap) => void;
  onStrokeStart: () => void;
  onStrokeEnd: () => void;
}

const PAD = 8; // breathing room inside the svg, px
const LABEL_W = 64; // space to the right of the grid for guide labels

type Cell = [number, number];

interface MoveDrag {
  kind: 'move';
  start: Cell;
  /** Selection bounds at drag start, to clamp the offset inside the grid. */
  minC: number;
  maxC: number;
  minR: number;
  maxR: number;
}

type Drag = { kind: 'marquee'; anchor: Cell } | MoveDrag;

export default function StitchGrid({
  gridSize,
  metrics,
  guides,
  stitches,
  tool,
  shade,
  mode,
  selection,
  onSelectionChange,
  onChange,
  onEdit,
  onStrokeStart,
  onStrokeEnd,
}: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const modeRef = useRef<'paint' | 'erase' | null>(null);
  const stitchesRef = useRef(stitches);
  stitchesRef.current = stitches;
  const selectionRef = useRef(selection);
  selectionRef.current = selection;
  const dragRef = useRef<Drag | null>(null);
  const [hoverCell, setHoverCell] = useState<string | null>(null);
  const [marquee, setMarquee] = useState<{ a: Cell; b: Cell } | null>(null);
  const marqueeRef = useRef(marquee);
  const [moveOffset, setMoveOffset] = useState<Cell | null>(null);
  const moveOffsetRef = useRef(moveOffset);

  const setMarqueeBoth = (m: { a: Cell; b: Cell } | null) => {
    marqueeRef.current = m;
    setMarquee(m);
  };
  const setMoveOffsetBoth = (o: Cell | null) => {
    moveOffsetRef.current = o;
    setMoveOffset(o);
  };

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

  /** Like cellFromEvent, but clamped into the grid (for marquee/move drags). */
  const cellFromEventClamped = (e: React.PointerEvent): Cell => {
    const rect = svgRef.current!.getBoundingClientRect();
    const col = Math.floor((e.clientX - rect.left - PAD) / cell);
    const row = Math.floor((e.clientY - rect.top - PAD) / cell);
    return [
      Math.min(gridSize - 1, Math.max(0, col)),
      Math.min(gridSize - 1, Math.max(0, row)),
    ];
  };

  const sameAsTool = (s: Stitch | undefined) => s != null && s.type === tool && s.shade === shade;

  const applyCell = (key: string) => {
    const current = stitchesRef.current;
    const paintMode = modeRef.current;
    if (!paintMode) return;
    if (paintMode === 'paint' ? sameAsTool(current.get(key)) : !current.has(key)) return;
    const next = new Map(current);
    if (paintMode === 'paint') next.set(key, makeStitch(tool, shade));
    else next.delete(key);
    onChange(next);
  };

  const capturePointer = (e: React.PointerEvent) => {
    try {
      svgRef.current!.setPointerCapture(e.pointerId);
    } catch {
      // synthetic events may carry an unknown pointerId; dragging still works
    }
  };

  const handlePointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0 && e.button !== 2) return;
    if (mode === 'select') {
      e.preventDefault();
      capturePointer(e);
      const cellPos = cellFromEventClamped(e);
      const key = cellKey(cellPos[0], cellPos[1]);
      const sel = selectionRef.current;
      if (e.button === 0 && sel.has(key) && stitchesRef.current.has(key)) {
        // drag an existing selection to move it
        let minC = Infinity,
          maxC = -Infinity,
          minR = Infinity,
          maxR = -Infinity;
        for (const k of sel) {
          if (!stitchesRef.current.has(k)) continue;
          const [c, r] = parseKey(k);
          if (c < minC) minC = c;
          if (c > maxC) maxC = c;
          if (r < minR) minR = r;
          if (r > maxR) maxR = r;
        }
        dragRef.current = { kind: 'move', start: cellPos, minC, maxC, minR, maxR };
        setMoveOffsetBoth([0, 0]);
      } else {
        dragRef.current = { kind: 'marquee', anchor: cellPos };
        setMarqueeBoth({ a: cellPos, b: cellPos });
      }
      return;
    }
    const key = cellFromEvent(e);
    if (!key) return;
    e.preventDefault();
    capturePointer(e);
    const erase = e.button === 2 || e.altKey;
    // clicking a cell that already has the active tool + shade unpicks it
    modeRef.current =
      erase ? 'erase' : sameAsTool(stitchesRef.current.get(key)) ? 'erase' : 'paint';
    onStrokeStart();
    applyCell(key);
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (mode === 'select') {
      const drag = dragRef.current;
      if (!drag) return;
      const cellPos = cellFromEventClamped(e);
      if (drag.kind === 'marquee') {
        setMarqueeBoth({ a: drag.anchor, b: cellPos });
      } else {
        const dc = Math.min(
          gridSize - 1 - drag.maxC,
          Math.max(-drag.minC, cellPos[0] - drag.start[0])
        );
        const dr = Math.min(
          gridSize - 1 - drag.maxR,
          Math.max(-drag.minR, cellPos[1] - drag.start[1])
        );
        setMoveOffsetBoth([dc, dr]);
      }
      return;
    }
    const key = cellFromEvent(e);
    setHoverCell(key);
    if (modeRef.current && key) applyCell(key);
  };

  const commitMove = (dc: number, dr: number) => {
    const current = stitchesRef.current;
    const next = new Map(current);
    const moved: [string, Stitch][] = [];
    for (const key of selectionRef.current) {
      const s = current.get(key);
      if (s == null) continue;
      next.delete(key);
      const [c, r] = parseKey(key);
      moved.push([cellKey(c + dc, r + dr), s]);
    }
    for (const [k, s] of moved) next.set(k, s);
    onEdit(next);
    onSelectionChange(new Set(moved.map(([k]) => k)));
  };

  const handlePointerUp = () => {
    if (mode === 'select') {
      const drag = dragRef.current;
      dragRef.current = null;
      if (!drag) return;
      if (drag.kind === 'marquee') {
        const m = marqueeRef.current;
        setMarqueeBoth(null);
        if (!m) return;
        const c0 = Math.min(m.a[0], m.b[0]);
        const c1 = Math.max(m.a[0], m.b[0]);
        const r0 = Math.min(m.a[1], m.b[1]);
        const r1 = Math.max(m.a[1], m.b[1]);
        const sel = new Set<string>();
        for (const key of stitchesRef.current.keys()) {
          const [c, r] = parseKey(key);
          if (c >= c0 && c <= c1 && r >= r0 && r <= r1) sel.add(key);
        }
        onSelectionChange(sel);
      } else {
        const [dc, dr] = moveOffsetRef.current ?? [0, 0];
        setMoveOffsetBoth(null);
        if (dc !== 0 || dr !== 0) commitMove(dc, dr);
      }
      return;
    }
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

  const offset: Cell = moveOffset ?? [0, 0];

  return (
    <svg
      ref={svgRef}
      className={mode === 'select' ? 'stitch-grid is-select' : 'stitch-grid'}
      width={width}
      height={height}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
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

      {/* hover highlight (stitch mode only) */}
      {mode === 'stitch' &&
        hoverCell &&
        (() => {
          const [c, r] = parseKey(hoverCell);
          return (
            <rect className="cell-hover" x={gx(c)} y={gy(r)} width={cell} height={cell} />
          );
        })()}

      {/* stitches: X = both legs, half stitches = one leg */}
      <g className="stitches">
        {[...stitches].map(([key, s]) => {
          const [baseC, baseR] = parseKey(key);
          const selected = selection.has(key);
          const c = baseC + (selected ? offset[0] : 0);
          const r = baseR + (selected ? offset[1] : 0);
          if (c < 0 || c >= gridSize || r < 0 || r >= gridSize) return null;
          const inset = cell * 0.18;
          const x0 = gx(c) + inset;
          const y0 = gy(r) + inset;
          const x1 = gx(c + 1) - inset;
          const y1 = gy(r + 1) - inset;
          return (
            <g key={key} className={`stitch shade-${s.shade}`}>
              <rect x={gx(c)} y={gy(r)} width={cell} height={cell} className="cell-fill" />
              {s.type !== '/' && <line x1={x0} y1={y0} x2={x1} y2={y1} strokeWidth={cell * 0.2} />}
              {s.type !== '\\' && <line x1={x0} y1={y1} x2={x1} y2={y0} strokeWidth={cell * 0.2} />}
            </g>
          );
        })}
      </g>

      {/* selection highlights */}
      {[...selection].map((key) => {
        if (!stitches.has(key)) return null;
        const [c, r] = parseKey(key);
        return (
          <rect
            key={key}
            className="cell-selected"
            x={gx(c + offset[0])}
            y={gy(r + offset[1])}
            width={cell}
            height={cell}
          />
        );
      })}

      {/* marquee while dragging */}
      {marquee &&
        (() => {
          const c0 = Math.min(marquee.a[0], marquee.b[0]);
          const c1 = Math.max(marquee.a[0], marquee.b[0]);
          const r0 = Math.min(marquee.a[1], marquee.b[1]);
          const r1 = Math.max(marquee.a[1], marquee.b[1]);
          return (
            <rect
              className="marquee"
              x={gx(c0)}
              y={gy(r0)}
              width={(c1 - c0 + 1) * cell}
              height={(r1 - r0 + 1) * cell}
            />
          );
        })()}
    </svg>
  );
}
