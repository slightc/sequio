# 07 · Effects + EffectRegistry + Transition

**状态**: 🚧 In progress（core 落地：调色 + 模糊 + warp[bulge/perspective/displacement] + crossfade；chroma/LUT/wipe 为后续）
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
- **Warp 效果（透视/扭曲/畸变）**——`Transform2D` 只做仿射，warp 处理仿射做不到的几何形变，
  自写 `GlProgram` 着色器采样源纹理；作用范围是 clip 包围盒（整帧 warp 需 clip 铺满帧）：
  - **`PerspectiveEffect`**：四角映射，纯函数 `squareToQuad`（Heckbert）+ `invert3x3` +
    `perspectiveSampleMatrix`（列主序）求 dest→source 单应，着色器透视除法采样，四边形外透明。
  - **`BulgeEffect`**：径向凸起/挤压，纯函数 `bulgeSourceUv` 是着色器的 CPU 参照。
  - **`DisplacementEffect`**：封装内置 `DisplacementFilter`，位移贴图驱动，`strength` 可动画。
- **`registerBuiltins(registry)`**：把 `color` / `blur` / `bulge` / `perspective` /
  `displacement` 注册进 `EffectRegistry`，按类型幂等。
- **三级作用域**（同一套 attach/update/detach，区别在挂到哪个 `Container`）：clip 级
  `clip.effects`（`VisualClip.syncEffects`，re-mount 时重挂）、轨道级 `track.effects`
  （`Reconciler.syncTrackEffects`）、全局 `compositor.effects`（`Compositor.syncStageEffects`，
  挂 root stage → 影响整帧合成，预览/导出一致）。
- **`CrossfadeTransition`**：`render(renderer, from, to, progress)` 把 `from` 铺满、
  `to` 以 `alpha=progress` 叠加 → `RenderTexture`（由 transition 复用/持有）。纯函数
  `crossfadeAlpha(progress)` 做 clamp，可单测。

测试 —— `tests/effects.test.ts` + `tests/effects-warp.test.ts`（纯逻辑：单应恒等/角点/
`M·M⁻¹=I`/列主序、bulge 放大与挤压、各 `valuesAt`/`matrixAt`、注册五内置）+
`pnpm verify:effects`（Puppeteer e2e）：e2e 用 `ColorEffect` 压暗白块、`BlurEffect` 让红块
边缘外溢、`CrossfadeTransition` 把红→蓝在 `progress=0.5` 混成 `(128,0,127)`；warp 段用
bulge 把圆盘外黑点放大成白、perspective 把整帧白矩形顶角切透明而中心保持、displacement
让红蓝分界位移——均在真实 WebGL 上校验。

交互 demo —— `pnpm dev` 后打开 `/example/effects-demo.html`：左面板一个 clip 带
`ColorEffect`+`BlurEffect`，拖 slider 实时改亮度/对比度/饱和度/模糊（每次改动重绘一帧，
契约 #5），勾 “Animate” 则把参数关键帧化、由渲染时钟扫 `updateAt(t)`；右面板一个
`CrossfadeTransition` 把 A→B 混合，可拖 progress 或 Play 做 0→1→0 往返。

## 待办（后续里程碑内补齐）

- 内置 `ChromaKeyEffect` / `LUTEffect`（同 `Effect` + 惰性 `createFilter` 模式；需自定义
  采样 `GlProgram` / 贴图）。
- warp 的向外 corner-pin（padding，让 perspective 能把内容拉出原 bounds）。
- `WipeTransition` 及其它转场；把 `Transition` 接进 Compositor，让相邻 clip 在重叠区间
  按 `durationFrames` 自动过渡（当前 `Transition` 是可独立调用的构件，尚未由 Compositor 驱动）。
- filter 的 WGSL 变体（WebGPU 路径；当前 warp 着色器仅 GL）。
