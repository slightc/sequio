# 09 · GroupClip 子合成（嵌套分组）

**状态**: ✅ Done
**依赖**: 01

## 目标
提供 `GroupClip`：一个本身是 `VisualClip` 的容器，可把一组子 clip 当整体来变换，
位置/时间相对容器，容器整体提供 transform / opacity / blendMode / filter(effect) /
animation，并可任意嵌套。

## 范围
- `GroupClip extends VisualClip`，持 `children: VisualClip[]` + `add` / `remove`。
- 子 clip mount 进 group 的 PixiJS `Container`，原生继承 group 的变换/透明度/混合/滤镜链。
- 时间按偏移相对：`localTime(t) = t - start`；子 clip 在 `lt` 上判活与求值，group
  自身动画在主时间线 `t` 上求值。
- 递归：`GroupClip` 内部持一个 `Reconciler`，`Reconciler.reconcileClips(active, t, stage)`
  作为轨道层 / 分组层共用的扁平 diff 入口；嵌套 group 偏移逐层叠加。
- 公开 `GroupClip`（`src/index.ts`）。

## 不做
- group 的 `end` 自动按子 clip 总时长推导（后续配合 duration API，见备注）。
- 子 clip 在 group 内的独立 zIndex（当前用数组顺序）。
- effect/filter 的实际 GPU attach 生命周期（见 07；当前与其它 clip 一致，仅 `updateAt`）。

## 验收标准
- 子 clip 挂到 group container 而非 stage，随 group 局部时间挂载/卸载。
  ✅ `tests/group-clip.test.ts`
- 时间相对 group（offset 模型），嵌套偏移叠加。✅
- group 失活时子树整体卸载。✅
- group 的 transform/opacity 写到 container（子树继承）。✅
- `render(t)` 幂等：同一 t 重复 reconcile 复用子树。✅

## 备注
- 与「根据 clip 总时长更新 duration」联动：后续可加 `GroupClip.contentEnd`
  （= 子 clip 最大 end）与 `Compositor.duration`，再驱动 `Clock.duration`。
