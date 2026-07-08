/**
 * Shared glue between the website and `@sequio/runtime`.
 *
 * Every place the site runs user code — the demo covers and Code Mode — goes
 * through {@link makeRuntime} so they all get the **same** injected externals.
 * We inject `gsap` exactly like the `sequio` CLI does, so a composition can
 * `import gsap from 'gsap'` and drive clips with a (paused, seeked) timeline.
 */
import { Runtime } from '@sequio/runtime';
import gsap from 'gsap';

/** Bare specifiers a composition may import, beyond the built-in engine/runtime. */
export const EXTERNALS = { gsap } as const;

/** A {@link Runtime} over the given files with the site's externals injected. */
export function makeRuntime(files: Record<string, string>, entry: string): Runtime {
  return new Runtime({ files, entry, externals: { ...EXTERNALS } });
}
