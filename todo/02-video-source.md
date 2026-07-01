# 02 · VideoSource（WebCodecs 解码）

**状态**: ✅ Done
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
  ✅ `MediabunnyVideoDecoder.load` 读 `displayWidth/Height`、`computeDuration`、
  `computePacketStats().averagePacketRate`；`tests/video-source.test.ts` 验 metadata 透传。
- 顺序播放无明显丢帧；反向 seek 能在合理延迟内出帧。
  ✅ 方向预读（`lookahead`）+ in-flight 去重已实现并单测；真实流畅度由 `example/` 手验。
- 解码器与 `VideoFrame` 在 `dispose()` 后全部关闭，无 leak（contract #4）。
  ✅ `FrameCache.onEvict` 把 `Texture` 销毁绑定到帧关闭；`dispose` 关帧 + 销纹理 +
  `backend.dispose`，均有单测。

## 实现 / 验证
- 解码藏在 `VideoDecoderBackend` 接口后，默认 `MediabunnyVideoDecoder`
  （动态 `import('mediabunny')`：`Input` + `VideoSampleSink`）。`VideoSource` 负责
  缓存 / 预读 / 纹理生命周期。
- 单测 `tests/video-source.test.ts`（fake backend）：metadata 透传、CFR keying、
  prepare/getTextureAt 同异步分离、方向预读翻转、去重、预算淘汰、dispose。
- 真实 WebCodecs 解码：`pnpm verify:decode`（Puppeteer + Chrome-for-Testing，含
  WebCodecs）自动验证 —— `example/decode-test.*` 在浏览器里 MediaRecorder 录一段真 WebM，
  再经 `VideoSource` 解回、`applyCover` 铺进异比例 stage 渲染，并断言（metadata / 三处取帧
  命中 / 四角+中心均被覆盖无黑边 / 预读缓存）。也可 `example/`「Load video」手验（`applyCover`
  让视频 object-fit:cover 铺满画布）。
  注：Playwright 自带的精简 Chromium 不带 WebCodecs，故改用 Puppeteer 的
  Chrome-for-Testing；首次需 `pnpm exec puppeteer browsers install chrome`。

## 关键契约
- `prepare` 异步、`getTextureAt` 同步，二者严格分离（contract #1）。
