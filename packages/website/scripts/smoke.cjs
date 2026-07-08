#!/usr/bin/env node
/**
 * Headless smoke test for the website. Boots Vite, then drives Chrome-for-Testing
 * to confirm end-to-end that:
 *   1. the demo gallery mounts all cover canvases and they render visible pixels
 *      (proved via element screenshots — the browser compositor has the real
 *      pixels, so this is immune to WebGL preserveDrawingBuffer:false), and
 *   2. Code Mode compiles + links + runs a demo into a live Composer preview
 *      (proved by its "Ran N file(s) → Composer…" log + a rendered stage).
 */
const { spawn } = require('node:child_process');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const PORT = 6266;
const VITE_PKG = require.resolve('vite/package.json', { paths: [ROOT, process.cwd()] });
const VITE_BIN = path.join(path.dirname(VITE_PKG), 'bin/vite.js');

function waitForServer(url, timeoutMs = 30000) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const tryOnce = () => {
      const req = require('node:http').get(url, (res) => { res.resume(); resolve(); });
      req.on('error', () => {
        if (Date.now() - start > timeoutMs) reject(new Error('vite did not start'));
        else setTimeout(tryOnce, 250);
      });
    };
    tryOnce();
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const puppeteer = require('puppeteer');
  const vite = spawn(process.execPath, [VITE_BIN, '--port', String(PORT), '--strictPort'], { cwd: ROOT, stdio: 'ignore' });
  let browser;
  const errors = [];
  try {
    await waitForServer(`http://localhost:${PORT}/`);
    browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'],
    });
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 900, deviceScaleFactor: 1 });
    page.on('pageerror', (e) => errors.push(String(e)));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

    // ── 1. Demos gallery ─────────────────────────────────────────────────
    // Not `networkidle0`: two covers stream a real network image + video, so the
    // network never fully idles. Wait on the DOM, then the covers explicitly.
    await page.goto(`http://localhost:${PORT}/#/demos`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.demo-cover canvas', { timeout: 30000 });
    await sleep(4000); // sequential cover boot queue (now incl. media decode) + a few frames
    const covers = await page.$$eval('.demo-cover canvas', (l) => l.length);

    // Screenshot the first cover element; a rendered, multi-color frame yields a
    // much larger PNG than a blank/solid one. Threshold is deliberately generous.
    const el = await page.$('.demo-cover');
    const shot = await el.screenshot({ encoding: 'base64' });
    const shotBytes = Math.floor((shot.length * 3) / 4);
    console.log('cover canvases:', covers, '· first-cover PNG bytes:', shotBytes);

    // ── 2. Code Mode ─────────────────────────────────────────────────────
    await page.goto(`http://localhost:${PORT}/#/code?demo=easing`, { waitUntil: 'networkidle0' });
    await page.waitForSelector('#stage canvas', { timeout: 30000 });
    await page.waitForFunction(() => /Ran \d+ file/.test(document.getElementById('log')?.textContent || ''), { timeout: 30000 });
    const log = await page.$eval('#log', (n) => n.textContent);
    await sleep(500);
    const stageEl = await page.$('#stage');
    const stageShot = await stageEl.screenshot({ encoding: 'base64' });
    const stageBytes = Math.floor((stageShot.length * 3) / 4);
    console.log('code-mode log:', JSON.stringify(log));
    console.log('code-mode stage PNG bytes:', stageBytes);

    // ── 3. Other routes render without error ─────────────────────────────
    for (const route of ['/', '/api', '/studio']) {
      await page.goto(`http://localhost:${PORT}/#${route}`, { waitUntil: 'networkidle0' });
      await page.waitForSelector('#view *', { timeout: 15000 });
    }

    // Ignore environmental network-load failures: two covers fetch a real image +
    // video from external hosts, which a sandboxed CI box may not reach (the cover
    // degrades gracefully to its fallback). Functional breakage is still caught by
    // the render/run checks below.
    const realErrors = errors.filter(
      (e) => !/favicon|Download the React|autoplay|net::ERR_|Failed to load resource/i.test(e),
    );
    if (realErrors.length) console.log('\npage errors:\n', realErrors.join('\n'));

    const checks = {
      sixCovers: covers >= 6,
      coverRendered: shotBytes > 2500,
      codeRan: /Ran \d+ file/.test(log) && /clip\(s\)/.test(log),
      stageRendered: stageBytes > 2500,
      noErrors: realErrors.length === 0,
    };
    console.log('\nchecks:', JSON.stringify(checks, null, 2));
    if (!Object.values(checks).every(Boolean)) throw new Error('smoke test FAILED');
    console.log('\n✅ website smoke test passed.');
  } finally {
    if (browser) await browser.close();
    vite.kill('SIGTERM');
  }
}

main().catch((err) => { console.error('\n❌', err.message || err); process.exit(1); });
