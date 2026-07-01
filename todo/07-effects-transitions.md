# 07 · Effects + EffectRegistry + Transition

**状态**: 🚧 In progress（core 落地：调色 + 模糊 + crossfade；chroma/LUT/wipe 为后续）
**依赖**: 04

## 目标
落地特效与转场：内置常用 `Effect`，动画参数写 uniform；`Transition` 双路纹理混合。

## 范围
- 内置 `Effect`：调色（亮度/对比度/饱和度）、模糊、抠像（chroma key）、LUT、变换。
  每个封装一个 `PIXI.Filter`（GLSL/WGSL），`updateAt(t)` 把动画参数写入 uniform。
- 启动时把内置类型注册进 `EffectRegistry`。
- `Transition` 子类（crossfade / wipe）：`render(from, to, progress)` → `RenderTexture`。

## 验收标准
- 注册的内置效果可 `create(type)` 并 attach 到 clip/track，参数可动画。
- crossfade 在两 clip 重叠区间按 `durationFrames` 平滑过渡。
- 滤镜参数在预览与导出一致（contract #3）。

## 进展（本次落地）

已实现 —— 覆盖上面前两条验收 + contract #3 的核心路径：

- **`Effect` 基类**：包一个 `PIXI.Filter`，参数是 `AnimatableProperty`。**Filter 惰性创建**
  （首次 `attach` 时 `createFilter()`），所以 Effect 可以在无 GPU/DOM 的环境里构造并做
  参数动画——这也是它能在 headless 单测里被测的原因。`attach/detach` 维护目标的
  `filters` 链，`updateAt(t)` 把 `t` 时刻的值写进 filter。
- **内置 `ColorEffect`**（`ColorMatrixFilter`，亮度/对比度/饱和度，各 `1`=不变）与
  **`BlurEffect`**（`BlurFilter`，`strength` 可动画）。两者都暴露纯函数
  `valuesAt(t)`，与写 filter 分离，便于单测。
- **`registerBuiltins(registry)`**：把 `color` / `blur` 注册进 `EffectRegistry`，按类型幂等。
- **clip 级特效接线**：`VisualClip.applyCommon` 里的 `syncEffects(obj,t)` 把新加的 effect
  attach 一次、每帧 `updateAt`、移除的 detach；`obj` 换新（re-mount）时重新 attach。
- **`CrossfadeTransition`**：`render(renderer, from, to, progress)` 把 `from` 铺满、
  `to` 以 `alpha=progress` 叠加 → `RenderTexture`（由 transition 复用/持有）。纯函数
  `crossfadeAlpha(progress)` 做 clamp，可单测。

测试 —— `tests/effects.test.ts`（纯逻辑）+ `pnpm verify:effects`（Puppeteer e2e）：
e2e 用 `ColorEffect` 压暗白块、`BlurEffect` 让红块边缘外溢、`CrossfadeTransition`
把红→蓝在 `progress=0.5` 混成 `(128,0,127)` 紫色，均在真实 WebGL 上校验。

交互 demo —— `pnpm dev` 后打开 `/example/effects-demo.html`：左面板一个 clip 带
`ColorEffect`+`BlurEffect`，拖 slider 实时改亮度/对比度/饱和度/模糊（每次改动重绘一帧，
契约 #5），勾 “Animate” 则把参数关键帧化、由渲染时钟扫 `updateAt(t)`；右面板一个
`CrossfadeTransition` 把 A→B 混合，可拖 progress 或 Play 做 0→1→0 往返。

## 待办（后续里程碑内补齐）

- 内置 `ChromaKeyEffect` / `LUTEffect` / `TransformEffect`（同 `Effect` + 惰性
  `createFilter` 模式；chroma/LUT 需自定义 `GlProgram`/`GpuProgram`）。
- `WipeTransition` 及其它转场；把 `Transition` 接进 Compositor，让相邻 clip 在重叠区间
  按 `durationFrames` 自动过渡（当前 `Transition` 是可独立调用的构件，尚未由 Compositor 驱动）。
- filter 的 WGSL 变体（WebGPU 路径）。
