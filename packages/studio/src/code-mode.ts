/**
 * Studio "Code Mode" — author a composition **as code** and run it.
 *
 * This is the reference consumer of `@video-editor-canvas/runtime`. The user
 * edits a small multi-file TS program in the browser; pressing Run hands those
 * files to a {@link Runtime}, which compiles + links them and executes the entry.
 * The entry's `defineComposition(...)` default export becomes a {@link Composer} —
 * and the same Composer object then drives all three destinations from this page:
 *
 *   • **Preview**       — `composer.preview(stage)` mounts + plays it live;
 *   • **Export**        — `composer.export({ container })` renders a video Blob;
 *   • **Server Render** — `composer.toSpec()` downloads the TimelineSpec JSON that
 *                         `pnpm ssr:render` / `ssr:render-node` consume.
 *
 * Everything runs in the tab against an in-memory virtual filesystem — no build
 * step, no server round-trip to see a change.
 */
import { Runtime, type Composer, type PreviewHandle } from '@video-editor-canvas/runtime';

// ── Default multi-file sample program ──────────────────────────────────────
// Three files that import each other, to show the virtual filesystem + linker:
// scene.ts (config + shape factories), title.ts (a keyframed title), index.ts
// (the entry that assembles them via defineComposition).
const DEFAULT_FILES: Record<string, string> = {
  '/index.ts': `import { defineComposition } from '@video-editor-canvas/runtime';
import { W, H, DURATION, background, ball } from './scene';
import { title } from './title';

// The entry's default export becomes the Composer. Edit any file and press Run.
export default defineComposition({
  width: W,
  height: H,
  fps: 30,
  background: 0x0b0b0e,
  range: [0, DURATION],
  tracks: [
    { zIndex: 0, clips: [background] },
    { zIndex: 1, clips: [ball(0x38bdf8, 210), ball(0xf472b6, 285)] },
    { zIndex: 2, clips: [title] },
  ],
});
`,
  '/scene.ts': `import type { ShapeClipSpec } from '@video-editor-canvas/runtime';

export const W = 640;
export const H = 360;
export const DURATION = 4;

// A full-frame backdrop.
export const background: ShapeClipSpec = {
  type: 'shape',
  shape: { kind: 'rect', width: W, height: H, fill: 0x0f172a },
  start: 0,
  end: DURATION,
  transform: { anchor: [0, 0], position: [0, 0] },
};

// A circle that slides left → right over the whole timeline.
export function ball(fill: number, y: number): ShapeClipSpec {
  return {
    type: 'shape',
    shape: { kind: 'ellipse', width: 64, height: 64, fill },
    start: 0,
    end: DURATION,
    transform: {
      anchor: [0.5, 0.5],
      position: {
        keyframes: [
          { time: 0, value: [80, y] },
          { time: DURATION, value: [W - 80, y], easing: 'easeInOutCubic' },
        ],
      },
    },
  };
}
`,
  '/title.ts': `import type { TextClipSpec } from '@video-editor-canvas/runtime';
import { W, DURATION } from './scene';

// A title that fades in over the first second.
export const title: TextClipSpec = {
  type: 'text',
  text: 'Hello from code',
  fontSize: 44,
  fill: 0xffffff,
  start: 0,
  end: DURATION,
  transform: { anchor: [0.5, 0.5], position: [W / 2, 80] },
  opacity: {
    keyframes: [
      { time: 0, value: 0 },
      { time: 1, value: 1, easing: 'easeOutQuad' },
    ],
  },
};
`,
};

const ENTRY = '/index.ts';

function $<T extends HTMLElement>(id: string): T {
  return document.getElementById(id) as T;
}

function downloadBlob(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

function main(): void {
  const files: Record<string, string> = { ...DEFAULT_FILES };
  let activeFile = ENTRY;

  // Live objects for the current run.
  let composer: Composer | null = null;
  let preview: PreviewHandle | null = null;
  let tickSub: { unsubscribe(): void } | null = null;
  let busy = false;

  // ── DOM refs ──────────────────────────────────────────────────────────
  const tabsEl = $<HTMLDivElement>('tabs');
  const codeEl = $<HTMLTextAreaElement>('code');
  const stageEl = $<HTMLDivElement>('stage');
  const logEl = $<HTMLDivElement>('log');
  const runBtn = $<HTMLButtonElement>('run');
  const playBtn = $<HTMLButtonElement>('play');
  const exportBtn = $<HTMLButtonElement>('export');
  const specBtn = $<HTMLButtonElement>('download-spec');
  const scrub = $<HTMLInputElement>('scrub');
  const timeLabel = $<HTMLSpanElement>('time');
  const exportFormat = $<HTMLSelectElement>('export-format');

  function log(message: string, kind: 'info' | 'ok' | 'err' = 'info'): void {
    logEl.textContent = message;
    logEl.className = `log${kind === 'ok' ? ' ok' : kind === 'err' ? ' err' : ''}`;
  }

  // ── File tabs ─────────────────────────────────────────────────────────
  function renderTabs(): void {
    tabsEl.replaceChildren();
    for (const path of Object.keys(files)) {
      const tab = document.createElement('div');
      tab.className = `tab${path === activeFile ? ' active' : ''}`;
      const label = document.createElement('span');
      label.textContent = path.replace(/^\//, '');
      label.addEventListener('click', () => selectFile(path));
      tab.append(label);
      // Every file except the entry can be closed.
      if (path !== ENTRY) {
        const close = document.createElement('span');
        close.className = 'close';
        close.textContent = '×';
        close.title = 'Delete file';
        close.addEventListener('click', (e) => {
          e.stopPropagation();
          deleteFile(path);
        });
        tab.append(close);
      }
      tabsEl.append(tab);
    }
    const add = document.createElement('div');
    add.className = 'tab add';
    add.textContent = '+ file';
    add.addEventListener('click', addFile);
    tabsEl.append(add);
  }

  function selectFile(path: string): void {
    files[activeFile] = codeEl.value; // persist edits before switching
    activeFile = path;
    codeEl.value = files[path] ?? '';
    renderTabs();
    codeEl.focus();
  }

  function addFile(): void {
    const name = prompt('New file name (e.g. lib.ts):', 'lib.ts');
    if (!name) return;
    const path = '/' + name.replace(/^\/+/, '');
    if (files[path] !== undefined) {
      selectFile(path);
      return;
    }
    files[path] = `export const value = 42;\n`;
    selectFile(path);
  }

  function deleteFile(path: string): void {
    if (path === ENTRY) return;
    delete files[path];
    if (activeFile === path) {
      activeFile = ENTRY;
      codeEl.value = files[ENTRY] ?? '';
    }
    renderTabs();
  }

  codeEl.addEventListener('input', () => {
    files[activeFile] = codeEl.value;
  });

  // Insert a soft tab instead of moving focus out of the editor.
  codeEl.addEventListener('keydown', (e) => {
    if (e.key === 'Tab') {
      e.preventDefault();
      const start = codeEl.selectionStart;
      const end = codeEl.selectionEnd;
      codeEl.value = codeEl.value.slice(0, start) + '  ' + codeEl.value.slice(end);
      codeEl.selectionStart = codeEl.selectionEnd = start + 2;
      files[activeFile] = codeEl.value;
    }
  });

  // ── Transport ─────────────────────────────────────────────────────────
  function fmt(t: number): string {
    return t.toFixed(2);
  }

  function updateTransport(t: number): void {
    if (!preview) return;
    scrub.value = String(t);
    timeLabel.textContent = `${fmt(t)} / ${fmt(preview.duration)}s`;
    playBtn.textContent = preview.playing ? '⏸ Pause' : '▶ Play';
  }

  scrub.addEventListener('input', () => {
    if (!preview) return;
    preview.pause();
    preview.seek(parseFloat(scrub.value));
    updateTransport(parseFloat(scrub.value));
  });

  playBtn.addEventListener('click', () => {
    if (!preview) return;
    if (preview.playing) preview.pause();
    else preview.play();
    updateTransport(preview.clock.currentTime);
  });

  // ── Run: compile + run → Composer → preview ───────────────────────────
  async function run(): Promise<void> {
    if (busy) return;
    busy = true;
    files[activeFile] = codeEl.value;
    runBtn.disabled = true;
    log('Compiling and running…');

    // Tear down any previous preview + its GPU graph before rebuilding.
    tickSub?.unsubscribe();
    tickSub = null;
    preview?.dispose();
    preview = null;
    playBtn.disabled = true;
    exportBtn.disabled = true;
    specBtn.disabled = true;

    try {
      composer = await new Runtime({ files, entry: ENTRY }).run();

      stageEl.replaceChildren(); // drop the placeholder / old canvas
      preview = await composer.preview(stageEl);

      scrub.min = '0';
      scrub.max = String(preview.duration);
      scrub.disabled = false;
      playBtn.disabled = false;
      exportBtn.disabled = false;
      specBtn.disabled = false;

      tickSub = preview.clock.onTick((t) => updateTransport(t));
      updateTransport(0);

      const spec = composer.toSpec();
      const clips = (spec.tracks ?? []).reduce((n, tr) => n + tr.clips.length, 0);
      log(
        `Ran ${Object.keys(files).length} file(s) → Composer: ${spec.width}×${spec.height} @ ${spec.fps}fps, ` +
          `${spec.tracks?.length ?? 0} track(s), ${clips} clip(s), ${fmt(preview.duration)}s.`,
        'ok',
      );
    } catch (err) {
      log(String(err instanceof Error ? err.stack ?? err.message : err), 'err');
    } finally {
      runBtn.disabled = false;
      busy = false;
    }
  }

  runBtn.addEventListener('click', run);

  // ── Export (client-side render to a video Blob) ───────────────────────
  exportBtn.addEventListener('click', async () => {
    if (!composer || busy) return;
    busy = true;
    exportBtn.disabled = true;
    preview?.pause();
    updateTransport(preview?.clock.currentTime ?? 0);
    const container = exportFormat.value as 'mp4' | 'webm';
    try {
      log(`Exporting ${container.toUpperCase()}… 0%`);
      const blob = await composer.export({ container }, (p) => {
        log(`Exporting ${container.toUpperCase()}… ${Math.round(p * 100)}%`);
      });
      downloadBlob(blob, `composition.${container}`);
      log(`Exported composition.${container} (${(blob.size / 1024).toFixed(0)} KB).`, 'ok');
    } catch (err) {
      log(`Export failed: ${err instanceof Error ? err.message : String(err)}`, 'err');
    } finally {
      exportBtn.disabled = !composer;
      busy = false;
    }
  });

  // ── Server render (download the serializable spec) ────────────────────
  specBtn.addEventListener('click', () => {
    if (!composer) return;
    const spec = composer.toSpec();
    downloadBlob(new Blob([JSON.stringify(spec, null, 2)], { type: 'application/json' }), 'timeline.json');
    log(
      'Saved timeline.json — render it on a server with:\n' +
        '  pnpm ssr:render      -- --timeline timeline.json --out out.mp4   (headless Chrome)\n' +
        '  pnpm ssr:render-node -- --timeline timeline.json --out out.mp4   (pure Node WebGPU)',
      'ok',
    );
  });

  // ── Boot ──────────────────────────────────────────────────────────────
  codeEl.value = files[activeFile] ?? '';
  renderTabs();
  void run(); // compile + preview the sample immediately
}

main();
