import type { Disposable } from '../core/disposable';
import type { AudioClip } from '../compositor/clip';
import type { AudioSource } from '../media/audio-source';
import type { Timebase } from '../time/timebase';
import { clipPlaybackAt, gainEventsAt } from './scheduling';

interface Entry {
  clip: AudioClip;
  source: AudioSource;
}

/**
 * Schedules audio clips against the timeline using the Web Audio API, and
 * renders the full mix offline (`OfflineAudioContext`) for export. Preview and
 * export share one scheduling core ({@link clipPlaybackAt} / {@link gainEventsAt}),
 * so the offline mix matches the preview (SDK contract #3).
 *
 * Per clip it handles `speed` (time-remap → playbackRate, which shifts pitch),
 * `gain` automation and `fadeIn` / `fadeOut` (as GainNode ramps).
 */
export class AudioEngine implements Disposable {
  private context: AudioContext | null = null;
  private readonly entries: Entry[] = [];
  private nodes: AudioBufferSourceNode[] = [];
  private playing = false;

  constructor(
    private readonly timebase: Timebase,
    context?: AudioContext,
  ) {
    this.context = context ?? null;
  }

  /** Register a clip and its (loaded) source. */
  schedule(clip: AudioClip, source: AudioSource): void {
    this.entries.push({ clip, source });
  }

  /** Stop playback and drop all registered clips (e.g. when swapping timelines). */
  clear(): void {
    this.stopNodes();
    this.playing = false;
    this.entries.length = 0;
  }

  get isPlaying(): boolean {
    return this.playing;
  }

  /** Start (or restart) audio from timeline `playhead`, aligned to the clock. */
  play(playhead: number): void {
    this.stopNodes();
    const ctx = this.ctx();
    if (ctx.state === 'suspended') void ctx.resume();
    const ctxStart = ctx.currentTime;
    for (const { clip, source } of this.entries) {
      const buffer = source.getBuffer();
      if (!buffer) continue;
      const node = this.buildClip(ctx, clip, buffer, playhead, ctxStart, ctx.destination);
      if (node) this.nodes.push(node);
    }
    this.playing = true;
  }

  pause(): void {
    this.stopNodes();
    this.playing = false;
  }

  /** Reposition; if playing, re-schedule from the new playhead. */
  seek(playhead: number): void {
    if (this.playing) this.play(playhead);
  }

  /**
   * Render the whole mix from t=0 for `duration` seconds into one AudioBuffer
   * (export path). Uses the same scheduling as preview.
   */
  async renderOffline(duration: number, sampleRate?: number): Promise<AudioBuffer> {
    const sr = sampleRate ?? this.context?.sampleRate ?? 48000;
    const length = Math.max(1, Math.ceil(duration * sr));
    const octx = this.createOfflineContext(2, length, sr);
    for (const { clip, source } of this.entries) {
      const buffer = source.getBuffer();
      if (buffer) this.buildClip(octx, clip, buffer, 0, 0, octx.destination);
    }
    return octx.startRendering();
  }

  dispose(): void {
    this.stopNodes();
    void this.context?.close?.();
    this.context = null;
    this.entries.length = 0;
  }

  // ── seams (overridable for tests) ──────────────────────────────────────────
  protected ctx(): AudioContext {
    if (!this.context) this.context = new AudioContext();
    return this.context;
  }

  protected createOfflineContext(channels: number, length: number, sampleRate: number): OfflineAudioContext {
    return new OfflineAudioContext(channels, length, sampleRate);
  }

  // ── internal ────────────────────────────────────────────────────────────────
  /** Build one buffer-source → gain → destination node for a clip. */
  private buildClip(
    ctx: BaseAudioContext,
    clip: AudioClip,
    buffer: AudioBuffer,
    playhead: number,
    ctxStart: number,
    dest: AudioNode,
  ): AudioBufferSourceNode | null {
    const pb = clipPlaybackAt(clip, playhead);
    if (!pb) return null;

    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.playbackRate.value = pb.playbackRate;

    const gain = ctx.createGain();
    const events = gainEventsAt(clip, playhead);
    if (events.length > 0) {
      gain.gain.setValueAtTime(events[0]!.value, ctxStart + events[0]!.when);
      for (let i = 1; i < events.length; i++) {
        gain.gain.linearRampToValueAtTime(events[i]!.value, ctxStart + events[i]!.when);
      }
    }

    src.connect(gain).connect(dest);
    src.start(ctxStart + pb.when, pb.offset, pb.duration);
    return src;
  }

  private stopNodes(): void {
    for (const node of this.nodes) {
      try {
        node.stop();
      } catch {
        /* already stopped */
      }
    }
    this.nodes = [];
  }
}
