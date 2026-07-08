# @sequio/website

The **sequio project website** — a single-page marketing + docs site:

- **Home** — what sequio is, the five contracts, the package DAG, quick start.
- **Demos** — a gallery whose card covers are **live `Composer` previews drawn by
  sequio itself** (no video files — shapes, text, effects, GSAP). Click a card to
  open its source in **Code Mode**.
- **Code Mode** — the same `@sequio/runtime` → `Composer` → preview / export /
  bundle loop the studio ships, embedded in the site; edit the multi-file program
  and re-run it live.
- **API** — the `@sequio/engine` public-surface reference, grouped by module.
- **Studio** — a showcase of the reference multi-track editor.

It is a **vanilla-TS Vite app** (no UI framework): one `index.html` shell + a tiny
hash router (`src/router.ts`). Like the studio it resolves `@sequio/engine` and
`@sequio/runtime` straight from source, and injects `gsap` as a runtime external
(exactly as the `sequio` CLI does) so demos can drive clips with a GSAP timeline.

```bash
pnpm dev:website       # dev server at http://localhost:6200 (from the repo root)
pnpm -F @sequio/website build       # production build
pnpm verify:website    # headless smoke test: covers + Code Mode actually render
```

`verify:website` boots Vite and drives Chrome-for-Testing to assert the demo
covers render pixels and Code Mode compiles + runs a demo into a live preview.
It needs the one-time browser fetch `pnpm exec puppeteer browsers install chrome`.

This package is **not part of the engine's published surface** — it's the docs/
marketing site, a consumer of the SDK like `studio`.
