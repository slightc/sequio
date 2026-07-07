/**
 * The browser half of `sequio preview`. Fetches `/__bundle` (the project
 * snapshot the dev server serves), compiles + runs it with the {@link Runtime}
 * into a {@link Composer}, and plays the resulting graph live via
 * `composer.preview(stage)` — the same in-browser render core studio's Code Mode
 * uses. With `--watch`, the dev server issues a full-reload on any file change,
 * so this module simply re-runs from scratch on load.
 */
import { Runtime, type PreviewHandle, type RuntimeBundle } from '@sequio/runtime';

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

scrub.addEventListener('input', () => {
  if (!preview) return;
  preview.pause();
  const t = parseFloat(scrub.value);
  preview.seek(t);
  updateTransport(t);
});

async function boot(): Promise<void> {
  log('Loading composition…');
  try {
    const res = await fetch('/__bundle', { cache: 'no-store' });
    const bundle = (await res.json()) as RuntimeBundle & { error?: string };
    if (!res.ok || bundle.error) throw new Error(bundle.error ?? `bundle request failed (${res.status})`);

    fileEl.textContent = bundle.entry;

    const composer = await new Runtime(bundle).run();
    stageEl.replaceChildren();
    preview = await composer.preview(stageEl);

    scrub.min = '0';
    scrub.max = String(preview.duration);
    scrub.disabled = false;
    playBtn.disabled = false;
    preview.clock.onTick((t) => updateTransport(t));
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
