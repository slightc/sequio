# Backlog — 杂项与待定

未排期的想法、小任务、技术债。攒够一组、依赖清晰后升级成里程碑文件。

- [x] `example/` playground 页面（`pnpm dev` 起 vite，单路 clip play/pause/seek）。✅ 里程碑 01
- [ ] golden-frame 测试基建：固定对象图 + FixedStepClock → 像素哈希比对。
- [ ] `colorSpace: 'display-p3'` 色彩管线对齐（sRGB↔linear、预乘 alpha）。
- [ ] WebGPU / WebGL 后端能力探测与降级策略。
- [ ] 可选 `ffmpeg.wasm` 兜底适配器：WebCodecs（经 Mediabunny）不支持的冷门编码软解/软封装。
      默认不内置——主链路只承诺 WebCodecs 覆盖的主流编码。
- [ ] `AnimatableProperty` 增加 spring 插值。
- [ ] 解码 worker 化（OffscreenCanvas + worker 内 VideoDecoder）。
- [ ] 重新开启 `noUnusedLocals` / `noUnusedParameters`（stub 填完后）。
- [ ] benchmark：多路 4K 同放的显存/CPU 占用基线。
