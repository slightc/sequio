/**
 * Encode tightly-packed **straight-alpha RGBA** pixels to PNG bytes via
 * `@napi-rs/canvas` — the same Node-native canvas the server env already uses.
 *
 * This lives in `@sequio/server` so the package that owns the `@napi-rs/canvas`
 * dependency also owns the one place it's used for output encoding; consumers (the
 * CLI's single-frame `sequio frame`) call this instead of pulling in their own
 * copy of the native binding. **Node-only.**
 */
export async function encodeRGBAToPng(
  rgba: Uint8Array,
  width: number,
  height: number,
): Promise<Uint8Array> {
  const { createCanvas } = await import('@napi-rs/canvas');
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');
  const image = ctx.createImageData(width, height);
  image.data.set(rgba);
  ctx.putImageData(image, 0, 0);
  return canvas.encode('png');
}
