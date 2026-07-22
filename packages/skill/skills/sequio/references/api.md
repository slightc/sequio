# sequio public API reference

The stable public surface is exactly what `@sequio/engine`'s barrel
(`packages/engine/src/index.ts`) exports. This mirrors it, grouped by module.
Internal helpers (`Reconciler`, `FrameCache`, `TextureManager`, demux/mux
adapters) are exported for advanced extension but are **not** stable API.

Times are **seconds** at the API boundary, quantized to frames internally via
`Timebase`.

## Time & clock

- `Timebase` — frame quantization (`new Timebase(fps)`).
- `Clock`, `RealtimeClock`, `FixedStepClock` — preview uses `RealtimeClock`;
  export uses a fixed step so no frame is dropped.

## Animation

- `Transform2D` — a clip's spatial state: `position`, `scale`, `rotation`,
  `anchor`, `alpha` (each an `AnimatableProperty`).
- `AnimatableProperty` / `Keyframe` — `.setStatic(value)` or
  `.setKeyframes([{ time, value, easing? }, ...])`; `.valueAt(t)`, `.animated`,
  `.keyframeTimes` (sorted keyframe times, for static validation).
- Easings: `linear`, `hold`, `cubicBezier`, `easeInQuad`, `easeOutQuad`,
  `easeInOutQuad`, `easeInCubic`, `easeOutCubic`, `easeInOutCubic`. Type `Easing`.
- Clip/text animators: `ClipAnimator`, `TextAnimator`, `StaggerTextAnimator`,
  `TweenAnimator`, `IDENTITY_SAMPLE`, `lerpSample`, `AnimationSample`, plus
  `TextPart` / `TextSplit` / `StaggerOrder` / `StaggerTextOptions` /
  `TweenAnimatorOptions`. `ClipAnimator` (`sampleAt`) and `TextAnimator`
  (`sampleForPart`) are **extension seams** — implement your own for custom motion
  (assign to `clip.animator` / `textClip.textAnimator`); see recipe 7b.
- GSAP binding (engine has no gsap dep): `gsapClipAnimator`, `gsapTextAnimator`,
  `identityTarget`; types `GsapLike`, `GsapTimelineLike`, `GsapTarget`.
- Text layout: `computeTextParts`, `MeasureWidth`.

## Media

- `MediaSource`, `VisualSource`, `SourceMetadata`.
- `VideoSource` (`VideoSourceOptions`) — decode via Mediabunny; `src` = URL | Blob.
- `ImageSource` (`ImageSourceOptions`).
- `AudioSource` (`AudioSourceOptions`).
- Decoder seam: `VideoDecoderBackend`, `DecodedFrame`, `MediabunnyVideoDecoder`,
  `setFrameImageExtractor` / `FrameImageExtractor`, `MediabunnyDemux`, `VideoInput`.
- `FrameCache`, `Closable`.
- Mediabunny module control (dual-package hazard): `loadMediabunny`,
  `setMediabunnyModule`, `MediabunnyModule`.

## Texture

- `TextureManager` — GPU byte budget + LRU eviction.

## Text / fonts

- `FontManager`, `fonts` (singleton), `buildGoogleCss2Url`; types `FontSpec`,
  `GoogleFontSpec`.
- `fonts.load({ family, src })` before rendering a `TextClip` in that family.
- `fonts.families()` — the family names a load has been requested for (used by
  `sequio check` to catch a `TextClip` referencing an unregistered font).

## Compositor graph

- `Compositor` (`CompositorOptions`) — root. `new Compositor({ width, height,
  fps?, background?, timebase?, createRenderer?, resolution? })`, then
  `await init()`, `addTrack(track)`, `renderPreview(t)`. `onContextLost(cb)` /
  `isContextLost` surface a lost GPU device — a browser reclaiming a backgrounded
  tab's GPU memory silently kills the WebGPU device (no error), turning the whole
  canvas black while audio keeps playing; recover by rebuilding the preview
  (a fresh compositor + renderer + canvas). `reloadPreview(t)` purges every
  source's decode/GPU caches and repaints (for the lesser case where frames were
  reclaimed but the context survives).
- Tracks: `Track`, `VisualTrack` (stacks by `.zIndex`), `AudioTrack`.
  `TextClip`, `ShapeClip`, `GroupClip`. Types: `TextStyleLike`, `TextStrokeLike`,
  `ShapeSpec`, `ShapeKind`, `MaskSpec`.
- Every clip has `.start` / `.end` (seconds) and `.transform` (`Transform2D`).
- Time-remap on any clip: `.speed` (default `1`; time-line seconds → `speed`×
  source seconds — variable-speed + pitch shift for audio) and `.reversed`
  (default `false`; 倒放 — plays the same source window backwards. Video feeds a
  decreasing source time to the decoder (decoded in GOP batches so reverse isn't
  O(GOP²)); audio plays a reversed copy of the buffer, since Web Audio has no
  negative playback rate). `clip.sourceTimeAt(t)` is the resulting source time —
  the single mapping both decode-prep and render use, so `speed`/`reversed` set
  on the clip apply everywhere.
- `TextClip` style (`TextStyleLike`): `text`, `fontFamily`, `fontSize`
  (animatable), `fill`, plus pass-throughs `fontWeight`, `fontStyle`
  (`'italic'`), `letterSpacing`, `align`, `lineHeight` and `stroke`
  (`TextStrokeLike` `{ color, width }` → hollow / outlined type). Weight and
  letter-spacing feed measurement too, so split-text layout stays correct.
- `VisualClip.maskShape` (`MaskSpec`): clip the content to a rounded-rect
  (`kind:'rect'`, big `radius` → arch/stadium) or `ellipse` (circle crop), sized
  explicitly (`width`/`height`, optional `x`/`y`, `inset`). Apply it to a
  container-backed clip — a `GroupClip` wrapping the image — since a Sprite
  cannot be masked by its own child; lay the content out from `(0,0)` in the
  group.

## Effects & transitions

- `Effect`, `EffectRegistry` (`EffectFactory`), `registerBuiltins`,
  `BUILTIN_EFFECTS`.
- Effects: `ColorEffect`, `BlurEffect`, `BulgeEffect`, `PerspectiveEffect`,
  `DisplacementEffect` (`DisplacementEffectOptions`).
- Warp math: `Mat3`, `Quad`, `Vec2`, `UNIT_QUAD`, `squareToQuad`, `invert3x3`,
  `applyHomography`, `perspectiveSampleMatrix`, `bulgeSourceUv`.
- Transitions: `Transition`, `CrossfadeTransition`, `crossfadeAlpha`.
- Extend: subclass `Effect` (or an engine effect) for a custom filter/param, and
  `Transition` (or `CrossfadeTransition`) for a custom mix — no `pixi.js` needed if
  you build on the engine's own classes. Attach: `clip.effects.push(fx)`,
  `track.addTransition(new T(frames).between(a, b))`. See recipe 7b.
- Status: color/blur/warp + crossfade done; chroma/LUT/wipe TODO.

## Audio

- `AudioEngine` — Web Audio live + OfflineAudioContext for export. Every
  `Compositor` owns one (`compositor.audioEngine`, sharing its `timebase`);
  schedule onto it with `compositor.audioEngine.schedule(clip, source)` and
  preview/export mix it automatically — no need to `new AudioEngine` yourself.
- Scheduling helpers: `clipPlaybackAt`, `effectiveGain`, `fadeFactor`,
  `gainEventsAt`; types `ClipPlayback`, `GainEvent`.

## Export

- `Exporter` (`ExportOptions`, `ExportFrameOptions`, `AudioExportOptions`),
  `ExportCancelledError`. `Exporter.export` → video, `exportFrame` → one still
  image, `exportAudio` → audio-only file (the `AudioEngine` offline mix).
- `ExportSink`, `ResolvedExportOptions`, `exportFrameTimes`,
  `MediabunnyExportSink`.
- Audio-only: `AudioExportSink`, `AudioExportFormat`
  (`'m4a' | 'mp3' | 'wav' | 'ogg' | 'webm'`), `ResolvedAudioExportOptions`,
  `MediabunnyAudioExportSink`.

## Re-exported PixiJS types (type-only)

- `Renderer`, `AutoDetectOptions`, `BLEND_MODES` — so a consumer types against the
  injected renderer / clip blend mode without importing `pixi.js` directly.

## Core primitives

- `Disposable`, `Subscription`, `createSubscription`.

## Runtime authoring API (`@sequio/runtime`)

- `defineComposition(builder)` — default-export a builder that returns
  `{ compositor, audioEngine?, duration? }`. Audio defaults to
  `compositor.audioEngine`; return `audioEngine` only to override with another.
- `loadAsset('./path')` — fetch a local media file as a `Blob` (host-provided).
- `Runtime`, `Composer` — compile+link+run files → a `Composer` that previews,
  exports (client), or `toBundle()`s source for server render.
- `@sequio/runtime/node-fs` (subpath) — `NodeFileSystem` for real-disk files.
