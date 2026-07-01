/**
 * A/V player: one RealtimeClock drives BOTH the visual render and the
 * AudioEngine, so audio and video play/pause/seek together (音画一起播).
 *
 * Default scene: a 4-note melody + a marker that steps across four blocks in
 * sync with the notes (the block under the marker is the note you hear). Or load
 * a video file to play its frames + audio together.
 */
import {
  AudioClip,
  AudioEngine,
  AudioSource,
  Compositor,
  hold,
  RealtimeClock,
  ShapeClip,
  Timebase,
  VideoClip,
  VideoSource,
  VisualClip,
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

/** Build a short melody into an AudioBuffer (per-note attack/decay envelope). */
function melodyBuffer(): AudioBuffer {
  const length = Math.floor(MELODY_DUR * SR);
  const buf = new AudioBuffer({ length, numberOfChannels: 1, sampleRate: SR });
  const d = buf.getChannelData(0);
  for (let i = 0; i < length; i++) {
    const t = i / SR;
    const ni = Math.min(NOTES.length - 1, Math.floor(t / NOTE_DUR));
    const local = t - ni * NOTE_DUR;
    const env = Math.min(1, local / 0.01) * Math.max(0, 1 - local / NOTE_DUR); // attack + decay
    d[i] = Math.sin(2 * Math.PI * NOTES[ni]! * t) * env * 0.3;
  }
  return buf;
}

/** Whatever visual + audio the player is currently showing. */
interface Scene {
  duration: number;
  visualTrack: VisualTrack;
  clips: VisualClip[];
  audioClip?: AudioClip;
  audioSource?: AudioSource;
  dispose(): void;
}

function buildMelodyScene(): Scene {
  const track = new VisualTrack();
  const clips: VisualClip[] = [];

  // Four colored blocks.
  const bw = 100;
  const gap = (W - NOTES.length * bw) / (NOTES.length + 1);
  NOTES.forEach((_, i) => {
    const block = new ShapeClip({ kind: 'rect', width: bw, height: 140, fill: BLOCK_COLORS[i]!, radius: 12 });
    block.start = 0;
    block.end = MELODY_DUR;
    block.transform.anchor.setStatic([0.5, 0.5]);
    block.transform.position.setStatic([gap + i * (bw + gap) + bw / 2, H / 2]);
    track.add(block);
    clips.push(block);
  });

  // A marker that steps onto the block of the currently-playing note.
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
      easing: hold, // snap per note (discrete), matching the audio
    })),
  );
  track.add(marker);
  clips.push(marker);

  const buffer = melodyBuffer();
  const audioSource = { getBuffer: () => buffer, dispose() {} } as unknown as AudioSource;
  const audioClip = new AudioClip();
  audioClip.start = 0;
  audioClip.end = MELODY_DUR;

  return {
    duration: MELODY_DUR,
    visualTrack: track,
    clips,
    audioClip,
    audioSource,
    dispose: () => clips.forEach((c) => c.unmount()),
  };
}

async function buildVideoScene(file: File): Promise<Scene> {
  const videoSource = new VideoSource({ src: file });
  const meta = await videoSource.load();
  const track = new VisualTrack();
  const clip = new VideoClip(videoSource);
  clip.start = 0;
  clip.end = meta.duration;
  applyCover(clip, meta.width, meta.height, W, H);
  track.add(clip);

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
    visualTrack: track,
    clips: [clip],
    audioClip,
    audioSource,
    dispose: () => {
      clip.unmount();
      videoSource.dispose();
      audioSource?.dispose();
    },
  };
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

  const clock = new RealtimeClock();
  const audio = new AudioEngine(new Timebase(FPS));

  const playBtn = document.getElementById('play') as HTMLButtonElement;
  const scrub = document.getElementById('scrub') as HTMLInputElement;
  const timeLabel = document.getElementById('time') as HTMLSpanElement;
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
    timeLabel.textContent = `${t.toFixed(2)} / ${(scene?.duration ?? 0).toFixed(2)}s`;
  });
  clock.onEnded(() => {
    if (loopBox.checked) {
      clock.play();
      audio.play(0); // restart audio with the clock
    } else {
      audio.pause();
      playBtn.textContent = '▶ Play';
    }
  });

  playBtn.addEventListener('click', () => {
    if (clock.paused) {
      clock.play();
      audio.play(clock.currentTime); // start audio from the same playhead
      playBtn.textContent = '⏸ Pause';
    } else {
      clock.pause();
      audio.pause();
      playBtn.textContent = '▶ Play';
    }
  });
  scrub.addEventListener('input', () => {
    clock.pause();
    audio.pause();
    playBtn.textContent = '▶ Play';
    clock.seek(Number(scrub.value));
  });
  file.addEventListener('change', async () => {
    const f = file.files?.[0];
    if (f) setScene(await buildVideoScene(f));
  });

  setScene(buildMelodyScene());
}

main().catch((err) => {
  console.error(err);
  document.getElementById('stage')!.textContent = String(err);
});
