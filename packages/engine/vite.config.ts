import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import dts from 'vite-plugin-dts';

// Engine library build: the SDK ships as ESM + CJS with type declarations.
// `pixi.js` and `mediabunny` are runtime dependencies but stay external in the
// bundle, so a consumer resolves a single deduped copy of each (Pixi is stateful
// — two copies break). The dev server (`pnpm dev:engine`) serves the demo/verify
// pages in `example/`.
export default defineConfig({
  server: {
    port: 6173,
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
    },
  },
  plugins: [
    dts({
      include: ['src'],
      rollupTypes: true,
    }),
  ],
  build: {
    lib: {
      entry: resolve(__dirname, 'src/index.ts'),
      name: 'VideoEditorCanvas',
      formats: ['es', 'cjs'],
      fileName: (format) => (format === 'es' ? 'index.js' : 'index.cjs'),
    },
    rollupOptions: {
      // `pixi.js` and `mediabunny` are runtime dependencies that stay external
      // so consumers dedupe a single copy of each.
      external: ['pixi.js', 'mediabunny'],
      output: {
        globals: { 'pixi.js': 'PIXI', mediabunny: 'Mediabunny' },
      },
    },
    sourcemap: true,
    target: 'es2022',
  },
});
