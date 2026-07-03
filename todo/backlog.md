# Backlog — 杂项与待定

未排期的想法、小任务、技术债。攒够一组、依赖清晰后升级成里程碑文件。

- [x] `example/` playground 页面（`pnpm dev` 起 vite，单路 clip play/pause/seek）。✅ 里程碑 01
- [x] 服务端渲染（路线 A：Headless Chrome）。时间线 JSON 协议 + `buildTimeline()` +
      `scripts/ssr-render.cjs` worker（时间线 JSON → 视频文件）。见
      [`docs/server-side-rendering.md`](../docs/server-side-rendering.md)。`pnpm verify:ssr` /
      `pnpm ssr:render`。
- [x] 服务端渲染路线 B（Node 原生，免拉起 Chrome，**含滤镜**）——**已实现**，见
      [`docs/server-side-rendering.md`](../docs/server-side-rendering.md) 的「路线 B」。用 Pixi **WebGPU**
      渲染器（Dawn 的 `webgpu` 绑定 + Mesa lavapipe 软件 Vulkan 兜底）出像素，滤镜/warp/转场全支持；
      `@mediabunny/server`（node-av/FFmpeg）编码、`@napi-rs/canvas` 供文字度量/字体、jsdom 补 DOM。SDK 仅
      加 `CompositorOptions.createRenderer` 注入 seam。`pnpm verify:ssr-node` / `pnpm ssr:render-node`。
- [ ] 路线 B 精修：彩色文字纹理上传按目标格式做 RGBA/BGRA swizzle；Google 字体 css2→文件解析；
      音频轨导出（Node `OfflineAudioContext` polyfill）；`writeTexture` 上传的预乘/色彩空间校正。
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
