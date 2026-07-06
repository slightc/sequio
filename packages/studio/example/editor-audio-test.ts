/**
 * Puppeteer e2e for editor audio (WebCodecs) — "video added with no sound" fix.
 *
 * Builds a source A/V file (green frame + a 440 Hz tone), imports it the way the
 * editor does (VideoSource + AudioSource), schedules the audio in an AudioEngine
 * and confirms:
 *   - the imported video reports `hasAudio` and the AudioSource decodes PCM,
 *   - scheduling + `play()` makes the engine active (preview would be audible),
 *   - the editor's forked export with `audio: true` produces a file that decodes
 *     back with BOTH a video and an audio track.
 *
 * Result on `window.__EDITOR_AUDIO_TEST__`; run via `pnpm verify:editor-audio`.
 */
import {
  AudioClip,
  AudioEngine,
  type AudioSource as AudioSourceType,
  AudioSource,
  Compositor,
  Exporter,
  ShapeClip,
  Timebase,
  VideoClip,
  VideoSource,
  VisualTrack,
} from '@video-editor-canvas/engine';
import { applyCover } from './cover';
import { type ExportTrackLike, exportTimeline } from '../src/editor-export';

const W = 160;
const H = 120;
const FPS = 15;
const DUR = 1;

/** Pick a container + video/audio codec the browser can actually encode. */
async function pickAV(): Promise<{ container: 'mp4' | 'webm'; videoCodec: string; audioCodec: string } | null> {
  const { canEncodeVideo, canEncodeAudio } = await import('mediabunny');
  const combos = [
    { container: 'webm' as const, videoCodec: 'vp8', audioCodec: 'opus' },
    { container: 'webm' as const, videoCodec: 'vp9', audioCodec: 'opus' },
    { container: 'mp4' as const, videoCodec: 'avc', audioCodec: 'aac' },
  ];
  for (const c of combos) {
    if ((await canEncodeVideo(c.videoCodec as 'vp8')) && (await canEncodeAudio(c.audioCodec as 'opus'))) return c;
  }
  return null;
}

/** Encode a green clip + a 440 Hz tone → an A/V File to import back. */
async function makeAVFile(av: { container: 'mp4' | 'webm'; videoCodec: string; audioCodec: string }): Promise<File> {
  const comp = new Compositor({ width: W, height: H, timebase: new Timebase(FPS), background: 0x000000, preferWebGPU: false });
  await comp.init();
  const track = new VisualTrack();
  const rect = new ShapeClip({ kind: 'rect', width: W, height: H, fill: 0x00ff00 });
  rect.start = 0;
  rect.end = DUR;
  rect.transform.anchor.setStatic([0.5, 0.5]);
  rect.transform.position.setStatic([W / 2, H / 2]);
  track.add(rect);
  comp.addTrack(track);

  const sr = 48000;
  const buffer = new AudioBuffer({ length: Math.floor(DUR * sr), numberOfChannels: 1, sampleRate: sr });
  const ch = buffer.getChannelData(0);
  for (let i = 0; i < ch.length; i++) ch[i] = Math.sin((2 * Math.PI * 440 * i) / sr) * 0.3;
  const clip = new AudioClip();
  clip.start = 0;
  clip.end = DUR;
  const audio = new AudioEngine(new Timebase(FPS));
  audio.schedule(clip, { getBuffer: () => buffer, dispose() {} } as unknown as AudioSourceType);

  const blob = await new Exporter(comp, audio).export({
    fps: FPS,
    range: [0, DUR],
    audio: true,
    bitrate: 1_000_000,
    audioBitrate: 96_000,
    ...av,
  });
  comp.dispose();
  return new File([blob], `av.${av.container}`, { type: blob.type });
}

async function run(): Promise<void> {
  const av = await pickAV();
  if (!av) {
    (window as unknown as { __EDITOR_AUDIO_TEST__: unknown }).__EDITOR_AUDIO_TEST__ = { ok: true, skipped: 'no encodable a/v combo' };
    return;
  }

  const file = await makeAVFile(av);

  // Import the way the editor does: a VideoSource, then decode the audio from its
  // ALREADY-OPENED demux (getMediabunnyDemux) — the file isn't fetched twice.
  const video = new VideoSource({ src: file });
  const vmeta = await video.load();
  const demux = video.getMediabunnyDemux();
  const audioSource = demux?.audioTrack ? new AudioSource({ demux }) : new AudioSource({ src: file });
  const ameta = await audioSource.load();
  const pcm = audioSource.getBuffer();

  // Build the timeline clips (video + its mirrored audio clip).
  const videoClip = new VideoClip(video);
  videoClip.start = 0;
  videoClip.end = vmeta.duration;
  applyCover(videoClip, vmeta.width, vmeta.height, W, H);
  const audioClip = new AudioClip();
  audioClip.start = 0;
  audioClip.end = vmeta.duration;

  // Preview: scheduling + play() should make the engine active (audible).
  const engine = new AudioEngine(new Timebase(FPS));
  engine.schedule(audioClip, audioSource);
  engine.play(0);
  const enginePlaying = engine.isPlaying;
  engine.pause();

  // Export with audio muxed in, then decode back and check both tracks exist.
  const tracks: ExportTrackLike[] = [{ zIndex: 0, clips: [{ kind: 'video', clip: videoClip, source: video }] }];
  const blob = await exportTimeline(tracks, engine, {
    width: W,
    height: H,
    timebase: new Timebase(FPS),
    fps: FPS,
    container: av.container,
    videoCodec: av.videoCodec,
    audioCodec: av.audioCodec,
    range: [0, DUR],
    bitrate: 1_000_000,
    audio: true,
  });

  const { Input, ALL_FORMATS, BlobSource } = await import('mediabunny');
  const input = new Input({ source: new BlobSource(blob), formats: ALL_FORMATS });
  const outVideo = await input.getPrimaryVideoTrack();
  const outAudio = await input.getPrimaryAudioTrack();

  video.dispose();
  audioSource.dispose();

  const ok =
    vmeta.hasAudio === true &&
    !!pcm &&
    pcm.length > 0 &&
    Math.abs(ameta.duration - DUR) < 0.2 &&
    enginePlaying &&
    blob.size > 500 &&
    !!outVideo &&
    !!outAudio;

  (window as unknown as { __EDITOR_AUDIO_TEST__: unknown }).__EDITOR_AUDIO_TEST__ = {
    ok,
    container: av.container,
    videoHasAudio: vmeta.hasAudio,
    pcmSamples: pcm?.length ?? 0,
    audioDuration: ameta.duration,
    enginePlaying,
    size: blob.size,
    outHasVideo: !!outVideo,
    outHasAudio: !!outAudio,
  };
}

run().catch((err) => {
  (window as unknown as { __EDITOR_AUDIO_TEST__: unknown }).__EDITOR_AUDIO_TEST__ = { ok: false, error: String(err) };
});
