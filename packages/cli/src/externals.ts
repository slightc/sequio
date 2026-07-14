/**
 * The third-party modules the `sequio` CLI makes resolvable to user
 * compositions, on top of the runtime's built-in `@sequio/engine` /
 * `@sequio/runtime`. This is what lets a composition write
 * `import gsap from 'gsap'` and drive clips through the engine's GSAP binding
 * (`gsapClipAnimator` / `gsapTextAnimator`) with **no per-project setup** — the
 * CLI owns gsap and injects it.
 *
 * `pixi.js` is injected the same way, so a composition can author a **custom
 * effect** (a `PIXI.Filter` subclassing the engine's `Effect`) without the engine
 * having to ship it — the runtime's "bring your own Effect". `pixi.js` is already
 * loaded by the render/preview host (the engine depends on it), so this just makes
 * the same module reachable by a bare `import … from 'pixi.js'` in user code.
 *
 * The engine stays gsap-free (it only declares the binding's structural types);
 * here the CLI — a batteries-included consumer — provides the actual libraries and
 * threads them through the runtime's `externals` seam, identically in both hosts:
 *  - **render** (Node): passed to `@sequio/server/route-b` `renderBundleToFile`;
 *  - **preview** (browser): passed to `new Runtime(...)` on the preview page.
 *
 * Isomorphic: gsap and pixi.js both run in Node and the browser, so the same
 * module is safe to load in either host.
 */
import gsap from 'gsap';
import * as PIXI from 'pixi.js';
import type { Externals } from '@sequio/runtime';

/** Bare-specifier → module value for user code (`import … from 'gsap' | 'pixi.js'`). */
export function cliExternals(): Externals {
  return { gsap, 'pixi.js': PIXI };
}
