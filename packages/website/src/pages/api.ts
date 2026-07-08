import { h } from '../dom';
import { codeBlock } from '../highlight';
import type { Page } from '../router';
import { API_MODULES } from '../api-data';

export const apiPage: Page = ({ view }) => {
  // Sidebar TOC — one group per module, jumping to its anchor.
  const side = h(
    'aside',
    { class: 'api-side' },
    ...API_MODULES.flatMap((mod) => [
      h('div', { class: 'grp' }, mod.title),
      ...mod.symbols.map((s) => h('a', { href: `#/api?x=${mod.id}-${slug(s.name)}`, onClick: jumpTo(`${mod.id}-${slug(s.name)}`) }, s.name)),
    ]),
  );

  const content = h(
    'div',
    {},
    h('div', { class: 'eyebrow' }, 'API reference'),
    h('h1', { style: 'font-size: clamp(30px,4vw,42px); margin-bottom: 14px' }, '@sequio/engine'),
    h(
      'p',
      { class: 'lead', style: 'margin-bottom: 8px' },
      'The engine’s public surface — the stable API a consumer builds on. Everything below is exported from ',
      h('code', {}, '@sequio/engine'),
      '. Internal helpers are exported for advanced extension but are not stable API.',
    ),
    h(
      'p',
      { style: 'color: var(--muted); font-size: 14px; margin-bottom: 26px' },
      'For the full design, see the ',
      h('a', { href: 'https://github.com/slightc/sequio/blob/main/docs/architecture.md', target: '_blank', rel: 'noopener' }, 'architecture doc'),
      '.',
    ),
    ...API_MODULES.map((mod) =>
      h(
        'section',
        { class: 'api-mod', id: `mod-${mod.id}` },
        h('h2', {}, mod.title),
        h('p', { class: 'mod-desc' }, mod.description),
        ...mod.symbols.map((s) =>
          h(
            'div',
            { class: 'api-sym', id: `${mod.id}-${slug(s.name)}` },
            h(
              'div',
              { class: 'sym-head' },
              h('h3', {}, s.name),
              h('span', { class: 'kind' }, s.kind),
            ),
            h('p', {}, s.summary),
            s.code ? codeBlock(s.code) : null,
          ),
        ),
      ),
    ),
  );

  view.append(h('section', { class: 'section', style: 'padding-top: 40px' }, h('div', { class: 'wrap' }, h('div', { class: 'api-layout' }, side, content))));

  // If arriving with ?x=anchor, scroll to it.
  const x = new URLSearchParams(location.hash.split('?')[1] ?? '').get('x');
  if (x) requestAnimationFrame(() => document.getElementById(x)?.scrollIntoView({ block: 'start' }));
};

function slug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

function jumpTo(id: string): (e: Event) => void {
  return (e: Event) => {
    e.preventDefault();
    document.getElementById(id)?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  };
}
