import { describe, expect, it, vi } from 'vitest';
import { AudioClip } from '../src/compositor/clip';
import { AudioEngine } from '../src/audio/audio-engine';
import type { AudioSource } from '../src/media/audio-source';
import { Timebase } from '../src/time/timebase';

/** A fake Web Audio context that records what the engine builds. */
function fakeContext(currentTime = 10) {
  const started: { when: number; offset: number; duration: number; rate: number }[] = [];
  const gains: { events: { type: 'set' | 'ramp'; value: number; time: number }[] }[] = [];
  const ctx = {
    state: 'running' as AudioContextState,
    currentTime,
    sampleRate: 48000,
    destination: { id: 'dest' } as unknown as AudioNode,
    resume: vi.fn(),
    close: vi.fn(),
    createBufferSource() {
      const node = {
        buffer: null as AudioBuffer | null,
        playbackRate: { value: 1 },
        connect: (n: unknown) => n,
        start(when: number, offset: number, duration: number) {
          started.push({ when, offset, duration, rate: node.playbackRate.value });
        },
        stop: vi.fn(),
      };
      return node;
    },
    createBuffer(numberOfChannels: number, length: number, sampleRate: number) {
      const channels = Array.from({ length: numberOfChannels }, () => new Float32Array(length));
      return {
        numberOfChannels,
        length,
        sampleRate,
        duration: length / sampleRate,
        getChannelData: (ch: number) => channels[ch]!,
      } as unknown as AudioBuffer;
    },
    createGain() {
      const events: { type: 'set' | 'ramp'; value: number; time: number }[] = [];
      gains.push({ events });
      return {
        gain: {
          setValueAtTime: (value: number, time: number) => events.push({ type: 'set', value, time }),
          linearRampToValueAtTime: (value: number, time: number) => events.push({ type: 'ramp', value, time }),
        },
        connect: (n: unknown) => n,
      };
    },
  };
  return { ctx, started, gains };
}

function fakeSource(): AudioSource {
  return { getBuffer: () => ({ length: 1 }) as unknown as AudioBuffer } as unknown as AudioSource;
}

function makeEngine(currentTime = 10) {
  const fake = fakeContext(currentTime);
  const engine = new AudioEngine(new Timebase(30), fake.ctx as unknown as AudioContext);
  return { engine, ...fake };
}

function audioClip(props: Partial<AudioClip>): AudioClip {
  const c = new AudioClip();
  Object.assign(c, props);
  return c;
}

describe('AudioEngine', () => {
  it('schedules a clip at the right context time, offset and duration', () => {
    const { engine, started } = makeEngine(10);
    engine.schedule(audioClip({ start: 2, end: 5 }), fakeSource());
    engine.play(0);
    expect(engine.isPlaying).toBe(true);
    // ctxStart 10 + when 2 = 12; offset 0; duration 3; rate 1
    expect(started).toEqual([{ when: 12, offset: 0, duration: 3, rate: 1 }]);
  });

  it('applies speed as playbackRate and remaps offset/duration into the buffer', () => {
    const { engine, started } = makeEngine(0);
    engine.schedule(audioClip({ start: 0, end: 4, speed: 2 }), fakeSource());
    engine.play(1); // play from timeline 1
    expect(started).toEqual([{ when: 0, offset: 2, duration: 6, rate: 2 }]);
  });

  it('倒放: plays a reversed copy of the buffer and offsets into it', () => {
    const { engine, started } = makeEngine(0);
    // A 4-sample buffer [1,2,3,4] at 1 Hz → 4s. Reverse over a 4s clip: forward
    // would read [0,4); reversed reads the flipped copy [4,3,2,1] from offset 0.
    const data = Float32Array.from([1, 2, 3, 4]);
    const buffer = {
      numberOfChannels: 1,
      length: 4,
      sampleRate: 1,
      duration: 4,
      getChannelData: () => data,
    } as unknown as AudioBuffer;
    const source = { getBuffer: () => buffer } as unknown as AudioSource;
    let uploaded: Float32Array | null = null;
    // Capture the buffer the node received by wrapping createBufferSource.
    const orig = (engine as unknown as { ctx(): AudioContext }).ctx();
    const realCreate = orig.createBufferSource.bind(orig);
    orig.createBufferSource = () => {
      const node = realCreate();
      Object.defineProperty(node, 'buffer', {
        set(b: AudioBuffer | null) {
          if (b) uploaded = b.getChannelData(0);
        },
        get() {
          return null;
        },
      });
      return node;
    };
    engine.schedule(audioClip({ start: 0, end: 4, reversed: true }), source);
    engine.play(0);
    // reversed offset = bufferDuration(4) - sourceStart(4) = 0, whole thing plays.
    expect(started).toEqual([{ when: 0, offset: 0, duration: 4, rate: 1 }]);
    expect(Array.from(uploaded!)).toEqual([4, 3, 2, 1]);
  });

  it('lays fade automation onto the gain node', () => {
    const { engine, gains } = makeEngine(0);
    engine.schedule(audioClip({ start: 0, end: 10, fadeIn: 2, fadeOut: 2 }), fakeSource());
    engine.play(0);
    const ev = gains[0]!.events;
    expect(ev[0]).toEqual({ type: 'set', value: 0, time: 0 }); // fade starts at 0
    expect(ev.map((e) => Number(e.value.toFixed(3)))).toEqual([0, 1, 1, 0]);
    expect(ev.map((e) => e.type)).toEqual(['set', 'ramp', 'ramp', 'ramp']);
  });

  it('skips clips finished before the playhead', () => {
    const { engine, started } = makeEngine();
    engine.schedule(audioClip({ start: 0, end: 2 }), fakeSource());
    engine.play(3); // clip already over
    expect(started).toEqual([]);
  });

  it('pause stops nodes and clears playing', () => {
    const { engine } = makeEngine();
    engine.schedule(audioClip({ start: 0, end: 5 }), fakeSource());
    engine.play(0);
    engine.pause();
    expect(engine.isPlaying).toBe(false);
  });

  it('clear() drops registered clips so nothing schedules', () => {
    const { engine, started } = makeEngine();
    engine.schedule(audioClip({ start: 0, end: 5 }), fakeSource());
    engine.clear();
    engine.play(0);
    expect(started).toEqual([]);
    expect(engine.isPlaying).toBe(true); // play() ran, just nothing to schedule
  });

  it('renderOffline builds the mix from t=0 and returns the rendered buffer', async () => {
    const rendered = { length: 480 } as unknown as AudioBuffer;
    const offline = fakeContext(0);
    class TestEngine extends AudioEngine {
      protected override createOfflineContext(): OfflineAudioContext {
        return {
          ...offline.ctx,
          startRendering: () => Promise.resolve(rendered),
        } as unknown as OfflineAudioContext;
      }
    }
    const engine = new TestEngine(new Timebase(30));
    engine.schedule(audioClip({ start: 2, end: 5 }), fakeSource());
    const out = await engine.renderOffline(5);
    expect(out).toBe(rendered);
    // scheduled from playhead 0: when 2, offset 0, duration 3
    expect(offline.started).toEqual([{ when: 2, offset: 0, duration: 3, rate: 1 }]);
  });
});
