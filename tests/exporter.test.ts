import { describe, expect, it, vi } from 'vitest';
import type { AudioEngine } from '../src/audio/audio-engine';
import type { Compositor } from '../src/compositor/compositor';
import type { ExportSink } from '../src/export/export-sink';
import { Exporter, ExportCancelledError } from '../src/export/exporter';
import { exportFrameTimes } from '../src/export/frame-times';

describe('exportFrameTimes', () => {
  it('emits round((end-start)*fps) half-open timestamps from start', () => {
    const t = exportFrameTimes([0, 0.1], 30);
    expect(t).toHaveLength(3);
    expect(t[0]).toBe(0);
    expect(t[1]).toBeCloseTo(1 / 30);
    expect(t[2]).toBeCloseTo(2 / 30);
  });

  it('offsets a sub-range from its start', () => {
    const t = exportFrameTimes([1, 1 + 2 / 30], 30);
    expect(t).toHaveLength(2);
    expect(t[0]).toBe(1);
    expect(t[1]).toBeCloseTo(1 + 1 / 30);
  });

  it('returns [] for empty or negative spans', () => {
    expect(exportFrameTimes([2, 2], 30)).toEqual([]);
    expect(exportFrameTimes([2, 1], 30)).toEqual([]);
  });
});

/** A fake compositor/audio/sink that logs the export pipeline calls in order. */
function harness() {
  const log: string[] = [];
  const sink: ExportSink = {
    start: vi.fn(async () => void log.push('start')),
    addFrame: vi.fn(async (t: number) => void log.push(`frame@${t.toFixed(3)}`)),
    addAudio: vi.fn(async () => void log.push('addAudio')),
    finalize: vi.fn(async () => {
      log.push('finalize');
      return new Blob(['x']);
    }),
    cancel: vi.fn(async () => void log.push('cancel')),
  };
  const compositor = {
    view: {} as HTMLCanvasElement,
    getTracks: () => [{ clips: [{ end: 0.1 }] }],
    prepare: vi.fn(async (t: number) => void log.push(`prepare@${t.toFixed(3)}`)),
    renderSync: vi.fn((t: number) => void log.push(`render@${t.toFixed(3)}`)),
  } as unknown as Compositor;
  const audio = {
    renderOffline: vi.fn(async (d: number) => {
      log.push(`offline@${d.toFixed(3)}`);
      return {} as AudioBuffer;
    }),
  } as unknown as AudioEngine;

  const encoded: Array<{ type?: string; quality?: number }> = [];
  class TestExporter extends Exporter {
    protected override createSink(): ExportSink {
      return sink;
    }
    protected override waitForAssets(): Promise<void> {
      return Promise.resolve();
    }
    protected override encodeFrame(
      _canvas: HTMLCanvasElement,
      options: { type?: string; quality?: number },
    ): Promise<Blob> {
      log.push(`encode:${options.type ?? 'image/png'}`);
      encoded.push(options);
      return Promise.resolve(new Blob(['img'], { type: options.type ?? 'image/png' }));
    }
  }
  return { log, sink, encoded, compositor, audio, exporter: new TestExporter(compositor, audio) };
}

describe('Exporter loop', () => {
  it('awaits prepare → renders → adds each frame in order, then audio, then finalize', async () => {
    const { log, exporter } = harness();
    await exporter.export({ fps: 30, audio: true }); // default range = timeline [0, 0.1) → 3 frames
    expect(log).toEqual([
      'start',
      'prepare@0.000',
      'render@0.000',
      'frame@0.000',
      'prepare@0.033',
      'render@0.033',
      'frame@0.033',
      'prepare@0.067',
      'render@0.067',
      'frame@0.067',
      'offline@0.100',
      'addAudio',
      'finalize',
    ]);
  });

  it('reports monotonic progress ending at 1', async () => {
    const { exporter } = harness();
    const progress: number[] = [];
    await exporter.export({ fps: 30 }, (p) => progress.push(p));
    expect(progress.map((p) => +p.toFixed(3))).toEqual([0.333, 0.667, 1]);
  });

  it('skips audio when audio:false', async () => {
    const { log, sink, exporter } = harness();
    await exporter.export({ fps: 30, audio: false });
    expect(sink.addAudio).not.toHaveBeenCalled();
    expect(log.some((l) => l.startsWith('offline'))).toBe(false);
    expect(log.at(-1)).toBe('finalize');
  });

  it('honors an explicit range instead of the timeline duration', async () => {
    const { log, exporter } = harness();
    await exporter.export({ fps: 30, range: [0, 2 / 30], audio: false });
    expect(log.filter((l) => l.startsWith('frame@'))).toEqual(['frame@0.000', 'frame@0.033']);
  });

  it('cancel() stops the loop, tears down the sink, and rejects (no finalize)', async () => {
    const { log, sink, exporter } = harness();
    (sink.addFrame as ReturnType<typeof vi.fn>).mockImplementation(async () => {
      log.push('frame');
      exporter.cancel(); // cancel after the first frame is written
    });
    await expect(exporter.export({ fps: 30 })).rejects.toBeInstanceOf(ExportCancelledError);
    expect(sink.addFrame).toHaveBeenCalledTimes(1); // stopped at the next iteration
    expect(sink.cancel).toHaveBeenCalledTimes(1);
    expect(log).not.toContain('finalize');
  });
});

describe('Exporter.exportFrame', () => {
  it('awaits prepare → renders → encodes exactly one frame at the given time', async () => {
    const { log, exporter } = harness();
    const blob = await exporter.exportFrame(0.05);
    expect(log).toEqual(['prepare@0.050', 'render@0.050', 'encode:image/png']);
    expect(blob).toBeInstanceOf(Blob);
    expect(blob.type).toBe('image/png');
  });

  it('does not touch the movie sink or audio', async () => {
    const { sink, audio, exporter } = harness();
    await exporter.exportFrame(0);
    expect(sink.start).not.toHaveBeenCalled();
    expect(sink.addFrame).not.toHaveBeenCalled();
    expect(audio.renderOffline).not.toHaveBeenCalled();
  });

  it('renders an arbitrary time that need not fall on an fps boundary', async () => {
    const { log, exporter } = harness();
    await exporter.exportFrame(0.017);
    expect(log[0]).toBe('prepare@0.017');
  });

  it('passes the type and quality through to the encoder (png default, 0.92 quality)', async () => {
    const { encoded, exporter } = harness();
    await exporter.exportFrame(0, { type: 'image/jpeg', quality: 0.6 });
    expect(encoded).toEqual([{ type: 'image/jpeg', quality: 0.6 }]);
  });
});
