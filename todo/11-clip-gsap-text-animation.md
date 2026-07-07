# 11 · Clip 动画器 + GSAP 绑定 + 文字动效

状态：✅ Done

## 目标

1. 让 **Clip 可被动画驱动**，并能接入 **GSAP**——但**不破坏**契约 #2
   （`render(t)` 是 `(对象图, t)` 的纯函数）、且**引擎不依赖 gsap**。
2. 实现**文字动效**：把 `TextClip` 拆成逐行 / 逐词 / 逐字的独立对象，做交错入场
   （例如逐字掉落）。

## 范围

- `src/animation/clip-animator.ts`：`AnimationSample`（叠加在关键帧之上的覆盖量）、
  `ClipAnimator` / `TextAnimator` 接口、`TextPart` / `TextSplit`、内置零依赖
  `StaggerTextAnimator`（逐行/逐词/逐字 + `order`）与 `TweenAnimator`。
- `src/animation/gsap-animator.ts`：`gsapClipAnimator` / `gsapTextAnimator`——
  **结构化**接口（`GsapLike` / `GsapTimelineLike`），不 import gsap；用**暂停时间轴 +
  seek**（`timeline.time(localT)`）保证纯函数。
- `src/text/text-layout.ts`：`computeTextParts()` 纯排版（宽度测量注入，可脱离
  canvas 单测）。
- `src/compositor/clip.ts`：`VisualClip.animator` + `applyCommon` 合成；
  `Transform2D.applyTo(obj, t, sample?)` 叠加覆盖量。
- `src/compositor/clips.ts`：`TextClip.split` / `textAnimator` / `partCount` /
  `getParts()`——拆分渲染（每 part 一个 `PIXI.Text`，anchor 居中；每帧先复位再叠加
  以稳定包围盒）。

## 验收标准

- [x] `Transform2D` 合成 sample：位移/旋转加法、缩放/alpha 乘法（单测）。
- [x] `VisualClip.applyCommon` 用 clip 级 animator 的 alpha 乘 opacity（单测）。
- [x] `StaggerTextAnimator` / `TweenAnimator` 为纯函数：交错、settle、reverse（单测）。
- [x] `computeTextParts` 逐行/逐词/逐字几何 + 空白处理 + index/count（单测）。
- [x] GSAP 绑定：seek→读回纯性、`.from`/stagger、越界 part 恒等不抛错（fake gsap 单测）。
- [x] 上屏渲染：逐字掉落起始隐藏 / 中途交错 / 结束到位（`pnpm verify:text-anim`）。
- [x] 文档：[`docs/text-animation.md`](../docs/text-animation.md) + 架构表 + 本文件。

## 备注

- 引擎 `package.json` **不含 gsap**；消费方注入自己的 gsap 实例。
- 拆分文字不自动折行；用基准字号排版，拆分模式下用动画器 `scaleX/scaleY` 动画字号。
