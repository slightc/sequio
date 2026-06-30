# 06 · AudioEngine 音画同步

**状态**: ⬜ Todo
**依赖**: 02

## 目标
实现 `AudioEngine`：按时间线精确排程音频，处理变速/淡变/增益自动化，并支持离线导出渲染。

## 范围
- `AudioSource.load`：用 Mediabunny `Input` 读容器、`AudioBufferSink.getBuffer(t)`
  直接拿到 Web Audio 的 `AudioBuffer`（替代手接 `decodeAudioData`），填充 metadata。
- `schedule(clip, source)`：用 Web Audio 在正确时间起播；处理 `speed`（time remap）、
  `gain` 自动化、`fadeIn` / `fadeOut`。
- `seek` / `play` / `pause`：与时钟对齐，保证音画同步。
- `renderOffline(duration)`：`OfflineAudioContext` 渲染整轨混音供导出。

## 验收标准
- 预览时音画同步漂移在可接受范围内。
- 变速 clip 的音高/时长处理正确。
- `renderOffline` 输出的 buffer 与预览混音一致（contract #3）。
