# Local-media demo

Shows a composition pulling in **local** media that sits next to it on disk — an
image and a video — through the runtime's `loadAsset` hook:

```ts
import { defineComposition, loadAsset } from '@sequio/runtime';

const video = new VideoSource({ src: await loadAsset('./video.mp4') });
const image = new ImageSource({ src: await loadAsset('./image.jpg') });
```

## Try it

Drop two files into this folder:

- `video.mp4` — any short video
- `image.jpg` — any image

Then run either command:

```bash
pnpm sequio preview example/media-local/index.ts --watch
pnpm sequio render  example/media-local/index.ts --out local.mp4
```

Before you add files, the demo still runs — each `loadAsset` falls back to a
placeholder telling you what to drop.

## Why the files aren't in the repo

Binary media bloats a git repo, so the media here is **git-ignored** (see
[`.gitignore`](./.gitignore)) and never enters the source bundle. `loadAsset`
resolves the file at runtime instead:

- **preview** — the dev server serves the file from this folder over `/__asset/…`;
- **render** — Node reads it straight off disk.

Both go through one contract in `@sequio/runtime` (`RuntimeOptions.loadAsset`), so
the same code previews and renders identically. To avoid a local file entirely,
reference a network URL instead — see [`../media-network`](../media-network).
