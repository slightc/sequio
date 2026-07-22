/**
 * A forward-decode cursor over an ordered sample stream.
 *
 * Random-access decode (`getSample(sec)`) re-seeks to the nearest keyframe and
 * re-decodes the GOP prefix on every call, so playing a clip frame-by-frame is
 * O(GOP²) and stutters. This cursor keeps one long-lived iterator (built by
 * {@link SampleIteratorFactory}, e.g. Mediabunny's `VideoSampleSink.samples`,
 * which pre-decodes a little ahead) and, for a monotonic request, just advances
 * it to the frame at-or-before `sec` — decoding each frame exactly once. A
 * backward step, or a forward jump past {@link resetGap}, rebuilds the iterator
 * from a fresh keyframe seek.
 *
 * This is pure control-flow over an injected iterator, so it's unit-tested
 * independently of any real decoder (see `tests/forward-decode-cursor.test.ts`).
 */
export interface CursorSample {
  /** Presentation timestamp in seconds. */
  readonly timestamp: number;
  /** Release the underlying decoded resource. */
  close(): void;
}

/**
 * Opens an iterator that yields samples in presentation order, the first being
 * the sample at-or-before `startSec` (the frame visible at that time).
 */
export type SampleIteratorFactory<S extends CursorSample> = (
  startSec: number,
) => AsyncGenerator<S, void, unknown>;

export class ForwardDecodeCursor<S extends CursorSample> {
  private iter: AsyncGenerator<S, void, unknown> | null = null;
  /** A sample pulled from {@link iter} but past the last request — the next
   *  call's first candidate (one frame of read-ahead we hold ownership of). */
  private head: S | null = null;
  /** Timestamp of the last frame served, distinguishing a step from a seek. */
  private cursorTs = -Infinity;

  constructor(
    private readonly open: SampleIteratorFactory<S>,
    /** A forward jump larger than this (seconds) re-seeks instead of iterating. */
    private readonly resetGap = 1.0,
  ) {}

  /**
   * The sample at-or-before `sec`. Reuses the cursor for a monotonic step;
   * rebuilds it for a backward/large-jump seek. Skipped-over frames are closed;
   * the returned sample is owned by the caller. `null` if no frame exists
   * at-or-before `sec` (e.g. before the first sample).
   */
  async at(sec: number): Promise<S | null> {
    let allowReset = true;
    if (!this.iter || sec < this.cursorTs || sec > this.cursorTs + this.resetGap) {
      await this.reset(sec);
      allowReset = false;
    }
    for (;;) {
      let result: S | null = null;
      // Pull while samples are still at-or-before sec; the last is the frame
      // visible at sec, earlier ones are stepped over (and closed).
      for (;;) {
        if (!this.head) {
          const next = await this.iter!.next();
          if (next.done) break;
          this.head = next.value;
        }
        if (this.head.timestamp <= sec) {
          result?.close(); // an intermediate frame, never served
          result = this.head;
          this.head = null;
        } else {
          break; // head is beyond sec — keep it as the next call's candidate
        }
      }
      if (result) {
        this.cursorTs = result.timestamp;
        return result;
      }
      // The cursor sits after sec (a small backward step within the reset gap):
      // re-seek once from a keyframe and retry.
      if (allowReset) {
        await this.reset(sec);
        allowReset = false;
        continue;
      }
      return null;
    }
  }

  /** Rebuild the iterator to start at `sec`, closing any carried-over frame. */
  async reset(sec: number): Promise<void> {
    if (this.iter) {
      try {
        await this.iter.return();
      } catch {
        /* iterator already torn down */
      }
    }
    this.head?.close();
    this.head = null;
    this.cursorTs = -Infinity;
    this.iter = this.open(Math.max(0, sec));
  }

  /**
   * Drop the live iterator (and its decoder) without disposing the cursor — the
   * next {@link at} rebuilds from a keyframe seek. A browser can reclaim a hidden
   * tab's WebCodecs decoder while it's backgrounded, leaving the iterator dead;
   * this lets {@link VideoSource.purge} recover it (the cursor stays reusable,
   * unlike {@link dispose}, which is terminal).
   */
  invalidate(): void {
    void this.iter?.return();
    this.iter = null;
    this.head?.close();
    this.head = null;
    this.cursorTs = -Infinity;
  }

  /** Tear down the cursor, releasing the iterator's decoder and held frame. */
  dispose(): void {
    void this.iter?.return();
    this.iter = null;
    this.head?.close();
    this.head = null;
  }
}
