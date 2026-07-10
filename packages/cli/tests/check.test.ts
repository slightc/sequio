import { describe, expect, it } from 'vitest';
import type { RuntimeBundle } from '@sequio/runtime';
import { checkBundle, type CheckBundleOptions, type Diagnostic } from '../src/check';

/**
 * `sequio check` — GPU-free static validation. Every case here runs the whole
 * compile → link → build → traverse pipeline against an in-memory bundle with a
 * **null renderer**: no WebGPU, no network, no disk. A deliberately-broken sample
 * per stage must surface its code; a clean composition must be diagnostic-free.
 */

function bundle(files: Record<string, string>, entry = '/index.ts'): RuntimeBundle {
  return { files, entry };
}

async function check(source: string, options?: CheckBundleOptions): Promise<Diagnostic[]> {
  return checkBundle(bundle({ '/index.ts': source }), options);
}

const codes = (ds: Diagnostic[]): string[] => ds.map((d) => d.code);

/** A minimal valid composition body, parameterized by the builder's clip setup. */
function composition(body: string, ret = 'return { compositor, duration: 4 };'): string {
  return `
    import { Compositor, VisualTrack, ShapeClip, TextClip, CrossfadeTransition } from '@sequio/engine';
    import { defineComposition } from '@sequio/runtime';
    export default defineComposition(async (env) => {
      const compositor = new Compositor({ width: 320, height: 240, ...env.compositorOptions });
      await compositor.init();
      const track = new VisualTrack();
      ${body}
      compositor.addTrack(track);
      ${ret}
    });
  `;
}

describe('checkBundle — Stage A (compile / link)', () => {
  it('A1: a syntax error', async () => {
    const ds = await check('export default (');
    expect(codes(ds)).toContain('A1');
  });

  it('A2: a dangling relative import', async () => {
    const ds = await check(`import './does-not-exist';\nexport default 1;`);
    expect(codes(ds)).toContain('A2');
  });

  it('A3: an external not injected', async () => {
    const ds = await check(`import gsap from 'gsap';\nexport default gsap;`);
    expect(codes(ds)).toContain('A3');
  });

  it('A3 clears once the external is provided (→ A4, past the import)', async () => {
    const ds = await check(`import gsap from 'gsap';\nexport const x = gsap;`, { externals: { gsap: {} } });
    expect(codes(ds)).not.toContain('A3');
    expect(codes(ds)).toContain('A4');
  });

  it('A4: entry does not export a composition', async () => {
    const ds = await check(`export const x = 1;`);
    expect(codes(ds)).toContain('A4');
  });
});

describe('checkBundle — Stage B (run the builder)', () => {
  it('B1: builder throws', async () => {
    const src = `
      import { defineComposition } from '@sequio/runtime';
      export default defineComposition(async () => { throw new Error('boom'); });
    `;
    expect(codes(await check(src))).toContain('B1');
  });

  it('B2: hits an unimplemented path', async () => {
    const src = `
      import { defineComposition } from '@sequio/runtime';
      export default defineComposition(async () => { throw new Error('X is not implemented — see todo'); });
    `;
    expect(codes(await check(src))).toContain('B2');
  });

  it('B4: an offline/media/GPU limitation is a warn, not an error', async () => {
    const src = `
      import { defineComposition } from '@sequio/runtime';
      export default defineComposition(async () => { throw new Error('createImageBitmap is not defined'); });
    `;
    const ds = await check(src);
    const b4 = ds.filter((d) => d.code === 'B4');
    expect(b4).toHaveLength(1);
    expect(b4[0]!.severity).toBe('warn');
    // A warn-only result must not be an error (check would exit 0).
    expect(ds.every((d) => d.severity === 'warn')).toBe(true);
  });

  it('B3: builder forgot compositor.init()', async () => {
    const src = `
      import { Compositor, VisualTrack, ShapeClip } from '@sequio/engine';
      import { defineComposition } from '@sequio/runtime';
      export default defineComposition(async (env) => {
        const compositor = new Compositor({ width: 320, height: 240, ...env.compositorOptions });
        const track = new VisualTrack();
        const clip = new ShapeClip({ kind: 'rect', width: 10, height: 10 });
        clip.start = 0; clip.end = 2;
        track.add(clip); compositor.addTrack(track);
        return { compositor, duration: 2 };
      });
    `;
    expect(codes(await check(src))).toContain('B3');
  });
});

describe('checkBundle — Stage C (traverse the graph)', () => {
  it('C1: clip end ≤ start', async () => {
    const ds = await check(
      composition(`
        const clip = new ShapeClip({ kind: 'rect', width: 10, height: 10 });
        clip.start = 2; clip.end = 1;
        track.add(clip);
      `),
    );
    expect(codes(ds)).toContain('C1');
  });

  it('C2: a keyframe outside the clip interval (dead keyframe)', async () => {
    const ds = await check(
      composition(`
        const clip = new ShapeClip({ kind: 'rect', width: 10, height: 10 });
        clip.start = 0; clip.end = 4;
        clip.transform.position.setKeyframes([
          { time: 0, value: [0, 0] },
          { time: 10, value: [100, 0] },
        ]);
        track.add(clip);
      `),
    );
    expect(codes(ds)).toContain('C2');
  });

  it('C3: clip end past the declared duration', async () => {
    const ds = await check(
      composition(
        `
        const clip = new ShapeClip({ kind: 'rect', width: 10, height: 10 });
        clip.start = 0; clip.end = 8;
        track.add(clip);
      `,
        'return { compositor, duration: 4 };',
      ),
    );
    expect(codes(ds)).toContain('C3');
  });

  it('C4: a TextClip font that was never registered (warn)', async () => {
    const ds = await check(
      composition(`
        const clip = new TextClip({ text: 'hi', fontFamily: 'TotallyUnregisteredFace' });
        clip.start = 0; clip.end = 4;
        track.add(clip);
      `),
    );
    const c4 = ds.filter((d) => d.code === 'C4');
    expect(c4).toHaveLength(1);
    expect(c4[0]!.severity).toBe('warn');
  });

  it('C4 does not fire for a generic family (sans-serif default)', async () => {
    const ds = await check(
      composition(`
        const clip = new TextClip({ text: 'hi' });
        clip.start = 0; clip.end = 4;
        track.add(clip);
      `),
    );
    expect(codes(ds)).not.toContain('C4');
  });

  it('C4 clears once the font is loaded', async () => {
    const src = `
      import { Compositor, VisualTrack, TextClip, fonts } from '@sequio/engine';
      import { defineComposition } from '@sequio/runtime';
      export default defineComposition(async (env) => {
        const compositor = new Compositor({ width: 320, height: 240, ...env.compositorOptions });
        await compositor.init();
        await fonts.load({ family: 'CheckTestInter', src: 'https://example.com/x.woff2' });
        const track = new VisualTrack();
        const clip = new TextClip({ text: 'hi', fontFamily: 'CheckTestInter' });
        clip.start = 0; clip.end = 4;
        track.add(clip); compositor.addTrack(track);
        return { compositor, duration: 4 };
      });
    `;
    expect(codes(await check(src))).not.toContain('C4');
  });

  it('C5: a transition whose clips do not overlap', async () => {
    const ds = await check(
      composition(`
        const a = new ShapeClip({ kind: 'rect', width: 10, height: 10 });
        a.start = 0; a.end = 2;
        const b = new ShapeClip({ kind: 'rect', width: 10, height: 10 });
        b.start = 3; b.end = 5;
        track.add(a); track.add(b);
        track.addTransition(new CrossfadeTransition().between(a, b));
      `,
        'return { compositor, duration: 5 };'),
    );
    expect(codes(ds)).toContain('C5');
  });

  it('C5 clears when the clips overlap', async () => {
    const ds = await check(
      composition(`
        const a = new ShapeClip({ kind: 'rect', width: 10, height: 10 });
        a.start = 0; a.end = 3;
        const b = new ShapeClip({ kind: 'rect', width: 10, height: 10 });
        b.start = 2; b.end = 5;
        track.add(a); track.add(b);
        track.addTransition(new CrossfadeTransition().between(a, b));
      `,
        'return { compositor, duration: 5 };'),
    );
    expect(codes(ds)).not.toContain('C5');
  });

  it('C8: an anchor outside 0..1 (pixel value mistaken for normalized)', async () => {
    const ds = await check(
      composition(`
        const clip = new ShapeClip({ kind: 'rect', width: 10, height: 10 });
        clip.start = 0; clip.end = 4;
        clip.transform.anchor.setStatic([160, 120]);
        track.add(clip);
      `),
    );
    expect(codes(ds)).toContain('C8');
  });

  it('C7: a local asset that does not exist on disk', async () => {
    const src = `
      import { Compositor, VisualTrack, ShapeClip } from '@sequio/engine';
      import { defineComposition, loadAsset } from '@sequio/runtime';
      export default defineComposition(async (env) => {
        const compositor = new Compositor({ width: 320, height: 240, ...env.compositorOptions });
        await compositor.init();
        await loadAsset('./missing.mp4');
        const track = new VisualTrack();
        const clip = new ShapeClip({ kind: 'rect', width: 10, height: 10 });
        clip.start = 0; clip.end = 2;
        track.add(clip); compositor.addTrack(track);
        return { compositor, duration: 2 };
      });
    `;
    const ds = await checkBundle(bundle({ '/index.ts': src }), { assetExists: () => false });
    expect(codes(ds)).toContain('C7');
  });
});

describe('checkBundle — a clean composition', () => {
  it('produces zero diagnostics', async () => {
    const ds = await check(
      composition(`
        const clip = new ShapeClip({ kind: 'rect', width: 100, height: 100 });
        clip.start = 0; clip.end = 4;
        clip.transform.position.setKeyframes([
          { time: 0, value: [0, 0] },
          { time: 3, value: [100, 0] },
        ]);
        track.add(clip);
      `),
    );
    expect(ds).toEqual([]);
  });
});
