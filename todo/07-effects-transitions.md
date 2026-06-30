# 07 · Effects + EffectRegistry + Transition

**状态**: ⬜ Todo
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
