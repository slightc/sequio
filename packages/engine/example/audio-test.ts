/**
 * Puppeteer verification for milestone 06 (audio). Two parts:
 *
 * 1. AudioEngine.renderOffline with a REAL OfflineAudioContext (works headless):
 *    schedule a synthesized tone with a fade-in and 0.5 gain, render the mix,
 *    and assert the output samples reflect the fade + gain (contract #3 — the
 *    offline mix is shaped by the same scheduling as preview).
 * 2. AudioSource.load: record a real WebM/Opus tone (MediaRecorder) and decode
 *    it back via Mediabunny's AudioBufferSink — reported best-effort.
 *
 * Result on `window.__AUDIO_TEST__`.
 */
import { AudioClip, AudioEngine, AudioSource, Timebase } from '../src/index';

const SR = 48000;

function toneBuffer(freq: number, seconds: number): AudioBuffer {
  const length = Math.floor(seconds * SR);
  const buf = new AudioBuffer({ length, numberOfChannels: 1, sampleRate: SR });
  const data = buf.getChannelData(0);
  for (let i = 0; i < length; i++) data[i] = Math.sin((2 * Math.PI * freq * i) / SR);
  return buf;
}

function rms(data: Float32Array, from: number, to: number): number {
  let s = 0;
  for (let i = from; i < to; i++) s += data[i]! * data[i]!;
  return Math.sqrt(s / Math.max(1, to - from));
}

/** Record a short tone into a real WebM/Opus blob. */
async function recordTone(seconds: number): Promise<Blob> {
  const ctx = new AudioContext();
  await ctx.resume().catch(() => {});
  const osc = ctx.createOscillator();
  osc.frequency.value = 440;
  const dest = ctx.createMediaStreamDestination();
  osc.connect(dest);
  osc.start();
  const mime = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
    ? 'audio/webm;codecs=opus'
    : 'audio/webm';
  const rec = new MediaRecorder(dest.stream, { mimeType: mime });
  const chunks: BlobPart[] = [];
  rec.ondataavailable = (e) => {
    if (e.data.size) chunks.push(e.data);
  };
  const stopped = new Promise<Blob>((res) => {
    rec.onstop = () => res(new Blob(chunks, { type: 'audio/webm' }));
  });
  rec.start();
  await new Promise((r) => setTimeout(r, seconds * 1000));
  rec.stop();
  osc.stop();
  await ctx.close();
  return stopped;
}

async function run(): Promise<void> {
  // ── 1. renderOffline of a synthesized tone with fade-in + gain ──────────────
  const tone = toneBuffer(440, 1);
  const source = { getBuffer: () => tone } as unknown as AudioSource;
  const clip = new AudioClip();
  clip.start = 0;
  clip.end = 1;
  clip.fadeIn = 0.25;
  clip.gain.setStatic(0.5);

  const engine = new AudioEngine(new Timebase(30));
  engine.schedule(clip, source);
  const mix = await engine.renderOffline(1, SR);
  const d = mix.getChannelData(0);

  const startRms = rms(d, 0, Math.floor(0.03 * SR)); // inside the fade-in → quiet
  const midRms = rms(d, Math.floor(0.5 * SR), Math.floor(0.55 * SR)); // full → ~0.5*0.707
  const offlineOk = midRms > 0.25 && midRms < 0.45 && startRms < midRms * 0.5;

  // ── 2. AudioSource decode (best-effort) ─────────────────────────────────────
  let decode: { ok: boolean; duration?: number; error?: string };
  try {
    const blob = await recordTone(0.8);
    const s = new AudioSource({ src: blob });
    const meta = await s.load();
    decode = { ok: !!s.getBuffer() && meta.duration > 0, duration: meta.duration };
  } catch (err) {
    decode = { ok: false, error: String(err) };
  }

  (window as unknown as { __AUDIO_TEST__: unknown }).__AUDIO_TEST__ = {
    ok: offlineOk,
    startRms,
    midRms,
    decode,
  };
}

run().catch((err) => {
  (window as unknown as { __AUDIO_TEST__: unknown }).__AUDIO_TEST__ = { ok: false, error: String(err) };
});
