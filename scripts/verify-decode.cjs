#!/usr/bin/env node
/**
 * End-to-end verification of the VideoSource decode path, using Puppeteer +
 * Chrome-for-Testing (which ships WebCodecs, unlike Playwright's stripped
 * Chromium). Spawns the Vite dev server, loads example/decode-test.html — which
 * records a real WebM and decodes it back through the SDK — and asserts the
 * in-page result.
 *
 * Usage: pnpm verify:decode
 * Requires a one-time browser fetch: `pnpm exec puppeteer browsers install chrome`.
 */
const { spawn } = require('node:child_process');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const PORT = 5199;
const URL = `http://localhost:${PORT}/example/decode-test.html`;

function waitForServer(url, timeoutMs = 20000) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const tryOnce = () => {
      const req = require('node:http').get(url, (res) => {
        res.resume();
        resolve();
      });
      req.on('error', () => {
        if (Date.now() - start > timeoutMs) reject(new Error('vite did not start'));
        else setTimeout(tryOnce, 250);
      });
    };
    tryOnce();
  });
}

async function main() {
  const puppeteer = require('puppeteer');

  const vite = spawn(
    path.join(ROOT, 'node_modules/.bin/vite'),
    ['--port', String(PORT), '--strictPort'],
    { cwd: ROOT, stdio: 'ignore' },
  );

  let browser;
  try {
    await waitForServer(`http://localhost:${PORT}/`);
    browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--ignore-gpu-blocklist'],
    });
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text());
    });

    await page.goto(URL, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction('window.__DECODE_TEST__ !== undefined', { timeout: 30000 });
    const result = await page.evaluate('window.__DECODE_TEST__');

    console.log('decode-test result:', JSON.stringify(result, null, 2));
    if (errors.length) console.log('page errors:', errors.filter((e) => !/favicon/.test(e)));

    if (!result || !result.ok) {
      throw new Error('decode verification FAILED');
    }
    console.log('\n✅ VideoSource decode path verified (real WebCodecs decode).');
  } finally {
    if (browser) await browser.close();
    vite.kill('SIGTERM');
  }
}

main().catch((err) => {
  console.error('\n❌', err.message || err);
  process.exit(1);
});
