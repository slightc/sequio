/**
 * Self-contained Route B audio check: render a shape (video) plus a synthesized
 * 440 Hz tone (audio) to an MP4 in pure Node, then decode it back and assert both
 * a video and an audio track are present. Needs no external asset — the tone is
 * scheduled directly (mirroring the browser `export-test.ts`), so it exercises
 * the offline-mix → mux path without a fetchable audio URL.
 */
import { AudioClip, AudioEngine, type AudioSource, type Renderer, Timebase } from '@video-editor-canvas/engine';
import { buildTimeline, type TimelineSpec } from '../src/timeline';
import { createNodeWebGPURenderer, getMediabunny, setupNodeEnvironment } from './env';
import { renderTimelineToFile } from './export-node';

const W = 160;
const H = 120;
const FPS = 15;
const DUR = 1;

const spec: TimelineSpec = {
  width: W,
  height: H,
  fps: FPS,
  background: 0x101014,
  range: [0, DUR],
  tracks: [
    {
      clips: [
        { type: 'shape', shape: { kind: 'rect', width: W, height: H, fill: 0x22aa55 }, start: 0, end: DUR, transform: { anchor: [0, 0], position: [0, 0] } },
      ],
    },
  ],
};

async function main(): Promise<void> {
  await setupNodeEnvironment();
  const fs = await import('node:fs');
  const path = await import('node:path');

  let renderer: Renderer | null = null;
  const built = await buildTimeline(spec, {
    createRenderer: async (opts) => (renderer = await createNodeWebGPURenderer(opts)),
  });

  // Schedule a 440 Hz tone directly into an AudioEngine (self-contained source).
  const sr = 48000;
  const AudioBufferCtor = (globalThis as unknown as { AudioBuffer: new (o: { length: number; numberOfChannels: number; sampleRate: number }) => { getChannelData(c: number): Float32Array } }).AudioBuffer;
  const buffer = new AudioBufferCtor({ length: Math.floor(DUR * sr), numberOfChannels: 1, sampleRate: sr });
  const ch = buffer.getChannelData(0);
  for (let i = 0; i < ch.length; i++) ch[i] = Math.sin((2 * Math.PI * 440 * i) / sr) * 0.3;
  const source = { getBuffer: () => buffer, dispose() {} } as unknown as AudioSource;
  const clip = new AudioClip();
  clip.start = 0;
  clip.end = DUR;
  const audioEngine = new AudioEngine(new Timebase(FPS));
  audioEngine.schedule(clip, source as never);

  const out = path.resolve('.ssr-out/node-audio.mp4');
  fs.mkdirSync(path.dirname(out), { recursive: true });
  const result = await renderTimelineToFile(built.compositor, renderer!, {
    fps: FPS,
    range: [0, DUR],
    out,
    audio: { engine: audioEngine, codec: 'aac' },
  });
  built.dispose();
  console.log(`rendered ${result.out} (${result.frames} frames, ${result.container}/${result.videoCodec}, ${result.bytes} bytes${result.audio ? ', +audio' : ''})`);
  if (!result.audio) throw new Error('audio verify FAILED — audio track was skipped (node-av can\'t encode aac/opus?)');

  // Decode back and assert both tracks are present (same registered instance).
  const { Input, ALL_FORMATS, FilePathSource } = getMediabunny();
  const input = new Input({ source: new FilePathSource(result.out), formats: ALL_FORMATS });
  const vtrack = await input.getPrimaryVideoTrack();
  const atrack = await input.getPrimaryAudioTrack();
  const ok = !!vtrack && !!atrack && result.bytes > 500;
  console.log(`video track: ${vtrack ? `${vtrack.displayWidth}x${vtrack.displayHeight}` : 'MISSING'}`);
  console.log(`audio track: ${atrack ? `${(atrack as { numberOfChannels?: number }).numberOfChannels ?? '?'}ch` : 'MISSING'}`);
  if (!ok) throw new Error('audio verify FAILED — missing a track');
  console.log('✅ Route B audio verified: video + audio tracks present.');
  process.exit(0);
}

main().catch((err) => {
  console.error('\n❌', err?.message || err);
  process.exit(1);
});
