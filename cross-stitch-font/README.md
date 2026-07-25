# Cross-Stitch Font Editor

Draw cross-stitch-style letterforms on an Aida-like grid and export the finished
abecedary as a real, installable TTF font. Published at
facundo.design/xstitch-font-builder (built into `../xstitch-font-builder`).

## Run it

```sh
npm install
npm run dev      # editor at http://localhost:5173
npm test         # font-math unit tests (vitest)
npm run build    # typecheck + production build

# refresh the published GitHub Pages folder:
npm run build -- --outDir ../xstitch-font-builder --emptyOutDir
```

## How it works

- **Pick a glyph** in the left panel's Characters tab (A–Z, a–z, Spanish
  á é í ó ú ü ñ ¿ ¡ in both cases, 0–9, basic punctuation, space). Saved
  glyphs are tinted, characters with unsaved drafts get a dashed amber
  border, and the counter tracks abecedary progress. The panel's second tab
  holds the grid & guide settings. Typing any character jumps straight to it.
- **Draw** on the grid: click toggles a stitch, dragging paints a stroke,
  right-click or ⌥-drag unpicks. The toolbar picks the stitch type — full
  cross (✕), half stitch to the left (╱), or half stitch to the right (╲) —
  and a shade: solid black or 50% gray. Painting over a cell replaces its
  type/shade, clicking with the same type + shade unpicks. Gray stitches
  export too, as a COLR/CPAL color-font layer. Baseline / x-height / cap-line
  / descender guides keep letters consistent. ⌘Z / ⇧⌘Z undo and redo per glyph.
- **Save ("burn") a glyph**: the grid edits a draft — *Save glyph* (or ⏎)
  burns it into the font (navigator, previews, export); *Clear* empties the
  draft without touching the saved design. Drafts survive reloads but never
  export. *Clear all glyphs* in the export panel wipes the whole font while
  keeping the name and grid settings.
- **Grid & guides panel** sets the grid size (4–64 stitches per em) and the
  four guide lines per project. The guides drive the exported font's vertical
  metrics (ascender = grid top above baseline, descender = descender line).
  Guides that were never customized re-derive when the grid size changes;
  customized ones are clamped into the new grid. Custom rulers (horizontal or
  vertical, at any grid line) can be added, moved, and deleted in the same
  panel — they're drawing aids only and don't affect the font.
- **Preview** (right panel, Glyph/Text tabs) shows the saved glyph as the
  font will render it with its advance width, and typesets multi-line sample
  text with real advances. The text tab expands to a full-size overlay
  (Esc closes it) with an "Insert sampler" button that loads a Spanish
  pangram paragraph plus every uppercase, lowercase, digit, and punctuation
  glyph.
- **Export** builds TTFs entirely client-side with `opentype.js`, each style
  downloadable individually or all at once: Block, the solid font (`name.ttf`);
  Outline, every cell as a hollow square frame (`name-outline.ttf`); Cross,
  where every cell is an X stitch (`name-stitch.ttf`); and Cross + grid, the
  Xs over the fabric grid (`name-chart.ttf`) — the grid covers each glyph's full
  advance width and em height (space included), so chart text sets as one
  continuous band of fabric. The chart font is a COLR/CPAL color font: the
  fabric grid paints at 50% black while the crosses stay full black, with a
  monochrome fallback outline for renderers without color-font support.
  All four share one **typographic family** (name ID 16, your font name) and
  differ only by **subfamily** (name ID 17: Block / Outline / Cross / Cross
  Grid), so a font menu lists them as one family with four styles rather than
  four separate families; each also keeps a unique legacy family name (name ID
  1) so PostScript names don't collide and old RIBBI-only apps still work.
  Projects autosave to localStorage and can be exported / imported as
  `.stitchfont.json` files.

## Font compilation

`src/lib/fontBuilder.ts` converts each glyph's full crosses into merged
rectilinear outlines via edge cancellation (shared edges between adjacent
cells cancel; survivors are chained into contours, holes wind the opposite
way for nonzero fill). Half stitches become corner-to-corner diagonal bands
in the block font and single diagonal bars in the stitch/chart variants.
Grid coordinates scale to a 1000-unit em with the baseline at y = 0, and
everything assembles into an `opentype.Font` with a `.notdef` glyph. Advance
width defaults to ink width + one cell of side bearing, overridable per glyph.

## Data model

```
Project { name, gridSize, metrics, guides,
          glyphs: { char -> { stitches: Map<"col,row" -> { type: "x"|"/"|"\\", shade: "solid"|"muted" }>, advanceWidth? } } }
```

Grid size (stitches per em, default 16) is shared by all glyphs in a project —
that's what keeps the metrics coherent. Serialization lives in
`src/lib/projectStorage.ts` and is file-format-ready (versioned JSON), so
save/load can move from localStorage to project files later. Older saved
projects migrate automatically — both the plain-array format and the
type-only string-map format load as solid full/half crosses. Solid stitches
still serialize compactly as a bare type string; only shaded cells store the
`{ t, s }` object.

## Possible future directions

- Kerning pairs, image auto-trace import
- Export a printable cross-stitch chart PDF (grid + floss legend) alongside the
  font — the data model (explicit stitch sets, grid metrics) already supports it.
