import type { Effect } from './effect';

export type EffectFactory = () => Effect;

/**
 * Registry of effect types. Built-ins (color / blur / key / LUT / transform)
 * register here at startup; consumers can register custom effect types.
 */
export class EffectRegistry {
  private readonly factories = new Map<string, EffectFactory>();

  register(type: string, factory: EffectFactory): void {
    if (this.factories.has(type)) {
      throw new Error(`Effect type "${type}" is already registered`);
    }
    this.factories.set(type, factory);
  }

  /** Whether a type is registered. */
  has(type: string): boolean {
    return this.factories.has(type);
  }

  create(type: string): Effect {
    const factory = this.factories.get(type);
    if (!factory) throw new Error(`Unknown effect type "${type}"`);
    return factory();
  }

  /** All registered type names. */
  types(): string[] {
    return [...this.factories.keys()];
  }
}
