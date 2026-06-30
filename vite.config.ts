import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import dts from 'vite-plugin-dts';

// Library build: the SDK ships as ESM + CJS with type declarations.
// `pixi.js` is a peer dependency and must stay external.
export default defineConfig({
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
      external: ['pixi.js'],
      output: {
        globals: { 'pixi.js': 'PIXI' },
      },
    },
    sourcemap: true,
    target: 'es2022',
  },
});
