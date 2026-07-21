/**
 * Interactive playground for milestone 08 — the Exporter — merged with the A/V
 * player (音画一起播).
 *
 * One RealtimeClock drives BOTH the visual render and the AudioEngine, so audio
 * and video preview together. Default scene: a 4-note melody + a marker stepping
 * across four blocks in sync; or load a video file to preview its frames + audio.
 * Hit **Export** to render the current scene — video AND audio — to a real
 * MP4/WebM with a progress bar; the file plays back inline and can be downloaded.
 * Preview and export share one render core (contract #3).
 */
import {
  AudioClip,
  AudioEngine,
  AudioSource,
  Compositor,
  Exporter,
  hold,
  RealtimeClock,
  ShapeClip,
  Timebase,
  VideoClip,
  VideoSource,
  VisualTrack,
} from '../src/index';
import { applyCover } from './cover';

const W = 480;
const H = 240;
const FPS = 30;
const SR = 48000;

const NOTES = [261.63, 329.63, 392.0, 523.25]; // C4 E4 G4 C5
const NOTE_DUR = 0.5;
const MELODY_DUR = NOTES.length * NOTE_DUR;
const BLOCK_COLORS = [0xff4d6d, 0xffb703, 0x2ec4b6, 0x4d9dff];

/** A short melody baked into an AudioBuffer (per-note attack/decay envelope). */
function melodyBuffer(): AudioBuffer {
  const length = Math.floor(MELODY_DUR * SR);
  const buf = new AudioBuffer({ length, numberOfChannels: 1, sampleRate: SR });
  const d = buf.getChannelData(0);
  for (let i = 0; i < length; i++) {
    const t = i / SR;
    const ni = Math.min(NOTES.length - 1, Math.floor(t / NOTE_DUR));
    const local = t - ni * NOTE_DUR;
    const env = Math.min(1, local / 0.01) * Math.max(0, 1 - local / NOTE_DUR);
    d[i] = Math.sin(2 * Math.PI * NOTES[ni]! * t) * env * 0.3;
  }
  return buf;
}

interface Scene {
  duration: number;
  /** The track shown in the live preview. */
  visualTrack: VisualTrack;
  /**
   * Build a track for the export fork: its own clips over the same demux but a
   * FORKED decoder (so preview + export decode in parallel, file parsed once).
   * `dispose` tears down the fork's decoder (not the shared demux).
   */
  makeExportTrack(): Promise<{ track: VisualTrack; dispose(): void }>;
  audioClip?: AudioClip;
  audioSource?: AudioSource;
  dispose(): void;
}

function buildMelodyScene(): Scene {
  const bw = 100;
  const gap = (W - NOTES.length * bw) / (NOTES.length + 1);

  // Procedural (no shared source), so each call is an independent track.
  const makeVisualTrack = (): VisualTrack => {
    const track = new VisualTrack();
    NOTES.forEach((_, i) => {
      const block = new ShapeClip({ kind: 'rect', width: bw, height: 140, fill: BLOCK_COLORS[i]!, radius: 12 });
      block.start = 0;
      block.end = MELODY_DUR;
      block.transform.anchor.setStatic([0.5, 0.5]);
      block.transform.position.setStatic([gap + i * (bw + gap) + bw / 2, H / 2]);
      track.add(block);
    });
    const marker = new ShapeClip({
      kind: 'rect',
      width: bw + 16,
      height: 156,
      fill: 0xffffff,
      radius: 14,
      stroke: { color: 0xffffff, width: 3 },
    });
    marker.start = 0;
    marker.end = MELODY_DUR;
    marker.opacity.setStatic(0.28);
    marker.transform.anchor.setStatic([0.5, 0.5]);
    marker.transform.position.setKeyframes(
      NOTES.map((_, i) => ({
        time: i * NOTE_DUR,
        value: [gap + i * (bw + gap) + bw / 2, H / 2] as [number, number],
        easing: hold, // snap per note, matching the audio
      })),
    );
    track.add(marker);
    return track;
  };

  const buffer = melodyBuffer();
  const audioSource = { getBuffer: () => buffer, dispose() {} } as unknown as AudioSource;
  const audioClip = new AudioClip();
  audioClip.start = 0;
  audioClip.end = MELODY_DUR;

  return {
    duration: MELODY_DUR,
    visualTrack: makeVisualTrack(),
    makeExportTrack: async () => ({ track: makeVisualTrack(), dispose: () => {} }), // procedural, nothing to fork
    audioClip,
    audioSource,
    dispose: () => {},
  };
}

async function buildVideoScene(file: File): Promise<Scene> {
  const videoSource = new VideoSource({ src: file });
  const meta = await videoSource.load();

  const makeVisualTrack = (src: VideoSource): VisualTrack => {
    const track = new VisualTrack();
    const clip = new VideoClip(src);
    clip.start = 0;
    clip.end = meta.duration;
    applyCover(clip, meta.width, meta.height, W, H);
    track.add(clip);
    return track;
  };

  let audioClip: AudioClip | undefined;
  let audioSource: AudioSource | undefined;
  try {
    const src = new AudioSource({ src: file });
    const am = await src.load();
    audioSource = src;
    audioClip = new AudioClip();
    audioClip.start = 0;
    audioClip.end = am.duration;
  } catch {
    /* no audio track */
  }

  return {
    duration: meta.duration,
    visualTrack: makeVisualTrack(videoSource), // preview uses the original decoder
    makeExportTrack: async () => {
      const forked = videoSource.fork(); // shares the demux, own decoder → parallel decode
      await forked.load();
      return { track: makeVisualTrack(forked), dispose: () => forked.dispose() };
    },
    audioClip,
    audioSource,
    dispose: () => {
      videoSource.dispose();
      audioSource?.dispose();
    },
  };
}

/** Pick a container + codecs the browser can encode (audio only checked if needed). */
async function pickCodec(
  pref: string,
  withAudio: boolean,
): Promise<{ container: 'mp4' | 'webm'; videoCodec: string; audioCodec: string } | null> {
  const { canEncodeVideo, canEncodeAudio } = await import('mediabunny');
  const combos = [
    { container: 'mp4' as const, videoCodec: 'avc', audioCodec: 'aac' },
    { container: 'webm' as const, videoCodec: 'vp9', audioCodec: 'opus' },
    { container: 'webm' as const, videoCodec: 'vp8', audioCodec: 'opus' },
  ];
  const ordered = pref === 'webm' ? [...combos.slice(1), combos[0]!] : combos;
  for (const c of ordered) {
    if (!(await canEncodeVideo(c.videoCodec as 'avc'))) continue;
    if (withAudio && !(await canEncodeAudio(c.audioCodec as 'aac'))) continue;
    return c;
  }
  return null;
}

async function main(): Promise<void> {
  const compositor = new Compositor({
    width: W,
    height: H,
    timebase: new Timebase(FPS),
    background: 0x0b0b0e,
    preferWebGPU: false,
  });
  await compositor.init();
  document.getElementById('stage')!.append(compositor.view);

  const clock = new RealtimeClock(compositor.timebase);
  const audio = new AudioEngine(new Timebase(FPS));

  const playBtn = document.getElementById('play') as HTMLButtonElement;
  const scrub = document.getElementById('scrub') as HTMLInputElement;
  const timeLbl = document.getElementById('time') as HTMLSpanElement;
  const loopBox = document.getElementById('loop') as HTMLInputElement;
  const file = document.getElementById('file') as HTMLInputElement;
  const audioBadge = document.getElementById('audio') as HTMLSpanElement;

  let scene: Scene | null = null;
  // The Compositor holds the last frame at the timeline end by default
  // (holdLastFrameAtEnd), so no consumer-side last-frame clamp is needed.
  const renderAt = (t: number) => compositor.renderPreview(t);

  function setScene(next: Scene): void {
    clock.pause();
    audio.pause();
    if (scene) {
      compositor.removeTrack(scene.visualTrack);
      scene.dispose();
    }
    scene = next;
    compositor.addTrack(next.visualTrack);
    audio.clear();
    if (next.audioClip && next.audioSource) audio.schedule(next.audioClip, next.audioSource);
    clock.duration = next.duration;
    scrub.max = String(next.duration);
    audioBadge.textContent = next.audioClip ? '🔊 audio' : '🔇 no audio';
    playBtn.textContent = '▶ Play';
    clock.seek(0);
  }

  clock.onTick((t) => {
    renderAt(t);
    scrub.value = String(t);
    timeLbl.textContent = `${t.toFixed(2)} / ${(scene?.duration ?? 0).toFixed(2)}s`;
  });
  clock.onEnded(() => {
    if (loopBox.checked) {
      clock.play();
      audio.play(0);
    } else {
      audio.pause();
      playBtn.textContent = '▶ Play';
    }
  });
  playBtn.addEventListener('click', () => {
    if (clock.paused) {
      clock.play();
      audio.play(clock.currentTime);
      playBtn.textContent = '⏸ Pause';
    } else {
      clock.pause();
      audio.pause();
      playBtn.textContent = '▶ Play';
    }
  });
  // rAF-throttle scrubbing: coalesce rapid inputs into one seek per frame (the
  // clock frame-snaps the seek itself).
  let scrubRaf = 0;
  let scrubPending = 0;
  scrub.addEventListener('input', () => {
    clock.pause();
    audio.pause();
    playBtn.textContent = '▶ Play';
    scrubPending = Number(scrub.value);
    if (scrubRaf !== 0) return;
    scrubRaf = requestAnimationFrame(() => {
      scrubRaf = 0;
      clock.seek(scrubPending);
    });
  });
  file.addEventListener('change', async () => {
    const f = file.files?.[0];
    if (f) setScene(await buildVideoScene(f));
  });

  // ── Export (video + audio) ─────────────────────────────────────────────────
  const exportBtn = document.getElementById('export') as HTMLButtonElement;
  const containerSel = document.getElementById('container') as HTMLSelectElement;
  const bar = document.getElementById('bar') as HTMLDivElement;
  const status = document.getElementById('status') as HTMLSpanElement;
  const result = document.getElementById('result') as HTMLDivElement;
  let lastUrl: string | null = null;

  exportBtn.addEventListener('click', async () => {
    if (!scene) return;
    // The preview keeps playing during export — we don't touch its clock, audio,
    // track or canvas. Export runs on a separate offscreen compositor below.
    exportBtn.disabled = true;
    result.innerHTML = '';
    bar.style.width = '0%';

    const withAudio = !!(scene.audioClip && scene.audioSource);
    const codec = await pickCodec(containerSel.value, withAudio);
    if (!codec) {
      status.textContent = 'No encodable codec in this browser.';
      exportBtn.disabled = false;
      return;
    }
    status.textContent = `Encoding ${codec.container} / ${codec.videoCodec}${withAudio ? ` + ${codec.audioCodec}` : ''}…`;

    // Fork: an offscreen export compositor with its OWN track (its own clips) but
    // SHARING the preview's texture pool + sources (nothing is decoded twice).
    // The preview compositor is never touched, so it keeps playing.
    const fork = new Compositor({
      width: W,
      height: H,
      timebase: new Timebase(FPS),
      background: 0x0b0b0e,
      preferWebGPU: false,
      textures: compositor.textures,
    });
    await fork.init();
    const { track: forkTrack, dispose: disposeForkTrack } = await scene.makeExportTrack();
    fork.addTrack(forkTrack);

    const exporter = new Exporter(fork, audio); // audio.renderOffline reads the shared mix
    try {
      const t0 = performance.now();
      const blob = await exporter.export(
        { fps: FPS, range: [0, scene.duration], audio: withAudio, bitrate: 4_000_000, audioBitrate: 128_000, ...codec },
        (p) => {
          bar.style.width = `${(p * 100).toFixed(0)}%`;
        },
      );
      const secs = ((performance.now() - t0) / 1000).toFixed(1);
      if (lastUrl) URL.revokeObjectURL(lastUrl);
      lastUrl = URL.createObjectURL(blob);
      status.textContent = `Done — ${(blob.size / 1024).toFixed(0)} KB in ${secs}s (${codec.container}/${codec.videoCodec}${withAudio ? '+' + codec.audioCodec : ''})`;

      const video = document.createElement('video');
      video.src = lastUrl;
      video.controls = true;
      video.loop = true;
      video.autoplay = true;
      video.style.width = `${W}px`;
      video.style.borderRadius = '10px';
      const dl = document.createElement('a');
      dl.href = lastUrl;
      dl.download = `export.${codec.container}`;
      dl.textContent = `⬇ download export.${codec.container}`;
      dl.style.cssText = 'display:block;margin-top:8px';
      result.append(video, dl);
    } catch (err) {
      status.textContent = `Export failed: ${String(err)}`;
    } finally {
      fork.removeTrack(forkTrack);
      fork.dispose(); // its own clips/renderer; the shared texture pool is kept
      disposeForkTrack(); // tear down the forked decoder (not the shared demux)
      exportBtn.disabled = false;
    }
  });

  setScene(buildMelodyScene());
  (window as unknown as { __EXPORT_DEMO_READY__: unknown }).__EXPORT_DEMO_READY__ = { ok: true };
}

main().catch((err) => {
  console.error(err);
  document.getElementById('stage')!.textContent = String(err);
  (window as unknown as { __EXPORT_DEMO_READY__: unknown }).__EXPORT_DEMO_READY__ = { ok: false, error: String(err) };
});
