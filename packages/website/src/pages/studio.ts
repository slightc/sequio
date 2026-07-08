import { h, section } from '../dom';
import { codeBlock } from '../highlight';
import type { Page } from '../router';

const REPO = 'https://github.com/slightc/sequio';

const FEATURES = [
  {
    title: 'Multi-track timeline',
    body: 'Stack video, image, text and shape clips across tracks with zIndex ordering, trim and drag — a reference consumer of the engine’s Track / Clip graph.',
  },
  {
    title: 'Canvas manipulation',
    body: 'Select, move, scale and rotate clips directly on the preview canvas; the SDK’s Transform2D primitives back every handle.',
  },
  {
    title: 'Video import with audio',
    body: 'Import a file, estimate its fps from a packet prefix (no full-file scan), and pull its audio track in for the export mix.',
  },
  {
    title: 'Forked offscreen export',
    body: 'Render to MP4 / WebM on a forked offscreen compositor that reuses the preview’s texture pool, so nothing decodes twice and the UI stays responsive.',
  },
  {
    title: 'Code Mode',
    body: 'Author a composition as multi-file TS/JS and run it through @sequio/runtime → a Composer that previews, exports, and ships as a bundle. The same thing this site embeds.',
  },
  {
    title: 'Server Render',
    body: 'Hand the portable code bundle to server-side rendering — headless Chrome or pure-Node WebGPU re-run the exact same code, no spec to keep in sync.',
  },
];

/** A stylized, CSS-only mock of the editor chrome (no live app needed). */
function editorMock(): HTMLElement {
  const bar = (label: string) =>
    h('div', { style: 'height:8px;border-radius:4px;background:var(--panel-2);border:1px solid var(--border);flex:none', title: label });

  const clip = (color: string, left: string, width: string) =>
    h('div', {
      style: `position:absolute;top:6px;bottom:6px;left:${left};width:${width};border-radius:6px;background:${color};opacity:0.85;border:1px solid rgba(255,255,255,0.15)`,
    });

  const trackRow = (...clips: HTMLElement[]) =>
    h(
      'div',
      { style: 'position:relative;height:34px;border-radius:8px;background:var(--bg-2);border:1px solid var(--border-soft)' },
      ...clips,
    );

  return h(
    'div',
    { class: 'shot' },
    h(
      'div',
      { class: 'chrome' },
      h('span', { class: 'd' }),
      h('span', { class: 'd' }),
      h('span', { class: 'd' }),
      h('span', { class: 'title' }, 'sequio · mini multi-track editor'),
    ),
    h(
      'div',
      { style: 'display:grid;grid-template-columns:1fr 200px;gap:14px;padding:16px;background:var(--panel)' },
      // Canvas preview
      h(
        'div',
        {
          style:
            'aspect-ratio:16/9;border-radius:10px;background:radial-gradient(420px 200px at 30% 20%,rgba(56,189,248,0.25),transparent),radial-gradient(360px 200px at 80% 80%,rgba(244,114,182,0.22),transparent),#08080c;border:1px solid var(--border);display:grid;place-items:center',
        },
        h('div', { style: 'font-family:var(--mono);color:var(--muted);font-size:13px' }, 'preview canvas'),
      ),
      // Inspector
      h(
        'div',
        { style: 'display:flex;flex-direction:column;gap:9px' },
        h('div', { style: 'font-size:11px;letter-spacing:.1em;text-transform:uppercase;color:var(--faint)' }, 'Inspector'),
        bar('position'),
        bar('scale'),
        bar('opacity'),
        bar('blend'),
        bar('effects'),
      ),
    ),
    // Timeline
    h(
      'div',
      { style: 'padding:0 16px 16px;background:var(--panel);display:flex;flex-direction:column;gap:8px' },
      trackRow(clip('#f472b6', '4%', '38%'), clip('#38bdf8', '46%', '30%')),
      trackRow(clip('#a78bfa', '10%', '52%')),
      trackRow(clip('#fbbf24', '2%', '24%'), clip('#34d399', '30%', '44%')),
    ),
  );
}

export const studioPage: Page = ({ view }) => {
  const hero = h(
    'section',
    { style: 'padding: 56px 0 8px' },
    h(
      'div',
      { class: 'wrap' },
      h('div', { class: 'eyebrow' }, 'Reference editor'),
      h('h1', { style: 'font-size: clamp(30px,4.5vw,46px); margin-bottom: 16px' }, 'The studio — a full editor on the engine'),
      h(
        'p',
        { class: 'lead' },
        '@sequio/studio is a reference multi-track editor built entirely on the public SDK. It exists to prove the engine is enough to build a real tool on — persistence, undo and UI live here, above the engine, exactly where the design puts them.',
      ),
      h(
        'div',
        { class: 'cta', style: 'margin-top: 26px' },
        h('a', { class: 'btn', href: '#/code' }, 'Try Code Mode here'),
        h('a', { class: 'btn ghost', href: `${REPO}/tree/main/packages/studio`, target: '_blank', rel: 'noopener' }, 'Studio source ↗'),
      ),
    ),
  );

  const shot = section(editorMock());

  const features = section(
    h('div', { class: 'eyebrow' }, 'What it demonstrates'),
    h('h2', { style: 'margin-bottom: 26px' }, 'Everything the engine makes possible'),
    h(
      'div',
      { class: 'feature-list' },
      ...FEATURES.map((f) =>
        h(
          'div',
          { class: 'row' },
          h('span', { class: 'mk' }, '▸'),
          h('div', {}, h('h4', {}, f.title), h('p', {}, f.body)),
        ),
      ),
    ),
  );

  const runIt = section(
    h('div', { class: 'eyebrow' }, 'Run it locally'),
    h('h2', { style: 'margin-bottom: 20px' }, 'From the workspace root'),
    codeBlock(`pnpm install     # install + link the workspace
pnpm dev         # studio editor at http://localhost:6173
                 # index.html → editor · code.html → Code Mode`),
    h(
      'p',
      { style: 'margin-top: 18px; color: var(--muted); font-size: 14.5px' },
      'The studio resolves the engine, runtime and server straight from source, so it runs without a prior ',
      h('code', {}, 'pnpm build'),
      '. Code Mode on this site is the same runtime → Composer → preview path the studio uses.',
    ),
  );

  const cta = section(
    h(
      'div',
      { class: 'card', style: 'text-align:center; padding: 44px 24px; background: linear-gradient(180deg, var(--panel), var(--bg-2));' },
      h('h2', { style: 'font-size: 28px; margin-bottom: 12px' }, 'Build your own layer'),
      h(
        'p',
        { class: 'lead', style: 'margin: 0 auto 24px' },
        'The engine is the published library; the studio is one consumer of it. Start from the API and bring your own UI.',
      ),
      h(
        'div',
        { style: 'display:flex; gap:12px; justify-content:center; flex-wrap:wrap' },
        h('a', { class: 'btn', href: '#/api' }, 'Read the API'),
        h('a', { class: 'btn ghost', href: '#/demos' }, 'Explore demos'),
      ),
    ),
  );

  view.append(hero, shot, features, runIt, cta);
};
