# 04 · Reconciler + 多轨叠层 + Transform

**状态**: ⬜ Todo
**依赖**: 01, 03

## 目标
多 `Track` 按 `zIndex` 叠层，`Reconciler` 增量 diff 活动 clip 到显示树，应用
`Transform2D` / `opacity` / `blendMode`。

## 范围
- 校验/强化 `Reconciler.reconcile`：复用对象、增量增删、保持 z 序稳定。
- `Transform2D.applyTo` 的 anchor 语义：归一化 anchor → 依据内容尺寸映射到 pivot。
- 轨道级 `effects`（调整层）作用于该轨道下所有内容。
- `VisualTrack` ↔ `PIXI.Container` 映射。

## 验收标准
- 两条以上 `VisualTrack` 正确叠层，blendMode / opacity 生效。
- 频繁 seek 时每帧分配接近 0（对象复用）。
- 启用/禁用轨道、移动 zIndex 立即反映在画面。
