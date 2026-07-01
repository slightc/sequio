/**
 * Mini multi-track editor playground.
 *
 * A small consumer app built on the SDK's public surface that demonstrates the
 * pieces an editor needs:
 *   - add Text / Shape (rect, ellipse) clips
 *   - upload local files as Image / Video sources and add them as clips
 *   - add tracks (stacked, later track renders on top via zIndex)
 *   - move / trim a clip on the timeline (edit its start / end)
 *   - move & resize a clip directly on the canvas (drag body, drag corner
 *     handles) or numerically in the inspector (transform position / scale)
 *   - export the timeline to MP4 / WebM via the SDK's Exporter (WebCodecs)
 *
 * Persistence, undo and schema are intentionally NOT here — that's the
 * consumer's job (see AGENT.md). This file only drives the SDK: every mutation
 * marks the graph dirty and calls `renderPreview` explicitly, because the SDK
 * never repaints on its own (contract #5).
 */
import {
  AudioEngine,
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
  VisualTrack,
} from '../src/index';

const W = 640;
const H = 360;
const FPS = 30;
const PX_PER_SEC = 80; // timeline horizontal scale
const MIN_TIMELINE = 8; // seconds of ruler shown even when empty
const DEFAULT_CLIP_DURATION = 3; // seconds for newly-added clips

const CLIP_COLORS = ['#3b82f6', '#8b5cf6', '#ec4899', '#f59e0b', '#10b981', '#ef4444'];

/** A clip plus the app-layer metadata the editor UI needs around it. */
interface ClipModel {
  id: number;
  kind: 'text' | 'shape' | 'image' | 'video';
  label: string;
  clip: VisualClip;
  source: { dispose(): void } | null;
  color: string;
  /** Editable text (text clips only). */
  text?: string;
  /** Intrinsic (unscaled) size in canvas px, for the on-canvas selection box. */
  iw: number;
  ih: number;
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
    // An editor timeline shows trailing black past the content instead of
    // freezing the final frame, so the playhead past the last clip is honest.
    holdLastFrameAtEnd: false,
  });
  await compositor.init();
  document.getElementById('stage')!.append(compositor.view);

  const clock = new RealtimeClock();

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
    clip.transform.position.setStatic([W / 2, H / 2]);
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
    source: { dispose(): void } | null,
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
    const source = new VideoSource({ src: file });
    const meta = await source.load();
    const clip = new VideoClip(source);
    const scale = Math.min(W / meta.width, H / meta.height) * 0.8;
    placeCentered(clip, scale);
    // Default the clip to the video's own length (capped so a long file doesn't
    // dominate the timeline; the user can trim it on the timeline anyway).
    const dur = Number.isFinite(meta.duration) ? Math.min(meta.duration, 10) : DEFAULT_CLIP_DURATION;
    addClip('video', clip, source, file.name, dur, meta.width, meta.height);
    setStatus('');
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

    // Move: drag the block body → shift start (duration preserved, clamped ≥ 0).
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

  /** Axis-aligned bounds of a clip in logical canvas px (anchor is centered). */
  function clipBounds(m: ClipModel): { cx: number; cy: number; w: number; h: number } {
    const [cx, cy] = m.clip.transform.position.valueAt(clock.currentTime);
    const [sx, sy] = m.clip.transform.scale.valueAt(clock.currentTime);
    return { cx, cy, w: m.iw * Math.abs(sx), h: m.ih * Math.abs(sy) };
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

    // Position (clip center in canvas px).
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
    playBtn.textContent = '▶ Play';
  });

  playBtn.addEventListener('click', () => {
    if (timelineEnd() <= 0) return;
    if (clock.paused) {
      clock.play();
      playBtn.textContent = '⏸ Pause';
    } else {
      clock.pause();
      playBtn.textContent = '▶ Play';
    }
  });

  scrub.addEventListener('input', () => {
    clock.pause();
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

  // No audio in this demo, but the Exporter needs an engine to construct; we
  // pass `audio: false` so its offline mix is never invoked.
  const audioEngine = new AudioEngine(timebase);

  async function doExport(): Promise<void> {
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
    playBtn.textContent = '▶ Play';
    exportBtn.disabled = true;
    const container = exportFormat.value as 'mp4' | 'webm';
    try {
      const exporter = new Exporter(compositor, audioEngine);
      const blob = await exporter.export(
        { fps: FPS, container, audio: false, range: [0, timelineEnd()] },
        (p) => setStatus(`Exporting… ${Math.round(p * 100)}%`),
      );
      downloadBlob(blob, `export.${container}`);
      setStatus(`Exported ${(blob.size / 1e6).toFixed(1)} MB ✓`);
    } catch (err) {
      reportError(err);
    } finally {
      exportBtn.disabled = false;
      render(); // export drove the compositor to other frames — restore preview
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
