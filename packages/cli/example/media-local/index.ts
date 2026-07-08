import {
  Compositor,
  ImageClip,
  ImageSource,
  ShapeClip,
  TextClip,
  VideoClip,
  VideoSource,
  VisualTrack,
  type VisualClip,
} from '@sequio/engine';
import { defineComposition, loadAsset } from '@sequio/runtime';

/**
 * CLI demo — **referencing local media** that lives next to this file.
 *
 *   sequio preview example/media-local/index.ts --watch
 *   sequio render  example/media-local/index.ts --out local.mp4
 *
 * `loadAsset('./video.mp4')` (imported from `@sequio/runtime`) returns the file's
 * bytes as a `Blob`, which `VideoSource` / `ImageSource` accept. The CLI supplies
 * the loader on both sides — the browser preview fetches the file the dev server
 * serves, the Node render reads it off disk — so the same code previews and
 * renders identically (contract #3).
 *
 * The media files are **git-ignored** (see `.gitignore`) and never enter the
 * source bundle, so dropping a big `.mp4` here won't bloat the repo. This demo
 * runs even before you add any: each `loadAsset` is wrapped so a missing file
 * falls back to a placeholder telling you what to drop where.
 */

const W = 1280;
const H = 720;
const DURATION = 5;

/** Filenames this demo looks for — drop your own next to this file. */
const VIDEO_FILE = './video.mp4';
const IMAGE_FILE = './image.jpg';

/** Lay a clip out like CSS `object-fit: cover` — fill the frame, keep aspect. */
function cover(clip: VisualClip, srcW: number, srcH: number, dstW: number, dstH: number, x = 0, y = 0): void {
  const scale = Math.max(dstW / srcW, dstH / srcH);
  clip.transform.anchor.setStatic([0, 0]);
  clip.transform.scale.setStatic([scale, scale]);
  clip.transform.position.setStatic([x + (dstW - srcW * scale) / 2, y + (dstH - srcH * scale) / 2]);
}

/** A labelled placeholder rectangle for when a local file isn't there yet. */
function placeholder(track: VisualTrack, x: number, y: number, w: number, h: number, label: string): void {
  const box = new ShapeClip({ kind: 'rect', width: w, height: h, fill: 0x1e293b, radius: 16 });
  box.start = 0;
  box.end = DURATION;
  box.transform.anchor.setStatic([0, 0]);
  box.transform.position.setStatic([x, y]);
  track.add(box);

  const text = new TextClip({ text: label, fontSize: 30, fill: 0x93c5fd });
  text.start = 0;
  text.end = DURATION;
  text.transform.anchor.setStatic([0.5, 0.5]);
  text.transform.position.setStatic([x + w / 2, y + h / 2]);
  track.add(text);
}

export default defineComposition(async () => {
  const compositor = new Compositor({ width: W, height: H, fps: 30, background: 0x0b1120 });
  await compositor.init();

  // ── Local video, full-frame ────────────────────────────────────────────────
  const videoTrack = new VisualTrack();
  try {
    const src = new VideoSource({ src: await loadAsset(VIDEO_FILE) });
    const meta = await src.load();
    const clip = new VideoClip(src);
    clip.start = 0;
    clip.end = DURATION;
    cover(clip, meta.width, meta.height, W, H);
    videoTrack.add(clip);
  } catch {
    placeholder(videoTrack, 0, 0, W, H, `drop a video at ${VIDEO_FILE}`);
  }
  compositor.addTrack(videoTrack);

  // ── Local image, picture-in-picture, bottom-right ──────────────────────────
  const pipTrack = new VisualTrack();
  pipTrack.zIndex = 1;
  const pipW = 420;
  const pipH = 236;
  const px = W - pipW - 48;
  const py = H - pipH - 48;

  const plate = new ShapeClip({ kind: 'rect', width: pipW + 16, height: pipH + 16, fill: 0xffffff, radius: 18 });
  plate.start = 0;
  plate.end = DURATION;
  plate.opacity.setStatic(0.9);
  plate.transform.anchor.setStatic([0, 0]);
  plate.transform.position.setStatic([px - 8, py - 8]);
  pipTrack.add(plate);

  try {
    const src = new ImageSource({ src: await loadAsset(IMAGE_FILE) });
    const meta = await src.load();
    const clip = new ImageClip(src);
    clip.start = 0;
    clip.end = DURATION;
    cover(clip, meta.width, meta.height, pipW, pipH, px, py);
    pipTrack.add(clip);
  } catch {
    placeholder(pipTrack, px, py, pipW, pipH, `drop ${IMAGE_FILE}`);
  }
  compositor.addTrack(pipTrack);

  // ── Caption ────────────────────────────────────────────────────────────────
  const textTrack = new VisualTrack();
  textTrack.zIndex = 2;
  const caption = new TextClip({ text: 'local image + video', fontSize: 44, fill: 0xffffff });
  caption.start = 0;
  caption.end = DURATION;
  caption.transform.anchor.setStatic([0.5, 0]);
  caption.transform.position.setStatic([W / 2, 40]);
  textTrack.add(caption);
  compositor.addTrack(textTrack);

  return { compositor, duration: DURATION };
});
