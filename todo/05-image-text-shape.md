# 05 · Image / Text / Shape clips

**状态**: ⬜ Todo
**依赖**: 04

## 目标
补齐非视频的视觉 clip：`ImageSource` 解码、`TextClip`、`ShapeClip`。

## 范围
- `ImageSource.load`：`src` → `ImageBitmap` → `Texture`，metadata（duration=Infinity）。
- `TextClip.mount`：依据 `TextStyleLike` 构建 `PIXI.Text`；样式可动画（字号/颜色）。
- `ShapeClip.mount`：`PIXI.Graphics` 矩形/椭圆/路径。
- 三者复用 `VisualClip.applyCommon`（transform / opacity / blend / effects）。

## 验收标准
- 图片/文字/形状 clip 能上屏、可变换、可设不透明度与 blendMode。
- `unmount` / `dispose` 释放底层 pixi 对象，无泄漏。
