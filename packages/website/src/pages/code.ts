/**
 * Code Mode — the same author-as-code loop the studio ships, embedded in the
 * site. A demo's multi-file source (or a default) is compiled + linked + run by
 * `@sequio/runtime`; the resulting `Composer` drives a live preview, a
 * client-side video export, and a portable bundle download. This is exactly
 * what a demo card opens into.
 */
import { h } from '../dom';
import type { Page } from '../router';
import type { Composer, PreviewHandle } from '@sequio/runtime';
import type { Subscription } from '@sequio/engine';
import { makeRuntime } from '../engine-host';
import { DEMOS, getDemo, type Demo } from '../demos';

const FALLBACK: Demo = DEMOS[0];

function downloadBlob(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export const codePage: Page = ({ view, params, navigate }) => {
  const demo = getDemo(params.get('demo')) ?? FALLBACK;
  const entry = demo.entry;
  const files: Record<string, string> = { ...demo.files };
  let activeFile = entry;

  // Live objects for the current run.
  let composer: Composer | null = null;
  let preview: PreviewHandle | null = null;
  let tickSub: Subscription | null = null;
  let endedSub: Subscription | null = null;
  let busy = false;
  let disposed = false;

  // ── DOM ───────────────────────────────────────────────────────────────
  const tabsEl = h('div', { class: 'code-tabs' });
  const codeEl = h('textarea', { id: 'code', spellcheck: false, autocomplete: 'off' }) as HTMLTextAreaElement;
  const stageEl = h(
    'div',
    { id: 'stage' },
    h('div', { class: 'stage-empty' }, 'Press Run to compile & preview'),
  );
  const logEl = h('div', { class: 'log', id: 'log' }, 'Compiling…');
  const scrub = h('input', { id: 'scrub', type: 'range', min: '0', max: '1', step: '0.001', value: '0', disabled: true }) as HTMLInputElement;
  const scrubPlay = h('button', { class: 'btn sm ghost transport-play', disabled: true, title: 'Play / pause', 'aria-label': 'Play' }, '▶') as HTMLButtonElement;
  const timeLabel = h('span', { id: 'time' }, '0.00 / 0.00s');
  const runBtn = h('button', { class: 'btn sm', title: 'Compile + run the files into a Composer, then preview' }, '▶ Run') as HTMLButtonElement;
  const playBtn = h('button', { class: 'btn sm ghost', disabled: true }, '▶ Play') as HTMLButtonElement;
  const exportBtn = h('button', { class: 'btn sm ghost', disabled: true, title: 'Render the Composer to a video in the browser' }, '⬇ Export') as HTMLButtonElement;
  const bundleBtn = h('button', { class: 'btn sm ghost', disabled: true, title: 'Download the portable code bundle for server-side render' }, '⇪ Bundle') as HTMLButtonElement;
  const exportFormat = h(
    'select',
    { id: 'export-format', class: 'ghost' },
    h('option', { value: 'mp4' }, 'MP4'),
    h('option', { value: 'webm' }, 'WebM'),
  ) as HTMLSelectElement;

  const demoSelect = h(
    'select',
    { class: 'ghost', title: 'Switch demo' },
    ...DEMOS.map((d) => h('option', { value: d.id, selected: d.id === demo.id }, d.title)),
  ) as HTMLSelectElement;
  demoSelect.addEventListener('change', () => navigate(`/code?demo=${demoSelect.value}`));

  const toolbar = h(
    'div',
    { class: 'code-toolbar' },
    h('h1', {}, 'Code Mode'),
    h('span', { class: 'sep' }),
    runBtn,
    playBtn,
    h('span', { class: 'sep' }),
    exportFormat,
    exportBtn,
    bundleBtn,
    h('span', { class: 'spacer' }),
    demoSelect,
    h('a', { class: 'navlink', href: '#/demos' }, '← Gallery'),
  );

  const editor = h('div', { class: 'code-editor' }, tabsEl, codeEl);
  const previewCol = h(
    'div',
    { class: 'code-preview' },
    stageEl,
    h('div', { class: 'transport' }, scrubPlay, scrub, timeLabel),
    logEl,
    h(
      'div',
      { style: 'color: var(--muted); font-size: 13px; line-height: 1.5' },
      'The runtime compiles these TS files, links them in a virtual filesystem and runs the entry ',
      h('code', {}, entry),
      '. Its ',
      h('code', {}, 'defineComposition(builder)'),
      ' default export builds the graph with the engine’s own classes and becomes a ',
      h('strong', {}, 'Composer'),
      ' — the same object that previews, exports, and ships as a bundle for server render.',
    ),
  );

  const page = h('div', { class: 'code-page' }, toolbar, h('div', { class: 'code-main' }, editor, previewCol));
  view.append(page);

  // ── helpers ───────────────────────────────────────────────────────────
  function log(message: string, kind: 'info' | 'ok' | 'err' = 'info'): void {
    logEl.textContent = message;
    logEl.className = `log${kind === 'ok' ? ' ok' : kind === 'err' ? ' err' : ''}`;
  }
  const fmt = (t: number): string => t.toFixed(2);

  // ── file tabs ─────────────────────────────────────────────────────────
  function renderTabs(): void {
    tabsEl.replaceChildren();
    for (const path of Object.keys(files)) {
      const tab = h('div', { class: `code-tab${path === activeFile ? ' active' : ''}` });
      const label = h('span', {}, path.replace(/^\//, ''));
      label.addEventListener('click', () => selectFile(path));
      tab.append(label);
      if (path !== entry) {
        const close = h('span', { class: 'close', title: 'Delete file' }, '×');
        close.addEventListener('click', (e) => {
          e.stopPropagation();
          deleteFile(path);
        });
        tab.append(close);
      }
      tabsEl.append(tab);
    }
    const add = h('div', { class: 'code-tab', style: 'color: var(--muted)' }, '+ file');
    add.addEventListener('click', addFile);
    tabsEl.append(add);
  }
  function selectFile(path: string): void {
    files[activeFile] = codeEl.value;
    activeFile = path;
    codeEl.value = files[path] ?? '';
    renderTabs();
    codeEl.focus();
  }
  function addFile(): void {
    const name = prompt('New file name (e.g. lib.ts):', 'lib.ts');
    if (!name) return;
    const path = '/' + name.replace(/^\/+/, '');
    if (files[path] !== undefined) return selectFile(path);
    files[path] = 'export const value = 42;\n';
    selectFile(path);
  }
  function deleteFile(path: string): void {
    if (path === entry) return;
    delete files[path];
    if (activeFile === path) {
      activeFile = entry;
      codeEl.value = files[entry] ?? '';
    }
    renderTabs();
  }

  codeEl.addEventListener('input', () => {
    files[activeFile] = codeEl.value;
  });
  codeEl.addEventListener('keydown', (e) => {
    if (e.key === 'Tab') {
      e.preventDefault();
      const s = codeEl.selectionStart;
      const en = codeEl.selectionEnd;
      codeEl.value = codeEl.value.slice(0, s) + '  ' + codeEl.value.slice(en);
      codeEl.selectionStart = codeEl.selectionEnd = s + 2;
      files[activeFile] = codeEl.value;
    }
  });

  // ── transport ─────────────────────────────────────────────────────────
  function updateTransport(t: number): void {
    if (!preview) return;
    scrub.value = String(t);
    timeLabel.textContent = `${fmt(t)} / ${fmt(preview.duration)}s`;
    playBtn.textContent = preview.playing ? '⏸ Pause' : '▶ Play';
    scrubPlay.textContent = preview.playing ? '⏸' : '▶';
    scrubPlay.setAttribute('aria-label', preview.playing ? 'Pause' : 'Play');
  }
  scrub.addEventListener('input', () => {
    if (!preview) return;
    preview.pause();
    preview.seek(parseFloat(scrub.value));
    updateTransport(parseFloat(scrub.value));
  });
  function togglePlay(): void {
    if (!preview) return;
    if (preview.playing) preview.pause();
    else preview.play();
    updateTransport(preview.clock.currentTime);
  }
  playBtn.addEventListener('click', togglePlay);
  scrubPlay.addEventListener('click', togglePlay);

  // ── run ───────────────────────────────────────────────────────────────
  async function run(): Promise<void> {
    if (busy || disposed) return;
    busy = true;
    files[activeFile] = codeEl.value;
    runBtn.disabled = true;
    log('Compiling and running…');

    tickSub?.unsubscribe();
    tickSub = null;
    endedSub?.unsubscribe();
    endedSub = null;
    preview?.dispose();
    preview = null;
    playBtn.disabled = true;
    scrubPlay.disabled = true;
    exportBtn.disabled = true;
    bundleBtn.disabled = true;

    try {
      composer = await makeRuntime(files, entry).run();
      if (disposed) return;
      stageEl.replaceChildren();
      preview = await composer.preview(stageEl);
      if (disposed) {
        preview.dispose();
        preview = null;
        return;
      }

      scrub.min = '0';
      scrub.max = String(preview.duration);
      scrub.disabled = false;
      playBtn.disabled = false;
      scrubPlay.disabled = false;
      exportBtn.disabled = false;
      bundleBtn.disabled = false;

      tickSub = preview.clock.onTick((t) => updateTransport(t));
      // Auto-stop at the end pauses internally without a tick — refresh so both
      // play buttons (toolbar + transport) fall back to ▶.
      endedSub = preview.clock.onEnded(() => updateTransport(preview?.clock.currentTime ?? 0));
      updateTransport(0);
      preview.play();

      const tracks = preview.built.compositor.getTracks();
      const clips = tracks.reduce((n, t) => n + t.clips.length, 0);
      log(`Ran ${Object.keys(files).length} file(s) → Composer: ${tracks.length} track(s), ${clips} clip(s), ${fmt(preview.duration)}s.`, 'ok');
    } catch (err) {
      log(String(err instanceof Error ? (err.stack ?? err.message) : err), 'err');
    } finally {
      runBtn.disabled = false;
      busy = false;
    }
  }
  runBtn.addEventListener('click', run);

  // ── export ────────────────────────────────────────────────────────────
  exportBtn.addEventListener('click', async () => {
    if (!composer || busy) return;
    busy = true;
    exportBtn.disabled = true;
    preview?.pause();
    updateTransport(preview?.clock.currentTime ?? 0);
    const container = exportFormat.value as 'mp4' | 'webm';
    try {
      log(`Exporting ${container.toUpperCase()}… 0%`);
      const blob = await composer.export({ container }, (p) => log(`Exporting ${container.toUpperCase()}… ${Math.round(p * 100)}%`));
      downloadBlob(blob, `${demo.id}.${container}`);
      log(`Exported ${demo.id}.${container} (${(blob.size / 1024).toFixed(0)} KB).`, 'ok');
    } catch (err) {
      log(`Export failed: ${err instanceof Error ? err.message : String(err)}`, 'err');
    } finally {
      exportBtn.disabled = !composer;
      busy = false;
    }
  });

  // ── bundle ────────────────────────────────────────────────────────────
  bundleBtn.addEventListener('click', () => {
    if (!composer) return;
    const bundle = composer.toBundle();
    downloadBlob(new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' }), `${demo.id}.bundle.json`);
    log('Saved the portable bundle (the source files themselves). Render it on a server with:\n  pnpm ssr:render -- --bundle bundle.json --out out.mp4', 'ok');
  });

  // ── boot ──────────────────────────────────────────────────────────────
  codeEl.value = files[activeFile] ?? '';
  renderTabs();
  void run();

  return () => {
    disposed = true;
    tickSub?.unsubscribe();
    endedSub?.unsubscribe();
    preview?.dispose();
    preview = null;
    composer = null;
  };
};
