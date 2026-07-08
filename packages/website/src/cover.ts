/**
 * Live demo covers, rendered **by sequio itself**. Each card mounts a real
 * `Composer` preview (the same code the card opens in Code Mode), loops it, and
 * pauses it when scrolled out of view so a wall of cards doesn't spin every
 * PixiJS renderer at once.
 *
 * Covers boot through a small sequential queue: initializing several GPU
 * renderers in the same tick contends for contexts, so we bring them up one at a
 * time — the page fills in quickly but smoothly.
 */
import type { Composer, PreviewHandle } from '@sequio/runtime';
import type { Subscription } from '@sequio/engine';
import type { Demo } from './demos';
import { makeRuntime } from './engine-host';

export interface CoverHandle {
  dispose(): void;
}

// A promise chain that serializes cover boot-up across all cards on the page.
let bootQueue: Promise<unknown> = Promise.resolve();

/**
 * Mount a looping, sequio-rendered preview of `demo` into `mount`. Returns a
 * handle whose `dispose()` tears the preview + its GPU graph down (call it when
 * the gallery unmounts).
 */
export function mountCover(mount: HTMLElement, demo: Demo): CoverHandle {
  let disposed = false;
  let preview: PreviewHandle | null = null;
  let endedSub: Subscription | null = null;
  let observer: IntersectionObserver | null = null;

  const fallback = mount.querySelector('.cover-fallback');

  const boot = async (): Promise<void> => {
    if (disposed) return;
    let composer: Composer;
    try {
      composer = await makeRuntime(demo.files, demo.entry).run();
      preview = await composer.preview(mount);
    } catch (err) {
      if (!disposed) mount.setAttribute('data-error', '1');
      console.warn(`[cover:${demo.id}]`, err);
      return;
    }
    if (disposed) {
      preview.dispose();
      preview = null;
      return;
    }
    fallback?.remove();
    preview.seek(demo.poster); // seed a representative first frame

    // Loop: when the clock reaches the end, jump back and keep playing.
    endedSub = preview.clock.onEnded(() => {
      if (!disposed && preview) {
        preview.seek(0);
        preview.play();
      }
    });

    // Only play while the card is on screen.
    observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.some((e) => e.isIntersecting);
        if (!preview) return;
        if (visible && !preview.playing) preview.play();
        else if (!visible && preview.playing) preview.pause();
      },
      { threshold: 0.15 },
    );
    observer.observe(mount);
  };

  bootQueue = bootQueue.then(boot, boot);

  return {
    dispose(): void {
      disposed = true;
      observer?.disconnect();
      observer = null;
      endedSub?.unsubscribe();
      endedSub = null;
      preview?.dispose();
      preview = null;
    },
  };
}
