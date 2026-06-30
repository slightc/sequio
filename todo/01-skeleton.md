# 01 · 渲染核心骨架：单路视频 play / seek 上屏

**状态**: 🚧 In progress
**依赖**: 00

## 目标
把 PixiJS 渲染核心接进 `Compositor`，让「单路 `VideoClip` 能 play / seek 上屏」走通。
这是验证核心契约 #1（异步 prepare / 同步 render 分离）的最小闭环。

## 范围
- `Compositor` 构造时创建 `PIXI.Application` / `Renderer`（WebGPU→WebGL 兜底），
  建立 root stage `Container`，把 canvas 暴露为 `view`。
- 实现 `renderSync(t)`：调用 `Reconciler.reconcile(tracks, t, stage)` 后
  `renderer.render(stage)`。
- 实现 `renderToTexture(t)`：渲染到离屏 `RenderTexture`。
- `renderPreview(t)`：fire-and-forget `prepare(t)` + 立即 `renderSync(t)`。
- 接通 `RealtimeClock.onTick → renderPreview` 的最小 example。

## 不做
- 真正的 WebCodecs 解码（见 02，本里程碑可用 `ImageSource` 或测试纹理占位）。
- 多轨混合细节（见 04）。

## 验收标准
- 一个 `example/` 页面：加载一张图/测试纹理，play 时画面随时钟更新，seek 能跳帧。
- `Compositor.dispose()` 释放 renderer、清空 reconciler，无 GPU 资源泄漏。
- `render(t)` 对同一对象图 + 同一 t 幂等（contract #2）。

## 备注
当前 `Compositor.renderSync / renderToTexture` 为 `throw not implemented`，
本里程碑落地后删除这些 throw。
