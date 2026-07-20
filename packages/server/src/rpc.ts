/**
 * A tiny **transport-agnostic RPC** layer: expose an object of async methods on
 * one side of a message channel, call them as if local from the other.
 *
 * It is deliberately hand-rolled (zero dependencies, fits the repo's
 * dependency-収口 style) but its {@link Endpoint} is shaped exactly like
 * [Comlink](https://github.com/GoogleChromeLabs/comlink)'s, so any `postMessage`
 * transport works and it can be swapped for `Comlink.wrap` later without changing
 * callers. Two transports use it today:
 *  - **iframe / Worker / MessagePort** — those objects already *are* `Endpoint`s
 *    (see {@link windowEndpoint} for a `Window`); structured clone moves values.
 *  - **headless Chrome (Puppeteer)** — the `@sequio/headless` worker adapts the
 *    CDP boundary (which has no native `MessagePort`) to an `Endpoint` by bridging
 *    `page.exposeFunction` + `page.evaluate`; values ride as JSON there.
 *
 * Supported over the wire: async method calls (args → result), error propagation,
 * and **one-way function arguments** (e.g. an `onProgress` callback) proxied back
 * as callback messages. Only clone/JSON-safe argument and return values cross —
 * that's the union of what both transports allow.
 */

/** A Comlink-shaped bidirectional message endpoint (a `MessagePort`/`Worker` fits). */
export interface Endpoint {
  postMessage(message: unknown, transfer?: unknown[]): void;
  addEventListener(type: 'message', listener: (event: { data: unknown }) => void): void;
  removeEventListener(type: 'message', listener: (event: { data: unknown }) => void): void;
  /** MessagePort-style; called once after listeners are attached. */
  start?(): void;
}

// ── Wire envelope ────────────────────────────────────────────────────────────
const CALL = 'sequio-rpc/call';
const RETURN = 'sequio-rpc/return';
const CALLBACK = 'sequio-rpc/callback';

interface CallMessage {
  t: typeof CALL;
  id: number;
  method: string;
  args: unknown[];
}
interface ReturnMessage {
  t: typeof RETURN;
  id: number;
  ok: boolean;
  value?: unknown;
  error?: string;
}
interface CallbackMessage {
  t: typeof CALLBACK;
  cbId: number;
  args: unknown[];
}
/** Placeholder a function argument is replaced with on the wire. */
interface CallbackRef {
  '@rpcCallback': number;
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}
function isCallbackRef(v: unknown): v is CallbackRef {
  return isObject(v) && typeof v['@rpcCallback'] === 'number';
}

/** The remote view of a service: every method returns a Promise. */
export type Remote<T> = {
  [K in keyof T]: T[K] extends (...args: infer A) => infer R
    ? (...args: A) => R extends Promise<unknown> ? R : Promise<R>
    : never;
};

/**
 * Serve `service`'s methods on `endpoint`. Incoming calls are dispatched to the
 * matching method; function arguments (sent as {@link CallbackRef}) are rehydrated
 * into functions that post their invocations back. Returns a disposer that
 * detaches the listener.
 */
export function expose(service: object, endpoint: Endpoint): () => void {
  const table = service as Record<string, (...args: unknown[]) => unknown>;
  const listener = (event: { data: unknown }): void => {
    const msg = event.data;
    if (!isObject(msg) || msg.t !== CALL) return;
    const call = msg as unknown as CallMessage;
    const respond = (r: ReturnMessage): void => endpoint.postMessage(r);
    const fn = table[call.method];
    if (typeof fn !== 'function') {
      respond({ t: RETURN, id: call.id, ok: false, error: `RPC: no method '${call.method}'` });
      return;
    }
    // Rehydrate callback placeholders into functions that post back.
    const args = call.args.map((a) =>
      isCallbackRef(a)
        ? (...cbArgs: unknown[]) =>
            endpoint.postMessage({ t: CALLBACK, cbId: a['@rpcCallback'], args: cbArgs } satisfies CallbackMessage)
        : a,
    );
    // Defer so a synchronous throw is caught the same as a rejected promise.
    Promise.resolve()
      .then(() => fn(...args))
      .then(
        (value) => respond({ t: RETURN, id: call.id, ok: true, value }),
        (err) => respond({ t: RETURN, id: call.id, ok: false, error: err instanceof Error ? err.message : String(err) }),
      );
  };
  endpoint.addEventListener('message', listener);
  endpoint.start?.();
  return () => endpoint.removeEventListener('message', listener);
}

/**
 * Wrap `endpoint` as a remote `T`: calling `remote.method(...)` posts a call and
 * resolves with the reply. Function arguments are registered and sent as
 * {@link CallbackRef}s, so a passed `onProgress` fires locally as the remote
 * invokes it. Rejections carry the remote error message.
 */
export function wrap<T>(endpoint: Endpoint): Remote<T> {
  let nextCallId = 1;
  let nextCbId = 1;
  const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: unknown) => void; cbIds: number[] }>();
  const callbacks = new Map<number, (...args: unknown[]) => void>();

  endpoint.addEventListener('message', (event) => {
    const msg = event.data;
    if (!isObject(msg)) return;
    if (msg.t === RETURN) {
      const ret = msg as unknown as ReturnMessage;
      const p = pending.get(ret.id);
      if (!p) return;
      pending.delete(ret.id);
      for (const cbId of p.cbIds) callbacks.delete(cbId); // the call is done; drop its callbacks
      if (ret.ok) p.resolve(ret.value);
      else p.reject(new Error(ret.error ?? 'RPC error'));
    } else if (msg.t === CALLBACK) {
      const cb = msg as unknown as CallbackMessage;
      callbacks.get(cb.cbId)?.(...cb.args);
    }
  });
  endpoint.start?.();

  return new Proxy(Object.create(null), {
    get(_target, prop: string | symbol) {
      if (typeof prop !== 'string') return undefined;
      return (...args: unknown[]): Promise<unknown> => {
        const id = nextCallId++;
        const cbIds: number[] = [];
        const encoded = args.map((a) => {
          if (typeof a !== 'function') return a;
          const cbId = nextCbId++;
          callbacks.set(cbId, a as (...x: unknown[]) => void);
          cbIds.push(cbId);
          return { '@rpcCallback': cbId } satisfies CallbackRef;
        });
        return new Promise((resolve, reject) => {
          pending.set(id, { resolve, reject, cbIds });
          endpoint.postMessage({ t: CALL, id, method: prop, args: encoded } satisfies CallMessage);
        });
      };
    },
  }) as Remote<T>;
}

/**
 * Adapt a `Window` (e.g. an iframe's `contentWindow`, or `self` inside the frame)
 * to an {@link Endpoint}: post to `remote`, listen on `local` (default the global
 * `self`). `targetOrigin` guards cross-origin posts (default `'*'`). A `Worker` or
 * `MessagePort` needs no adapter — it already satisfies `Endpoint`.
 */
export function windowEndpoint(
  remote: { postMessage(message: unknown, targetOrigin: string, transfer?: unknown[]): void },
  local: {
    addEventListener(type: 'message', listener: (event: { data: unknown }) => void): void;
    removeEventListener(type: 'message', listener: (event: { data: unknown }) => void): void;
  } = globalThis as unknown as Endpoint,
  targetOrigin = '*',
): Endpoint {
  return {
    postMessage: (message, transfer) => remote.postMessage(message, targetOrigin, transfer),
    addEventListener: (type, listener) => local.addEventListener(type, listener),
    removeEventListener: (type, listener) => local.removeEventListener(type, listener),
  };
}
