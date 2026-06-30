# 01 · 渲染核心骨架：单路视频 play / seek 上屏

**状态**: ✅ Done
**依赖**: 00

## 目标
把 PixiJS 渲染核心接进 `Compositor`，让「单路 `VideoClip` 能 play / seek 上屏」走通。
这是验证核心契约 #1（异步 prepare / 同步 render 分离）的最小闭环。

## 范围
- `Compositor` 同步构造对象图/reconciler/canvas；`init()` 异步建 `Renderer`
  （WebGPU→WebGL 兜底，`autoDetectRenderer`），root stage 为 `Container`，
  canvas 暴露为 `view`。
- 实现 `renderSync(t)`：调用 `Reconciler.reconcile(tracks, t, stage)` 后
  `renderer.render({ container: stage })`。
- 实现 `renderToTexture(t)`：渲染到离屏 `RenderTexture`（未 `init()` 时抛错）。
- `renderPreview(t)`：fire-and-forget `prepare(t)` + 立即 `renderSync(t)`。
- 接通 `RealtimeClock.onTick → renderPreview` 的最小 example。

## 不做
- 真正的 WebCodecs 解码（见 02，本里程碑可用 `ImageSource` 或测试纹理占位）。
- 多轨混合细节（见 04）。

## 验收标准
- 一个 `example/` 页面：加载一张图/测试纹理，play 时画面随时钟更新，seek 能跳帧。
  ✅ `example/`（`pnpm dev`）—— 占位渐变纹理随时钟平移/旋转，play/pause/scrub 可用，
  到 `duration` 自动停；已用 Chromium 实跑截图验证。
- `Compositor.dispose()` 释放 renderer、清空 reconciler，无 GPU 资源泄漏。
  ✅ `dispose()` 调 `reconciler.clear` → `clip.unmount`、`renderer.destroy()`、
  `stage.destroy()`，并清空 tracks。
- `render(t)` 对同一对象图 + 同一 t 幂等（contract #2）。
  ✅ `tests/compositor.test.ts`：同一 t 重复 `renderSync` 只 mount 一次、显示树稳定。

## 验证
- 单测：`tests/compositor.test.ts`（Reconciler mount/unmount/z-order/幂等 +
  Compositor 委派/守卫/dispose）、`tests/clock.test.ts`（play/pause/seek/ended）。
- 手动：`example/` 在浏览器跑通，rAF 时钟驱动 renderPreview 上屏。
- GPU 绘制路径（WebGL/WebGPU）不在 headless 单测内，由 `example/` 覆盖。
