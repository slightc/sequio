import { describe, expect, it, vi } from 'vitest';
import { expose, wrap, type Endpoint, type Remote } from '../src/rpc';

/**
 * A connected pair of in-memory endpoints (a MessageChannel stand-in). Delivery is
 * async (microtask) and `structuredClone`s the payload — so a raw function slipping
 * onto the wire would throw, proving only callback *refs* cross, never functions.
 */
function endpointPair(): [Endpoint, Endpoint] {
  const listeners: [Set<(e: { data: unknown }) => void>, Set<(e: { data: unknown }) => void>] = [new Set(), new Set()];
  const make = (self: 0 | 1): Endpoint => {
    const other = self === 0 ? 1 : 0;
    return {
      postMessage: (message) => {
        const clone = structuredClone(message);
        queueMicrotask(() => listeners[other].forEach((l) => l({ data: clone })));
      },
      addEventListener: (_t, l) => listeners[self].add(l),
      removeEventListener: (_t, l) => listeners[self].delete(l),
    };
  };
  return [make(0), make(1)];
}

interface Calc {
  add(a: number, b: number): Promise<number>;
  boom(): Promise<never>;
  countTo(n: number, onTick: (i: number) => void): Promise<number>;
}

describe('rpc expose/wrap', () => {
  it('calls a remote method and returns the value', async () => {
    const [a, b] = endpointPair();
    expose({ add: async (x: number, y: number) => x + y }, a);
    const remote = wrap<Calc>(b);
    expect(await remote.add(2, 3)).toBe(5);
  });

  it('propagates a thrown error to the caller as a rejection', async () => {
    const [a, b] = endpointPair();
    expose({ boom: async () => { throw new Error('kaboom'); } }, a);
    const remote = wrap<Calc>(b);
    await expect(remote.boom()).rejects.toThrow('kaboom');
  });

  it('rejects a call to an unknown method', async () => {
    const [a, b] = endpointPair();
    expose({}, a);
    const remote = wrap<Calc>(b);
    await expect(remote.add(1, 1)).rejects.toThrow(/no method 'add'/);
  });

  it('proxies a function argument as a callback that fires locally', async () => {
    const [a, b] = endpointPair();
    expose(
      {
        countTo: async (n: number, onTick: (i: number) => void) => {
          for (let i = 1; i <= n; i++) onTick(i);
          return n;
        },
      },
      a,
    );
    const remote = wrap<Calc>(b);
    const ticks: number[] = [];
    const total = await remote.countTo(3, (i) => ticks.push(i));
    expect(total).toBe(3);
    expect(ticks).toEqual([1, 2, 3]);
  });

  it('keeps concurrent calls independent (ids not crossed)', async () => {
    const [a, b] = endpointPair();
    expose({ add: async (x: number, y: number) => x + y }, a);
    const remote: Remote<Calc> = wrap<Calc>(b);
    const [r1, r2, r3] = await Promise.all([remote.add(1, 1), remote.add(2, 2), remote.add(10, 20)]);
    expect([r1, r2, r3]).toEqual([2, 4, 30]);
  });

  it('does not fire a callback after its call has returned', async () => {
    const [a, b] = endpointPair();
    // Capture the proxied callback in a box (an object property isn't flow-narrowed
    // across the await the way a local would be) so we can invoke it after the return.
    const box: { late: ((i: number) => void) | null } = { late: null };
    expose(
      {
        countTo: async (_n: number, onTick: (i: number) => void) => {
          box.late = onTick;
          return 0;
        },
      },
      a,
    );
    const remote = wrap<Calc>(b);
    const cb = vi.fn();
    await remote.countTo(1, cb);
    box.late?.(99); // fired after the return — the client already dropped the callback
    await new Promise((r) => queueMicrotask(() => r(null)));
    expect(cb).not.toHaveBeenCalled();
  });
});
