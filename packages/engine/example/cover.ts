import type { VisualClip } from '../src/index';

/**
 * Lay a clip out like CSS `object-fit: cover`: scale uniformly to fill the
 * `dst` box, keeping aspect ratio, centered — overflow is cropped by the canvas
 * viewport. This is app-layer layout on top of the SDK's transform primitives.
 */
export function applyCover(
  clip: VisualClip,
  srcW: number,
  srcH: number,
  dstW: number,
  dstH: number,
): void {
  const scale = Math.max(dstW / srcW, dstH / srcH);
  clip.transform.anchor.setStatic([0, 0]);
  clip.transform.scale.setStatic([scale, scale]);
  clip.transform.position.setStatic([(dstW - srcW * scale) / 2, (dstH - srcH * scale) / 2]);
}
