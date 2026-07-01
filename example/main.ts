/**
 * Mini multi-track editor playground.
 *
 * A small consumer app built on the SDK's public surface that demonstrates the
 * pieces an editor needs:
 *   - add Text / Shape (rect, ellipse) clips
 *   - upload local files as Image / Video sources and add them as clips
 *   - add tracks (stacked, later track renders on top via zIndex)
 *   - move / trim a clip on the timeline (edit its start / end)
 *   - move & resize a clip on the canvas (transform position / scale)
 *
 * Persistence, undo and schema are intentionally NOT here — that's the
 * consumer's job (see AGENT.md). This file only drives the SDK: every mutation
 * marks the graph dirty and calls `renderPreview` explicitly, because the SDK
 * never repaints on its own (contract #5).
 */
import {
  Compositor,
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
    addClip('text', clip, null, 'Text', DEFAULT_CLIP_DURATION, { text: 'Text' });
  }

  function addShape(kind: ShapeKind): void {
    const color = kind === 'rect' ? 0x3b82f6 : 0xec4899;
    const clip = new ShapeClip({ kind, width: 200, height: 140, fill: color, radius: kind === 'rect' ? 12 : undefined });
    placeCentered(clip);
    addClip('shape', clip, null, kind === 'rect' ? 'Rect' : 'Ellipse', DEFAULT_CLIP_DURATION);
  }

  async function addImage(file: File): Promise<void> {
    setStatus(`Loading ${file.name}…`);
    const source = new ImageSource({ src: file });
    const meta = await source.load();
    const clip = new ImageClip(source);
    // Contain within the canvas at 80% so it's clearly movable/resizable.
    const scale = Math.min(W / meta.width, H / meta.height) * 0.8;
    placeCentered(clip, scale);
    addClip('image', clip, source, file.name, DEFAULT_CLIP_DURATION);
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
    addClip('video', clip, source, file.name, dur);
    setStatus('');
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
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }

  // ── Inspector rendering ────────────────────────────────────────────────

  function rebuildInspector(): void {
    inspectorEl.innerHTML = '';
    if (!selected) {
      inspectorEl.innerHTML =
        '<h2>Inspector</h2><p class="empty-hint">Add a clip, then select it here or on the timeline to edit its <b>time</b>, <b>position</b> and <b>size</b>.</p>';
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
    inspectorEl.append(
      field('X', numberInput(Math.round(pos[0]), 1, (v) => {
        const p = c.transform.position.valueAt(clock.currentTime);
        c.transform.position.setStatic([v, p[1]]);
        render();
      })),
    );
    inspectorEl.append(
      field('Y', numberInput(Math.round(pos[1]), 1, (v) => {
        const p = c.transform.position.valueAt(clock.currentTime);
        c.transform.position.setStatic([p[0], v]);
        render();
      })),
    );

    // Size (uniform scale).
    const scale = c.transform.scale.valueAt(clock.currentTime)[0];
    inspectorEl.append(
      field('Size', rangeInput(scale, 0.1, 4, 0.05, (v) => {
        c.transform.scale.setStatic([v, v]);
        render();
      }, (v) => `${v.toFixed(2)}×`),
    ));

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
  ): HTMLElement {
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
    return wrap;
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

  // ── Boot ───────────────────────────────────────────────────────────────
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
