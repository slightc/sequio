# Backlog — 杂项与待定

未排期的想法、小任务、技术债。攒够一组、依赖清晰后升级成里程碑文件。

- [x] runtime/cli 支持在组合里引用 gsap：runtime 的 `externals` 接缝（已有）+ CLI 把 gsap 作为
      依赖并在 `render`（Node）与 `preview`（浏览器）两处注入（`cliExternals()`），server Route B
      `renderBundleToFile` 开通用 `externals` 透传口；引擎仍不依赖 gsap。`example/index.ts` 标题用
      gsap 入场，`pnpm verify:cli` 覆盖。见 [runtime.md](../docs/runtime.md) / [cli.md](../docs/cli.md)。
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
- [x] 路线 B 精修：文字/图片纹理上传按目标纹理格式做 BGRA/RGBA swizzle + `premultipliedAlpha` 预乘
      （彩色文字颜色正确，实测红字读回 `(255,0,0)`）。
- [x] 路线 B 音频轨导出：`node-web-audio-api` 提供 `OfflineAudioContext`，`AudioEngine.renderOffline`
      离线混音经 mediabunny `AudioBufferSource` 混轨（`pnpm verify:ssr-node-audio` 断言视频+音频轨都在）。
- [x] 路线 B Google 字体：`fonts-node.ts` 拉 css2 → `parseGoogleFontUrls` 抽字体文件 URL →
      `GlobalFonts.register`（`pnpm verify:ssr-node-font` 实测 Roboto 加载并渲染）。
- [x] 路线 B 媒体源解码（视频/图片/音频文件）：`loadMediabunny()` SDK seam + `setMediabunnyModule()`
      让 SDK 与 `@mediabunny/server` 用同一 mediabunny 实例（破 dual-package hazard）；`setFrameImageExtractor()`
      让 Node 用 `sample.copyTo` 取视频帧像素；`createImageBitmap` polyfill 走 `@napi-rs/canvas`。
      `pnpm verify:ssr-node-media` 实测视频+图片纯 Node 解码合成。
- [x] 统一环境模型（两层）：**engine 层** `EngineEnv` + `setDefaultEngineEnv()`
      （`packages/engine/src/env.ts`：renderer/resolution/mediabunny/frameImageExtractor/setup 的进程级默认，
      `Compositor` 消费、显式 `CompositorOptions` 覆盖）+ **runtime 层** `RuntimeEnv` + `setEnv`
      （`packages/runtime/src/env.ts`：externals/loadAsset/setup/可选 compositorOptions，`Composer.build` 消费）。
      server 的 `serverEnv()`（不依赖 runtime）在 `setup()` 里 `setDefaultEngineEnv({createRenderer,resolution})`
      把 renderer 注册到 engine 层，CLI 的 `render`/`frame`/`audio` 三处入口去重。见
      [`docs/environments-and-rpc.md`](../docs/environments-and-rpc.md) §A、[`docs/runtime.md`](../docs/runtime.md)。
- [ ] VM 沙箱执行路径（`RuntimeEnv` 的 evaluator 维度）：`ModuleRuntime` 抽出 `ModuleEvaluator` 接缝，
      Node 用 `node:vm` 白名单 globals、浏览器用 iframe/Worker；配素材 URL allowlist 挡 SSRF。设计见
      [`docs/environments-and-rpc.md`](../docs/environments-and-rpc.md) §B。
- [x] `packages/headless` 包：把 Route A（无头 Chrome）从 `packages/server/route-a/*` 抽离成独立包
      `@sequio/headless`（private、不发布），依赖 `@sequio/server`（复用 TimelineSpec）+ runtime + engine，
      DAG `engine ← runtime ← {server, headless}`；`verify:ssr`/`ssr:render` 迁入并改指该包。见
      [`docs/environments-and-rpc.md`](../docs/environments-and-rpc.md) §C、[`docs/server-side-rendering.md`](../docs/server-side-rendering.md)。
      对称的 `headlessEnv()` 随 §D RPC 一起做。
- [x] RPC 协议：transport-agnostic 的 `Endpoint`/`expose`/`wrap`/`windowEndpoint`（`@sequio/server/src/rpc.ts`，
      零依赖、Comlink 兼容形态）+ `RenderService`/`RenderResult` 契约（`render-service.ts`）。headless 页面
      `expose(service)`、worker（`ssr-worker.ts`，tsx）`wrap` 该 service，经 Puppeteer 桥接的 Endpoint 跨 CDP
      通信；onProgress 回调跨边界回报。旧 `window.__SSR__` + `page.evaluate` base64 老路移除。iframe/Worker
      适配器 + 零拷贝/流式回传待接场景。见 [`docs/environments-and-rpc.md`](../docs/environments-and-rpc.md) §D。
- [ ] `headlessEnv()`：对称于 `serverEnv()`，把无头 Chrome 宿主也表达成一个 env（随 iframe/RPC 接场景）。
- [ ] 路线 B 精修（续）：`writeTexture` 上传的色彩空间（sRGB）校正细化；软件光栅化性能基线；
      带音频的视频源在 Route B 的音轨解码（AudioSource 走同一实例，理论已通，待补 e2e）。
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
