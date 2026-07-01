import { DisplacementFilter, type Filter, Sprite, Texture } from 'pixi.js';
import { AnimatableProperty } from '../animation/animatable-property';
import { Effect } from './effect';

export interface DisplacementEffectOptions {
  /** The displacement map (R = horizontal, G = vertical offset). */
  map?: Texture;
  /** Initial displacement scale in pixels. @default 20 */
  strength?: number;
}

/**
 * Map-driven **distortion** — thin wrapper over PixiJS's built-in
 * `DisplacementFilter`. A map texture's red/green channels push each pixel
 * horizontally/vertically; `strength` (animatable) scales the offset. Feed a
 * ripple/normal map for wave, heat-haze or dynamic-warp looks.
 *
 * With no map, a neutral gray (0.5, 0.5) map is used → zero displacement, so
 * attaching the effect is a no-op until you {@link setMap}.
 */
export class DisplacementEffect extends Effect {
  readonly strength = new AnimatableProperty<number>(20);
  readonly params: Record<string, AnimatableProperty<unknown>> = { strength: this.strength };

  private map: Texture | null;
  private sprite: Sprite | null = null;

  constructor(options: DisplacementEffectOptions = {}) {
    super();
    this.map = options.map ?? null;
    if (options.strength != null) this.strength.setStatic(options.strength);
  }

  /** Swap the displacement map. Applies immediately if the filter exists. */
  setMap(map: Texture): void {
    this.map = map;
    if (this.sprite) this.sprite.texture = map;
  }

  /** A 1×1 neutral map (0.5, 0.5) → no displacement. */
  private static neutralMap(): Texture {
    const c = document.createElement('canvas');
    c.width = 1;
    c.height = 1;
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = 'rgb(128,128,128)';
    ctx.fillRect(0, 0, 1, 1);
    return Texture.from(c);
  }

  protected createFilter(): Filter {
    this.sprite = new Sprite(this.map ?? DisplacementEffect.neutralMap());
    return new DisplacementFilter({ sprite: this.sprite, scale: this.strength.valueAt(0) });
  }

  updateAt(t: number): void {
    const f = this.filter as DisplacementFilter | null;
    if (!f) return;
    const s = this.strength.valueAt(t);
    f.scale.x = s;
    f.scale.y = s;
  }

  override dispose(): void {
    super.dispose();
    this.sprite?.destroy();
    this.sprite = null;
  }
}
