export const UPPERCASE = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
export const LOWERCASE = 'abcdefghijklmnopqrstuvwxyz'.split('');
export const DIGITS = '0123456789'.split('');
// accented vowels, ü/ñ and inverted marks for Spanish text
export const SPANISH = [
  'á', 'é', 'í', 'ó', 'ú', 'ü', 'ñ',
  'Á', 'É', 'Í', 'Ó', 'Ú', 'Ü', 'Ñ',
];
export const PUNCTUATION = [
  '.', ',', ';', ':', '!', '?', '¡', '¿',
  "'", '"', '«', '»', '-', '_', '(', ')',
  '&', '@', '#', '%', '+', '=', '*', '/', '…',
];
export const SPACE = ' ';

export const GLYPH_SET: string[] = [
  ...UPPERCASE,
  ...LOWERCASE,
  ...SPANISH,
  ...DIGITS,
  ...PUNCTUATION,
  SPACE,
];

/** Sampler for the full-size text preview: a paragraph, then every case and mark. */
export const SAMPLER_TEXT = [
  '¡El veloz murciélago hindú comía feliz cardillo y kiwi!',
  '¿Qué extraño día, señor? La cigüeña tocó el saxofón.',
  '',
  UPPERCASE.join(''),
  SPANISH.filter((c) => c === c.toUpperCase()).join(''),
  LOWERCASE.join(''),
  SPANISH.filter((c) => c === c.toLowerCase()).join(''),
  DIGITS.join(''),
  PUNCTUATION.join(' '),
].join('\n');

// Adobe Glyph List names for non-letter characters, so exported fonts
// carry standard glyph names instead of uniXXXX fallbacks.
const GLYPH_NAMES: Record<string, string> = {
  'á': 'aacute',
  'é': 'eacute',
  'í': 'iacute',
  'ó': 'oacute',
  'ú': 'uacute',
  'ü': 'udieresis',
  'ñ': 'ntilde',
  'Á': 'Aacute',
  'É': 'Eacute',
  'Í': 'Iacute',
  'Ó': 'Oacute',
  'Ú': 'Uacute',
  'Ü': 'Udieresis',
  'Ñ': 'Ntilde',
  '¡': 'exclamdown',
  '¿': 'questiondown',
  '.': 'period',
  ',': 'comma',
  ';': 'semicolon',
  '!': 'exclam',
  '?': 'question',
  "'": 'quotesingle',
  '"': 'quotedbl',
  '«': 'guillemotleft',
  '»': 'guillemotright',
  '-': 'hyphen',
  '_': 'underscore',
  '(': 'parenleft',
  ')': 'parenright',
  '&': 'ampersand',
  '@': 'at',
  '#': 'numbersign',
  '%': 'percent',
  '+': 'plus',
  '=': 'equal',
  '*': 'asterisk',
  '/': 'slash',
  '…': 'ellipsis',
  ':': 'colon',
  ' ': 'space',
  '0': 'zero',
  '1': 'one',
  '2': 'two',
  '3': 'three',
  '4': 'four',
  '5': 'five',
  '6': 'six',
  '7': 'seven',
  '8': 'eight',
  '9': 'nine',
};

export function glyphName(char: string): string {
  if (GLYPH_NAMES[char]) return GLYPH_NAMES[char];
  if (/^[A-Za-z]$/.test(char)) return char;
  return 'uni' + char.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0');
}
