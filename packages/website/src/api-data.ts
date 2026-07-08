/**
 * The engine API reference content. Curated from `@sequio/engine`'s public
 * barrel (`packages/engine/src/index.ts`) and the modules' JSDoc. This is the
 * stable public surface — internal helpers (Reconciler, FrameCache internals,
 * demuxers) are exported for advanced extension but not documented as API here.
 */
export interface ApiSymbol {
  name: string;
  kind: 'class' | 'interface' | 'function' | 'type' | 'const';
  summary: string;
  code?: string;
}

export interface ApiModule {
  id: string;
  title: string;
  description: string;
  symbols: ApiSymbol[];
}

export const API_MODULES: ApiModule[] = [
  {
    id: 'time',
    title: 'Time & Clock',
    description:
      'Times are seconds at the API boundary, quantized to a frame grid internally. A Clock drives the frame loop; the layer above wires it to renderPreview.',
    symbols: [
      {
        name: 'Timebase',
        kind: 'class',
        summary:
          'A frame reference at a given fps. All seeks quantize to its frame boundaries — the contract that keeps preview and export on the same grid.',
        code: `const tb = new Timebase(30);
tb.toFrame(1.02);   // → 31
tb.toSeconds(31);   // → 1.0333…
tb.quantize(1.02);  // → snap seconds to the frame grid`,
      },
      {
        name: 'RealtimeClock',
        kind: 'class',
        summary:
          'A wall-clock-driven Clock for live preview. Its control surface mirrors an HTMLMediaElement: play / pause / seek over [0, duration], auto-pausing at the end.',
        code: `const clock = new RealtimeClock();
clock.duration = 4;
clock.onTick((t) => compositor.renderPreview(t));
clock.play();`,
      },
      {
        name: 'FixedStepClock',
        kind: 'class',
        summary:
          'A deterministic clock that advances by a fixed dt regardless of wall-clock — the export loop, so every frame is prepared and none is dropped.',
      },
      {
        name: 'Clock',
        kind: 'interface',
        summary:
          'The shared clock surface: currentTime, duration, paused/ended, onTick/onEnded, play/pause/seek. Implemented by RealtimeClock and FixedStepClock.',
      },
    ],
  },
  {
    id: 'animation',
    title: 'Animation',
    description:
      'Keyframes, easing and a transform primitive, plus the clip/text animator seam. An animator layers on top of a clip’s base transform (offsets add, factors multiply).',
    symbols: [
      {
        name: 'AnimatableProperty<T>',
        kind: 'class',
        summary:
          'A value that is either static or driven by keyframes. valueAt(t) is a pure function of t. Static and keyframed are mutually exclusive.',
        code: `const x = new AnimatableProperty<number>(0);
x.setKeyframes([
  { time: 0, value: 80 },
  { time: 4, value: 560, easing: easeInOutCubic },
]);
x.valueAt(2); // interpolated`,
      },
      {
        name: 'Transform2D',
        kind: 'class',
        summary:
          'Position, scale, rotation and a normalized anchor (0..1), each an AnimatableProperty. Every VisualClip owns one as clip.transform.',
        code: `clip.transform.anchor.setStatic([0.5, 0.5]);
clip.transform.position.setKeyframes([
  { time: 0, value: [80, 200] },
  { time: 4, value: [560, 200] },
]);`,
      },
      {
        name: 'Easing',
        kind: 'type',
        summary:
          'An easing is (t01) => t01. Built-ins: linear, hold, cubicBezier, and ease{In,Out,InOut}{Quad,Cubic}. Pass one per keyframe.',
      },
      {
        name: 'StaggerTextAnimator',
        kind: 'class',
        summary:
          'A TextAnimator that reveals split text part-by-part (char / word / line) from a "from" pose, staggered — line/word/char drop-ins with no GSAP.',
        code: `text.split = 'char';
text.textAnimator = new StaggerTextAnimator({
  from: { y: -80, alpha: 0 },
  duration: 0.5, stagger: 0.09, easing: easeOutCubic,
});`,
      },
      {
        name: 'TweenAnimator',
        kind: 'class',
        summary: 'A single-tween ClipAnimator: interpolate a clip from one AnimationSample to another over a duration.',
      },
      {
        name: 'gsapClipAnimator / gsapTextAnimator',
        kind: 'function',
        summary:
          'Bind a clip (or split text) to a paused, seek-driven GSAP timeline. The engine never imports gsap — the host passes it in — and only ever seeks, so render(t) stays reproducible.',
        code: `import gsap from 'gsap';
clip.animator = gsapClipAnimator(gsap, (tl, o) => {
  tl.from(o, { y: -70, alpha: 0, ease: 'back.out(1.7)' });
});`,
      },
    ],
  },
  {
    id: 'media',
    title: 'Media',
    description:
      'Sources decode into frames the compositor can draw. Video uses WebCodecs via Mediabunny; images and audio have their own sources. A FrameCache holds decoded frames under a budget.',
    symbols: [
      {
        name: 'VideoSource',
        kind: 'class',
        summary:
          'A decoding video source over a file/blob/URL. Async prepare(t) decodes ahead; the frame cache serves renderSync. Backed by MediabunnyVideoDecoder (WebCodecs).',
      },
      {
        name: 'ImageSource',
        kind: 'class',
        summary: 'A still-image source (decoded once) for ImageClip. Accepts a URL, Blob or data: URL.',
      },
      {
        name: 'AudioSource',
        kind: 'class',
        summary: 'A decoded audio source (AudioBuffer-backed) for AudioClip, fed to the AudioEngine for preview and the export mix.',
      },
      {
        name: 'MediaSource / VisualSource',
        kind: 'class',
        summary: 'Base classes for sources. SourceMetadata carries intrinsic width/height/duration/fps discovered on load.',
      },
      {
        name: 'FrameCache',
        kind: 'class',
        summary:
          'An LRU of decoded frames keyed by frame index, with a size budget and explicit close() of evicted frames — contract #4, explicit resource ownership.',
      },
      {
        name: 'loadMediabunny / setMediabunnyModule',
        kind: 'function',
        summary:
          'Reach the mediabunny module without a static import (dual-package hazard); a host can pin one instance. setFrameImageExtractor customizes how a decoded frame becomes a texture (Route B).',
      },
    ],
  },
  {
    id: 'texture',
    title: 'Texture',
    description: 'GPU texture ownership with a byte budget and LRU eviction — so long timelines and many clips never OOM the GPU.',
    symbols: [
      {
        name: 'TextureManager',
        kind: 'class',
        summary:
          'Owns uploaded textures under a byte budget (default 256 MiB), evicting least-recently-used ones. A Compositor creates one, or shares an existing pool via CompositorOptions.textures so an export reuses the preview’s frames.',
      },
    ],
  },
  {
    id: 'text',
    title: 'Text & Fonts',
    description: 'Web-font loading and text layout. Fonts load once and feed both the browser preview and the Node render identically.',
    symbols: [
      {
        name: 'fonts / FontManager',
        kind: 'const',
        summary:
          'fonts is the shared FontManager. load() a FontSpec (family + src, including a data: URL) or a GoogleFontSpec; buildGoogleCss2Url builds a Google Fonts css2 URL.',
        code: `await fonts.load({ family: 'Poppins', src: POPPINS_DATA_URL });
const clip = new TextClip({ text: 'Hi', fontFamily: 'Poppins' });`,
      },
      {
        name: 'computeTextParts',
        kind: 'function',
        summary:
          'Split laid-out text into line / word / char parts (with positions) given a width measurer — the layout behind TextClip.split and the stagger animators.',
      },
    ],
  },
  {
    id: 'compositor',
    title: 'Compositor graph',
    description:
      'The object graph: a Compositor holds Tracks, each holding Clips. render(t) is a pure function of the graph and t; renderPreview is best-effort, renderSync assumes frames are ready.',
    symbols: [
      {
        name: 'Compositor',
        kind: 'class',
        summary:
          'The root. Construct with { width, height, timebase | fps, background, preferWebGPU, … }, await init(), addTrack(). renderPreview(t) draws best-effort; renderSync(t) draws now; view is the canvas; dispose() frees everything.',
        code: `const compositor = new Compositor({ width: 1920, height: 1080, fps: 30 });
await compositor.init();
compositor.addTrack(track);
compositor.renderPreview(t);
document.body.append(compositor.view);`,
      },
      {
        name: 'VisualTrack / AudioTrack',
        kind: 'class',
        summary:
          'A Track holds clips and a zIndex for stacking. VisualTrack composites onto the canvas; AudioTrack feeds the AudioEngine. track.add(clip) inserts a clip.',
      },
      {
        name: 'TextClip',
        kind: 'class',
        summary:
          'Styled text via PIXI.Text. Options: { text, fontFamily?, fontSize?, fill? }. Set split to char/word/line for motion; drive with textAnimator.',
        code: `const t = new TextClip({ text: 'Hello', fontSize: 64, fill: 0xffffff });
t.start = 0; t.end = 4;
t.transform.position.setStatic([960, 120]);`,
      },
      {
        name: 'ShapeClip',
        kind: 'class',
        summary:
          'A vector rect or ellipse. Spec: { kind: "rect" | "ellipse", width, height, fill?, radius?, stroke? }.',
        code: `const box = new ShapeClip({ kind: 'rect', width: 200, height: 120, fill: 0x38bdf8, radius: 16 });`,
      },
      {
        name: 'VideoClip / ImageClip',
        kind: 'class',
        summary:
          'Clips backed by a VideoSource / ImageSource. VideoClip supports sourceIn / speed for trimming and retiming; both draw a source frame at time t.',
      },
      {
        name: 'Clip / VisualClip / AudioClip',
        kind: 'class',
        summary:
          'Base clips. A clip has start / end (seconds), opacity, blendMode, an effects[] list, transform and an optional animator. isActiveAt(t) gates rendering.',
      },
      {
        name: 'GroupClip',
        kind: 'class',
        summary: 'A clip that nests a sub-graph of clips, transformed and composited as a unit — group transforms, opacity and effects apply to the whole.',
      },
    ],
  },
  {
    id: 'effects',
    title: 'Effects & Transitions',
    description:
      'Clip-level filters and overlap-driven transitions, all keyframable through their AnimatableProperty params. The same filter core runs in preview and export.',
    symbols: [
      {
        name: 'ColorEffect',
        kind: 'class',
        summary: 'Brightness / contrast / saturation adjustment, each an AnimatableProperty. Push onto clip.effects.',
        code: `const color = new ColorEffect();
color.brightness.setStatic(1.4);
clip.effects.push(color);`,
      },
      { name: 'BlurEffect', kind: 'class', summary: 'A Gaussian blur whose strength is animatable.' },
      {
        name: 'BulgeEffect / PerspectiveEffect / DisplacementEffect',
        kind: 'class',
        summary:
          'Warp filters: a lens bulge, a homography (perspective quad) and a displacement-map shift. Warp helpers (homography math, bulgeSourceUv) are exported for custom warps.',
      },
      {
        name: 'Effect / EffectRegistry',
        kind: 'class',
        summary:
          'Effect is the base for a filter; subclass it for your own. EffectRegistry maps names to factories; registerBuiltins / BUILTIN_EFFECTS register the built-ins.',
      },
      {
        name: 'CrossfadeTransition / Transition',
        kind: 'class',
        summary:
          'Transition is the base for an overlap-driven blend between two clips; CrossfadeTransition fades one into the next over their overlap. crossfadeAlpha exposes the curve.',
      },
    ],
  },
  {
    id: 'audio',
    title: 'Audio',
    description: 'Preview mixing on Web Audio and export mixing on an OfflineAudioContext, scheduled against the same clock and clip timings.',
    symbols: [
      {
        name: 'AudioEngine',
        kind: 'class',
        summary:
          'Schedules AudioClips for playback (play / pause / seek) in preview and renders the offline mix for export. Constructed with a Timebase.',
      },
      {
        name: 'scheduling helpers',
        kind: 'function',
        summary:
          'Pure helpers behind the engine: clipPlaybackAt, effectiveGain, fadeFactor, gainEventsAt — compute what each clip should sound like at a time, unit-tested in isolation.',
      },
    ],
  },
  {
    id: 'export',
    title: 'Export',
    description: 'Render a timeline to a video Blob: a FixedStep loop awaits prepare(t) for every frame (never dropping one) and muxes MP4 / WebM via Mediabunny.',
    symbols: [
      {
        name: 'Exporter',
        kind: 'class',
        summary:
          'Drives the deterministic export loop over a Compositor + AudioEngine. export(options, onProgress) returns a Blob; options set fps, range, container and audio. Throws ExportCancelledError if aborted.',
        code: `const exporter = new Exporter(compositor, audioEngine);
const blob = await exporter.export(
  { fps: 30, range: [0, 4], container: 'mp4' },
  (p) => console.log(Math.round(p * 100) + '%'),
);`,
      },
      {
        name: 'ExportSink / MediabunnyExportSink',
        kind: 'class',
        summary:
          'The sink an Exporter writes encoded frames to. MediabunnyExportSink muxes MP4 / WebM; implement ExportSink for a custom container. exportFrameTimes computes the frame time list.',
      },
    ],
  },
];
