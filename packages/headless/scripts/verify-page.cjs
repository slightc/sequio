#!/usr/bin/env node
/**
 * Generic browser e2e runner: spawn Vite, load an example page that publishes a
 * result object on a `window.<global>`, and assert `result.ok`. Uses Puppeteer +
 * Chrome-for-Testing (which ships WebCodecs, unlike Playwright's stripped
 * Chromium).
 *
 * Usage: node scripts/verify-page.cjs <pagePath> <resultGlobal> [label]
 *   e.g. node scripts/verify-page.cjs example/decode-test.html __DECODE_TEST__ "decode"
 *
 * Requires a one-time browser fetch: `pnpm exec puppeteer browsers install chrome`.
 */
const { spawn } = require('node:child_process');
const path = require('node:path');

const [pagePath, resultGlobal, label = 'render'] = process.argv.slice(2);
if (!pagePath || !resultGlobal) {
  console.error('usage: verify-page.cjs <pagePath> <resultGlobal> [label]');
  process.exit(2);
}

const ROOT = path.resolve(__dirname, '..');
const PORT = 5199;

// Resolve Vite's CLI regardless of whether it's hoisted into this package or
// only present at the workspace root (tooling is a root devDependency). Resolve
// via the package.json (always exported) then join `bin/vite.js`, so newer Vite
// versions that don't list the bin in their `exports` map still work.
const VITE_PKG = require.resolve('vite/package.json', { paths: [ROOT, process.cwd()] });
const VITE_BIN = path.join(path.dirname(VITE_PKG), 'bin/vite.js');

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
    process.execPath,
    [VITE_BIN, '--port', String(PORT), '--strictPort'],
    { cwd: ROOT, stdio: 'ignore' },
  );

  let browser;
  try {
    await waitForServer(`http://localhost:${PORT}/`);
    browser = await puppeteer.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--use-gl=angle',
        '--use-angle=swiftshader',
        '--ignore-gpu-blocklist',
        '--autoplay-policy=no-user-gesture-required',
      ],
    });
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text());
    });

    await page.goto(`http://localhost:${PORT}/${pagePath}`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(`window.${resultGlobal} !== undefined`, { timeout: 30000 });
    const result = await page.evaluate(`window.${resultGlobal}`);

    console.log(`${label} result:`, JSON.stringify(result, null, 2));
    if (errors.length) console.log('page errors:', errors.filter((e) => !/favicon/.test(e)));

    if (!result || !result.ok) {
      throw new Error(`${label} verification FAILED`);
    }
    console.log(`\n✅ ${label} verified.`);
  } finally {
    if (browser) await browser.close();
    vite.kill('SIGTERM');
  }
}

main().catch((err) => {
  console.error('\n❌', err.message || err);
  process.exit(1);
});
