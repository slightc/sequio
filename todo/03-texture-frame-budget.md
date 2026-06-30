# 03 · TextureManager + FrameCache 预算

**状态**: ⬜ Todo
**依赖**: 02

## 目标
钉死资源预算（contract #4）。多路高分辨率视频极易爆显存/内存，这是稳定性命门。
**这步不做，多路一定崩。**

## 范围
- `TextureManager.upload(VideoFrame)`：`VideoFrame` → PixiJS `Texture`，按字节计预算，
  超预算时 `evictLRU`。
- 解码侧 `FrameCache`（已实现 LRU/环形）与显存侧 `TextureManager` 预算联动。
- 给 `Compositor` 暴露预算配置（显存字节数、缓存帧数）。
- 上传/回收的 key 策略：`sourceId + frameIdx`。

## 验收标准
- 多路 4K 同时播放，显存占用稳定在预算内，不持续增长。
- LRU 回收命中率合理；压测下无 `Texture` / `VideoFrame` 泄漏。
- `usage()` 报告的 used/budget 与实际一致。
