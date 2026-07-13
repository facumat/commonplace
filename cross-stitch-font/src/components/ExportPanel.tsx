import { useRef, useState } from 'react';
import type { Project } from '../lib/model';
import type { FontVariant } from '../lib/fontBuilder';
import { buildFont, downloadFont } from '../lib/fontBuilder';
import {
  deserializeProject,
  downloadProjectJSON,
  slugify,
} from '../lib/projectStorage';

interface Props {
  project: Project;
  onImport: (project: Project) => void;
  onReset: () => void;
  onClearFont: () => void;
}

export default function ExportPanel({ project, onImport, onReset, onClearFont }: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const drawnCount = Object.values(project.glyphs).filter((g) => g.stitches.size > 0).length;

  const VARIANTS: { variant: FontVariant; label: string; fileSuffix: string }[] = [
    { variant: 'solid', label: 'Block', fileSuffix: '' },
    { variant: 'outline', label: 'Outline', fileSuffix: '-outline' },
    { variant: 'stitch', label: 'Cross', fileSuffix: '-stitch' },
    { variant: 'chart', label: 'Cross + grid', fileSuffix: '-chart' },
  ];

  const exportOne = (variant: FontVariant, fileSuffix: string) => {
    setError(null);
    try {
      const font = buildFont(project, variant);
      downloadFont(font, `${slugify(project.name)}${fileSuffix}.ttf`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const exportAll = async () => {
    setError(null);
    try {
      for (const [i, { variant, fileSuffix }] of VARIANTS.entries()) {
        const font = buildFont(project, variant);
        downloadFont(font, `${slugify(project.name)}${fileSuffix}.ttf`);
        // space the downloads out so the browser doesn't swallow them
        if (i < VARIANTS.length - 1) await new Promise((r) => setTimeout(r, 400));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const importFile = async (file: File) => {
    setError(null);
    try {
      onImport(deserializeProject(await file.text()));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <section className="panel export-panel">
      <h2>Export</h2>
      <div className="export-variants">
        {VARIANTS.map(({ variant, label, fileSuffix }) => (
          <button
            key={variant}
            className="btn"
            onClick={() => exportOne(variant, fileSuffix)}
            disabled={drawnCount === 0}
          >
            {label} (.ttf)
          </button>
        ))}
      </div>
      <button
        className="btn btn-primary"
        onClick={() => void exportAll()}
        disabled={drawnCount === 0}
      >
        Download all four
      </button>
      {drawnCount === 0 && <p className="hint">Draw at least one glyph first.</p>}
      {error && <p className="error">{error}</p>}

      <h2 className="project-heading">Project</h2>
      <div className="btn-row">
        <button className="btn" onClick={() => downloadProjectJSON(project)}>
          Export JSON
        </button>
        <button className="btn" onClick={() => fileRef.current?.click()}>
          Import JSON
        </button>
      </div>
      <input
        ref={fileRef}
        type="file"
        accept=".json,application/json"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void importFile(file);
          e.target.value = '';
        }}
      />
      <button
        className="btn btn-quiet btn-danger"
        onClick={() => {
          if (
            window.confirm(
              'Clear the whole font? All saved glyph designs and unsaved drafts are deleted; the font name and grid settings are kept.'
            )
          )
            onClearFont();
        }}
      >
        Clear all glyphs
      </button>
      <button
        className="btn btn-quiet btn-danger"
        onClick={() => {
          if (window.confirm('Start a new project? This erases everything, including settings.'))
            onReset();
        }}
      >
        New project
      </button>
      <p className="hint">Progress autosaves in this browser.</p>
    </section>
  );
}
