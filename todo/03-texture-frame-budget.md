# 03 · TextureManager + FrameCache 预算

**状态**: ✅ Done
**依赖**: 02

## 目标
钉死资源预算（contract #4）。多路高分辨率视频极易爆显存/内存，这是稳定性命门。
**这步不做，多路一定崩。**

## 范围
- `TextureManager.acquireOrUpload(key, image)`：image → PixiJS `Texture`，按字节计预算，
  超预算时 `evictLRU`（永不淘汰刚上传的那张）。
- 解码侧 `FrameCache`（LRU/环形）与显存侧 `TextureManager` 预算联动：帧被淘汰经
  `onEvict` → `release` 掉纹理；纹理可独立于帧被显存压力淘汰（下次重传）。
- `Compositor` 暴露预算配置（`textureBudgetBytes`）+ 共享 `TextureManager`（`compositor.textures`），
  `prepare` 时把各 `VideoSource` 收编到共享池，多轨共用一份 VRAM 预算。
- 上传/回收 key 策略：`sourceId:frameIdx`（`VideoSource` 内部生成 `sourceId`）。

## 验收标准
- 多路 4K 同时播放，显存占用稳定在预算内，不持续增长。
  ✅ 字节预算 + LRU 淘汰单测（`tests/texture-manager.test.ts`：超预算淘汰、保刚上传、
  缩预算即回收）；共享池由 `Compositor.prepare` 收编，多源共用一份预算。
- LRU 回收命中率合理；压测下无 `Texture` / `VideoFrame` 泄漏。
  ✅ `FrameCache.onEvict → TextureManager.release`、`dispose` 全销毁均有单测；
  `VideoSource` 只在自己拥有默认池时才 dispose 它（共享池归 Compositor）。
- `usage()` 报告的 used/budget 与实际一致。
  ✅ 单测断言 `usage.usedBytes` 随 register/release/overwrite/setBudget 变化；
  e2e `pnpm verify:decode` 报告真实上传后 `usedBytes>0 且 ≤ budget`。

## 验证
- 单测：`tests/texture-manager.test.ts`（8）+ `tests/video-source.test.ts`（收编/释放/不销毁共享池）
  + `tests/compositor.test.ts`（预算配置、prepare 收编源）。
- e2e：`pnpm verify:decode` 真实解码后 `compositor.textures` count>0、usedBytes 在预算内。
