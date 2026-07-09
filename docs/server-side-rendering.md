# 服务端渲染（Server-Side Rendering）

> 在没有屏幕的服务器上，把一条时间线渲染成视频文件。

## 为什么需要一套方案

这套 SDK 的渲染核心是**浏览器技术栈**：PixiJS 的 WebGL/WebGPU 合成、经 Mediabunny 封装的
WebCodecs 解/编码、`OfflineAudioContext` 混音、`document.fonts` 字体度量。Node 里没有这些
原生 API，所以"服务端渲染"本质上是**在服务器环境里跑完整条 decode→composite→encode 管线**。

导出主循环（`src/export/exporter.ts`）每帧的依赖：

| 环节 | 依赖的浏览器 API |
|---|---|
| 合成/绘制（`Compositor.renderSync`） | WebGL2 / WebGPU、`HTMLCanvasElement` |
| 解码（`VideoSource.prepare`） | WebCodecs (`VideoDecoder`)、`VideoFrame` |
| 音频离线混音（`AudioEngine.renderOffline`） | `OfflineAudioContext` |
| 编码/封装（`MediabunnyExportSink`） | WebCodecs (`VideoEncoder`)、`CanvasSource` |
| 字体（`FontManager`） | `document.fonts` / `FontFace` |

## 路线 A：Headless Chrome（本仓库实现的方案）

无头 Chrome 天生带 WebGL、WebCodecs、Web Audio 和字体，所以 **SDK 一行不用改**就能在服务器
上跑。项目的 `verify:*` 脚本（`packages/*/scripts/verify-page.cjs`）本来就用 Puppeteer + Chrome-for-Testing
（Playwright 精简版 Chromium 不带 WebCodecs，故必须用带 WebCodecs 的 Chrome）在无头环境里跑真实
导出——本方案就是把它产品化成一个"输入时间线 JSON → 输出视频文件"的渲染 worker。

契约 #3（预览与导出共用渲染核心）因此天然满足：服务端产出与用户浏览器里所见逐像素一致。

### 组成

```
packages/server/src/timeline.ts        时间线 JSON 协议（TimelineSpec）+ buildTimeline() 重建对象图
packages/server/src/sample-timeline.ts 自包含 demo spec（纯文字 + 图形，无需外部素材）
packages/server/route-a/ssr-render.{html,ts}   浏览器入口：暴露 window.__SSR__.render(spec) → base64 视频
packages/server/route-a/ssr-render.cjs         Node worker：起 Vite + 无头 Chrome，喂 spec，取回字节写盘
packages/server/tests/ssr-timeline.test.ts     builder 的 headless 单测（spec→对象图映射）
```

**为什么时间线协议放在 `packages/server` 而不是引擎包**：引擎（`@sequio/engine`）
刻意把持久化 / schema 交给上层（见 `AGENT.md`）。`TimelineSpec` 是一种消费者层的序列化格式，
因此它属于 server 包（`@sequio/server`，也被 studio 的“Server Render”复用），
引擎的公开面保持不变。

### 数据流

```
 时间线 JSON（服务器/DB）
      │  JSON.parse
      ▼
 packages/server/route-a/ssr-render.cjs ──启动──► Vite dev server
      │                              │ 提供 packages/server/route-a/ssr-render.html
      │  puppeteer.launch(headless)  ▼
      └──────────────────────► 无头 Chrome
                                     │ window.__SSR__.render(spec)
                                     │   buildTimeline(spec) → Compositor/Track/Clip
                                     │   Exporter.export() → Blob → base64
      ◄──────────────────────────────┘ page.evaluate 返回 base64
      │  Buffer.from(base64, 'base64')
      ▼
 out.mp4（写盘）
```

### 用法

一次性安装无头 Chrome（Chrome-for-Testing，带 WebCodecs）：

```bash
pnpm exec puppeteer browsers install chrome
```

渲染一条时间线：

```bash
# 内置 demo（无需素材，可离线跑通全链路）
pnpm ssr:render -- --out out.mp4

# 渲染自己的时间线 JSON
pnpm ssr:render -- --timeline my-timeline.json --out out.mp4

# 自校验：断言产出是合法容器（CI 用）
pnpm ssr:render -- --verify --out out.mp4
```

浏览器半侧的 e2e 校验（断言无头 Chrome 里 render 成功产出视频）：

```bash
pnpm verify:ssr
```

### 时间线 JSON 协议（`TimelineSpec`）

```jsonc
{
  "width": 320,
  "height": 180,
  "fps": 30,
  "background": 1052692,          // 0x101014
  "origin": [0, 0],               // 归一化坐标原点，默认左上
  "range": [0, 2],                // 可选，默认 [0, 最大 clip end]
  "fonts": [                      // 渲染前一次性加载（TextClip 需要）
    { "family": "Inter", "src": "https://…/Inter.woff2" },
    { "family": "Roboto", "google": { "weights": [400, 700] } }
  ],
  "tracks": [
    {
      "zIndex": 0,
      "clips": [
        { "type": "shape", "shape": { "kind": "rect", "width": 320, "height": 180, "fill": 1013358 },
          "start": 0, "end": 2, "transform": { "anchor": [0, 0], "position": [0, 0] } },
        { "type": "text", "text": "Hello", "fontSize": 26, "fill": 16777215,
          "start": 0, "end": 2, "transform": { "anchor": [0.5, 0.5], "position": [160, 40] },
          "opacity": { "keyframes": [ { "time": 0, "value": 0 },
                                      { "time": 0.6, "value": 1, "easing": "easeOutQuad" } ] } },
        { "type": "image", "src": "https://…/logo.png", "start": 0, "end": 2, "transform": { "position": [160, 90] } },
        { "type": "video", "src": "https://…/clip.mp4", "start": 0, "end": 2, "cacheFrames": 30 }
      ]
    }
  ],
  "audio": [
    { "src": "https://…/music.mp3", "start": 0, "end": 2, "gain": 0.8, "fadeIn": 0.2, "fadeOut": 0.3 }
  ],
  "export": { "container": "mp4", "videoCodec": "avc", "bitrate": 2000000 }
}
```

- **可动画属性**（`position` / `scale` / `rotation` / `opacity` / `fontSize`）取
  `T`（静态）或 `{ keyframes: [{ time, value, easing? }] }`。`easing` 是命名曲线
  （`linear` / `easeInQuad` / `easeInOutCubic` …，见 `EasingName`）。
- **素材**（image/video/audio/自托管字体）必须是无头浏览器能 `fetch` 到的 URL 或 data-URI——
  在服务器上用本地静态服务喂给页面。demo 只用文字 + 图形，故完全自包含。
- **编解码协商**：`export.videoCodec` 是首选；若该无头 Chrome 编不了（SwiftShader 软件光栅化下
  常只有 VP8/VP9），`negotiateCodec` 会退到 `avc`→`vp9`→`vp8`，并在结果里报告实际用了哪个。

### 把字节取回 Node

`page.evaluate` 不能直接返回 `Blob`，所以 render 返回 **base64**，Node 侧 `Buffer.from(…, 'base64')`
落盘。base64 有 ~33% 膨胀且要在内存里过一遍字符串——**大文件**（几百 MB 起）建议改成让页面
`fetch` POST 到一个本地端点流式回传，或用 CDP 传 `ArrayBuffer`。demo/短片走 base64 足够。

### 生产化要点

- **并发/隔离**：一个 page 一个导出任务，做成任务队列；导出内存大，控制并发数。可复用一个常驻
  Chrome 多开 page，避免每次冷启动。
- **无 GPU 的服务器**：worker 用 `--use-angle=swiftshader`（软件光栅化）——无显卡也能跑，代价是
  慢；有 GPU 就换真实驱动。
- **无头新模式**：必须是 `headless: true`（new headless）才有完整 WebCodecs/WebGL。
- **字体确定性**：`buildTimeline` 在建 clip 前 `await` 所有字体就绪（契约 #2：`render(t)` 不能
  中途把 fallback 换成真字体）。


## 路线 B：Node 原生（已实现，**含滤镜**）

不想每个任务拉起一个 Chrome，就在 **Node 进程内**跑整条管线。**关键点：滤镜必须能用**——
`Effect` / warp / `Transition` 都是 shader，所以 Node 侧渲染后端**必须是 GPU 管线**（不能是
Canvas 2D，它没有 filter）。方案是 **PixiJS 的 WebGPU 渲染器 + Dawn 的 Node WebGPU 绑定**，帧渲到
`RenderTexture` 后从 GPU 读回，再交给 Mediabunny 编码。与浏览器预览**共用同一渲染核心**（契约 #3），
只是换了 renderer 和一个 GPU 读帧步骤。

> 下面所有结论均在本仓库沙盒（Node 22 + Mesa lavapipe 软件 Vulkan）**实测跑通**：内置 demo
> （青底 + 移动的**带模糊滤镜**的圆 + 文字）渲成 60 帧 MP4，解码回来断言尺寸/颜色正确
> （青底 `[14,117,110]`、橙圆 `[245,157,11]`、模糊生效）。

### 组成

```
src/compositor/compositor.ts     新增 CompositorOptions.createRenderer 注入 seam（唯一的 SDK 改动）
packages/server/route-b/env.ts          Node 环境引导：jsdom + rAF/addEventListener shim + DOMAdapter(napi-canvas)
                                 + navigator.gpu(Dawn) + GPU* globals + Dawn 兼容 shim + registerMediabunnyServer
                                 + createNodeWebGPURenderer 工厂
packages/server/route-b/export-node.ts  GPU 读帧导出：renderToTexture → copyTextureToBuffer → BGRA→RGBA
                                 → VideoSample → VideoSampleSource → Output + FilePathTarget（写盘）
                                 + 音频轨（AudioEngine.renderOffline → AudioBufferSource）
                                 + renderFrameRGBA（单帧读回，供单帧导出复用）
packages/server/route-b/fonts-node.ts   Node 字体加载：自托管 URL + Google 字体（css2→文件→GlobalFonts.register）
                                 + bridgeFontManagerToNode（把引擎 FontManager 的 load 钩子改接 loadFontsNode，
                                 让代码/bundle 路线里作曲的 fonts.load(...) 在 Node 也注册进 GlobalFonts）
packages/server/route-b/render-bundle.ts renderBundleToFile：读 RuntimeBundle（命令式代码）→ Runtime→Composer→build
                                 →renderTimelineToFile（`sequio render` 与 worker `--bundle` 都走它）
packages/server/route-b/frame-node.ts   renderBundleFrameToFile：读 RuntimeBundle → build → seek 一帧 → renderFrameRGBA
                                 → @napi-rs/canvas 编码 PNG 写盘（`sequio frame` 走它；与 render 同一渲染核心）
packages/server/route-b/audio-node.ts   exportBundleAudioToFile：读 RuntimeBundle → build → Exporter.exportAudio（只导
                                 AudioEngine 离线混音，不渲染帧）→ 写 m4a/mp3/wav/ogg/webm（`sequio audio` 走它）
packages/server/route-b/index.ts        @sequio/server/route-b 子路径 barrel（Node-only：renderTimelineToFile /
                                 renderBundleToFile / renderBundleFrameToFile / exportBundleAudioToFile /
                                 setupNodeEnvironment / createNodeWebGPURenderer）
packages/server/route-b/render.ts       worker 主程序：--timeline 读 TimelineSpec（复用 buildTimeline）或
                                 --bundle 读代码 bundle（复用 renderBundleToFile），渲成文件
packages/server/route-b/verify-audio.ts 自包含校验：合成正弦 → 视频+音频 MP4，解回断言两轨都在
packages/server/route-b/verify-font.ts  自包含校验：从 Google 加载 Roboto 渲染文字，断言字形像素渲出
packages/server/route-b/verify-media.ts 自包含校验：渲一段视频→作为 VideoSource 解回 + data-URL 图片，合成断言像素
```

SDK 侧为 Route B 新增的 seam（都不影响浏览器：不设置就是原行为）：`CompositorOptions.createRenderer`
（注入 renderer）、`loadMediabunny()`/`setMediabunnyModule()`（pin mediabunny 实例）、
`setFrameImageExtractor()`（视频帧→纹理的取像方式）。

时间线协议、`buildTimeline`、`buildEffect` 与路线 A 复用同一份 `packages/server/src/`（`TimelineSpec` 现支持
clip 级与全局 `effects`）。

### 依赖与前置

devDependencies（只有 Node SSR 用，像 puppeteer 一样不进发布包）：`tsx`、`jsdom`、
`@napi-rs/canvas`、`webgpu`（Dawn）、`@mediabunny/server`（内含 `node-av` = FFmpeg N-API）、
`node-web-audio-api`（`OfflineAudioContext` 音频混音）。

**必须有 WebGPU 可用的宿主**：一块真 GPU，或一个**软件 Vulkan 驱动**。无 GPU 的服务器/CI 装
Mesa **lavapipe** 即可：

```bash
apt install mesa-vulkan-drivers      # 提供 lavapipe(llvmpipe) 软件 Vulkan
pnpm rebuild webgpu node-av          # pnpm 默认屏蔽原生 build script，需手动触发
```

没有任何 Vulkan 驱动时，worker 会以清晰的 “No WebGPU adapter — Route B needs a GPU or lavapipe” 退出。

**编码器（node-av）**：Route B 经 `@mediabunny/server`（node-av/FFmpeg）编码。**`node-av` 的原生二进制必须
装好**（`pnpm rebuild node-av`）——否则 mediabunny 会退回浏览器 WebCodecs 路径、在 Node 里抛
`VideoFrame is not defined`。

**单实例（dual-package hazard）**：mediabunny 同时发布 ESM 和 CJS 两套构建，**它们是两个独立的模块实例、各有
独立的编解码器注册表**。`registerMediabunnyServer()` 只在它自己 `require('mediabunny')` 到的那个实例上注册
node-av 编码器；如果导出代码 `import('mediabunny')` 拿到的是**另一个**实例，注册表就是空的，每次编码都悄悄
回退到 WebCodecs → `VideoFrame is not defined`（本机好用、别的机器全挂就是这个原因，取决于 Node/tsx/pnpm 的
解析）。所以 `env.ts` 用同一个 CJS `require` 加载 `@mediabunny/server` **和** `mediabunny`（同一个缓存实例），
并由 `getMediabunny()` 把**那个确切实例**交给所有 Route B 代码（`export-node.ts` 的编码、`verify-*` 的解码）。
**SDK 内部也用同一实例**：SDK 的 `VideoSource`/`AudioSource`/`MediabunnyExportSink` 改成走 `loadMediabunny()`
（新 SDK seam，读 `globalThis.__mediabunny__` 覆盖，否则正常 `import`），`env.ts` 用 `setMediabunnyModule()`
把注册实例塞进去。所以**带媒体源（视频/图片/音频文件）的时间线在纯 Node 下也能解码**了。

**媒体源解码的两个额外 seam**（都在 `env.ts` 装配）：
- **视频帧→纹理**：SDK 默认用 `sample.toVideoFrame()` 取一个**归自己所有、生命周期自己控制**的
  `VideoFrame`（浏览器）。**不能**用 `sample.toCanvasImageSource()`——它返回的 `VideoFrame`「可能在下一个
  microtask 被自动关闭」，而我们把帧**缓存起来、延后**才上传成纹理（Pixi 把上传推迟到渲染时且会跨帧复用），
  届时 WebGPU `copyExternalImageToTexture` 会撞上已释放的帧（`video frame that doesn't have back resource`）。
  Node 没有 `VideoFrame`，故 `setFrameImageExtractor()` seam 改用 `sample.copyTo(buf, {format:'RGBA'})` 读像素
  → 画进 napi canvas（Pixi 接受为纹理源）；两条路径都在拿到稳定图像后立即 `sample.close()`。
- **图片解码**：`ImageSource` 用浏览器的 `createImageBitmap`（Node 没有）。`env.ts` 用 `@napi-rs/canvas` 的
  `loadImage` polyfill 一个 `globalThis.createImageBitmap`：解码字节 → 画进 napi canvas 返回。

校验 `pnpm verify:ssr-node-media`：纯 Node 里先渲一段"红块横移"视频到文件，再作为 `VideoSource` 解回、叠加一张
data-URL 图片，合成断言视频块（红）与图片（蓝）都出像素。**媒体源 URL** 需 Node 可 `fetch`（http，或 data: URI；
本地文件走 `ArrayBuffer`）。此外**很多 node-av 构建不含 H.264/avc**（x264 是 GPL）。

**`canEncodeVideo` 不可信、连"试编一帧"预检也不可靠**：`@mediabunny/server` 的 `supports()` 只看
`bitrateMode !== 'quantizer'`、对 avc/hevc/… 基本**无条件返回 true**，不校验 FFmpeg 里到底有没有该编码器；
而 `bitrateMode` 默认 `undefined`，所以任何独立预检（哪怕真编一帧）都可能给出**假阳性**——真正的整段导出
才落回 WebCodecs 抛 `VideoFrame`。因此 worker 直接在**真实导出路径上做编码回退**：按顺序尝试候选编码
（优先请求的 `avc`/mp4 → `vp9` → `vp8`(WebM) → `av1`），**用真实的第一帧去试编**；失败（`VideoFrame is not
defined` 等）就换下一个编码重来。失败发生在第 1 帧，所以一个不可用的编码只浪费一帧、随即回退到 VP9/WebM
（node-av 几乎必带 libvpx）。全部失败才以可操作的报错退出（提示 `pnpm rebuild node-av`）。输出扩展名自动
改成实际容器（`.webm`）。macOS 上 avc 常经 VideoToolbox 可用；很多 Linux/CI 构建不含 x264，会自动落到 VP9/WebM。

### 用法

```bash
pnpm ssr:render-node -- --out out.mp4                       # 渲染内置 demo（含滤镜）
pnpm ssr:render-node -- --timeline my-timeline.json --out out.mp4
pnpm ssr:render-node -- --timeline my-timeline.json --scale 2 --out out.mp4  # 2× 分辨率导出
pnpm verify:ssr-node                                        # 纯 Node 渲 demo → 断言合法 MP4
```

**`--scale N`（分辨率倍数）**：Node 里没有 `devicePixelRatio`，所以默认按时间线的 `width×height`（1×）
渲染。`--scale 2` 以 **2× 的分辨率**渲染并导出（文字/矢量更清晰、视频/图片放大、文件更大）——例如 640×360
的时间线 `--scale 2` → 1280×720 输出。原理是把 `CompositorOptions.resolution` 透传给 `renderToTexture`
（离屏帧按 `width*resolution` 出像素），GPU 读帧与编码随之用放大后的尺寸。整数倍最稳（保证偶数尺寸，H.264
友好）。

### 让它在 Node 里跑起来踩过的坑（都已在 `env.ts` 里 shim）

1. **DOM 垫片**：Pixi 完整 barrel 自动注册 `EventSystem`/`DOMPipe`/`Ticker`，需 `document`/`window`
   （jsdom）+ `requestAnimationFrame`/`addEventListener` shim。
2. **GPU 全局**：Dawn 的 `webgpu` 模块经 `wg.globals` 暴露 `GPU*` 类/常量，要挂到 `globalThis`，并把
   `navigator.gpu` 指向 `wg.create([])`。
3. **Dawn 比浏览器严格**：Pixi 用 `for..in` 传给 `setBindGroup` 的 index 是**字符串**，浏览器会隐式
   转数字，Dawn 不会 → 报 “value is not a number”。shim 把 index `Number()` 化。
4. **napi canvas 不是 HTMLCanvasElement**：Pixi 的 `CanvasSource.test` 用 `instanceof HTMLCanvasElement`
   判定，napi canvas 过不了 → 屏幕 render target 会另建一张 canvas，**画到别处、view 全透明**。给 napi
   canvas 打 tag 并 patch `CanvasSource.test` 接受它，Pixi 才画进我们控制的 view。
5. **文字/图片纹理上传**：Pixi WebGPU 用 `queue.copyExternalImageToTexture({source: canvas})` 上传
   canvas 纹理，Dawn 读不了 napi canvas → 报 “no possible types matched … member 'source'”。shim 把这类调用
   改走 `writeTexture`（读 canvas 原始像素）。
6. **`getBoundingClientRect`**：ticker 里的 `CanvasObserver` 会调它，给 canvas stub 补上。
7. **读帧**：Pixi 的 `extract.pixels`(WebGPU) 走 canvas 的 `GPUCanvasContext`（我们没有），改为手动
   `copyTextureToBuffer` + `mapAsync` 直接读 GPU 纹理（256 字节行对齐要去 padding）。

### 字体（本条你特别关照）

Node 里 `FontManager` 的 `FontFace`/`document.fonts` 是 no-op；Pixi 文字用**渲染 canvas 的
`measureText`** 量字形，字体要经 `@napi-rs/canvas` 的 `GlobalFonts.register(bytes, family)` 注册。
`fonts-node.ts` 的 `loadFontsNode`（作为 `buildTimeline` 的 `loadFonts` override 传入）支持两种来源：
- **自托管**：`fetch(src)` → `GlobalFonts.register`。
- **Google 字体**：用 SDK 的 `buildGoogleCss2Url` 建 css2 URL → `fetch`（用普通 UA 让 Google 回
  TrueType）→ `parseGoogleFontUrls` 抽出字体文件 URL → 逐个 `fetch` 并 `register`。

实测 `pnpm verify:ssr-node-font`：纯 Node 从 Google 加载 Roboto 700 并渲染文字（读回 2521 个字形像素）。
napi 自带若干 family（含 sans-serif），demo 不需外部字体。`parseGoogleFontUrls` 是纯函数、有单测。

### 已知取舍 / 后续

- **颜色/透明度**：GPU 读回是 **BGRA、预乘 alpha**。导出帧背景不透明（alpha=255）时预乘是恒等，
  读帧时做 BGRA→RGBA 通道交换即可（已处理）。纹理上传（文字/图片）的 `writeTexture` shim 也已**按目标
  纹理格式做 BGRA/RGBA swizzle 并按 `premultipliedAlpha` 预乘**，彩色文字/图片颜色正确（实测红字读回
  `(255,0,0)`）。
- **性能**：lavapipe 是软件光栅化，慢；有真 GPU 时快很多。软件 Vulkan 更适合 CI/无卡服务器兜底。
- **Google 字体**：`loadFontsNode` 只处理自托管 `src`；css2 → 字体文件的解析未做（后续）。
- **音频**：已支持。`node-web-audio-api` 提供 `OfflineAudioContext`/`AudioBuffer` 全局，
  `AudioEngine.renderOffline` 出离线混音，`export-node.ts` 经 mediabunny `AudioBufferSource` 混成音频轨
  （`pnpm verify:ssr-node-audio`：合成 440Hz 正弦 + 图形 → MP4，解回断言视频+音频轨都在）。JSON `audio`
  轨的 `AudioSource({src})` 走 mediabunny 解码，src 需 Node 可 `fetch` 到（同素材要求）。
- **脆性**：这套依赖 Pixi 内部行为 + Dawn 绑定的若干 shim，Pixi/Dawn 升级可能需要跟着调。

### 两条路线怎么选

| | 路线 A（Headless Chrome） | 路线 B（Node 原生 WebGPU） |
|---|---|---|
| 滤镜/转场 | ✅ 全支持 | ✅ 全支持（本次打通） |
| 依赖 | 一个 Chrome | Dawn + Vulkan 驱动 + 若干 shim |
| 每任务开销 | 一个浏览器进程 | 进程内，无浏览器 |
| 成熟度 | 高（复用 verify 路径） | 中（依赖内部行为 + shim） |
| 适合 | 默认、全保真、最省心 | 高吞吐/无浏览器环境，愿意维护 shim |

两条都能出带滤镜的视频。默认用 A；对吞吐/隔离敏感、且能接受维护 Dawn shim 时上 B。
