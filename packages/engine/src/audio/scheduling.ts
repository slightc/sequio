import type { AudioClip } from '../compositor/clip';

/** How to start one buffer node for a clip, relative to the transport start. */
export interface ClipPlayback {
  /** Seconds after the transport start at which to `start()` the node (≥ 0). */
  when: number;
  /** Offset into the buffer, in buffer seconds (into the reversed copy when {@link reversed}). */
  offset: number;
  /** Buffer seconds to consume; the node auto-stops after this. */
  duration: number;
  /** Playback rate (clip speed / time-remap). Affects pitch and duration. */
  playbackRate: number;
  /** Whether the node should read from a reversed copy of the buffer (倒放). */
  reversed: boolean;
}

/**
 * Compute how to schedule `clip` when the transport is (re)started at timeline
 * time `playhead`. Returns `null` if the clip has already finished at the
 * playhead. All times are seconds; `when` is relative to the transport start.
 *
 * Speed maps timeline seconds to buffer seconds: playing timeline
 * `[playStart, end)` at rate `s` consumes buffer `[offset, offset + span*s)` and
 * takes `span` real seconds (rate `s` stretches the buffer back to real time).
 *
 * For a {@link AudioClip.reversed} clip the driver plays a reversed copy of the
 * buffer (Web Audio has no negative `playbackRate`), so `offset` is measured
 * into that reversed copy — pass `bufferDuration` (the source buffer length in
 * seconds) so the forward source time can be flipped to a reversed offset.
 */
export function clipPlaybackAt(
  clip: AudioClip,
  playhead: number,
  bufferDuration = 0,
): ClipPlayback | null {
  const speed = clip.speed > 0 ? clip.speed : 1;
  const playStart = Math.max(clip.start, playhead);
  if (playStart >= clip.end) return null;
  const span = clip.end - playStart;
  // Forward source time at playStart. In a reversed clip the window is walked
  // downward, so the highest source time consumed is at the *end* of the window.
  const sourceStart = clip.reversed
    ? clip.sourceIn + (clip.end - playStart) * speed
    : clip.sourceIn + (playStart - clip.start) * speed;
  return {
    when: playStart - playhead,
    // A reversed copy maps original time τ → position (bufferDuration − τ); the
    // reversed node then plays *forward* from there as source time counts down.
    offset: clip.reversed ? bufferDuration - sourceStart : sourceStart,
    duration: span * speed,
    playbackRate: speed,
    reversed: clip.reversed,
  };
}

/** Fade multiplier (0..1) from `fadeIn` / `fadeOut` at timeline time `t`. */
export function fadeFactor(clip: AudioClip, t: number): number {
  let f = 1;
  if (clip.fadeIn > 0 && t < clip.start + clip.fadeIn) {
    f *= clamp01((t - clip.start) / clip.fadeIn);
  }
  if (clip.fadeOut > 0 && t > clip.end - clip.fadeOut) {
    f *= clamp01((clip.end - t) / clip.fadeOut);
  }
  return f;
}

/** Effective gain at timeline time `t`: animated `gain` × fade envelope. */
export function effectiveGain(clip: AudioClip, t: number): number {
  return Math.max(0, clip.gain.valueAt(t) * fadeFactor(clip, t));
}

/** One gain-automation point, relative to the transport start. */
export interface GainEvent {
  when: number;
  value: number;
}

/**
 * Gain-automation events for `clip` over its playback from `playhead`. Includes
 * the fade corners and — when `gain` is keyframed — regular samples, so the
 * driver can lay them onto a `GainNode` (first as a set, the rest as ramps).
 */
export function gainEventsAt(clip: AudioClip, playhead: number, sampleStep = 1 / 30): GainEvent[] {
  const playStart = Math.max(clip.start, playhead);
  if (playStart >= clip.end) return [];

  const times = new Set<number>([playStart, clip.end]);
  if (clip.fadeIn > 0) times.add(clip.start + clip.fadeIn);
  if (clip.fadeOut > 0) times.add(clip.end - clip.fadeOut);
  if (clip.gain.animated) {
    for (let t = playStart; t < clip.end; t += sampleStep) times.add(t);
  }

  return [...times]
    .filter((t) => t >= playStart && t <= clip.end)
    .sort((a, b) => a - b)
    .map((t) => ({ when: t - playhead, value: effectiveGain(clip, t) }));
}

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}
