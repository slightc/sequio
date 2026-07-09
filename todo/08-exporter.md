# 08 · Exporter（FixedStep + 编码封装）

**状态**: ✅ Done（核心落地:定步循环 + `await prepare` 不丢帧 + Mediabunny 封装 MP4/WebM;音画一起导出 e2e;单帧图片导出 `exportFrame` + 单独音频导出 `exportAudio`；golden-frame 全帧对比为后续）
**依赖**: 01, 02, 03, 06

## 目标
实现 `Exporter`：复用同一 Compositor 渲染核心，换成 `FixedStepClock` 逐帧确定性导出，
绝不丢帧（contract #1 + #3）。

## 范围
- 循环前一次性等齐字体：`await fonts.ready()`（TextClip 用真字体，绝不中途换）。
- 逐帧循环：`for t`：`await compositor.prepare(t)`（等齐）→ `renderToTexture(t)`
  → readback 成 `VideoFrame` → Mediabunny 视频编码（封装 WebCodecs `VideoEncoder`）。
- 音频：`audio.renderOffline(duration)` → 编码 → Mediabunny `Output` 封装。
- 封装：Mediabunny `Output` + `Mp4OutputFormat`（fast-start / fragmented）/
  `WebMOutputFormat`，取代 `mp4-muxer` / `webm-muxer`。
- `ExportOptions`（分辨率/fps/codec/bitrate/range）、`onProgress`、`cancel()`。
- 单帧导出：`exportFrame(time, options?)` 把指定时刻渲染成图片 `Blob`（PNG/JPEG/WebP）。
- 单独导出音频：`exportAudio(options?)` 只把 `AudioEngine` 离线混音封装成音频 `Blob`
  （m4a/mp3/wav/ogg/webm，不渲染帧、不需 GPU）。

## 验收标准
- 导出结果与预览逐帧一致（golden-frame 对比）。🟡 共用同一 `renderSync` 渲染核心(契约 #3),
  e2e 已断言解回的帧确实是预期色(红);逐帧全画面 diff 的 golden 工具为后续。
- `range` 局部导出正确;`cancel()` 能及时中止并释放编码器。✅（range 单测 + e2e;`cancel` 单测:
  抛 `ExportCancelledError`、`sink.cancel()`、不 finalize）
- 长视频导出内存稳定（帧/纹理预算生效）。🟡 结构上成立(每帧 await 编码器背压、复用单个 `view`
  画布、沿用 03 的帧/纹理预算),未做长视频压测。

## 关键契约
- 导出路径必须 `await prepare`，绝不丢帧；与预览共用渲染核心（contract #1 / #3）。✅

## 落地说明

- **`exportFrameTimes(range, fps)`**（纯、可单测）算逐帧时刻;循环 `await prepare(t)` →
  `renderSync(t)`（画到共享 `view`）→ `sink.addFrame`。定步/确定性等价于 `FixedStepClock`,
  但用纯函数表达便于测试。
- **`ExportSink` seam**:默认 `MediabunnyExportSink`（`CanvasSource` 抓 `view` 画布免手动
  readback + `AudioBufferSource` + `Output`(MP4/WebM) + `BufferTarget`,动态 import）。
- **`ExportOptions`**:`fps`/`container`/`videoCodec`/`bitrate`/`audio`/`audioCodec`/
  `audioBitrate`/`range`;`onProgress`、`cancel()`/`ExportCancelledError`。
- **`exportFrame(time, options?)`**:单帧静态画面导出——`await fonts.ready()` →
  `await prepare(time)`（绝不抓半解码帧）→ `renderSync(time)` → 把 `view` 画布编码成图片
  `Blob`。`ExportFrameOptions`:`type`（'image/png' 默认 | 'image/jpeg' | 'image/webp'）/
  `quality`（有损,默认 0.92）。编码 = `encodeFrame` seam（`convertToBlob`/`toBlob`,测试可注入）。
  `time` 不必落在 fps 帧边界。
- **`exportAudio(options?)`**:单独导出音频——只 `audio.renderOffline(duration)` 拿离线混音,
  经 `AudioExportSink` seam（默认 `MediabunnyAudioExportSink`:单音轨、无视频轨的 `Output` +
  `AudioBufferSource` + `BufferTarget`）封装成音频 `Blob`。不渲染帧、不走定步循环、不需 GPU。
  `AudioExportOptions`:`format`（'m4a' 默认 | 'mp3' | 'wav' | 'ogg' | 'webm'）/ `codec`（各格式
  默认 aac/mp3/pcm-s16/opus）/ `bitrate`（默认 128k,wav 忽略）/ `range` / `sampleRate`。CLI
  `sequio audio <file>` 走 Route B 的 `exportBundleAudioToFile` 复用它。
- 测试:`tests/exporter.test.ts` + `pnpm verify:export`(真实导出→Mediabunny 解回:①视频-only
  帧数 8、尺寸 160×120、帧是红色;②音+画到 WebM,解回断言视频轨 + 音频轨都在)。`exportAudio`:
  单测断言 start→离线混音→addAudio→finalize 顺序/默认格式/编码器推导/透传/失败清理;`pnpm verify:cli`
  的 `audio` 步骤真实导出 m4a 并校验 `ftyp`。
- 交互 demo:`pnpm dev` 后打开 `/example/export-demo.html`——并入了 av-player:一个时钟同时驱动
  画面与 `AudioEngine`(音画一起播),默认 4 音符旋律 + 同步跳动的 marker,或加载视频文件;点
  **Export** 把当前场景的**视频 + 音频**带进度条导出成真实 MP4/WebM,结果内联播放并可下载
  (预览与导出共用同一渲染核心)。

## 待办（后续补齐）

- golden-frame 全画面逐帧 diff 工具（预览 vs 导出）。
- 长视频压测(内存/背压)。
