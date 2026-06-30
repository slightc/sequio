# 02 · VideoSource（WebCodecs 解码）

**状态**: ⬜ Todo
**依赖**: 01

## 目标
实现 `VideoSource`：解封装 + 硬解 + 帧缓存 + 方向预读，支撑 `prepare` / `getTextureAt`。

## 范围
- Demux：`mp4box.js` 解析容器、读取 track 配置与关键帧表，填充 `SourceMetadata`。
- Decode：`WebCodecs VideoDecoder`，`prepare(sourceTime)` 找最近关键帧 → 解码到目标帧
  → 入 `FrameCache`；按播放方向 lookahead 预读。
- `getTextureAt(sourceTime)`：同步读 cache，命中返回纹理，miss 返回 `null`
  （预览复用上一帧）。
- `ffmpeg.wasm` 兜底解码路径（WebCodecs 不支持的编码）。

## 验收标准
- `await source.load()` 返回正确 width/height/duration/fps。
- 顺序播放无明显丢帧；反向 seek 能在合理延迟内出帧。
- 解码器与 `VideoFrame` 在 `dispose()` 后全部关闭，无 leak（contract #4）。

## 关键契约
- `prepare` 异步、`getTextureAt` 同步，二者严格分离（contract #1）。
