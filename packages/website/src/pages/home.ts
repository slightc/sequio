import { h, section } from '../dom';
import { codeBlock } from '../highlight';
import type { Page } from '../router';

const CONTRACTS = [
  {
    n: '01',
    title: 'Async prepare / sync render',
    body: 'Decoding is async; render(t) is synchronous. Preview does best-effort prepare then renders now (may drop frames); export awaits prepare and never drops one.',
  },
  {
    n: '02',
    title: 'render(t) is pure',
    body: 'A frame is a pure function of the object graph and t — no hidden dependence on the previous frame or wall-clock. That is what makes export reproducible.',
  },
  {
    n: '03',
    title: 'One render core',
    body: 'Preview and export share the same resolution, color pipeline (sRGB↔linear, premultiplied alpha) and filter params. What you preview is what you ship.',
  },
  {
    n: '04',
    title: 'Explicit ownership',
    body: 'VideoFrame, Texture, RenderTexture and decoders are disposed explicitly, each with a budget + LRU eviction. Every SDK object implements dispose().',
  },
  {
    n: '05',
    title: 'Invalidate / dirty-flag',
    body: 'The SDK never repaints on its own. Mutations mark dirty; the layer above schedules a repaint on demand. You own the frame loop.',
  },
];

const PACKAGES = [
  { name: '@sequio/engine', sub: 'packages/engine', desc: 'The SDK: a command-style object-graph runtime — decode, composite, audio, export. The published library.' },
  { name: '@sequio/runtime', sub: 'packages/runtime', desc: 'Compile + run multi-file TS/JS into a Composer that previews, exports, or feeds server rendering.' },
  { name: '@sequio/server', sub: 'packages/server', desc: 'serverEnv — the pure-Node (PixiJS WebGPU) render environment that runs the engine outside a browser.' },
  { name: '@sequio/studio', sub: 'packages/studio', desc: 'A reference multi-track editor: timeline, canvas manipulation, forked export, Code Mode, Server Render.' },
  { name: '@sequio/cli', sub: 'packages/cli', desc: 'The sequio command line: render a composition to video and preview it live in the browser.' },
];

const FEATURES = [
  { ico: '🎞️', title: 'Real decode', body: 'WebCodecs / Mediabunny video + audio decode, an image and audio source, a frame cache with a byte budget and LRU eviction.' },
  { ico: '🧱', title: 'Multi-track compositor', body: 'Tracks, clips (video / image / text / shape), groups and a reconciler over the PixiJS v8 scene graph.' },
  { ico: '✨', title: 'Effects & transitions', body: 'Color, blur and warp effects plus crossfade, all keyframable — the same filter core in preview and export.' },
  { ico: '⌨️', title: 'Kinetic text', body: 'Web-font loading, line/word/char split and stagger animators, with an optional deterministic GSAP binding.' },
  { ico: '🔊', title: 'Audio engine', body: 'Web Audio for preview and an OfflineAudioContext mix for export, scheduled against the same clock.' },
  { ico: '📦', title: 'Export anywhere', body: 'A FixedStep export loop muxes MP4 / WebM in the browser, or renders headless on a server (Chrome or Node WebGPU).' },
];

const QUICKSTART = `import { Timebase, RealtimeClock, Compositor, VisualTrack, TextClip } from '@sequio/engine';

const compositor = new Compositor({ width: 1920, height: 1080, timebase: new Timebase(30) });
await compositor.init();

const track = new VisualTrack();
const title = new TextClip({ text: 'Hello', fontSize: 96, fill: 0xffffff });
title.start = 0;
title.end = 4;
track.add(title);
compositor.addTrack(track);

const clock = new RealtimeClock();
clock.onTick((t) => compositor.renderPreview(t)); // wire clock → preview
clock.start();`;

export const homePage: Page = ({ view }) => {
  // ── Hero ────────────────────────────────────────────────────────────────
  const hero = h(
    'section',
    { class: 'hero' },
    h(
      'div',
      { class: 'wrap' },
      h('div', { class: 'badge' }, h('span', { class: 'dot' }), 'Engine functional end-to-end · built on PixiJS v8 + Mediabunny'),
      h(
        'h1',
        {},
        'Programmable timelines for ',
        h('span', { class: 'grad' }, 'web video and AI'),
      ),
      h(
        'p',
        { class: 'lead' },
        'Sequio is a command-style object-graph engine for building video editors on the web. You construct a tree of Track / Clip / Effect objects and drive a clock — it owns the low-level runtime: decode, composite, audio, export.',
      ),
      h(
        'div',
        { class: 'cta' },
        h('a', { class: 'btn', href: '#/demos' }, '▶  Explore demos'),
        h('a', { class: 'btn ghost', href: '#/api' }, 'Read the API'),
        h('a', { class: 'btn ghost', href: '#/studio' }, 'See the studio'),
      ),
      h(
        'div',
        { class: 'hero-install' },
        h('span', { class: 'pfx' }, '$'),
        h('span', {}, 'npm install @sequio/engine'),
      ),
    ),
  );

  // ── Contracts ───────────────────────────────────────────────────────────
  const contracts = section(
    h('div', { class: 'eyebrow' }, 'The five contracts'),
    h('h2', {}, 'Invariants the whole design rests on'),
    h('p', { class: 'lead', style: 'margin-bottom: 34px' }, 'Every part of the engine preserves these. They are what make export reproducible and golden-frame testing possible.'),
    h('div', { class: 'contracts' }, ...CONTRACTS.map((c) =>
      h(
        'div',
        { class: 'contract' },
        h('div', { class: 'n' }, c.n),
        h('h4', {}, c.title),
        h('p', {}, c.body),
      ),
    )),
  );

  // ── Features ────────────────────────────────────────────────────────────
  const features = section(
    h('div', { class: 'eyebrow' }, 'What the engine gives you'),
    h('h2', {}, 'A runtime, not a widget'),
    h('p', { class: 'lead', style: 'margin-bottom: 34px' }, 'Persistence, schema, undo, collaboration and UI are out of scope — they belong to the layer above. The engine owns everything below the timeline.'),
    h('div', { class: 'grid cols-3' }, ...FEATURES.map((f) =>
      h(
        'div',
        { class: 'card hoverable' },
        h('div', { class: 'ico' }, f.ico),
        h('h3', {}, f.title),
        h('p', {}, f.body),
      ),
    )),
  );

  // ── Quick start ─────────────────────────────────────────────────────────
  const quickstart = section(
    h('div', { class: 'eyebrow' }, 'Quick start'),
    h('h2', {}, 'Build a timeline imperatively, drive it with a clock'),
    h('p', { class: 'lead', style: 'margin-bottom: 26px' }, 'The same object graph previews live, exports to MP4/WebM, and renders headless on a server — one description, three destinations.'),
    codeBlock(QUICKSTART),
    h(
      'p',
      { style: 'margin-top: 20px; color: var(--muted); font-size: 14.5px' },
      'Prefer authoring a whole program? Open the ',
      h('a', { href: '#/demos' }, 'demo gallery'),
      ' — every card runs its source in the in-browser Code Mode, the same runtime the CLI and studio use.',
    ),
  );

  // ── Packages ────────────────────────────────────────────────────────────
  const packages = section(
    h('div', { class: 'eyebrow' }, 'Monorepo'),
    h('h2', {}, 'Five packages in a clean dependency DAG'),
    h(
      'p',
      { class: 'lead', style: 'margin-bottom: 30px' },
      h('code', {}, 'engine ← runtime ← server ← studio'),
      '  and  ',
      h('code', {}, 'engine ← { server, studio, cli }'),
      '.',
    ),
    h('div', {}, ...PACKAGES.map((p) =>
      h(
        'div',
        { class: 'pkg-row' },
        h('div', { class: 'name' }, p.name, h('span', { class: 'badge-pkg' }, p.sub)),
        h('div', { class: 'desc' }, p.desc),
      ),
    )),
  );

  // ── Closing CTA ─────────────────────────────────────────────────────────
  const cta = section(
    h(
      'div',
      { class: 'card', style: 'text-align:center; padding: 48px 24px; background: linear-gradient(180deg, var(--panel), var(--bg-2));' },
      h('h2', { style: 'font-size: 30px; margin-bottom: 12px' }, 'See it render'),
      h('p', { class: 'lead', style: 'margin: 0 auto 26px' }, 'Every demo cover on the next page is drawn by Sequio itself. Click one to edit and re-run it live.'),
      h(
        'div',
        { style: 'display:flex; gap:12px; justify-content:center; flex-wrap:wrap' },
        h('a', { class: 'btn', href: '#/demos' }, 'Open the gallery'),
        h('a', { class: 'btn ghost', href: 'https://github.com/slightc/sequio', target: '_blank', rel: 'noopener' }, 'Star on GitHub'),
      ),
    ),
  );

  view.append(hero, contracts, features, quickstart, packages, cta);
};
