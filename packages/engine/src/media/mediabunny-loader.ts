/** The shape of the `mediabunny` module. */
export type MediabunnyModule = typeof import('mediabunny');

/** Where a host can pin the exact `mediabunny` instance the SDK should use. */
interface MediabunnyGlobal {
  __mediabunny__?: MediabunnyModule;
}

/**
 * Load the `mediabunny` module used for decode / encode / mux.
 *
 * In a browser this is just a dynamic `import('mediabunny')`. But `mediabunny`
 * ships both an ESM and a CJS build, which are **separate module instances with
 * separate codec registries** (the classic dual-package hazard). A host that
 * registers custom codecs on one specific instance — notably server-side
 * rendering in Node, where `@mediabunny/server` registers node-av
 * encoders/decoders — must make the SDK use that same instance, or every
 * decode/encode silently falls back to the (nonexistent-in-Node) WebCodecs path.
 *
 * Such a host sets `globalThis.__mediabunny__` to the registered instance (see
 * {@link setMediabunnyModule}); the SDK then uses it instead of importing a fresh
 * copy. Unset (the browser default) → a normal dynamic import.
 */
export function loadMediabunny(): Promise<MediabunnyModule> {
  const override = (globalThis as MediabunnyGlobal).__mediabunny__;
  return override ? Promise.resolve(override) : import('mediabunny');
}

/** Pin the `mediabunny` instance the SDK should use (see {@link loadMediabunny}). */
export function setMediabunnyModule(mod: MediabunnyModule | undefined): void {
  (globalThis as MediabunnyGlobal).__mediabunny__ = mod;
}
