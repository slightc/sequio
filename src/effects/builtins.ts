import { BlurEffect } from './blur-effect';
import { ColorEffect } from './color-effect';
import type { EffectRegistry } from './effect-registry';

/** Type names of the built-in effects registered by {@link registerBuiltins}. */
export const BUILTIN_EFFECTS = {
  color: () => new ColorEffect(),
  blur: () => new BlurEffect(),
} as const;

/**
 * Register the built-in effect types into a registry. Idempotent per type.
 * Consumers add their own via {@link EffectRegistry.register}.
 * (Chroma-key / LUT / transform built-ins are follow-ups — same `Effect` +
 * lazy `createFilter` pattern.)
 */
export function registerBuiltins(registry: EffectRegistry): void {
  for (const [type, factory] of Object.entries(BUILTIN_EFFECTS)) {
    if (!registry.has(type)) registry.register(type, factory);
  }
}
