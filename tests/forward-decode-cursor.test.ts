import { describe, expect, it } from 'vitest';
import { type CursorSample, ForwardDecodeCursor } from '../src/media/forward-decode-cursor';

/** A synthetic decoded frame that records whether it was closed. */
class FakeSample implements CursorSample {
  closed = false;
  constructor(readonly timestamp: number) {}
  close(): void {
    this.closed = true;
  }
}

/**
 * A fake sample stream over a sorted timestamp list, mirroring Mediabunny's
 * `VideoSampleSink.samples(start)`: the first yielded sample is the one
 * at-or-before `start` (else the first sample), then the rest in order. Records
 * every `open(start)` (a re-seek) and every yielded timestamp (a decode).
 */
function fakeStream(times: number[]) {
  const opens: number[] = [];
  const decoded: number[] = [];
  const samples = times.map((t) => new FakeSample(t));
  const open = (start: number) => {
    opens.push(start);
    // Largest index whose timestamp <= start, else 0 (before the first frame).
    let i = 0;
    for (let k = 0; k < samples.length; k++) if (samples[k]!.timestamp <= start) i = k;
    async function* gen(): AsyncGenerator<FakeSample, void, unknown> {
      for (let k = i; k < samples.length; k++) {
        decoded.push(samples[k]!.timestamp);
        yield samples[k]!;
      }
    }
    return gen();
  };
  return { open, opens, decoded, samples };
}

const ts = (s: FakeSample | null) => s?.timestamp ?? null;

describe('ForwardDecodeCursor', () => {
  it('decodes each frame once over a sequential forward walk (one iterator)', async () => {
    const times = [0, 0.1, 0.2, 0.3, 0.4];
    const { open, opens, decoded } = fakeStream(times);
    const cursor = new ForwardDecodeCursor(open);

    for (const t of times) {
      expect(ts(await cursor.at(t))).toBeCloseTo(t);
    }
    expect(opens).toEqual([0]); // built the iterator exactly once — no re-seeks
    // Every frame decoded exactly once (each appears once in the decode log).
    expect(decoded.filter((t) => t === 0.2)).toHaveLength(1);
    expect(new Set(decoded).size).toBe(times.length);
  });

  it('returns the frame at-or-before a between-frames request', async () => {
    const { open } = fakeStream([0, 0.1, 0.2, 0.3]);
    const cursor = new ForwardDecodeCursor(open);
    expect(ts(await cursor.at(0.05))).toBeCloseTo(0); // visible frame at 0.05 is t=0
    expect(ts(await cursor.at(0.25))).toBeCloseTo(0.2); // and at 0.25 is t=0.2
  });

  it('re-seeks on a backward step', async () => {
    const { open, opens } = fakeStream([0, 0.1, 0.2, 0.3, 0.4]);
    const cursor = new ForwardDecodeCursor(open);
    await cursor.at(0.3); // first request seeks near 0.3
    await cursor.at(0.4);
    expect(opens).toEqual([0.3]); // still one iterator so far
    expect(ts(await cursor.at(0.1))).toBeCloseTo(0.1); // backward jump
    expect(opens).toEqual([0.3, 0.1]); // rebuilt from a fresh seek
  });

  it('re-seeks on a forward jump past the reset gap, iterates within it', async () => {
    const times = [0, 0.5, 1.0, 1.5, 5.0, 5.5];
    const { open, opens } = fakeStream(times);
    const cursor = new ForwardDecodeCursor(open, /* resetGap */ 1.0);
    await cursor.at(0); // opens at 0
    await cursor.at(0.5); // within gap → same iterator
    expect(opens).toEqual([0]);
    await cursor.at(5.0); // 5.0 >> 0.5 + 1.0 → re-seek
    expect(opens).toEqual([0, 5.0]);
  });

  it('closes frames it steps over, not the one it serves', async () => {
    // Dense frames, then a forward step that skips a few (within the reset gap so
    // it iterates rather than re-seeks).
    const { open, samples } = fakeStream([0, 0.1, 0.2, 0.3, 0.4, 0.5]);
    const cursor = new ForwardDecodeCursor(open);
    await cursor.at(0.05); // serves t=0
    const served = await cursor.at(0.35); // serves t=0.3, stepping over 0.1, 0.2
    expect(ts(served)).toBeCloseTo(0.3);
    expect(samples[1]!.closed).toBe(true); // 0.1 stepped over → closed
    expect(samples[2]!.closed).toBe(true); // 0.2 stepped over → closed
    expect(samples[3]!.closed).toBe(false); // 0.3 served → caller owns it
    expect(samples[4]!.closed).toBe(false); // 0.4 is the held look-ahead head
  });

  it('yields null before the first frame', async () => {
    const { open } = fakeStream([1.0, 1.1, 1.2]);
    const cursor = new ForwardDecodeCursor(open);
    expect(await cursor.at(0.5)).toBeNull(); // nothing at-or-before 0.5
  });

  it('dispose closes the carried look-ahead frame', async () => {
    const { open, samples } = fakeStream([0, 0.1, 0.2]);
    const cursor = new ForwardDecodeCursor(open);
    await cursor.at(0); // serves 0, holds 0.1 as look-ahead head
    cursor.dispose();
    expect(samples[1]!.closed).toBe(true); // held head released
  });
});
