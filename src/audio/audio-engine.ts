import type { Disposable } from '../core/disposable';
import type { AudioClip } from '../compositor/clip';
import type { AudioSource } from '../media/audio-source';
import type { Timebase } from '../time/timebase';

/**
 * Schedules audio clips against the timeline using the Web Audio API, and
 * renders the full mix offline (OfflineAudioContext) for export.
 *
 * Handles per-clip speed (time remap), gain automation and fades.
 */
export class AudioEngine implements Disposable {
  constructor(private readonly timebase: Timebase) {}

  /** Schedule a clip's source on the timeline. */
  schedule(_clip: AudioClip, _source: AudioSource): void {
    throw new Error('AudioEngine.schedule not implemented — see todo/06-audio-engine.md');
  }

  seek(_t: number): void {
    throw new Error('AudioEngine.seek not implemented — see todo/06-audio-engine.md');
  }

  play(): void {
    throw new Error('AudioEngine.play not implemented — see todo/06-audio-engine.md');
  }

  pause(): void {
    throw new Error('AudioEngine.pause not implemented — see todo/06-audio-engine.md');
  }

  /** Render the entire mix offline for `duration` seconds (export path). */
  async renderOffline(_duration: number): Promise<AudioBuffer> {
    throw new Error('AudioEngine.renderOffline not implemented — see todo/06-audio-engine.md');
  }

  dispose(): void {
    // Close the AudioContext, stop scheduled nodes.
  }
}
