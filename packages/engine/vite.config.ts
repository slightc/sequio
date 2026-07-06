import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import dts from 'vite-plugin-dts';

// Engine library build: the SDK ships as ESM + CJS with type declarations.
// `pixi.js` (peer) and `mediabunny` (runtime dep) stay external in the bundle.
// The dev server (`pnpm dev:engine`) serves the demo/verify pages in `example/`.
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
      // `pixi.js` is a peer dependency; `mediabunny` is a runtime dependency.
      // Both stay external so consumers dedupe a single copy.
      external: ['pixi.js', 'mediabunny'],
      output: {
        globals: { 'pixi.js': 'PIXI', mediabunny: 'Mediabunny' },
      },
    },
    sourcemap: true,
    target: 'es2022',
  },
});
