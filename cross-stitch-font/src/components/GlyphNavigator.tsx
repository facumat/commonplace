import type { Project } from '../lib/model';
import { DIGITS, LOWERCASE, PUNCTUATION, SPACE, SPANISH, UPPERCASE } from '../lib/glyphSet';

interface Props {
  project: Project;
  currentChar: string;
  /** Characters with draft edits that haven't been saved into the font yet. */
  dirtyChars: Set<string>;
  onSelect: (char: string) => void;
}

const SECTIONS: { title: string; chars: string[] }[] = [
  { title: 'Uppercase', chars: UPPERCASE },
  { title: 'Lowercase', chars: LOWERCASE },
  { title: 'Español', chars: SPANISH },
  { title: 'Digits', chars: DIGITS },
  { title: 'Punctuation', chars: [...PUNCTUATION, SPACE] },
];

export default function GlyphNavigator({ project, currentChar, dirtyChars, onSelect }: Props) {
  const drawnCount = Object.values(project.glyphs).filter((g) => g.stitches.size > 0).length;
  const total = SECTIONS.reduce((n, s) => n + s.chars.length, 0) - 1; // space needs no drawing

  return (
    <nav className="glyph-nav">
      <div className="glyph-nav-progress">
        {drawnCount} / {total} drawn
      </div>
      {SECTIONS.map((section) => (
        <div key={section.title} className="glyph-nav-section">
          <h3>{section.title}</h3>
          <div className="glyph-nav-grid">
            {section.chars.map((char) => {
              const drawn = (project.glyphs[char]?.stitches.size ?? 0) > 0;
              const dirty = dirtyChars.has(char);
              const classes = [
                'glyph-cell',
                char === currentChar ? 'is-current' : '',
                drawn ? 'is-drawn' : '',
                dirty ? 'is-dirty' : '',
              ]
                .filter(Boolean)
                .join(' ');
              const name = char === ' ' ? 'space' : char;
              return (
                <button
                  key={char}
                  className={classes}
                  onClick={() => onSelect(char)}
                  title={dirty ? `${name} — unsaved changes` : name}
                >
                  {char === ' ' ? '␣' : char}
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </nav>
  );
}
