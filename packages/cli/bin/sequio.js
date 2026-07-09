#!/usr/bin/env node
/**
 * The `sequio` binary. Two modes:
 *
 *   • **Published** — the package ships a built `dist/cli.js`; we import it
 *     directly (plain Node, no toolchain needed), and it resolves the sibling
 *     `@sequio/*` packages from `node_modules`.
 *
 *   • **From source (this repo)** — there is no `dist/` yet, so — mirroring how
 *     the repo runs its other Node entry points (route-b, the verify scripts) —
 *     we execute `src/cli.ts` through tsx, pinning this package's tsconfig so its
 *     `paths` resolve `@sequio/*` straight from source without a prior build.
 */
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const built = resolve(here, '../dist/cli.js');

if (existsSync(built)) {
  // Published: run the built entry (it self-invokes `main`).
  await import(pathToFileURL(built).href);
} else {
  // From source: launch `src/cli.ts` through tsx.
  const require = createRequire(import.meta.url);
  const entry = resolve(here, '../src/cli.ts');

  // Resolve tsx's bin from its manifest so this works regardless of where the
  // (hoisted) dependency landed in the workspace's node_modules.
  const tsxPkgPath = require.resolve('tsx/package.json');
  const tsxPkg = require('tsx/package.json');
  const tsxBin = resolve(dirname(tsxPkgPath), typeof tsxPkg.bin === 'string' ? tsxPkg.bin : tsxPkg.bin.tsx);

  // Pin the tsconfig tsx uses to this package's own — it carries the `paths` that
  // resolve @sequio/engine, @sequio/runtime and @sequio/server/route-b straight
  // from source. Without this, tsx would pick up whatever tsconfig sits at the
  // cwd (e.g. the workspace-root solution config, which has no `paths`), and the
  // bare imports would fall back to the engine's unbuilt `dist/` and fail.
  const tsconfig = resolve(here, '../tsconfig.json');

  const child = spawn(process.execPath, [tsxBin, entry, ...process.argv.slice(2)], {
    stdio: 'inherit',
    env: { ...process.env, TSX_TSCONFIG_PATH: tsconfig },
  });
  child.on('close', (code) => process.exit(code ?? 1));
  child.on('error', (err) => {
    console.error('✖ failed to launch sequio:', err.message);
    process.exit(1);
  });
}
