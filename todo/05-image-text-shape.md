# 05 · Image / Text / Shape clips

**状态**: ✅ Done
**依赖**: 04

## 目标
补齐非视频的视觉 clip：`ImageSource` 解码、`TextClip`、`ShapeClip`。

## 范围
- `ImageSource.load`：`src`（URL / Blob / ImageBitmap）→ `ImageBitmap` → `Texture`，
  metadata（width/height，duration=Infinity）。
- `TextClip.mount`：依据 `TextStyleLike` 构建 `PIXI.Text`；`fontSize` 用
  `AnimatableProperty` 可动画（`text`/`fontFamily`/`fill` 为可设字段，仅变化时才 relayout）。
- `ShapeClip.mount`：`PIXI.Graphics` 矩形 / 圆角矩形 / 椭圆（可选 stroke）。路径待后续。
- 三者复用 `VisualClip.applyCommon`（transform / opacity / blend / effects）。

## 验收标准
- 图片/文字/形状 clip 能上屏、可变换、可设不透明度与 blendMode。
  ✅ e2e `pnpm verify:clips`：红矩形 `(255,0,0)` + 绿椭圆 `(0,255,0)` + 品红图片 `(255,0,255)`
  + 白色 “Hi” 文字均在预期位置渲染;各 clip 走 `applyCommon`（anchor 居中、position 变换）。
- `unmount` / `dispose` 释放底层 pixi 对象，无泄漏。
  ✅ `unmount` 各自 `destroy()` 并置空;`ImageSource.dispose` 销毁纹理。单测覆盖。

## 验证
- 单测 `tests/clips.test.ts`：ShapeClip 尺寸/anchor/变换/unmount、TextClip 构建/fontSize
  关键帧动画/文本更新、ImageSource 未 load 行为。（Text 度量需 canvas，headless 下对
  `getLocalBounds` 打桩。）
- e2e `pnpm verify:clips`（四类 clip 真实上屏采样）。

## 备注
- 颜色（`fill`）逐通道关键帧插值待后续（当前 `fill` 为可设字段，`fontSize` 已可动画）。
- 形状 `path` 待后续（当前支持 rect / rounded-rect / ellipse）。
- **字体加载**：新增全局 `FontManager`（默认 `fonts`）——`await fonts.load({family, src})`
  用 `FontFace` API 注册进 `document.fonts`，去重；`fonts.ready()` 等齐。字体必须在渲染前
  一次性加载（契约 #1/#2，不能中途换字体）。单测 `tests/font-manager.test.ts`。
