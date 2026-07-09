import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import dts from 'vite-plugin-dts';

// Runtime package. Two jobs:
//   • the dev server (`pnpm dev` / `pnpm -F @sequio/runtime dev`) serves the e2e
//     verify page in `example/` and vitest runs the pure-logic unit tests;
//   • `vite build` produces the published library — ESM + CJS with type
//     declarations — with two entries: the browser-safe barrel (`.`) and the
//     Node-only `./node-fs` subpath (which touches `node:fs`/`node:path`).
// The engine and `typescript` stay external so consumers dedupe one copy of each;
// dev/test resolve the engine straight from source (alias below) so no prior
// `pnpm build` is needed.
export default defineConfig({
  server: {
    port: 6177,
  },
  resolve: {
    alias: {
      '@sequio/engine': resolve(__dirname, '../engine/src/index.ts'),
    },
  },
  plugins: [
    dts({
      include: ['src'],
      exclude: ['tests', 'example'],
      entryRoot: resolve(__dirname, 'src'),
      // Keep `@sequio/engine` a bare specifier in the emitted .d.ts — the alias
      // is a dev-only resolution convenience, not something to inline.
      aliasesExclude: [/^@sequio\//],
    }),
  ],
  build: {
    lib: {
      entry: {
        index: resolve(__dirname, 'src/index.ts'),
        'node-fs': resolve(__dirname, 'src/node-fs.ts'),
      },
      formats: ['es', 'cjs'],
      fileName: (format, name) => (format === 'es' ? `${name}.js` : `${name}.cjs`),
    },
    rollupOptions: {
      // Keep the engine and the (heavy) TypeScript compiler external.
      external: ['@sequio/engine', 'typescript', /^node:/],
    },
    sourcemap: true,
    target: 'es2022',
  },
  test: {
    include: ['tests/**/*.test.ts'],
  },
});
