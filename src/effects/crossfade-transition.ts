import { Container, type Renderer, RenderTexture, Sprite, type Texture } from 'pixi.js';
import { Transition } from './transition';

/** Clamp progress to [0,1] → the incoming clip's opacity for a linear crossfade. */
export function crossfadeAlpha(progress: number): number {
  return progress < 0 ? 0 : progress > 1 ? 1 : progress;
}

/**
 * Linear crossfade: draw `from` opaque, then `to` at alpha = progress, so
 * `out = from*(1-progress) + to*progress`. progress 0 = from, 1 = to.
 */
export class CrossfadeTransition extends Transition {
  private target: RenderTexture | null = null;
  private readonly stage = new Container();
  private readonly fromSprite = new Sprite();
  private readonly toSprite = new Sprite();

  constructor(readonly durationFrames = 30) {
    super();
    this.stage.addChild(this.fromSprite, this.toSprite);
  }

  render(renderer: Renderer, from: Texture, to: Texture, progress: number): RenderTexture {
    const width = from.width;
    const height = from.height;
    if (!this.target || this.target.width !== width || this.target.height !== height) {
      this.target?.destroy(true);
      this.target = RenderTexture.create({ width, height });
    }

    this.fromSprite.texture = from;
    this.fromSprite.alpha = 1;
    this.toSprite.texture = to;
    this.toSprite.alpha = crossfadeAlpha(progress);

    renderer.render({ container: this.stage, target: this.target, clear: true });
    return this.target;
  }

  dispose(): void {
    this.target?.destroy(true);
    this.target = null;
    this.stage.destroy({ children: true });
  }
}
