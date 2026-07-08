# @sequio/website

The **Sequio project website** — a single-page marketing + docs site:

- **Home** — what Sequio is, the five contracts, the package DAG, quick start.
- **Demos** — a gallery whose card covers are **live `Composer` previews drawn by
  Sequio itself** — shapes, text, effects, GSAP, plus two that fetch a still
  **image** and a **video** straight off the network (`ImageSource` /
  `VideoSource`) and composite them. Click a card to open its source in
  **Code Mode**.
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

## Deploy to Vercel

The repo root ships a [`vercel.json`](../../vercel.json) that builds only this
package inside the pnpm workspace, so deploying is turnkey:

1. Import the repo at [vercel.com/new](https://vercel.com/new) — keep **Root
   Directory** at the repo root (the default). `vercel.json` drives everything:

   ```jsonc
   {
     "installCommand": "pnpm install --frozen-lockfile",
     "buildCommand": "pnpm -F @sequio/website build",   // builds just the website
     "outputDirectory": "packages/website/dist",
     "rewrites": [{ "source": "/(.*)", "destination": "/index.html" }]
   }
   ```

2. Deploy. Vercel picks up the pnpm version from the root `packageManager` field
   (via corepack) and runs the workspace install, so the website resolves
   `@sequio/engine` / `@sequio/runtime` from source at build time — no prior
   `pnpm build` of the other packages is needed.

It's a fully static SPA: navigation is **hash-based** (`/#/demos`), so the server
only ever serves `index.html`. The catch-all rewrite just makes a directly-typed
path (e.g. `/api`) fall back to the app too; static assets under `/assets/*` are
served from the filesystem first, so the rewrite never shadows them.

CLI alternative (from the repo root):

```bash
pnpm dlx vercel        # preview deploy
pnpm dlx vercel --prod # production deploy
```

