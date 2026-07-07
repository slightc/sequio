#!/usr/bin/env node
/**
 * The `sequio` binary. The CLI is authored in TypeScript and resolves the other
 * workspace packages straight from source, so — mirroring how the repo runs its
 * other Node entry points (route-b, the verify scripts) — this launcher executes
 * `src/cli.ts` through tsx rather than requiring a prior build step.
 */
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));
const entry = resolve(here, '../src/cli.ts');

// Resolve tsx's bin from its manifest so this works regardless of where the
// (hoisted) dependency landed in the workspace's node_modules.
const tsxPkgPath = require.resolve('tsx/package.json');
const tsxPkg = require('tsx/package.json');
const tsxBin = resolve(dirname(tsxPkgPath), typeof tsxPkg.bin === 'string' ? tsxPkg.bin : tsxPkg.bin.tsx);

const child = spawn(process.execPath, [tsxBin, entry, ...process.argv.slice(2)], {
  stdio: 'inherit',
});
child.on('close', (code) => process.exit(code ?? 1));
child.on('error', (err) => {
  console.error('✖ failed to launch sequio:', err.message);
  process.exit(1);
});
