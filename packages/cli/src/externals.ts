/**
 * The third-party modules the `sequio` CLI makes resolvable to user
 * compositions, on top of the runtime's built-in `@sequio/engine` /
 * `@sequio/runtime`. This is what lets a composition write
 * `import gsap from 'gsap'` and drive clips through the engine's GSAP binding
 * (`gsapClipAnimator` / `gsapTextAnimator`) with **no per-project setup** — the
 * CLI owns gsap and injects it.
 *
 * The engine stays gsap-free (it only declares the binding's structural types);
 * here the CLI — a batteries-included consumer — provides the actual library and
 * threads it through the runtime's `externals` seam, identically in both hosts:
 *  - **render** (Node): passed to `@sequio/server/route-b` `renderBundleToFile`;
 *  - **preview** (browser): passed to `new Runtime(...)` on the preview page.
 *
 * Isomorphic: only imports gsap (which runs in Node and the browser) and a type,
 * so the same module is safe to load in either host.
 */
import gsap from 'gsap';
import type { Externals } from '@sequio/runtime';

/** Bare-specifier → module value for user code. `import gsap from 'gsap'` works. */
export function cliExternals(): Externals {
  return { gsap };
}
