import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import dts from 'vite-plugin-dts';

// CLI package. Two jobs:
//   • vitest runs the pure-logic unit tests (arg parsing, bundle collection); the
//     `preview` command boots its own Vite dev server at runtime (see
//     src/preview.ts) rooted in `preview/`, so this config's aliases are only for
//     the tests and resolve the sibling packages straight from source;
//   • `vite build` produces the published CLI — ESM with type declarations — with
//     three entries: the programmatic barrel (`.`), the executable (`cli`, what
//     the `sequio` bin runs), and the browser-safe `externals` module the preview
//     page imports (`@sequio/cli/externals`).
//
// Everything cross-package (engine / runtime / server) plus gsap and vite stays
// external. Output is ESM only: the CLI uses `import.meta.url` to locate its own
// `package.json` (version) and the shipped `preview/` folder.
export default defineConfig({
  resolve: {
    alias: {
      // node-fs subpath first so it wins over the bare '@sequio/runtime' prefix.
      '@sequio/runtime/node-fs': resolve(__dirname, '../runtime/src/node-fs.ts'),
      '@sequio/cli/externals': resolve(__dirname, 'src/externals.ts'),
      '@sequio/engine': resolve(__dirname, '../engine/src/index.ts'),
      '@sequio/server': resolve(__dirname, '../server/src/index.ts'),
      '@sequio/runtime': resolve(__dirname, '../runtime/src/index.ts'),
    },
  },
  plugins: [
    dts({
      include: ['src'],
      exclude: ['tests', 'scripts', 'preview', 'example'],
      entryRoot: resolve(__dirname, 'src'),
      aliasesExclude: [/^@sequio\//],
    }),
  ],
  build: {
    lib: {
      entry: {
        index: resolve(__dirname, 'src/index.ts'),
        cli: resolve(__dirname, 'src/cli.ts'),
        externals: resolve(__dirname, 'src/externals.ts'),
      },
      formats: ['es'],
      fileName: (_format, name) => `${name}.js`,
    },
    rollupOptions: {
      external: [
        '@sequio/engine',
        '@sequio/runtime',
        '@sequio/runtime/node-fs',
        '@sequio/server',
        '@sequio/server/route-b',
        'gsap',
        'vite',
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
