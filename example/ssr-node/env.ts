/**
 * Node environment bootstrap for **pure server-side rendering** (Route B — no
 * browser). PixiJS assumes browser globals; this file supplies just enough of
 * them, backed by native Node libraries, so the SDK's WebGPU render core runs in
 * Node with **full filter/effect support** (contract #3 — same core as preview):
 *
 * - **GPU**: `webgpu` (Dawn) provides `navigator.gpu` + the `GPU*` constants.
 *   Filters/warp/transitions are shaders, so a real GPU pipeline (not Canvas 2D)
 *   is required — this is why WebGPU, not `@napi-rs/canvas`, is the backend. Needs
 *   a Vulkan-capable host: a real GPU, or a software driver (Mesa **lavapipe**).
 * - **2D canvas + fonts**: `@napi-rs/canvas` backs `DOMAdapter.createCanvas`
 *   (Pixi measures text via a 2D canvas) and registers fonts via `GlobalFonts`.
 * - **DOM**: `jsdom` supplies `document`/`window`; small shims cover the ticker's
 *   `requestAnimationFrame` and the event system's `addEventListener`.
 * - **Codecs**: `@mediabunny/server` (`node-av`/FFmpeg) polyfills WebCodecs at the
 *   Mediabunny layer, so decode/encode/mux work (see `export-node.ts`).
 *
 * A few shims paper over Dawn being *stricter* than a browser (it rejects the
 * string bind-group index Pixi passes) and over `@napi-rs/canvas` not being an
 * `HTMLCanvasElement` (Pixi/CanvasSource would otherwise reject it).
 *
 * All deps are dev/optional — importing this file only makes sense on a server
 * set up for Route B. See `docs/server-side-rendering.md`.
 */
import type { AutoDetectOptions, Renderer } from 'pixi.js';

let ready = false;
/** Tag identifying our `@napi-rs/canvas` instances to Pixi's canvas checks. */
const NAPI = Symbol('napi-canvas');

/**
 * Install the browser-global shims and return the GPU handle. Idempotent.
 * Throws if no WebGPU adapter is available (no GPU and no software Vulkan
 * driver) — the caller should surface that as "Route B unavailable on this host".
 */
export async function setupNodeEnvironment(): Promise<void> {
  if (ready) return;

  const { JSDOM } = await import('jsdom');
  const dom = new JSDOM('<!doctype html><html><body></body></html>');
  for (const k of ['window', 'document', 'navigator', 'HTMLElement', 'Node', 'DOMParser'] as const) {
    if ((globalThis as Record<string, unknown>)[k] === undefined && dom.window[k] !== undefined) {
      try {
        (globalThis as Record<string, unknown>)[k] = dom.window[k];
      } catch {
        /* read-only global (e.g. navigator on newer Node) — leave it */
      }
    }
  }
  // Pixi's ticker uses rAF; its event system touches global add/removeEventListener.
  const g = globalThis as Record<string, unknown>;
  g.requestAnimationFrame ??= (cb: (t: number) => void) => setTimeout(() => cb(Date.now()), 16) as unknown as number;
  g.cancelAnimationFrame ??= (id: number) => clearTimeout(id);
  g.addEventListener ??= () => {};
  g.removeEventListener ??= () => {};

  // WebGPU via Dawn: expose navigator.gpu + the GPU* constant/class globals.
  const wg = await import('webgpu');
  const gpu = wg.create([]);
  for (const [k, v] of Object.entries(wg.globals ?? {})) {
    if ((globalThis as Record<string, unknown>)[k] === undefined) {
      try {
        (globalThis as Record<string, unknown>)[k] = v;
      } catch {
        /* ignore */
      }
    }
  }
  Object.defineProperty(globalThis.navigator, 'gpu', { value: gpu, configurable: true });
  const adapter = await gpu.requestAdapter();
  if (!adapter) {
    throw new Error(
      'No WebGPU adapter — Route B needs a GPU or a software Vulkan driver (install Mesa lavapipe: `apt install mesa-vulkan-drivers`).',
    );
  }

  // Dawn's binding is strict where browsers coerce: Pixi passes a string
  // bind-group index (a for..in key). Coerce it so setBindGroup's overload matches.
  const wgGlobals = wg.globals as Record<string, { prototype?: Record<string, (...a: unknown[]) => unknown> }>;
  const proto = wgGlobals?.GPURenderPassEncoder?.prototype;
  if (proto?.setBindGroup) {
    const orig = proto.setBindGroup;
    proto.setBindGroup = function (this: unknown, index: unknown, ...rest: unknown[]) {
      return orig.call(this, Number(index), ...rest);
    };
  }

  // Dawn's `copyExternalImageToTexture` can't read a `@napi-rs/canvas` as an
  // image source (text / image / video textures upload through it). Reroute it
  // to `writeTexture` with the canvas's raw pixels. Colours are read as RGBA;
  // if the destination is BGRA the R/B channels swap — fine for white/greyscale
  // text, a caveat for colour glyphs (see docs).
  const queueProto = wgGlobals?.GPUQueue?.prototype as
    | { copyExternalImageToTexture?: (...a: unknown[]) => unknown; writeTexture?: (...a: unknown[]) => unknown }
    | undefined;
  if (queueProto?.copyExternalImageToTexture && queueProto.writeTexture) {
    const origCopy = queueProto.copyExternalImageToTexture;
    queueProto.copyExternalImageToTexture = function (this: { writeTexture: (...a: unknown[]) => unknown }, ...args: unknown[]) {
      const source = args[0] as { source?: Record<string | symbol, unknown> };
      const dest = args[1] as Record<string, unknown>;
      const img = source?.source;
      if (img && img[NAPI]) {
        const w = img.width as number;
        const h = img.height as number;
        const ctx = (img.getContext as (t: string) => { getImageData(x: number, y: number, w: number, h: number): { data: Uint8ClampedArray } })('2d');
        const src = ctx.getImageData(0, 0, w, h).data; // straight-alpha RGBA
        // Match what `copyExternalImageToTexture` would do: honour the destination
        // texture's channel order (BGRA vs RGBA) and premultiply if requested —
        // otherwise coloured glyphs/images come out with R/B swapped or wrong edges.
        const format = String((dest.texture as { format?: string })?.format ?? '');
        const bgra = format.startsWith('bgra');
        const premultiply = dest.premultipliedAlpha === true;
        const out = new Uint8Array(w * h * 4);
        for (let i = 0; i < w * h; i++) {
          const j = i * 4;
          let r = src[j]!;
          let g = src[j + 1]!;
          let b = src[j + 2]!;
          const a = src[j + 3]!;
          if (premultiply) {
            r = (r * a + 127) / 255 | 0;
            g = (g * a + 127) / 255 | 0;
            b = (b * a + 127) / 255 | 0;
          }
          if (bgra) {
            out[j] = b; out[j + 1] = g; out[j + 2] = r; out[j + 3] = a;
          } else {
            out[j] = r; out[j + 1] = g; out[j + 2] = b; out[j + 3] = a;
          }
        }
        return this.writeTexture(
          { texture: dest.texture, mipLevel: dest.mipLevel ?? 0, origin: dest.origin ?? {}, aspect: dest.aspect ?? 'all' },
          out,
          { offset: 0, bytesPerRow: w * 4, rowsPerImage: h },
          { width: w, height: h, depthOrArrayLayers: 1 },
        );
      }
      return origCopy.apply(this, args);
    };
  }

  // Route Pixi's canvas creation through @napi-rs/canvas, and teach Pixi to
  // accept those canvases (they aren't jsdom HTMLCanvasElements).
  const { createCanvas } = await import('@napi-rs/canvas');
  const makeCanvas = (w?: number, h?: number) => {
    const c = createCanvas(w || 1, h || 1) as unknown as Record<string | symbol, unknown>;
    c[NAPI] = true;
    const orig = (c.getContext as (t: string, ...r: unknown[]) => unknown).bind(c);
    c.getContext = (type: string, ...r: unknown[]) => (type === '2d' ? orig('2d', ...r) : null);
    c.addEventListener = () => {};
    c.removeEventListener = () => {};
    c.style = {};
    c.getBoundingClientRect = () => ({
      x: 0, y: 0, top: 0, left: 0, right: c.width as number, bottom: c.height as number,
      width: c.width as number, height: c.height as number,
    });
    return c;
  };

  const pixi = await import('pixi.js');
  // Runtime glue against Pixi's Adapter/canvas contracts — cast the interop.
  const DOMParserCtor = (globalThis as unknown as { DOMParser: new () => { parseFromString(s: string, t: string): unknown } }).DOMParser;
  pixi.DOMAdapter.set({
    createCanvas: (w?: number, h?: number) => makeCanvas(w, h),
    createImage: () => makeCanvas(1, 1),
    getCanvasRenderingContext2D: () => (createCanvas(1, 1).getContext('2d') as { constructor: unknown }).constructor,
    getWebGLRenderingContext: () => function WebGLRenderingContext() {},
    getNavigator: () => globalThis.navigator,
    getBaseUrl: () => 'http://localhost/',
    getFontFaceSet: () => undefined,
    fetch: (...a: Parameters<typeof fetch>) => fetch(...a),
    parseXML: (s: string) => new DOMParserCtor().parseFromString(s, 'text/xml'),
  } as unknown as Parameters<typeof pixi.DOMAdapter.set>[0]);
  // The screen render target and texture uploads reject non-HTMLCanvasElements;
  // accept our tagged napi canvases so Pixi paints into the view we control.
  const origTest = pixi.CanvasSource.test.bind(pixi.CanvasSource);
  pixi.CanvasSource.test = ((res: unknown) =>
    !!(res && (res as Record<symbol, unknown>)[NAPI]) || origTest(res as never)) as typeof pixi.CanvasSource.test;

  // WebCodecs polyfill (decode/encode/mux via node-av / FFmpeg).
  const { registerMediabunnyServer } = await import('@mediabunny/server');
  registerMediabunnyServer();

  ready = true;
}

/**
 * A {@link CompositorOptions.createRenderer} factory that builds a PixiJS WebGPU
 * renderer in Node. Requires {@link setupNodeEnvironment} to have run.
 */
export async function createNodeWebGPURenderer(options: Partial<AutoDetectOptions>): Promise<Renderer> {
  const { WebGPURenderer } = await import('pixi.js');
  const renderer = new WebGPURenderer();
  await renderer.init({
    width: options.width,
    height: options.height,
    background: options.background,
    backgroundAlpha: 1,
    antialias: false,
    // No canvas presentation — we render to RenderTextures and read them back.
  });
  return renderer as unknown as Renderer;
}
