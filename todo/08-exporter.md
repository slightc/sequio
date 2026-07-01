# 08 · Exporter（FixedStep + 编码封装）

**状态**: ⬜ Todo
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
- 导出结果与预览逐帧一致（golden-frame 对比）。
- `range` 局部导出正确；`cancel()` 能及时中止并释放编码器。
- 长视频导出内存稳定（帧/纹理预算生效）。

## 关键契约
- 导出路径必须 `await prepare`，绝不丢帧；与预览共用渲染核心（contract #1 / #3）。
