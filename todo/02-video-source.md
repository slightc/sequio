# 02 · VideoSource（WebCodecs 解码）

**状态**: ⬜ Todo
**依赖**: 01

## 目标
实现 `VideoSource`：解封装 + 硬解 + 帧缓存 + 方向预读，支撑 `prepare` / `getTextureAt`。

## 范围
- Demux + Decode：用 [Mediabunny](https://mediabunny.dev) `Input` 解析容器、读 track 配置
  填充 `SourceMetadata`；`VideoSampleSink.getSample(sourceTime)` 取「≤该时间戳最近一帧」
  （内部封装 WebCodecs 硬解、自动找关键帧）。`prepare(sourceTime)` 异步解码目标帧入
  `FrameCache`；用 `samples()` 迭代器做按播放方向的 lookahead 预读。
- `getTextureAt(sourceTime)`：同步读 cache，命中返回纹理，miss 返回 `null`
  （预览复用上一帧）。Mediabunny 的 `getSample` 是异步的，同步层仍由 `FrameCache` 兜。
- 取代原 `mp4box.js` + 手接 `VideoDecoder` 组合。无纯软件兜底；WebCodecs 不支持的
  冷门编码暂不承诺（可选 `ffmpeg.wasm` 兜底见 backlog）。

## 验收标准
- `await source.load()` 返回正确 width/height/duration/fps。
- 顺序播放无明显丢帧；反向 seek 能在合理延迟内出帧。
- 解码器与 `VideoFrame` 在 `dispose()` 后全部关闭，无 leak（contract #4）。

## 关键契约
- `prepare` 异步、`getTextureAt` 同步，二者严格分离（contract #1）。
