# 04 · Reconciler + 多轨叠层 + Transform

**状态**: ✅ Done
**依赖**: 01, 03

## 目标
多 `Track` 按 `zIndex` 叠层，`Reconciler` 增量 diff 活动 clip 到显示树，应用
`Transform2D` / `opacity` / `blendMode`。

## 范围
- 强化 `Reconciler.reconcile`：每帧用 `setChildIndex` 重申 z 序（容器与 clip），
  对象跨帧复用、增量增删。
- `Transform2D.applyTo` 的 anchor 语义：归一化 anchor → 按 `getLocalBounds()` 映射到 pivot。
- `VisualTrack` ↔ `PIXI.Container` 映射；轨道级 `effects`（调整层）挂到该 container，
  作用于该轨道全部内容。

## 验收标准
- 两条以上 `VisualTrack` 正确叠层，blendMode / opacity 生效。
  ✅ e2e `pnpm verify:render`：红底 + 蓝顶 0.5 opacity → 中心 `(128,0,127)` 紫（叠层+透明度）；
  蓝顶 `blendMode:'add'` → `(255,0,255)` 品红（blendMode 生效）。
- 频繁 seek 时每帧分配接近 0（对象复用）。
  ✅ mount/unmount 复用 pixi 对象（无每帧 new Sprite/Container）；单测验幂等复用。
- 启用/禁用轨道、移动 zIndex 立即反映在画面。
  ✅ 单测：disable→卸载容器、enable→重挂；改 zIndex→容器重排；低层 clip 后激活仍落正确层级。

## 验证
- 单测 `tests/compositor.test.ts`（Reconciler：每轨容器、z 序稳定、enable/disable、
  zIndex 重排、轨道 effects attach/detach/update）+ `tests/transform2d.test.ts`（anchor→pivot 映射）。
- e2e `pnpm verify:render`（多轨叠层 + opacity + blendMode 真实像素）。

## 备注
- `GroupClip.update` 现在先 reconcile 子级再 `applyCommon`，使 group 的 anchor 依据当前子树 bounds。
