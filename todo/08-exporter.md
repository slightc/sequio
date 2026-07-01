# 08 · Exporter（FixedStep + 编码封装）

**状态**: ✅ Done（核心落地:定步循环 + `await prepare` 不丢帧 + Mediabunny 封装 MP4/WebM;音画一起导出 e2e + golden-frame 全帧对比为后续）
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
- 测试:`tests/exporter.test.ts` + `pnpm verify:export`(真实导出→Mediabunny 解回:帧数 8、
  尺寸 160×120、解出的帧是红色)。

## 待办（后续补齐）

- 音画一起导出的 e2e（当前 e2e 走 `audio:false`;音频 `addAudio` 已实现并单测,但未 e2e 解回验证）。
- golden-frame 全画面逐帧 diff 工具（预览 vs 导出）。
- 长视频压测(内存/背压)。
