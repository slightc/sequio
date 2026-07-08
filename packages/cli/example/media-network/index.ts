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
import { defineComposition } from '@sequio/runtime';

/**
 * CLI demo — **referencing media over the network**.
 *
 *   sequio preview example/media-network/index.ts --watch
 *   sequio render  example/media-network/index.ts --out network.mp4
 *
 * `ImageSource` / `VideoSource` take a URL string directly: the browser preview
 * `fetch`es it and the Node render pulls it through Mediabunny's `UrlSource` — the
 * same builder in both (contract #3). Nothing is stored in the repo; the media
 * lives on its origin server. (Both commands therefore need network access.)
 */

const W = 1280;
const H = 720;

// Small, public, CORS-enabled sample assets — swap in your own URLs.
const IMAGE_URL = 'https://picsum.photos/id/1015/1280/720';
const VIDEO_URL = 'https://cdn.jsdelivr.net/gh/mediaelement/mediaelement-files/big_buck_bunny.mp4';

/** Lay a clip out like CSS `object-fit: cover` — fill the frame, keep aspect. */
function cover(clip: VisualClip, srcW: number, srcH: number): void {
  const scale = Math.max(W / srcW, H / srcH);
  clip.transform.anchor.setStatic([0, 0]);
  clip.transform.scale.setStatic([scale, scale]);
  clip.transform.position.setStatic([(W - srcW * scale) / 2, (H - srcH * scale) / 2]);
}

export default defineComposition(async () => {
  const compositor = new Compositor({ width: W, height: H, fps: 30, background: 0x000000 });
  await compositor.init();

  // ── A network video, full-frame, playing for its first 6s ──────────────────
  const videoSource = new VideoSource({ src: VIDEO_URL });
  const vmeta = await videoSource.load();
  const duration = Math.min(vmeta.duration || 6, 6);

  const videoTrack = new VisualTrack();
  const video = new VideoClip(videoSource);
  video.start = 0;
  video.end = duration;
  cover(video, vmeta.width, vmeta.height);
  videoTrack.add(video);
  compositor.addTrack(videoTrack);

  // ── A network image as a picture-in-picture card, top-left ─────────────────
  const imageSource = new ImageSource({ src: IMAGE_URL });
  const imeta = await imageSource.load();

  const pipTrack = new VisualTrack();
  pipTrack.zIndex = 1;
  const pipW = 380;
  const pipH = (pipW * imeta.height) / imeta.width;
  const margin = 48;

  // A rounded backing plate so the PiP reads as a card over the video.
  const plate = new ShapeClip({ kind: 'rect', width: pipW + 16, height: pipH + 16, fill: 0xffffff, radius: 18 });
  plate.start = 0;
  plate.end = duration;
  plate.opacity.setStatic(0.9);
  plate.transform.anchor.setStatic([0, 0]);
  plate.transform.position.setStatic([margin - 8, margin - 8]);
  pipTrack.add(plate);

  const image = new ImageClip(imageSource);
  image.start = 0;
  image.end = duration;
  image.transform.anchor.setStatic([0, 0]);
  image.transform.scale.setStatic([pipW / imeta.width, pipW / imeta.width]);
  image.transform.position.setStatic([margin, margin]);
  pipTrack.add(image);
  compositor.addTrack(pipTrack);

  // ── Caption ────────────────────────────────────────────────────────────────
  const textTrack = new VisualTrack();
  textTrack.zIndex = 2;
  const caption = new TextClip({ text: 'network image + video', fontSize: 44, fill: 0xffffff });
  caption.start = 0;
  caption.end = duration;
  caption.transform.anchor.setStatic([0.5, 1]);
  caption.transform.position.setStatic([W / 2, H - 40]);
  textTrack.add(caption);
  compositor.addTrack(textTrack);

  return { compositor, duration };
});
