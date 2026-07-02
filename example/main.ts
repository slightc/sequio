/**
 * Mini multi-track editor playground.
 *
 * A small consumer app built on the SDK's public surface that demonstrates the
 * pieces an editor needs:
 *   - add Text / Shape (rect, ellipse) clips
 *   - upload local files as Image / Video sources and add them as clips; a
 *     video's audio track is decoded and played with it (AudioEngine)
 *   - add tracks (stacked, later track renders on top via zIndex)
 *   - move / trim a clip on the timeline, including dragging it across tracks
 *   - move & resize a clip directly on the canvas (drag body, drag corner
 *     handles) or numerically in the inspector (X/Y are centre-relative — the
 *     compositor is created with `origin: [0.5, 0.5]`, so [0,0] is the middle)
 *   - export the timeline to MP4 / WebM via the SDK's Exporter, on a forked
 *     offscreen graph (video sources are `fork()`ed) so export never contends
 *     with the live preview's decoder; cancelable, with progress
 *
 * Persistence, undo and schema are intentionally NOT here — that's the
 * consumer's job (see AGENT.md). This file only drives the SDK: every mutation
 * marks the graph dirty and calls `renderPreview` explicitly, because the SDK
 * never repaints on its own (contract #5).
 */
import {
  AudioClip,
  AudioEngine,
  AudioSource,
  Compositor,
  Exporter,
  ImageClip,
  ImageSource,
  RealtimeClock,
  ShapeClip,
  TextClip,
  Timebase,
  VideoClip,
  VideoSource,
  type ShapeKind,
  type VisualClip,
  type VisualSource,
  VisualTrack,
} from '../src/index';
import { exportTimeline, videoCacheSettings } from './editor-export';

const W = 640;
const H = 360;
const FPS = 30;
const PX_PER_SEC = 80; // timeline horizontal scale
const MIN_TIMELINE = 8; // seconds of ruler shown even when empty
const DEFAULT_CLIP_DURATION = 3; // seconds for newly-added clips
/** Coordinate origin at the canvas centre — clip position [0,0] is the middle. */
const ORIGIN: [number, number] = [0.5, 0.5];

const CLIP_COLORS = ['#3b82f6', '#8b5cf6', '#ec4899', '#f59e0b', '#10b981', '#ef4444'];

/** A clip plus the app-layer metadata the editor UI needs around it. */
interface ClipModel {
  id: number;
  kind: 'text' | 'shape' | 'image' | 'video';
  label: string;
  clip: VisualClip;
  source: VisualSource | null;
  color: string;
  /** Editable text (text clips only). */
  text?: string;
  /** Intrinsic (unscaled) size in canvas px, for the on-canvas selection box. */
  iw: number;
  ih: number;
  /** Audio for video clips: a decoded source + a timeline clip mirroring the
   *  video clip's start/end, scheduled in the shared AudioEngine. */
  audioSource?: AudioSource;
  audioClip?: AudioClip;
}

/** A track plus its clip models. */
interface TrackModel {
  id: number;
  name: string;
  track: VisualTrack;
  clips: ClipModel[];
}

async function main(): Promise<void> {
  const timebase = new Timebase(FPS);
  const compositor = new Compositor({
    width: W,
    height: H,
    timebase,
    background: 0x101014,
    preferWebGPU: true,
    // Freeze the final real frame at the timeline end (SDK default) so playing
    // to the very end doesn't flash black on the [start, end) boundary.
    holdLastFrameAtEnd: true,
    // Origin at the canvas centre: a clip at position [0,0] sits in the middle,
    // so inspector X/Y are centre-relative (SDK handles the frame, not the app).
    origin: ORIGIN,
  });
  await compositor.init();
  document.getElementById('stage')!.append(compositor.view);

  const clock = new RealtimeClock();
  // One AudioEngine drives preview playback AND the export offline mix.
  const audioEngine = new AudioEngine(timebase);

  // ── App state ──────────────────────────────────────────────────────────
  const tracks: TrackModel[] = [];
  let nextId = 1;
  let zCounter = 1;
  let activeTrack: TrackModel | null = null;
  let selected: ClipModel | null = null;

  // ── DOM refs ───────────────────────────────────────────────────────────
  const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
  const scrub = $<HTMLInputElement>('scrub');
  const playBtn = $<HTMLButtonElement>('play');
  const timeLabel = $<HTMLSpanElement>('time');
  const statusEl = $<HTMLSpanElement>('status');
  const tracksEl = $<HTMLDivElement>('tracks');
  const rulerEl = $<HTMLDivElement>('ruler');
  const inspectorEl = $<HTMLDivElement>('inspector');
  const overlayEl = $<HTMLDivElement>('overlay');
  const selBox = $<HTMLDivElement>('sel-box');
  const exportBtn = $<HTMLButtonElement>('export');
  const exportFormat = $<HTMLSelectElement>('export-format');

  // Offscreen 2D context, reused to approximate text sizes.
  const measureCtx = document.createElement('canvas').getContext('2d')!;

  // ── Core helpers ───────────────────────────────────────────────────────

  /** Largest clip end across all tracks (the timeline duration). */
  function timelineEnd(): number {
    let end = 0;
    for (const tm of tracks) for (const c of tm.clips) if (c.clip.end > end) end = c.clip.end;
    return end;
  }

  /** Repaint the current frame. The SDK never auto-repaints (contract #5). */
  function render(): void {
    compositor.renderPreview(clock.currentTime);
    updateOverlay();
  }

  /** Whether any clip contributes audio. */
  function hasAnyAudio(): boolean {
    return tracks.some((tm) => tm.clips.some((c) => c.audioClip && c.audioSource));
  }

  /**
   * Re-register every audio clip with the engine (it has no per-entry remove, so
   * clear + re-schedule). The engine reads clip start/end fresh on each play, so
   * timing edits don't need a reschedule — but add/delete do. Resumes playback
   * from the current playhead if we were playing.
   */
  function syncAudioSchedule(): void {
    audioEngine.clear();
    for (const tm of tracks) {
      for (const c of tm.clips) {
        if (c.audioClip && c.audioSource) audioEngine.schedule(c.audioClip, c.audioSource);
      }
    }
    if (!clock.paused) audioEngine.play(clock.currentTime);
  }

  /** Mirror a video clip's timeline window onto its audio clip. */
  function mirrorAudio(m: ClipModel): void {
    if (!m.audioClip) return;
    m.audioClip.start = m.clip.start;
    m.audioClip.end = m.clip.end;
    m.audioClip.sourceIn = m.clip.sourceIn;
    m.audioClip.speed = m.clip.speed;
    if (!clock.paused) audioEngine.seek(clock.currentTime); // re-cue live playback
  }

  /** Recompute the clock duration + scrub range from the current graph. */
  function refreshDuration(): void {
    const end = Math.max(timelineEnd(), 0.001);
    clock.duration = end;
    scrub.max = String(end);
    if (clock.currentTime > end) clock.seek(end);
    updateTimeLabel();
  }

  function updateTimeLabel(): void {
    timeLabel.textContent = `${clock.currentTime.toFixed(2)} / ${timelineEnd().toFixed(2)}s`;
  }

  /** Center a fresh clip on the canvas at a given uniform scale. */
  function placeCentered(clip: VisualClip, scale = 1): void {
    clip.transform.anchor.setStatic([0.5, 0.5]);
    clip.transform.position.setStatic([0, 0]); // origin is the canvas centre
    clip.transform.scale.setStatic([scale, scale]);
  }

  // ── Mutations ──────────────────────────────────────────────────────────

  function addTrack(): TrackModel {
    const track = new VisualTrack();
    track.zIndex = zCounter++; // later track renders on top
    compositor.addTrack(track);
    const tm: TrackModel = { id: nextId++, name: `Track ${tracks.length + 1}`, track, clips: [] };
    tracks.push(tm);
    activeTrack = tm;
    return tm;
  }

  /** Ensure there's a track to drop new clips onto. */
  function targetTrack(): TrackModel {
    if (activeTrack) return activeTrack;
    return tracks[0] ?? addTrack();
  }

  /** Add a built clip to the active track, starting after its existing clips. */
  function addClip(
    kind: ClipModel['kind'],
    clip: VisualClip,
    source: VisualSource | null,
    label: string,
    duration: number,
    iw: number,
    ih: number,
    extra?: Partial<ClipModel>,
  ): void {
    const tm = targetTrack();
    // Append after the last clip on this track so it doesn't overlap by default.
    let start = 0;
    for (const c of tm.clips) if (c.clip.end > start) start = c.clip.end;
    clip.start = start;
    clip.end = start + duration;

    const model: ClipModel = {
      id: nextId++,
      kind,
      label,
      clip,
      source,
      color: CLIP_COLORS[(nextId - 1) % CLIP_COLORS.length]!,
      iw,
      ih,
      ...extra,
    };
    tm.clips.push(model);
    tm.track.add(clip);
    mirrorAudio(model); // align the audio clip (if any) to the placed video clip
    if (model.audioClip) syncAudioSchedule();
    selectClip(model);
    refreshDuration();
    rebuildTimeline();
    render();
  }

  function addText(): void {
    const clip = new TextClip({ text: 'Text', fontSize: 56, fill: 0xffffff });
    placeCentered(clip);
    const [iw, ih] = measureText('Text', 56, clip.fontFamily);
    addClip('text', clip, null, 'Text', DEFAULT_CLIP_DURATION, iw, ih, { text: 'Text' });
  }

  function addShape(kind: ShapeKind): void {
    const color = kind === 'rect' ? 0x3b82f6 : 0xec4899;
    const w = 200;
    const h = 140;
    const clip = new ShapeClip({ kind, width: w, height: h, fill: color, radius: kind === 'rect' ? 12 : undefined });
    placeCentered(clip);
    addClip('shape', clip, null, kind === 'rect' ? 'Rect' : 'Ellipse', DEFAULT_CLIP_DURATION, w, h);
  }

  async function addImage(file: File): Promise<void> {
    setStatus(`Loading ${file.name}…`);
    const source = new ImageSource({ src: file });
    const meta = await source.load();
    const clip = new ImageClip(source);
    // Contain within the canvas at 80% so it's clearly movable/resizable.
    const scale = Math.min(W / meta.width, H / meta.height) * 0.8;
    placeCentered(clip, scale);
    addClip('image', clip, source, file.name, DEFAULT_CLIP_DURATION, meta.width, meta.height);
    setStatus('');
  }

  async function addVideo(file: File): Promise<void> {
    setStatus(`Decoding ${file.name}…`);
    // Probe metadata first (cheap — reads the container header, not the whole
    // file), then size the decode cache to the resolution so a 4K/large source
    // can't accumulate gigabytes of decoded frames and freeze the tab.
    let source = new VideoSource({ src: file });
    let meta = await source.load();
    const { cacheFrames, lookahead } = videoCacheSettings(meta.width, meta.height);
    if (cacheFrames < 60) {
      // Cache size is a constructor-only knob → rebuild with a bounded ring.
      // The export fork() inherits these options, so export stays bounded too.
      source.dispose();
      source = new VideoSource({ src: file, cacheFrames, lookahead });
      meta = await source.load();
    }
    const clip = new VideoClip(source);
    const scale = Math.min(W / meta.width, H / meta.height) * 0.8;
    placeCentered(clip, scale);
    // Default the clip to the video's own length (capped so a long file doesn't
    // dominate the timeline; the user can trim it on the timeline anyway).
    const dur = Number.isFinite(meta.duration) ? Math.min(meta.duration, 10) : DEFAULT_CLIP_DURATION;

    // Decode the audio track (if any) into a clip so the video plays with sound.
    let extra: Partial<ClipModel> | undefined;
    if (meta.hasAudio) {
      try {
        setStatus(`Decoding audio for ${file.name}…`);
        const audioSource = new AudioSource({ src: file });
        await audioSource.load();
        extra = { audioSource, audioClip: new AudioClip() };
      } catch (err) {
        console.warn('audio decode failed; adding video without sound', err);
      }
    }

    addClip('video', clip, source, file.name, dur, meta.width, meta.height, extra);
    setStatus(
      cacheFrames < 60 ? `${meta.width}×${meta.height} · decode cache ${cacheFrames} frames` : '',
    );
  }

  /** Approximate a text clip's unscaled pixel size (for the selection box). */
  function measureText(text: string, fontSize: number, fontFamily: string): [number, number] {
    measureCtx.font = `${fontSize}px ${fontFamily}`;
    const w = measureCtx.measureText(text || ' ').width;
    return [Math.max(w, 8), fontSize * 1.2];
  }

  function deleteClip(model: ClipModel): void {
    const tm = tracks.find((t) => t.clips.includes(model));
    if (!tm) return;
    tm.track.remove(model.clip);
    tm.clips.splice(tm.clips.indexOf(model), 1);
    model.source?.dispose();
    if (model.audioSource) {
      model.audioSource.dispose();
      syncAudioSchedule(); // drop its entry (engine has no per-clip remove)
    }
    if (selected === model) selected = null;
    refreshDuration();
    rebuildTimeline();
    rebuildInspector();
    render();
  }

  function selectClip(model: ClipModel | null): void {
    selected = model;
    if (model) activeTrack = tracks.find((t) => t.clips.includes(model)) ?? activeTrack;
    rebuildTimeline();
    rebuildInspector();
    updateOverlay(); // show/move the box on select, hide it immediately on deselect
  }

  function setStatus(msg: string): void {
    statusEl.textContent = msg;
  }

  // ── Timeline rendering ─────────────────────────────────────────────────

  function rebuildRuler(width: number): void {
    rulerEl.innerHTML = '';
    rulerEl.style.width = `${width}px`;
    const seconds = Math.ceil(width / PX_PER_SEC);
    for (let s = 0; s <= seconds; s++) {
      const tick = document.createElement('div');
      tick.className = 'tick';
      tick.style.left = `${s * PX_PER_SEC}px`;
      tick.textContent = `${s}s`;
      rulerEl.append(tick);
    }
    const playhead = document.createElement('div');
    playhead.className = 'playhead';
    playhead.id = 'playhead';
    playhead.style.left = `${clock.currentTime * PX_PER_SEC}px`;
    rulerEl.append(playhead);
  }

  function updatePlayhead(): void {
    const ph = document.getElementById('playhead');
    if (ph) ph.style.left = `${clock.currentTime * PX_PER_SEC}px`;
  }

  function rebuildTimeline(): void {
    const laneWidth = Math.max(timelineEnd(), MIN_TIMELINE) * PX_PER_SEC + 40;
    rebuildRuler(laneWidth);
    tracksEl.innerHTML = '';

    tracks.forEach((tm) => {
      const row = document.createElement('div');
      row.className = 'track-row';

      const label = document.createElement('div');
      label.className = 'track-label' + (tm === activeTrack ? ' active' : '');
      label.innerHTML = `<span class="name">${tm.name}</span><span class="meta">${tm.clips.length} clip(s)</span>`;
      label.addEventListener('click', () => {
        activeTrack = tm;
        rebuildTimeline();
      });
      row.append(label);

      const lane = document.createElement('div');
      lane.className = 'track-lane';
      lane.style.width = `${laneWidth}px`;

      tm.clips.forEach((model) => lane.append(buildClipBlock(model)));
      row.append(lane);
      tracksEl.append(row);
    });
  }

  /** The TrackModel whose lane contains a viewport Y coordinate (or null). */
  function trackAtClientY(clientY: number): TrackModel | null {
    const lanes = tracksEl.querySelectorAll('.track-lane');
    for (let i = 0; i < lanes.length; i++) {
      const r = lanes[i]!.getBoundingClientRect();
      if (clientY >= r.top && clientY <= r.bottom) return tracks[i] ?? null;
    }
    return null;
  }

  /** Re-parent a clip to another track (visual graph + model + z-stacking). */
  function moveClipToTrack(model: ClipModel, to: TrackModel): void {
    const from = tracks.find((t) => t.clips.includes(model));
    if (!from || from === to) return;
    // The reconciler drains all cross-track unmounts before any remount, so a
    // plain remove+add is safe — no manual flush needed (see Reconciler).
    from.track.remove(model.clip);
    from.clips.splice(from.clips.indexOf(model), 1);
    to.clips.push(model);
    to.track.add(model.clip);
    activeTrack = to;
    // Audio isn't per-track (scheduled globally by the AudioEngine), so nothing
    // to reschedule here.
  }

  function buildClipBlock(model: ClipModel): HTMLElement {
    const block = document.createElement('div');
    block.className = 'clip-block' + (model === selected ? ' selected' : '');
    block.style.left = `${model.clip.start * PX_PER_SEC}px`;
    block.style.width = `${Math.max(model.clip.end - model.clip.start, 0.05) * PX_PER_SEC}px`;
    block.style.background = model.color;
    block.textContent = model.label;

    const handle = document.createElement('div');
    handle.className = 'resize';
    block.append(handle);

    // Move: drag the block body → shift start (duration preserved, clamped ≥ 0)
    // and, when the pointer crosses into another lane, re-parent to that track.
    block.addEventListener('pointerdown', (e) => {
      if (e.target === handle) return;
      e.preventDefault();
      selectClip(model);
      const startX = e.clientX;
      const origStart = model.clip.start;
      const dur = model.clip.end - model.clip.start;
      const onMove = (ev: PointerEvent) => {
        const ds = (ev.clientX - startX) / PX_PER_SEC;
        const ns = Math.max(0, quantize(origStart + ds));
        model.clip.start = ns;
        model.clip.end = ns + dur;
        mirrorAudio(model);
        const target = trackAtClientY(ev.clientY);
        if (target) moveClipToTrack(model, target); // vertical → change track
        refreshDuration();
        rebuildTimeline();
        render();
      };
      dragUntilUp(onMove);
    });

    // Trim: drag the right edge → change end (min 1 frame duration).
    handle.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      selectClip(model);
      const startX = e.clientX;
      const origEnd = model.clip.end;
      const onMove = (ev: PointerEvent) => {
        const ds = (ev.clientX - startX) / PX_PER_SEC;
        const ne = Math.max(model.clip.start + 1 / FPS, quantize(origEnd + ds));
        model.clip.end = ne;
        mirrorAudio(model);
        refreshDuration();
        rebuildTimeline();
        render();
      };
      dragUntilUp(onMove);
    });

    return block;
  }

  /** Snap a time to the frame grid so timeline edits stay frame-aligned. */
  function quantize(t: number): number {
    return Math.round(t * FPS) / FPS;
  }

  /** Run `onMove` on pointermove until pointerup (shared drag plumbing). */
  function dragUntilUp(onMove: (e: PointerEvent) => void): void {
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      rebuildInspector(); // re-sync inputs after the gesture settles
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }

  // ── On-canvas manipulation (drag to move, corner handles to resize) ──────

  /** CSS↔logical scale of the canvas (backing store is W×H logical px). */
  function cssScale(): { kx: number; ky: number } {
    const cw = compositor.view.clientWidth || W;
    const ch = compositor.view.clientHeight || H;
    return { kx: cw / W, ky: ch / H };
  }

  /** Axis-aligned bounds of a clip in logical canvas px (anchor is centered).
   *  Positions are origin-relative, so add the origin offset to reach the DOM's
   *  top-left canvas pixels used by the overlay and hit-testing. */
  function clipBounds(m: ClipModel): { cx: number; cy: number; w: number; h: number } {
    const [px, py] = m.clip.transform.position.valueAt(clock.currentTime);
    const [sx, sy] = m.clip.transform.scale.valueAt(clock.currentTime);
    const [ox, oy] = compositor.originPixels();
    return { cx: px + ox, cy: py + oy, w: m.iw * Math.abs(sx), h: m.ih * Math.abs(sy) };
  }

  /** Position the selection box over the selected clip (hidden if not shown). */
  function updateOverlay(): void {
    if (!selected || !selected.clip.isActiveAt(clock.currentTime)) {
      selBox.style.display = 'none';
      return;
    }
    const { kx, ky } = cssScale();
    const { cx, cy, w, h } = clipBounds(selected);
    selBox.style.display = 'block';
    selBox.style.left = `${(cx - w / 2) * kx}px`;
    selBox.style.top = `${(cy - h / 2) * ky}px`;
    selBox.style.width = `${w * kx}px`;
    selBox.style.height = `${h * ky}px`;
  }

  /** Push a clip's live transform into the inspector inputs (no rebuild). */
  function syncInspectorTransform(m: ClipModel): void {
    if (selected !== m) return;
    const [x, y] = m.clip.transform.position.valueAt(clock.currentTime);
    const s = m.clip.transform.scale.valueAt(clock.currentTime)[0];
    if (insX && document.activeElement !== insX) insX.value = String(Math.round(x));
    if (insY && document.activeElement !== insY) insY.value = String(Math.round(y));
    if (insScale) insScale.value = String(s);
    if (insScaleVal) insScaleVal.textContent = `${s.toFixed(2)}×`;
  }

  /** Convert a pointer event to logical canvas coordinates. */
  function toLogical(e: PointerEvent): [number, number] {
    const rect = overlayEl.getBoundingClientRect();
    const { kx, ky } = cssScale();
    return [(e.clientX - rect.left) / kx, (e.clientY - rect.top) / ky];
  }

  /** Topmost active clip whose bounds contain a logical point (top track first). */
  function hitTest(x: number, y: number): ClipModel | null {
    const ordered = [...tracks].sort((a, b) => b.track.zIndex - a.track.zIndex);
    for (const tm of ordered) {
      for (let i = tm.clips.length - 1; i >= 0; i--) {
        const m = tm.clips[i]!;
        if (!m.clip.isActiveAt(clock.currentTime)) continue;
        const b = clipBounds(m);
        if (Math.abs(x - b.cx) <= b.w / 2 && Math.abs(y - b.cy) <= b.h / 2) return m;
      }
    }
    return null;
  }

  /** Drag the clip's center (position) with the pointer. */
  function startMove(m: ClipModel, ev: PointerEvent): void {
    const { kx, ky } = cssScale();
    const [ox, oy] = m.clip.transform.position.valueAt(clock.currentTime);
    const sx0 = ev.clientX;
    const sy0 = ev.clientY;
    dragUntilUp((e) => {
      m.clip.transform.position.setStatic([ox + (e.clientX - sx0) / kx, oy + (e.clientY - sy0) / ky]);
      render();
      syncInspectorTransform(m);
    });
  }

  /** Drag a corner handle to scale uniformly about the clip's center. */
  function startResize(m: ClipModel, ev: PointerEvent): void {
    ev.stopPropagation();
    const { cx, cy } = clipBounds(m);
    const [px, py] = toLogical(ev);
    const startDist = Math.hypot(px - cx, py - cy) || 1;
    const origScale = m.clip.transform.scale.valueAt(clock.currentTime)[0];
    dragUntilUp((e) => {
      const [x, y] = toLogical(e);
      const d = Math.hypot(x - cx, y - cy);
      const s = Math.min(20, Math.max(0.05, (origScale * d) / startDist));
      m.clip.transform.scale.setStatic([s, s]);
      render();
      syncInspectorTransform(m);
    });
  }

  function wireCanvasManipulation(): void {
    // Empty canvas: hit-test to select (and immediately move) or deselect.
    overlayEl.addEventListener('pointerdown', (e) => {
      if (selBox.contains(e.target as Node)) return; // selBox handles its own drag
      e.preventDefault();
      const [x, y] = toLogical(e);
      const hit = hitTest(x, y);
      if (hit) {
        if (hit !== selected) selectClip(hit);
        startMove(hit, e);
      } else {
        selectClip(null);
      }
    });

    // Selected clip's box: body moves, corner handles resize.
    selBox.addEventListener('pointerdown', (e) => {
      if ((e.target as HTMLElement).classList.contains('handle')) return;
      e.preventDefault();
      e.stopPropagation();
      if (selected) startMove(selected, e);
    });
    selBox.querySelectorAll<HTMLElement>('.handle').forEach((h) =>
      h.addEventListener('pointerdown', (e) => {
        if (selected) startResize(selected, e);
      }),
    );

    window.addEventListener('resize', updateOverlay);
  }

  // ── Inspector rendering ────────────────────────────────────────────────

  // Live refs to the transform inputs so an on-canvas drag can update the
  // readouts without a full inspector rebuild (which would steal focus).
  let insX: HTMLInputElement | null = null;
  let insY: HTMLInputElement | null = null;
  let insScale: HTMLInputElement | null = null;
  let insScaleVal: HTMLSpanElement | null = null;

  function rebuildInspector(): void {
    inspectorEl.innerHTML = '';
    insX = insY = insScale = null;
    insScaleVal = null;
    if (!selected) {
      inspectorEl.innerHTML =
        '<h2>Inspector</h2><p class="empty-hint">Add a clip, then select it here or on the timeline to edit its <b>time</b>, <b>position</b> and <b>size</b>. On the canvas: drag to move, drag a corner to resize.</p>';
      return;
    }
    const m = selected;
    const c = m.clip;

    const h2 = document.createElement('h2');
    h2.textContent = `${m.label} · ${m.kind}`;
    inspectorEl.append(h2);

    // Text content (text clips only).
    if (m.kind === 'text') {
      inspectorEl.append(
        field('Text', textInput(m.text ?? '', (v) => {
          m.text = v;
          (c as TextClip).text = v;
          m.label = v || 'Text';
          const size = (c as TextClip).fontSize.valueAt(clock.currentTime);
          [m.iw, m.ih] = measureText(v, size, (c as TextClip).fontFamily);
          rebuildTimeline();
          render();
        })),
      );
    }

    // Timing.
    inspectorEl.append(
      field('Start (s)', numberInput(round2(c.start), 0.1, (v) => {
        c.start = Math.max(0, Math.min(v, c.end - 1 / FPS));
        commitAndRefresh();
      })),
    );
    inspectorEl.append(
      field('End (s)', numberInput(round2(c.end), 0.1, (v) => {
        c.end = Math.max(c.start + 1 / FPS, v);
        commitAndRefresh();
      })),
    );

    // Position — origin-relative (SDK origin is the canvas centre), so a centered
    // clip reads 0,0. No app-side conversion: the compositor owns the frame.
    const pos = c.transform.position.valueAt(clock.currentTime);
    insX = numberInput(Math.round(pos[0]), 1, (v) => {
      const p = c.transform.position.valueAt(clock.currentTime);
      c.transform.position.setStatic([v, p[1]]);
      render();
    });
    insY = numberInput(Math.round(pos[1]), 1, (v) => {
      const p = c.transform.position.valueAt(clock.currentTime);
      c.transform.position.setStatic([p[0], v]);
      render();
    });
    inspectorEl.append(field('X', insX), field('Y', insY));

    // Size (uniform scale).
    const scale = c.transform.scale.valueAt(clock.currentTime)[0];
    const sizeCtl = rangeInput(scale, 0.05, 4, 0.05, (v) => {
      c.transform.scale.setStatic([v, v]);
      render();
    }, (v) => `${v.toFixed(2)}×`);
    insScale = sizeCtl.input;
    insScaleVal = sizeCtl.val;
    inspectorEl.append(field('Size', sizeCtl.wrap));

    const del = document.createElement('button');
    del.className = 'danger';
    del.textContent = 'Delete clip';
    del.addEventListener('click', () => deleteClip(m));
    inspectorEl.append(del);

    function commitAndRefresh(): void {
      mirrorAudio(m);
      refreshDuration();
      rebuildTimeline();
      rebuildInspector();
      render();
    }
  }

  // ── Small DOM builders ─────────────────────────────────────────────────

  function field(label: string, control: HTMLElement): HTMLElement {
    const row = document.createElement('div');
    row.className = 'row';
    const lbl = document.createElement('span');
    lbl.className = 'lbl';
    lbl.textContent = label;
    row.append(lbl, control);
    return row;
  }

  function numberInput(value: number, step: number, onChange: (v: number) => void): HTMLInputElement {
    const input = document.createElement('input');
    input.type = 'number';
    input.step = String(step);
    input.value = String(value);
    input.addEventListener('input', () => {
      const v = Number(input.value);
      if (Number.isFinite(v)) onChange(v);
    });
    return input;
  }

  function textInput(value: string, onChange: (v: string) => void): HTMLInputElement {
    const input = document.createElement('input');
    input.type = 'text';
    input.value = value;
    input.addEventListener('input', () => onChange(input.value));
    return input;
  }

  function rangeInput(
    value: number,
    min: number,
    max: number,
    step: number,
    onChange: (v: number) => void,
    fmt: (v: number) => string,
  ): { wrap: HTMLElement; input: HTMLInputElement; val: HTMLSpanElement } {
    const wrap = document.createElement('div');
    wrap.style.display = 'flex';
    wrap.style.flex = '1';
    wrap.style.gap = '8px';
    wrap.style.alignItems = 'center';
    const input = document.createElement('input');
    input.type = 'range';
    input.min = String(min);
    input.max = String(max);
    input.step = String(step);
    input.value = String(value);
    const val = document.createElement('span');
    val.className = 'val';
    val.textContent = fmt(value);
    input.addEventListener('input', () => {
      const v = Number(input.value);
      val.textContent = fmt(v);
      onChange(v);
    });
    wrap.append(input, val);
    return { wrap, input, val };
  }

  function round2(n: number): number {
    return Math.round(n * 100) / 100;
  }

  // ── Transport wiring ───────────────────────────────────────────────────

  clock.onTick(() => {
    render();
    scrub.value = String(clock.currentTime);
    updateTimeLabel();
    updatePlayhead();
  });
  clock.onEnded(() => {
    audioEngine.pause();
    playBtn.textContent = '▶ Play';
  });

  playBtn.addEventListener('click', () => {
    if (timelineEnd() <= 0) return;
    if (clock.paused) {
      clock.play();
      audioEngine.play(clock.currentTime); // start audio from the same playhead
      playBtn.textContent = '⏸ Pause';
    } else {
      clock.pause();
      audioEngine.pause();
      playBtn.textContent = '▶ Play';
    }
  });

  scrub.addEventListener('input', () => {
    clock.pause();
    audioEngine.pause();
    playBtn.textContent = '▶ Play';
    clock.seek(Number(scrub.value));
    updateTimeLabel();
    updatePlayhead();
    // Re-sync the inspector's X/Y readout to the (possibly keyframed) frame.
    rebuildInspector();
  });

  // ── Toolbar wiring ─────────────────────────────────────────────────────

  $('add-text').addEventListener('click', addText);
  $('add-rect').addEventListener('click', () => addShape('rect'));
  $('add-ellipse').addEventListener('click', () => addShape('ellipse'));
  $('add-track').addEventListener('click', () => {
    addTrack();
    rebuildTimeline();
  });

  $<HTMLInputElement>('add-image').addEventListener('change', (e) => {
    const f = (e.target as HTMLInputElement).files?.[0];
    if (f) addImage(f).catch(reportError);
    (e.target as HTMLInputElement).value = '';
  });
  $<HTMLInputElement>('add-video').addEventListener('change', (e) => {
    const f = (e.target as HTMLInputElement).files?.[0];
    if (f) addVideo(f).catch(reportError);
    (e.target as HTMLInputElement).value = '';
  });

  function reportError(err: unknown): void {
    console.error(err);
    setStatus(`Error: ${err instanceof Error ? err.message : String(err)}`);
  }

  // ── Export ─────────────────────────────────────────────────────────────

  let activeExporter: Exporter | null = null;

  async function doExport(): Promise<void> {
    if (activeExporter) {
      activeExporter.cancel(); // second click = cancel an in-flight export
      return;
    }
    if (timelineEnd() <= 0) {
      setStatus('Nothing to export');
      return;
    }
    // Export encodes via WebCodecs (Mediabunny). Fail fast on browsers without
    // it instead of hanging on an encoder that never initializes.
    if (typeof (globalThis as { VideoEncoder?: unknown }).VideoEncoder === 'undefined') {
      setStatus('Export needs WebCodecs (use a recent Chrome/Edge)');
      return;
    }
    clock.pause();
    audioEngine.pause(); // don't leave preview audio running during export
    playBtn.textContent = '▶ Play';
    exportBtn.textContent = '⏹ Cancel';
    const container = exportFormat.value as 'mp4' | 'webm';

    try {
      setStatus('Preparing export…');
      // Map the editor's tracks onto the exporter's minimal view and run the
      // forked offscreen export (see editor-export.ts). Audio is muxed from the
      // shared AudioEngine's offline mix when any clip contributes sound.
      const blob = await exportTimeline(tracks.map((tm) => ({ zIndex: tm.track.zIndex, clips: tm.clips })), audioEngine, {
        width: W,
        height: H,
        timebase,
        fps: FPS,
        container,
        range: [0, timelineEnd()],
        origin: ORIGIN,
        audio: hasAnyAudio(),
        onProgress: (p) => setStatus(`Exporting… ${Math.round(p * 100)}%`),
        onExporter: (e) => (activeExporter = e),
      });
      downloadBlob(blob, `export.${container}`);
      setStatus(`Exported ${(blob.size / 1e6).toFixed(1)} MB ✓`);
    } catch (err) {
      if (err instanceof Error && err.name === 'ExportCancelledError') setStatus('Export cancelled');
      else reportError(err);
    } finally {
      activeExporter = null;
      exportBtn.textContent = '⬇ Export';
      render(); // repaint the preview (untouched by the offscreen export)
    }
  }

  function downloadBlob(blob: Blob, name: string): void {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }

  exportBtn.addEventListener('click', () => void doExport());

  // ── Boot ───────────────────────────────────────────────────────────────
  wireCanvasManipulation();
  addTrack(); // start with one empty track
  addText(); // and a sample title so the canvas isn't blank
  rebuildTimeline();
  rebuildInspector();
  refreshDuration();
  clock.seek(0);
  render();
}

main().catch((err) => {
  console.error(err);
  const stage = document.getElementById('stage');
  if (stage) stage.textContent = String(err);
});
