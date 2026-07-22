/**
 * Studio "Code Mode" — author a composition **as imperative code** and run it.
 *
 * This is the reference consumer of `@sequio/runtime`. The user
 * edits a small multi-file TS program in the browser that builds the object graph
 * with the engine's own classes — `new Compositor()`, `new VisualTrack()`,
 * `track.add(new ShapeClip(...))` — exactly like the `example/` demos (so a user
 * can bring their own `Clip` / `Effect` subclasses, no schema to sync). Pressing
 * Run hands those files to a {@link Runtime}, which compiles + links them and
 * executes the entry; its `defineComposition(builder)` default export becomes a
 * {@link Composer}. The same Composer then drives all three destinations:
 *
 *   • **Preview**       — `composer.preview(stage)` mounts + plays it live;
 *   • **Export**        — `composer.export({ container })` renders a video Blob;
 *   • **Server Render** — `composer.toBundle()` downloads the portable source
 *                         files; a runtime re-runs that code on a server.
 *
 * Everything runs in the tab against an in-memory virtual filesystem — no build
 * step, no server round-trip to see a change.
 */
import { Runtime, type Composer, type PreviewHandle } from '@sequio/runtime';

// ── Default multi-file sample program ──────────────────────────────────────
// Three files that import each other, to show the virtual filesystem + linker.
// scene.ts / title.ts build engine clips imperatively; index.ts assembles a
// Compositor. It reads exactly like an `example/` demo — the runtime injects any
// server renderer into `new Compositor` implicitly, so there's no env plumbing.
const DEFAULT_FILES: Record<string, string> = {
  '/index.ts': `import { Compositor, VisualTrack } from '@sequio/engine';
import { defineComposition } from '@sequio/runtime';
import { W, H, DURATION, background, ball } from './scene';
import { title } from './title';

// The builder's default export becomes the Composer. Edit any file and press Run.
export default defineComposition(async () => {
  const compositor = new Compositor({
    width: W,
    height: H,
    fps: 30, // or pass a Timebase; omit both for 30fps
    background: 0x0b0b0e,
    preferWebGPU: true,
  });
  await compositor.init();

  const bg = new VisualTrack();
  bg.add(background());
  compositor.addTrack(bg);

  const balls = new VisualTrack();
  balls.zIndex = 1;
  balls.add(ball(0x38bdf8, 210));
  balls.add(ball(0xf472b6, 285));
  compositor.addTrack(balls);

  const text = new VisualTrack();
  text.zIndex = 2;
  text.add(title());
  compositor.addTrack(text);

  return { compositor, duration: DURATION };
});
`,
  '/scene.ts': `import { ShapeClip, easeInOutCubic } from '@sequio/engine';

export const W = 640;
export const H = 360;
export const DURATION = 4;

// A full-frame backdrop.
export function background(): ShapeClip {
  const bg = new ShapeClip({ kind: 'rect', width: W, height: H, fill: 0x0f172a });
  bg.start = 0;
  bg.end = DURATION;
  bg.transform.anchor.setStatic([0, 0]);
  bg.transform.position.setStatic([0, 0]);
  return bg;
}

// A circle that slides left → right over the whole timeline (keyframed).
export function ball(fill: number, y: number): ShapeClip {
  const c = new ShapeClip({ kind: 'ellipse', width: 64, height: 64, fill });
  c.start = 0;
  c.end = DURATION;
  c.transform.anchor.setStatic([0.5, 0.5]);
  c.transform.position.setKeyframes([
    { time: 0, value: [80, y] },
    { time: DURATION, value: [W - 80, y], easing: easeInOutCubic },
  ]);
  return c;
}
`,
  '/title.ts': `import { TextClip, easeOutQuad } from '@sequio/engine';
import { W, DURATION } from './scene';

// A title that fades in over the first second.
export function title(): TextClip {
  const t = new TextClip({ text: 'Hello from code', fontSize: 44, fill: 0xffffff });
  t.start = 0;
  t.end = DURATION;
  t.transform.anchor.setStatic([0.5, 0.5]);
  t.transform.position.setStatic([W / 2, 80]);
  t.opacity.setKeyframes([
    { time: 0, value: 0 },
    { time: 1, value: 1, easing: easeOutQuad },
  ]);
  return t;
}
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
  const bundleBtn = $<HTMLButtonElement>('download-spec');
  const scrub = $<HTMLInputElement>('scrub');
  const timeLabel = $<HTMLSpanElement>('time');
  const exportFormat = $<HTMLSelectElement>('export-format');

  // A browser reclaims a backgrounded tab's GPU memory after a while, silently
  // losing the WebGPU device (no error); PixiJS v8 doesn't recover, so the whole
  // canvas goes black — audio keeps playing — until the page is reloaded. Rebuild
  // the preview in place instead (fresh compositor + renderer + canvas from the
  // retained Composer, restoring time + play state). The loss usually arrives
  // while the tab is still hidden, so defer the rebuild until it's visible again.
  let needsRebuild = false;
  let lostSub: { unsubscribe(): void } | null = null;
  let rebuildAttempts = 0;
  const MAX_REBUILDS = 3;

  function maybeRebuild(): void {
    if (!needsRebuild || document.visibilityState !== 'visible') return;
    needsRebuild = false;
    if (rebuildAttempts >= MAX_REBUILDS) {
      log('GPU context keeps failing after several rebuilds — please reload the page.', 'err');
      return;
    }
    rebuildAttempts++;
    void rebuildPreview();
  }
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') rebuildAttempts = 0; // new reclaim cycle
    else maybeRebuild();
  });

  async function rebuildPreview(): Promise<void> {
    if (!composer || !preview) return;
    const t = preview.clock.currentTime;
    const wasPlaying = preview.playing;
    tickSub?.unsubscribe();
    tickSub = null;
    preview.dispose();
    preview = null;
    stageEl.replaceChildren();
    try {
      preview = await composer.preview(stageEl);
      wirePreview(preview);
      scrub.max = String(preview.duration);
      preview.seek(t);
      if (wasPlaying) preview.play();
      updateTransport(preview.clock.currentTime);
      log('Preview rebuilt after GPU context loss.', 'ok');
    } catch (err) {
      log(String(err instanceof Error ? err.stack ?? err.message : err), 'err');
    }
  }

  /** Wire the per-frame transport tick + context-loss rebuild onto a preview. */
  function wirePreview(p: PreviewHandle): void {
    tickSub = p.clock.onTick((t) => updateTransport(t));
    lostSub?.unsubscribe();
    lostSub = p.onContextLost(() => {
      needsRebuild = true;
      log('GPU context lost (tab backgrounded) — rebuilding preview…');
      maybeRebuild();
    });
  }

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
    bundleBtn.disabled = true;

    try {
      composer = await new Runtime({ files, entry: ENTRY }).run();

      stageEl.replaceChildren(); // drop the placeholder / old canvas
      preview = await composer.preview(stageEl);

      scrub.min = '0';
      scrub.max = String(preview.duration);
      scrub.disabled = false;
      playBtn.disabled = false;
      exportBtn.disabled = false;
      bundleBtn.disabled = false;

      wirePreview(preview);
      updateTransport(0);

      const tracks = preview.built.compositor.getTracks();
      const clips = tracks.reduce((n, t) => n + t.clips.length, 0);
      log(
        `Ran ${Object.keys(files).length} file(s) → Composer: ${tracks.length} track(s), ` +
          `${clips} clip(s), ${fmt(preview.duration)}s.`,
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

  // ── Server render (download the portable code bundle) ─────────────────
  bundleBtn.addEventListener('click', () => {
    if (!composer) return;
    const bundle = composer.toBundle();
    downloadBlob(new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' }), 'bundle.json');
    log(
      'Saved bundle.json (the source files themselves) — render it on a server with:\n' +
        '  pnpm ssr:render -- --bundle bundle.json --out out.mp4   (headless Chrome runs the same code)',
      'ok',
    );
  });

  // ── Boot ──────────────────────────────────────────────────────────────
  codeEl.value = files[activeFile] ?? '';
  renderTabs();
  void run(); // compile + preview the sample immediately
}

main();
