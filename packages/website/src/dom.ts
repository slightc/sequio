/** Minimal DOM helpers — no framework, just terse element creation. */

type Child = Node | string | null | undefined | false;

/** Create an element with attributes/props and children. */
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, unknown> = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value == null || value === false) continue;
    if (key === 'class') el.className = String(value);
    else if (key === 'html') el.innerHTML = String(value);
    else if (key.startsWith('on') && typeof value === 'function') {
      el.addEventListener(key.slice(2).toLowerCase(), value as EventListener);
    } else if (key in el && key !== 'list') {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (el as any)[key] = value;
    } else {
      el.setAttribute(key, String(value));
    }
  }
  el.append(...children.filter((c): c is Node | string => c != null && c !== false));
  return el;
}

/** Build a detached fragment from an HTML string. */
export function fromHTML(markup: string): DocumentFragment {
  const t = document.createElement('template');
  t.innerHTML = markup.trim();
  return t.content;
}

/** A `<section class="section">` with an inner `.wrap`. */
export function section(...children: Child[]): HTMLElement {
  const wrap = h('div', { class: 'wrap' }, ...children);
  return h('section', { class: 'section' }, wrap);
}
