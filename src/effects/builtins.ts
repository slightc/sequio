import { BlurEffect } from './blur-effect';
import { BulgeEffect } from './bulge-effect';
import { ColorEffect } from './color-effect';
import { DisplacementEffect } from './displacement-effect';
import type { EffectRegistry } from './effect-registry';
import { PerspectiveEffect } from './perspective-effect';

/** Type names of the built-in effects registered by {@link registerBuiltins}. */
export const BUILTIN_EFFECTS = {
  color: () => new ColorEffect(),
  blur: () => new BlurEffect(),
  bulge: () => new BulgeEffect(),
  perspective: () => new PerspectiveEffect(),
  displacement: () => new DisplacementEffect(),
} as const;

/**
 * Register the built-in effect types into a registry. Idempotent per type.
 * Consumers add their own via {@link EffectRegistry.register}.
 * (Chroma-key / LUT built-ins are follow-ups — same `Effect` +
 * lazy `createFilter` pattern.)
 */
export function registerBuiltins(registry: EffectRegistry): void {
  for (const [type, factory] of Object.entries(BUILTIN_EFFECTS)) {
    if (!registry.has(type)) registry.register(type, factory);
  }
}
