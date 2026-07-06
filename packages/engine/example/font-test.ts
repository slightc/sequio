/**
 * Puppeteer render test for custom-font support (the mechanism behind
 * fonts.loadGoogleFont). Loads a distinctive script font (Pacifico) and renders
 * a TextClip with it, asserting the font registered AND text drew.
 *
 * The font is self-hosted here because this sandbox's browser has no outbound
 * network; `fonts.loadGoogleFont({ family: 'Pacifico' })` uses the exact same
 * FontFace/document.fonts path over the wire (verified reachable via curl).
 *
 * Publishes the result on `window.__FONT_TEST__`.
 */
import { Compositor, fonts, TextClip, Timebase, VisualTrack } from '../src/index';

const W = 420;
const H = 140;

async function run(): Promise<void> {
  await fonts.load({ family: 'Pacifico', src: '/example/assets/pacifico.ttf' });
  const available = document.fonts.check('32px "Pacifico"');

  const compositor = new Compositor({
    width: W,
    height: H,
    timebase: new Timebase(30),
    background: 0x0b0b0e,
    preferWebGPU: false,
  });
  await compositor.init();
  document.getElementById('stage')!.append(compositor.view);

  const track = new VisualTrack();
  const clip = new TextClip({ text: 'Google Fonts', fontFamily: 'Pacifico', fontSize: 46, fill: 0xffffff });
  clip.start = 0;
  clip.end = 100;
  clip.transform.anchor.setStatic([0.5, 0.5]);
  clip.transform.position.setStatic([W / 2, H / 2]);
  track.add(clip);
  compositor.addTrack(track);

  compositor.renderSync(0);

  const off = document.createElement('canvas');
  off.width = W;
  off.height = H;
  const ctx = off.getContext('2d')!;
  ctx.drawImage(compositor.view, 0, 0);
  const { data } = ctx.getImageData(0, 0, W, H);
  let bright = 0;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i]! > 180 && data[i + 1]! > 180 && data[i + 2]! > 180) bright++;
  }

  (window as unknown as { __FONT_TEST__: unknown }).__FONT_TEST__ = {
    ok: available && bright > 200,
    available,
    bright,
  };
}

run().catch((err) => {
  (window as unknown as { __FONT_TEST__: unknown }).__FONT_TEST__ = { ok: false, error: String(err) };
});
