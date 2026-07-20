import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import dts from 'vite-plugin-dts';

// Server package. Two jobs:
//   • the dev server (`pnpm dev:server`) + vitest run the headless
//     timeline-protocol unit tests;
//   • `vite build` produces the published library — ESM with type declarations —
//     with two entries: the browser-safe protocol barrel (`.`, imports only the
//     engine) and the Node-only `./route-b` render route.
//
// Route B pulls the engine, runtime, PixiJS, mediabunny and the Node-native
// bindings (jsdom / @napi-rs/canvas / webgpu / node-web-audio-api /
// @mediabunny/server) — all kept external so its dynamic `import()`/`require()`
// resolve one instance of each on the host. Output is ESM only: route-b uses
// `import.meta.url` + `createRequire` to pin a single mediabunny instance.
//
// Route A (headless Chrome) now lives in the `@sequio/headless` package. Dev/test
// resolve the engine and runtime straight from source (aliases below) so no prior
// `pnpm build` is needed.
export default defineConfig({
  server: {
    port: 6175,
  },
  resolve: {
    alias: {
      '@sequio/engine': resolve(__dirname, '../engine/src/index.ts'),
      '@sequio/runtime': resolve(__dirname, '../runtime/src/index.ts'),
    },
  },
  plugins: [
    dts({
      include: ['src', 'route-b'],
      exclude: ['tests', 'route-b/verify-*.ts', 'route-b/render.ts'],
      entryRoot: __dirname,
      aliasesExclude: [/^@sequio\//],
    }),
  ],
  build: {
    lib: {
      entry: {
        index: resolve(__dirname, 'src/index.ts'),
        'route-b': resolve(__dirname, 'route-b/index.ts'),
      },
      formats: ['es'],
      fileName: (_format, name) => `${name}.js`,
    },
    rollupOptions: {
      external: [
        '@sequio/engine',
        '@sequio/runtime',
        '@sequio/runtime/node-fs',
        'pixi.js',
        'mediabunny',
        '@mediabunny/server',
        '@napi-rs/canvas',
        'jsdom',
        'webgpu',
        'node-web-audio-api',
        /^node:/,
      ],
    },
    sourcemap: true,
    target: 'es2022',
  },
  test: {
    include: ['tests/**/*.test.ts'],
  },
});
