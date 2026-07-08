import { resolve } from 'node:path';
import { defineConfig } from 'vite';

// The project website (`pnpm -F @sequio/website dev`). A single-page app: one
// `index.html` shell + a tiny hash router (see src/router.ts) drives Home, the
// Demos gallery + Code Mode, the engine API reference and the studio showcase.
//
// Like the studio app it resolves the engine and runtime straight from source
// (tsconfig `paths` + the aliases below), so the demo covers render and Code
// Mode compiles+runs user code without a prior `pnpm build` of the SDK.
export default defineConfig({
  server: {
    port: 6200,
  },
  resolve: {
    alias: {
      '@sequio/engine': resolve(__dirname, '../engine/src/index.ts'),
      '@sequio/runtime': resolve(__dirname, '../runtime/src/index.ts'),
    },
  },
});
