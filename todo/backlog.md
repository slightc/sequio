# Backlog — 杂项与待定

未排期的想法、小任务、技术债。攒够一组、依赖清晰后升级成里程碑文件。

- [x] `example/` playground 页面（`pnpm dev` 起 vite，单路 clip play/pause/seek）。✅ 里程碑 01
- [x] 服务端渲染（路线 A：Headless Chrome）。时间线 JSON 协议 + `buildTimeline()` +
      `scripts/ssr-render.cjs` worker（时间线 JSON → 视频文件）。见
      [`docs/server-side-rendering.md`](../docs/server-side-rendering.md)。`pnpm verify:ssr` /
      `pnpm ssr:render`。
- [ ] 服务端渲染路线 B（Node 原生）：`headless-gl` 出像素 + ffmpeg `ExportSink` / ffmpeg
      `VideoDecoderBackend`，免拉起 Chrome。仅当"每任务一个 Chrome"开销成瓶颈时做。
- [ ] SSR 大文件回传：base64 换成页面 `fetch` POST 流式回传 / CDP `ArrayBuffer`（当前 demo 走 base64）。
- [ ] golden-frame 测试基建：固定对象图 + FixedStepClock → 像素哈希比对。
- [ ] `colorSpace: 'display-p3'` 色彩管线对齐（sRGB↔linear、预乘 alpha）。
- [ ] WebGPU / WebGL 后端能力探测与降级策略。
- [ ] 可选 `ffmpeg.wasm` 兜底适配器：WebCodecs（经 Mediabunny）不支持的冷门编码软解/软封装。
      默认不内置——主链路只承诺 WebCodecs 覆盖的主流编码。
- [ ] `AnimatableProperty` 增加 spring 插值。
- [ ] 解码 worker 化（OffscreenCanvas + worker 内 VideoDecoder）。
- [ ] 重新开启 `noUnusedLocals` / `noUnusedParameters`（stub 填完后）。
- [ ] benchmark：多路 4K 同放的显存/CPU 占用基线。
