# 06 · AudioEngine 音画同步

**状态**: ✅ Done
**依赖**: 02

## 目标
实现 `AudioEngine`：按时间线精确排程音频，处理变速/淡变/增益自动化，并支持离线导出渲染。

## 范围
- `AudioSource.load`：Mediabunny `Input` + `AudioBufferSink.buffers()` 解码并拼成一个
  `AudioBuffer`，填充 metadata（duration / hasAudio）。
- `schedule(clip, source)` 注册；`play/pause/seek(playhead)` 用 Web Audio 建
  `BufferSource → Gain → destination`，`src.start(when, offset, duration)`。
- 纯排程核心 `src/audio/scheduling.ts`：`clipPlaybackAt`（speed→playbackRate、offset/duration
  重映射）、`gainEventsAt`（gain 自动化 + fadeIn/fadeOut → 增益事件）。
- `renderOffline(duration)`：`OfflineAudioContext` 建同一套图渲染整轨混音。

## 验收标准
- 预览时音画同步漂移在可接受范围内。
  ✅ Web Audio 采样级排程；`play/seek(playhead)` 由上层与视觉时钟同时驱动。
- 变速 clip 的音高/时长处理正确。
  ✅ `speed → playbackRate`（变调变速），offset/duration 按 speed 重映射；单测覆盖。
- `renderOffline` 输出的 buffer 与预览混音一致（contract #3）。
  ✅ 预览与导出共用 `clipPlaybackAt`/`gainEventsAt`;e2e 断言离线混音 `midRms≈0.5×0.707`、
  fade 段更弱。

## 验证
- 单测 `tests/audio-scheduling.test.ts`（9）+ `tests/audio-engine.test.ts`（6，假 context）。
- e2e `pnpm verify:audio`：真实 `OfflineAudioContext` 渲染带 fade+gain 的正弦并断言样本;
  MediaRecorder 录 Opus → `AudioSource.load` 解回（decode.ok）。

## 备注
- 长音频目前一次性全解码成一个 `AudioBuffer`（流式/分块解码为后续细化）。
- `gain` 自动化按固定步长采样成事件（AnimatableProperty 不暴露关键帧时刻）。
