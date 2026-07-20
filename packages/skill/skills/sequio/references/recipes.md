# sequio recipes

Copy-paste patterns. Each is an imperative composition — the same code runs in
browser preview, browser export, and server render (contract #3). Author them as
a `defineComposition(builder)` module and drive with `sequio preview` / `sequio
render`, or lift the body into an app that owns its own clock.

## 1. Title over a background

```ts
import { Compositor, VisualTrack, TextClip, ShapeClip } from '@sequio/engine';
import { defineComposition } from '@sequio/runtime';

export default defineComposition(async () => {
  const c = new Compositor({ width: 1280, height: 720, fps: 30 });
  await c.init();

  const bg = new VisualTrack();
  const rect = new ShapeClip({ kind: 'rect', width: 1280, height: 720, fill: 0x101018 });
  rect.start = 0; rect.end = 5;
  rect.transform.anchor.setStatic([0, 0]);
  rect.transform.position.setStatic([0, 0]);
  bg.add(rect);
  c.addTrack(bg);

  const layer = new VisualTrack();
  layer.zIndex = 1;
  const title = new TextClip({ text: 'Hello', fontSize: 96, fill: 0xffffff });
  title.start = 0; title.end = 5;
  title.transform.anchor.setStatic([0.5, 0.5]);
  title.transform.position.setStatic([640, 360]);
  layer.add(title);
  c.addTrack(layer);

  return { compositor: c, duration: 5 };
});
```

## 2. Keyframed motion + fade

```ts
import { easeOutCubic } from '@sequio/engine';
// clip.transform properties are AnimatableProperty — keyframe any of them.
clip.transform.position.setKeyframes([
  { time: 0, value: [200, 360] },
  { time: 1.2, value: [640, 360], easing: easeOutCubic },
]);
clip.transform.scale.setKeyframes([
  { time: 0, value: [0.6, 0.6] },
  { time: 1.2, value: [1, 1], easing: easeOutCubic },
]);
clip.transform.alpha.setKeyframes([
  { time: 0, value: 0 },
  { time: 0.6, value: 1 },
]);
```

## 3. GSAP-driven entrance (CLI injects gsap)

```ts
import gsap from 'gsap';
import { gsapClipAnimator } from '@sequio/engine';

title.animator = gsapClipAnimator(gsap, (tl, o) => {
  tl.from(o, { y: -80, alpha: 0, duration: 0.8, ease: 'back.out(1.7)' });
});
```

The binding seeks a **paused** gsap timeline so `render(t)` stays pure. In your
own app (not the CLI) you must inject gsap via `RuntimeOptions.externals` or use
it directly — the engine declares only the structural `GsapLike` types.

## 4. Per-character text drop-in

```ts
import { StaggerTextAnimator } from '@sequio/engine';

title.split = 'char';                       // split into per-character parts
title.textAnimator = new StaggerTextAnimator({
  from: { y: -40, alpha: 0 },               // each part starts 40px up + invisible
  stagger: 0.04,                            // delay between consecutive parts (s)
  duration: 0.5,                            // per-part animation length (s)
});
```

Split text uses `textAnimator` (a `TextAnimator`); a whole-clip animator uses
`animator` (a `ClipAnimator`) — don't mix the two fields. For gsap-driven per-part
motion use `gsapTextAnimator(gsap, split, builder)`.

## 5. Video and image clips

```ts
import { Compositor, VisualTrack, VideoClip, ImageClip, VideoSource, ImageSource } from '@sequio/engine';
import { defineComposition, loadAsset } from '@sequio/runtime';

export default defineComposition(async () => {
  const c = new Compositor({ width: 1920, height: 1080, fps: 30 });
  await c.init();

  // URL sources (browser fetch / Node UrlSource) — nothing committed to the repo:
  const web = new ImageSource({ src: 'https://picsum.photos/id/1015/1280/720' });
  // Local file next to the composition — host provides the bytes, never bundled:
  const local = new VideoSource({ src: await loadAsset('./clip.mp4') });

  const track = new VisualTrack();
  const img = new ImageClip({ source: web });
  img.start = 0; img.end = 3;
  const vid = new VideoClip({ source: local });
  vid.start = 3; vid.end = 8;
  track.add(img); track.add(vid);
  c.addTrack(track);

  return { compositor: c };
});
```

## 6. Custom font (preview == render)

```ts
import { fonts, TextClip } from '@sequio/engine';

// Load an explicit web font so Node render matches browser preview
// (system defaults differ per platform). `src` may be a URL or a data: URL.
await fonts.load({ family: 'Poppins', src: POPPINS_DATA_URL });
const title = new TextClip({ text: 'sequio', fontFamily: 'Poppins', fontSize: 72, fill: 0xffffff });
```

## 7. An effect on a clip + a crossfade

```ts
import { BlurEffect, CrossfadeTransition } from '@sequio/engine';

const blur = new BlurEffect();
blur.strength.setStatic(8);            // strength is an AnimatableProperty (keyframe it too)
clip.effects.push(blur);               // `effects` is an array

// A crossfade between two OVERLAPPING clips on one track — their overlap is the
// transition window (bind order is direction: from → to):
track.addTransition(new CrossfadeTransition(15).between(clipA, clipB)); // 15 frames
```

(chroma/LUT/wipe are not yet built — check `references/api.md` and the classes in
`packages/engine/src/effects/`. To author your own, see the next recipe.)

## 7b. Bring your own — custom effect · transition · animation

All four extension points are plain subclasses/implementations imported from
`@sequio/engine` only. Build on the engine's own classes (or keep the animators
pure math) and you need **no `pixi.js`**, so they render the same in preview
(WebGL) and Node render (WebGPU). Full worked demo: `packages/cli/example/custom-fx/`.

```ts
// ── a custom EFFECT — subclass an engine effect, reuse its built-in filter ──
import { BlurEffect, AnimatableProperty } from '@sequio/engine';
class FocusPull extends BlurEffect {
  readonly focus = new AnimatableProperty<number>(0);     // 0 sharp → 1 blurred
  constructor(readonly maxBlur = 28) { super(); }
  override updateAt(t: number) {
    this.strength.setStatic(this.focus.valueAt(t) * this.maxBlur);
    super.updateAt(t);                                     // let BlurEffect push it into the filter
  }
}
const fx = new FocusPull(30);
fx.focus.setKeyframes([{ time: 0, value: 1 }, { time: 0.8, value: 0 }]);
clip.effects.push(fx);

// ── a custom TRANSITION — subclass CrossfadeTransition, reshape the curve ──
import { CrossfadeTransition, easeInOutCubic } from '@sequio/engine';
class EasedCrossfade extends CrossfadeTransition {
  override progressAt(t: number) { return easeInOutCubic(super.progressAt(t)); }
}
track.addTransition(new EasedCrossfade(30).between(clipA, clipB));

// ── a custom whole-clip ANIMATION — implement ClipAnimator (pure sampleAt) ──
import type { AnimationSample, ClipAnimator } from '@sequio/engine';
class OrbitAnimator implements ClipAnimator {
  constructor(private r = 90, private period = 2.6) {}
  sampleAt(localT: number): AnimationSample {              // sampled at t - clip.start
    const a = (localT / this.period) * Math.PI * 2;
    return { x: Math.cos(a) * this.r, y: Math.sin(a) * this.r, rotation: a };
  }
}
clip.animator = new OrbitAnimator();

// ── a custom TEXT ANIMATION — implement TextAnimator (per split part) ──
import type { AnimationSample, TextAnimator, TextPart } from '@sequio/engine';
import { easeOutCubic } from '@sequio/engine';
class DropInText implements TextAnimator {
  constructor(private stagger = 0.06, private dur = 0.5, private drop = 70) {}
  sampleForPart(part: TextPart, localT: number): AnimationSample {
    const k = (localT - part.index * this.stagger) / this.dur;
    const p = k <= 0 ? 0 : k >= 1 ? 1 : easeOutCubic(k);
    return { y: -this.drop * (1 - p), alpha: p };
  }
}
title.split = 'char';
title.textAnimator = new DropInText();
```

`sampleAt` / `sampleForPart` / `updateAt(t)` / `render(t)` must be **pure functions
of time** (contract #2) — no wall-clock, no dependence on the previous frame — so
export stays reproducible. An `AnimationSample` composes over the clip's base
transform: `x`/`y`/`rotation` add, `scaleX`/`scaleY`/`alpha` multiply.

## 8. Export from your own app (not the CLI)

- Runtime `Composer`: `const blob = await composer.export({ format: 'mp4' });`
- Engine `Exporter` directly against a `Compositor` + `AudioEngine` — one object,
  three exits (all reuse the same render/audio core, contract #3):
  ```ts
  import { Exporter } from '@sequio/engine';
  const exporter = new Exporter(compositor, audioEngine);

  // Video: FixedStep loop, awaits prepare — no dropped frames.
  const movie = await exporter.export({ fps: 30, container: 'mp4' });

  // One still image at a time (no fps boundary needed).
  const still = await exporter.exportFrame(2.5, { type: 'image/png' });

  // Audio only — just the AudioEngine offline mix, no frames rendered, no GPU.
  const track = await exporter.exportAudio({ format: 'mp3' });
  //   format: 'mp3' (default) | 'm4a' | 'wav' | 'ogg' | 'webm'
  //   codec defaults per format (mp3 / aac / pcm-s16 / opus); bitrate, range, sampleRate optional
  ```

## 9. Server-side render (no browser)

Snapshot a composition's files into a bundle and hand it to Route B:

```bash
pnpm sequio render composition.ts --out out.mp4 --scale 2
# or programmatically, from the CLI's public API:
#   import { runRender } from '@sequio/cli';
#   await runRender('composition.ts', { out: 'out.mp4', scale: 2 });
```

Route B is pure Node + PixiJS WebGPU (Dawn), running under `@sequio/server`'s
`serverEnv`; it needs a GPU or the Mesa lavapipe software driver. (The render
helpers live inside `@sequio/cli`; `@sequio/server` provides only the environment.)

## 10. Quick visual check — export a single frame (no full render)

The fast way to confirm a composition looks right without rendering the whole
video (and without a browser). `sequio frame` seeks to one time and writes a PNG
through the same render core as `render`:

```bash
sequio frame composition.ts --time 2.5 --out /tmp/check.png   # then open/view the PNG
sequio frame composition.ts --time 0    --out /tmp/start.png --scale 2
```

- `--time <sec>` is clamped to `[0, duration]` (so `--time 999` gives the last frame).
- `--scale N` renders at N× like `render`.
- Needs a WebGPU host (GPU or Mesa lavapipe), same as `render`.

Recommended iterate loop for an agent: edit the composition → `sequio frame` at a
few representative times → look at the PNGs → only `sequio render` once it's right.
Programmatically it's `runFrame(file, { out, time, scale })` from `@sequio/cli`.

## 11. Export just the audio (no video)

Encode only the composition's audio track — the same `AudioEngine` offline mix the
video export muxes — to an audio-only file:

```bash
sequio audio composition.ts --out track.mp3                 # default format: mp3
sequio audio composition.ts --format m4a --out track.m4a    # or m4a / wav / ogg / webm
sequio audio composition.ts --out track.wav --bitrate 192000
```

- `--format` is `mp3` (default) `| m4a | wav | ogg | webm`; when omitted it's
  inferred from `--out`'s extension. `--bitrate` is ignored for `wav` (PCM).
- Same Route B path as `render`, so it needs a WebGPU host (GPU or Mesa lavapipe).
- Programmatically it's `runAudio(file, { out, format, bitrate })` from
  `@sequio/cli`; in-app it's `Exporter.exportAudio(...)` (recipe 8).

## 12. Bring your own spec (JSON → object graph)

sequio ships **no** persistent schema — an imperative `defineComposition` module
is the only portable format the SDK blesses (the server re-runs that code via a
`RuntimeBundle`, contract #3). If your app already has a document model — a Y.Doc,
a database row, an editor's own JSON — **you own the schema**, and mapping it onto
the engine is a ~30-line builder. This is a **pattern, not an API**: copy it and
bend it to your data; don't look for an official spec type to import.

The mapping has four moving parts, all mechanical:

1. **keyframes** → `prop.setStatic(v)` for a constant, `prop.setKeyframes([...])` to animate.
2. **easing** → a name→function lookup table (easings are just exported functions).
3. **fonts** → `await fonts.load(...)` up front, before any `TextClip` uses the family.
4. **effects** → a `type` switch that `new`s the engine effect and writes its params.

```ts
import {
  Compositor, VisualTrack, TextClip, ShapeClip, ImageClip, ImageSource,
  BlurEffect, ColorEffect, fonts,
  linear, easeOutCubic, easeInOutCubic,
  type Easing, type Effect,
} from '@sequio/engine';
import { defineComposition, loadAsset } from '@sequio/runtime';

// ── YOUR schema (you define this — here's a minimal one) ─────────────────────
type Prop<T> = T | { keyframes: Array<{ time: number; value: T; easing?: string }> };
interface MySpec {
  width: number; height: number; fps: number; background?: number;
  fonts?: { family: string; src: string }[];
  clips: Array<{
    type: 'text' | 'shape' | 'image';
    start: number; end: number;
    position?: Prop<[number, number]>;
    opacity?: Prop<number>;
    text?: string; fontFamily?: string; fill?: number;   // text
    width?: number; height?: number; src?: string;       // shape / image
    effects?: Array<{ type: 'blur' | 'color'; strength?: number; brightness?: number }>;
  }>;
}

// ── the fixed lookup tables ──────────────────────────────────────────────────
const EASINGS: Record<string, Easing> = { linear, easeOutCubic, easeInOutCubic };

function applyProp<T>(p: { setStatic(v: T): void; setKeyframes(k: any[]): void }, s: Prop<T> | undefined) {
  if (s === undefined) return;
  if (typeof s === 'object' && s !== null && 'keyframes' in s)
    p.setKeyframes(s.keyframes.map((k) => ({ ...k, easing: k.easing ? EASINGS[k.easing] : undefined })));
  else p.setStatic(s as T);
}

function buildEffect(e: { type: string; strength?: number; brightness?: number }): Effect {
  if (e.type === 'blur') { const fx = new BlurEffect(); if (e.strength != null) fx.strength.setStatic(e.strength); return fx; }
  const fx = new ColorEffect(); if (e.brightness != null) fx.brightness.setStatic(e.brightness); return fx;
}

// ── the builder: MySpec → Composer ───────────────────────────────────────────
export function fromSpec(spec: MySpec) {
  return defineComposition(async () => {
    const c = new Compositor({ width: spec.width, height: spec.height, fps: spec.fps, background: spec.background });
    await c.init();
    for (const f of spec.fonts ?? []) await fonts.load(f);      // fonts BEFORE clips

    const track = new VisualTrack();
    for (const cs of spec.clips) {
      let clip;
      if (cs.type === 'text')  clip = new TextClip({ text: cs.text!, fontFamily: cs.fontFamily, fill: cs.fill });
      else if (cs.type === 'shape') clip = new ShapeClip({ kind: 'rect', width: cs.width!, height: cs.height!, fill: cs.fill ?? 0xffffff });
      else clip = new ImageClip(new ImageSource({ src: cs.src! }));
      clip.start = cs.start; clip.end = cs.end;
      applyProp(clip.transform.position, cs.position);
      applyProp(clip.opacity, cs.opacity);
      for (const e of cs.effects ?? []) clip.effects.push(buildEffect(e));
      track.add(clip);
    }
    c.addTrack(track);
    return { compositor: c };
  });
}
```

Feed it your JSON and you get a `Composer` that previews, exports and
server-renders like any other composition:

```ts
export default fromSpec(JSON.parse(await loadAsset('./timeline.json')));
```

**Why the SDK doesn't ship this for you:** any real product already has a document
model (undo, collaboration, its own field names); an official spec would just be a
second schema to fight. The fuller reference implementation — video/audio clips,
`sourceIn`/`sourceOut`, blend modes, a global grade — lives in
`packages/server/src/timeline.ts` (the `TimelineSpec` type + `buildTimeline`). Read
it for the complete pattern, then write your own.

**Trust boundary:** a `RuntimeBundle` is *code* — re-running it executes arbitrary
TS/JS on your server. Serve bundles only from trusted (first-party) sources. For a
multi-tenant or public-facing service, accept *data* (a tenant's JSON + your
builder above), never their code, and allowlist any media `src` URL your builder
fetches. See `docs/server-side-rendering.md` § 信任边界与安全模型.

## Outlined / echoed / italic display text

`TextStyleLike` passes weight, italic, letter-spacing and a stroke straight into
Pixi's text style — so one family covers bold / hollow / italic cuts:

```ts
// Hollow outlined word: pale fill + a coloured stroke.
new TextClip({ text: 'SUPER', fontFamily: 'Oswald', fontSize: 150, fill: 0xf7cfcf,
  fontWeight: '700', letterSpacing: 2, stroke: { color: 0xa5120f, width: 4 } });

// Bold italic call-to-action.
new TextClip({ text: 'MAKE IT YOURS', fontFamily: 'Oswald', fontSize: 96,
  fill: 0xa5120f, fontWeight: '700', fontStyle: 'italic' });
```

An "echo" stack (fading after-image) is N copies with decreasing opacity:

```ts
const g = new GroupClip();
for (let i = 0; i < 4; i++) {
  const t = new TextClip({ text: 'PROMO', fontFamily: 'Oswald', fontSize: 150, fill: 0xffffff, fontWeight: '700' });
  t.start = 0; t.end = 3;
  t.transform.anchor.setStatic([0, 0]);
  t.transform.position.setStatic([0, i * 205]);
  t.opacity.setStatic(Math.pow(0.7, i)); // each copy fainter
  g.add(t);
}
```

## Arch / circle-cropped photo (`maskShape`)

Clip an image to a rounded-rect (arch) or ellipse. Mask a **`GroupClip`** that
wraps the image — a Sprite can't be masked by its own child — and lay the image
out from `(0, 0)` in the group, sized to fill the mask:

```ts
const src = new ImageSource({ src: 'https://…?w=760&h=1500&fit=crop' }); // pre-crop to region aspect
const meta = await src.load();
const img = new ImageClip(src);
img.start = 0; img.end = 3;
img.transform.anchor.setStatic([0, 0]);
img.transform.scale.setStatic([760 / meta.width, 1500 / meta.height]);

const arch = new GroupClip();
arch.start = 0; arch.end = 3;
arch.transform.anchor.setStatic([0, 0]);
arch.transform.position.setStatic([170, -60]);            // where the arch sits
arch.maskShape = { kind: 'rect', width: 760, height: 1500, radius: 380 }; // big radius → arch
arch.add(img);
```

## Gotchas

- Call `await compositor.init()` before adding tracks.
- `anchor` is normalized (`[0.5,0.5]` = center); `position` is pixels.
- Set both `.start` and `.end` on every clip, in seconds.
- Don't read the previous frame's state inside a render — `render(t)` must be pure.
- In a long-lived app, `dispose()` what you create; a one-shot render tears down
  for you.
