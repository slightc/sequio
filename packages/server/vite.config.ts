import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import dts from 'vite-plugin-dts';

// Server package. Two jobs:
//   • the dev server (`pnpm dev:server`) + vitest run the pure-logic unit tests;
//   • `vite build` produces the published library — ESM with type declarations —
//     a single entry: `serverEnv`, the pure-Node (PixiJS WebGPU) render
//     environment (`src/index.ts`).
//
// The env pulls the engine, PixiJS, mediabunny and the Node-native bindings
// (jsdom / @napi-rs/canvas / webgpu / node-web-audio-api / @mediabunny/server) —
// all kept external so its dynamic `import()`/`require()` resolve one instance of
// each on the host. Output is ESM only: the env uses `import.meta.url` +
// `createRequire` to pin a single mediabunny instance.
//
// The TimelineSpec protocol + RPC now live in `@sequio/headless`, and the
// code-bundle render helpers in `@sequio/cli`. Dev/test resolve the engine and
// runtime straight from source (aliases below) so no prior `pnpm build` is needed.
export default defineConfig({
  server: {
    port: 6175,
  },
  resolve: {
    alias: {
      '@sequio/engine': resolve(__dirname, '../engine/src/index.ts'),
    },
  },
  plugins: [
    dts({
      include: ['src'],
      exclude: ['tests'],
      entryRoot: __dirname,
      aliasesExclude: [/^@sequio\//],
    }),
  ],
  build: {
    lib: {
      entry: {
        index: resolve(__dirname, 'src/index.ts'),
      },
      formats: ['es'],
      fileName: (_format, name) => `${name}.js`,
    },
    rollupOptions: {
      external: [
        '@sequio/engine',
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
