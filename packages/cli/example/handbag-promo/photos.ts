/**
 * Photographic assets for the handbag-promo recreation — real studio product /
 * fashion shots referenced by URL (Pexels, free to use, no attribution required:
 * https://www.pexels.com/license/). They all come from one burnt-orange studio
 * shoot, so the model, the rust co-ord and the grey seamless read as a single
 * campaign — the same look as the source ad, without redrawing it as flat vector.
 *
 * `ImageSource` takes a URL directly: the browser preview `fetch`es it and the
 * Node render pulls it the same way (contract #3), so both need network access.
 * A `w=` query keeps each download modestly sized for a 720-wide canvas.
 */
import { ImageSource } from '@sequio/engine';

const PX = (id: number, w: number) =>
  `https://images.pexels.com/photos/${id}/pexels-photo-${id}.jpeg?auto=compress&cs=tinysrgb&w=${w}`;

/** Every photo the piece uses, by role. */
export const PHOTOS = {
  /** Ch.1 hero — a hand presenting the orange bag over an orange knit. */
  hero: PX(8801036, 1100),
  /** Ch.2 — the model, full-body, rust co-ord on grey seamless. */
  modelFull: PX(8801174, 1000),
  /** Ch.4 top — waist/midriff holding the bag. */
  waist: PX(8801058, 1000),
  /** Ch.4 bottom — a portrait crop of the model. */
  portrait: PX(8801065, 900),
  /** Ch.3 contact-sheet poses. */
  grid: [PX(8801174, 640), PX(8801168, 640), PX(8801159, 640), PX(8801058, 640), PX(8801067, 640), PX(8801065, 640)],
  /** Ch.4 mini-bag product shots that cycle at the hand. */
  bags: [PX(8801079, 720), PX(8801036, 720), PX(8801087, 720)],
} as const;

/** A loaded (or failed → null) photo: its source + intrinsic size. */
export interface Photo {
  source: ImageSource;
  w: number;
  h: number;
}

/** Load a URL into an {@link ImageSource}; returns `null` if it can't be fetched. */
export async function loadPhoto(url: string): Promise<Photo | null> {
  try {
    const source = new ImageSource({ src: url });
    const meta = await source.load();
    return { source, w: meta.width, h: meta.height };
  } catch {
    return null;
  }
}
