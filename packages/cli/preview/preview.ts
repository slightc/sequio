/**
 * The browser half of `sequio preview`. Fetches `/__bundle` (the project
 * snapshot the dev server serves), compiles + runs it with the {@link Runtime}
 * into a {@link Composer}, and plays the resulting graph live via
 * `composer.preview(stage)` — the same in-browser render core studio's Code Mode
 * uses. With `--watch`, the dev server issues a full-reload on any file change,
 * so this module simply re-runs from scratch on load.
 */
import { Runtime, type Composer, type PreviewHandle, type RuntimeBundle, type Subscription } from '@sequio/runtime';
// Browser-safe subpath so the preview page resolves the same `cliExternals` in
// both hosts: from source in this repo (alias in src/preview.ts) and from the
// published `dist/externals.js` when installed from npm.
import { cliExternals } from '@sequio/cli/externals';
import { browserAssetLoader } from './assets';

function $<T extends HTMLElement>(id: string): T {
  return document.getElementById(id) as T;
}

const stageEl = $<HTMLDivElement>('stage');
const fileEl = $<HTMLSpanElement>('file');
const logEl = $<HTMLDivElement>('log');
const playBtn = $<HTMLButtonElement>('play');
const scrub = $<HTMLInputElement>('scrub');
const timeLabel = $<HTMLSpanElement>('time');

function log(message: string, kind: 'info' | 'ok' | 'err' = 'info'): void {
  logEl.textContent = message;
  logEl.className = `log${kind === 'ok' ? ' ok' : kind === 'err' ? ' err' : ''}`;
}

function fmt(t: number): string {
  return t.toFixed(2);
}

let preview: PreviewHandle | null = null;
// Retained so we can rebuild the preview in place (a fresh compositor + renderer
// + canvas) without a page reload when the GPU context is lost — see below.
let composer: Composer | null = null;
let lostSub: Subscription | null = null;
let needsRebuild = false;
// Cap automatic rebuilds so a persistently-broken GPU can't hot-loop; the count
// resets each time the tab is backgrounded again (a fresh reclaim cycle).
let rebuildAttempts = 0;
const MAX_REBUILDS = 3;

function updateTransport(t: number): void {
  if (!preview) return;
  scrub.value = String(t);
  timeLabel.textContent = `${fmt(t)} / ${fmt(preview.duration)}s`;
  playBtn.textContent = preview.playing ? '⏸ Pause' : '▶ Play';
}

playBtn.addEventListener('click', () => {
  if (!preview) return;
  if (preview.playing) preview.pause();
  else preview.play();
  updateTransport(preview.clock.currentTime);
});

// Scrubbing fires `input` far faster than we can decode + repaint, so coalesce
// rapid inputs into at most one seek per animation frame (the clock frame-snaps
// the seek itself). A drag then triggers one render per frame boundary crossed.
let scrubRaf = 0;
let scrubPending = 0;
scrub.addEventListener('input', () => {
  if (!preview) return;
  preview.pause();
  scrubPending = parseFloat(scrub.value);
  if (scrubRaf !== 0) return;
  scrubRaf = requestAnimationFrame(() => {
    scrubRaf = 0;
    if (!preview) return;
    preview.seek(scrubPending);
    updateTransport(preview.clock.currentTime);
  });
});

// A browser reclaims a backgrounded tab's GPU state after a while — either losing
// the WebGPU device outright or just freeing its buffers (the next submit then
// errors with "used in submit while destroyed"). Both are silent (no thrown
// exception), PixiJS v8 doesn't recover, so the whole canvas goes black while
// audio (GPU-independent) keeps playing, and only a page reload fixes it. The
// engine surfaces all of that through onContextLost; rebuild the preview in place
// instead: a fresh compositor + renderer + canvas from the retained Composer,
// restoring the current time + play state. The loss usually arrives while the tab
// is still hidden, so defer the rebuild until it's visible again (a new GPU device
// for a hidden tab may just be lost again), and cap consecutive rebuilds.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') rebuildAttempts = 0; // new reclaim cycle
  else maybeRebuild();
});

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

/** Wire transport + context-loss handling onto a freshly-built preview. */
function wirePreview(p: PreviewHandle): void {
  p.clock.onTick((t) => updateTransport(t));
  // Reaching the end auto-pauses the clock but fires no further tick, so
  // refresh the transport (Play button label, scrub) on `ended` too.
  p.clock.onEnded(() => updateTransport(p.clock.currentTime));
  lostSub?.unsubscribe();
  lostSub = p.onContextLost(() => {
    needsRebuild = true;
    log('GPU context lost (tab backgrounded) — rebuilding preview…');
    maybeRebuild();
  });
}

/** Tear down the current preview and rebuild it from the retained Composer,
 *  restoring time + play state — the in-place equivalent of a page reload. */
async function rebuildPreview(): Promise<void> {
  if (!composer || !preview) return;
  const t = preview.clock.currentTime;
  const wasPlaying = preview.playing;
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
    log(err instanceof Error ? (err.stack ?? err.message) : String(err), 'err');
  }
}

async function boot(): Promise<void> {
  log('Loading composition…');
  try {
    const res = await fetch('/__bundle', { cache: 'no-store' });
    const bundle = (await res.json()) as RuntimeBundle & { error?: string };
    if (!res.ok || bundle.error) throw new Error(bundle.error ?? `bundle request failed (${res.status})`);

    fileEl.textContent = bundle.entry;

    composer = await new Runtime({
      ...bundle,
      externals: cliExternals(),
      // Resolve `loadAsset('./clip.mp4')` by fetching the file the dev server
      // serves under /__asset/ (readBundle keeps binary assets out of the bundle).
      loadAsset: browserAssetLoader(),
    }).run();
    stageEl.replaceChildren();
    preview = await composer.preview(stageEl);

    scrub.min = '0';
    scrub.max = String(preview.duration);
    scrub.disabled = false;
    playBtn.disabled = false;
    wirePreview(preview);
    updateTransport(0);

    const tracks = preview.built.compositor.getTracks();
    const clips = tracks.reduce((n, t) => n + t.clips.length, 0);
    log(
      `Ran ${Object.keys(bundle.files).length} file(s) → ${tracks.length} track(s), ` +
        `${clips} clip(s), ${fmt(preview.duration)}s. Ready.`,
      'ok',
    );
    // Publish a result the `verify:cli` harness can assert on (repo convention).
    (window as unknown as { __PREVIEW_TEST__: unknown }).__PREVIEW_TEST__ = {
      ok: tracks.length > 0 && preview.duration > 0,
      tracks: tracks.length,
      clips,
      duration: preview.duration,
    };
  } catch (err) {
    log(err instanceof Error ? (err.stack ?? err.message) : String(err), 'err');
    (window as unknown as { __PREVIEW_TEST__: unknown }).__PREVIEW_TEST__ = {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

void boot();
