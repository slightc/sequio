/**
 * A deliberately tiny TS/JS syntax highlighter for the site's static code
 * blocks. Not a real parser — a single tokenizing regex over the raw source,
 * escaping each chunk as it goes, so it can never emit unbalanced HTML. Classes
 * map to the `pre.code .k/.s/.c/.f/.n` styles in styles.css.
 */
import { h } from './dom';

const KEYWORDS = new Set([
  'import', 'from', 'export', 'default', 'const', 'let', 'var', 'new', 'await',
  'async', 'return', 'function', 'class', 'extends', 'interface', 'type', 'if',
  'else', 'for', 'of', 'in', 'this', 'void', 'true', 'false', 'null', 'undefined',
]);

// Order matters: comments and strings must win over keyword/number matching.
const TOKEN = /(\/\/[^\n]*)|('(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"|`(?:[^`\\]|\\.)*`)|(\b[A-Za-z_$][\w$]*\b)|(\b\d[\d_.]*\b)/g;

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Highlight `code` into an HTML string of escaped, span-wrapped tokens. */
export function highlight(code: string): string {
  let out = '';
  let last = 0;
  for (let m = TOKEN.exec(code); m; m = TOKEN.exec(code)) {
    out += esc(code.slice(last, m.index));
    const [full, comment, str, word, num] = m;
    if (comment) out += `<span class="c">${esc(comment)}</span>`;
    else if (str) out += `<span class="s">${esc(str)}</span>`;
    else if (word && KEYWORDS.has(word)) out += `<span class="k">${esc(word)}</span>`;
    else if (word && /^[A-Z]/.test(word)) out += `<span class="f">${esc(word)}</span>`;
    else if (num) out += `<span class="n">${esc(num)}</span>`;
    else out += esc(full);
    last = m.index + full.length;
  }
  out += esc(code.slice(last));
  return out;
}

/** A `<pre class="code">` with `code` highlighted. */
export function codeBlock(code: string): HTMLElement {
  return h('pre', { class: 'code', html: highlight(code.trim()) });
}
