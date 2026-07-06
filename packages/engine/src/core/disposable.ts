/**
 * Anything that owns releasable resources (decoders, textures, listeners).
 *
 * Contract #4 of the SDK: resource ownership is explicit. Every SDK object
 * that holds GPU / decoder / DOM resources implements {@link Disposable}.
 */
export interface Disposable {
  dispose(): void;
}

/** A cancellable subscription handle returned by event-style APIs. */
export interface Subscription {
  /** Unsubscribe / cancel. Idempotent. */
  unsubscribe(): void;
}

/** Build a {@link Subscription} from a teardown function, guarding double-calls. */
export function createSubscription(teardown: () => void): Subscription {
  let active = true;
  return {
    unsubscribe() {
      if (!active) return;
      active = false;
      teardown();
    },
  };
}
