# handbag-promo — a retro fashion spot, recreated

A 15-second vertical (9:16) **burnt-orange retro fashion promo**, rebuilt from
the engine's own object graph. It's a faithful re-creation of a real social-media
handbag ad — same four chapters, palette, kinetic typography, film/polaroid
framing, sunburst backdrops and light-leak cuts — but with **entirely original,
procedurally-drawn artwork** in place of the source's photography, so nothing
copyrighted is reproduced and the whole piece is self-contained and reproducible.

```bash
sequio preview example/handbag-promo/index.ts --watch
sequio render  example/handbag-promo/index.ts --out handbag.mp4 --scale 2
sequio frame   example/handbag-promo/index.ts --time 3 --out frame.png
```

## The four chapters

| # | Time | Headline | What happens |
|---|------|----------|--------------|
| 1 | 0.0–5.6s | **FASHIONABLE HANDBAG** | Sunburst backdrop; a polaroid product card drops in tilted, settles, then pushes in to fill. The headline pulses solid↔hollow and **spreads apart** on exit. |
| 2 | 5.6–8.6s | **MINIMALIST · RETRO-STYLE** | A black film frame (CapCut-style strip markings) holds the model over diagonal cream/orange stripes, gently swaying, then **whips out** on a motion blur. |
| 3 | 8.6–11.1s | **LUXURIOUS** | A film contact-sheet grid pans down; the hollow headline **flickers** in. |
| 4 | 11.1–15.0s | **GET IT NOW** | The model with a **rotating set of mini-bags** at the waist; the CTA resolves and `www.brandname.com` **types on** character-by-character. |

Between chapters a **sunburst iris** bursts open (1→2 and 3→4) and warm
**light-leak flashes** cover the cuts.

## How it's built

Everything is the engine's public surface — no bespoke renderer:

- **`TextClip`** with `stroke` + a transparent fill for the hollow/outline display
  type; a stacked fill copy cross-pulses under it (`pulseHeadline` in `kit.ts`).
  `split: 'char'` + `StaggerTextAnimator` drives the URL typewriter.
- **`ImageClip`** + a `GroupClip` `maskShape` for the cropped photo panels
  (`coverImage`); Ken-Burns pushes, tilts, sways and the whip are all keyframed
  `Transform2D`s.
- **`BlurEffect`** for the motion-blur whip; **`ColorEffect`** for a light warm
  grade; **`blendMode: 'add'`** light leaks and **`'overlay'`** film grain.
- Each chapter is one `GroupClip` placed at its slice of the timeline, so its
  children read in chapter-**local** time (see the note below).

### Assets (`assets/`)

All drawn procedurally (flat vector + noise/grain), then optimized:

`sunburst.png` · `bag-hero.png` · `model.png` · `bag1–4.png` · `stripes.png` ·
`lightleak.png` · `grain.png`. Fonts (Anton display + Oswald condensed, Latin
subsets) are embedded as `data:` URLs in `font.ts`, so the title renders
identically in the browser preview and the Node render.

### A note on time (why chapters are groups)

A clip's `transform`/`opacity` keyframes evaluate at the **timeline** time, but a
`GroupClip` evaluates its **children** at the group's *local* time
(`t − group.start`). Wrapping each chapter in a group therefore lets every
keyframe inside a chapter read as an offset from that chapter's start — the same
pattern the `valentine` example uses. The light-leak/iris overlays ride a
top-level track instead, so their times are absolute.
