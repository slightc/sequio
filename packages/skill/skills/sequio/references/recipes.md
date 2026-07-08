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
title.animator = new StaggerTextAnimator({
  each: 0.04,                               // stagger between parts
  from: (o) => ({ y: -40, alpha: 0 }),      // starting sample per part
});
```

For gsap-driven per-part motion use `gsapTextAnimator(gsap, split, builder)`.

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

clip.effects.add(new BlurEffect({ strength: 8 }));
// A crossfade between two overlapping clips on a track (overlap drives it):
track.transition = new CrossfadeTransition({ duration: 0.5 });
```

(Effect/transition constructor options vary — check `references/api.md` and the
class in `packages/engine/src/effects/`. chroma/LUT/wipe are not yet built.)

## 8. Export from your own app (not the CLI)

Two ways:

- Runtime `Composer`: `const blob = await composer.export({ format: 'mp4' });`
- Engine `Exporter` directly against a `Compositor`:
  ```ts
  import { Exporter } from '@sequio/engine';
  const exporter = new Exporter(compositor, { duration, fps: 30, format: 'mp4' });
  const blob = await exporter.run();       // FixedStep loop, awaits prepare — no dropped frames
  ```

## 9. Server-side render (no browser)

Snapshot a composition's files into a bundle and hand it to Route B:

```bash
pnpm sequio render composition.ts --out out.mp4 --scale 2
# or, from a RuntimeBundle programmatically:
#   import { renderBundleToFile } from '@sequio/server/route-b';
#   await renderBundleToFile(bundle, { out: 'out.mp4', scale: 2 });
```

Route B is pure Node + PixiJS WebGPU (Dawn); it needs a GPU or the Mesa lavapipe
software driver.

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
Programmatically it's `renderBundleFrameToFile(bundle, { out, time, scale })` from
`@sequio/server/route-b`, or `runFrame(file, { out, time, scale })` from `@sequio/cli`.

## Gotchas

- Call `await compositor.init()` before adding tracks.
- `anchor` is normalized (`[0.5,0.5]` = center); `position` is pixels.
- Set both `.start` and `.end` on every clip, in seconds.
- Don't read the previous frame's state inside a render — `render(t)` must be pure.
- In a long-lived app, `dispose()` what you create; a one-shot render tears down
  for you.
