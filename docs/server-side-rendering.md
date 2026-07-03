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
上跑。项目的 `verify:*` 脚本（`scripts/verify-page.cjs`）本来就用 Puppeteer + Chrome-for-Testing
（Playwright 精简版 Chromium 不带 WebCodecs，故必须用带 WebCodecs 的 Chrome）在无头环境里跑真实
导出——本方案就是把它产品化成一个"输入时间线 JSON → 输出视频文件"的渲染 worker。

契约 #3（预览与导出共用渲染核心）因此天然满足：服务端产出与用户浏览器里所见逐像素一致。

### 组成

```
example/ssr/timeline.ts        时间线 JSON 协议（TimelineSpec）+ buildTimeline() 重建对象图
example/ssr/sample-timeline.ts 自包含 demo spec（纯文字 + 图形，无需外部素材）
example/ssr-render.{html,ts}   浏览器入口：暴露 window.__SSR__.render(spec) → base64 视频
scripts/ssr-render.cjs         Node worker：起 Vite + 无头 Chrome，喂 spec，取回字节写盘
tests/ssr-timeline.test.ts     builder 的 headless 单测（spec→对象图映射）
```

**为什么时间线协议放在 `example/` 而不是 `src/`**：SDK 刻意把持久化 / schema 交给上层
（见 `AGENT.md`）。`TimelineSpec` 是一种消费者层的序列化格式，因此它属于示例/消费者代码，
`src/` 的公开面保持不变。

### 数据流

```
 时间线 JSON（服务器/DB）
      │  JSON.parse
      ▼
 scripts/ssr-render.cjs ──启动──► Vite dev server
      │                              │ 提供 example/ssr-render.html
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

## 路线 B：Node 原生 + polyfill（探索，未落地）

不想每个任务拉起一个 Chrome，就在 **Node 进程内**跑管线。下面的结论都在本仓库沙盒里
（Node 22）**实测过**——哪些直接能用、哪些是真正的坑，都有证据。

### 结论速览

| 环节 | 方案 | 沙盒实测 |
|---|---|---|
| 解码 / 编码 / 封装 | `@mediabunny/server`（`node-av` = FFmpeg N-API 绑定） | ✅ 装得上、能跑 |
| Canvas 2D + 字体度量 + 字体注册 | `@napi-rs/canvas` | ✅ 装得上、能跑（**无 WebGL**） |
| 合成/出像素 | PixiJS v8.16+ 的 `CanvasRenderer`（2D） | ⚠️ 能 init/render，但**没真正画出像素**、且**无 filter** |
| 编码喂帧 | mediabunny `CanvasSource(canvas)` | ❌ 只认真正的 `HTMLCanvasElement`/`OffscreenCanvas` |
| 字体 | SDK 的 `FontManager`（`FontFace`+`document.fonts`） | ❌ 服务端是 no-op，需换 `GlobalFonts.register` |

### 已经解决的一半：编解码（`@mediabunny/server`）

[`@mediabunny/server`](https://github.com/Vanilagy/mediabunny/tree/main/packages/server) 用
`node-av`（对 FFmpeg C API 的 N-API 绑定）在 Node/Bun/Deno 里补齐 WebCodecs 能力：

```js
import { registerMediabunnyServer } from '@mediabunny/server';
registerMediabunnyServer();          // 把 AVC/HEVC/VP8/VP9/AV1 + AAC/MP3/Opus/… 注册进
                                     // Mediabunny 的 Codec Registry
```

实测：注册后 `await canEncodeVideo('avc')` / `canEncodeVideo('vp9')` 在 Node 里都返回 `true`。
**注意**：它**不设** `globalThis.VideoEncoder/VideoDecoder/VideoFrame` 这些 WebCodecs 全局，而是
在 **Mediabunny 层**接管编解码。因此 SDK 里凡是走 mediabunny 的部分——`MediabunnyVideoDecoder`
（`Input`+`VideoSampleSink`）、`AudioSource`（`AudioBufferSink`）、导出的 `Output`/mux——
**在 Node 里能直接工作，一行不用改**。这把 Route B 最硬的骨头（Node 没有 WebCodecs）解决了。

### 剩下的一半：出像素 + 喂帧 + 字体（真正的坑）

**1. 渲染后端只能用 Canvas 2D，且要补 DOM。** `@napi-rs/canvas` 没有 WebGL（实测
`getContext('webgl')` 抛 `webgl is not supported`），`headless-gl` 只有 WebGL1 而 Pixi v8 要
WebGL2，node 的 WebGPU 绑定未验证。所以 Node 里现实的后端是 **Pixi v8.16+ 的 `CanvasRenderer`
（2D）**。实测它能 `init()`/`render()`，但要喂一堆 DOM 垫片——Pixi 完整 barrel 会自动注册
`EventSystem`/`DOMPipe`/`Ticker`，分别要 `document`、`window`、`requestAnimationFrame`、
`globalThis.addEventListener`（用 jsdom + 少量 shim 可满足，或改用精简入口只注册 Canvas 系统）。

**2. Canvas 渲染器没有 filter 管线。** `CanvasRenderer` 的 pipe 里没有 filter——所以
`Effect` / warp / `Transition`（全是 filter 实现）**在 Node 里不会渲染**，只剩
sprite/graphics/text/基础合成。这是能力上的硬损失。

**3. Canvas 渲染器"能跑但没画出来"。** 实测里 `init`/`render` 都成功、canvas 尺寸对，但读回像素
是 `(0,0,0,0)` 透明——即 Pixi 的 Canvas 后端没真正把内容合成进 `@napi-rs/canvas` 的表面
（可能要 `OffscreenCanvas` 语义或另配 render-target）。这块要额外调通，不是开箱即用。

**4. `MediabunnyExportSink` 不能直接复用。** mediabunny 的 `CanvasSource` 构造时
`instanceof HTMLCanvasElement` 校验，`@napi-rs/canvas` 的 `CanvasElement` 过不了（实测抛
`canvas must be an HTMLCanvasElement or OffscreenCanvas`）。所以服务端要**另写一个 `ExportSink`**：
从渲染 canvas 读原始像素 → 包成 `VideoSample`/`VideoFrame` → 走 `VideoSampleSource`（或直接
node-av），并可用 `FilePathTarget` 直接写盘。

**5. 字体要换注册路径（本条你特别关照）。** SDK 的 `FontManager.loadFace` 走
`new FontFace(...)` + `document.fonts.add`——在 Node 里 `document.fonts` 是"not implemented"，
**等于什么都没做**。而 Pixi 的 `CanvasTextSystem` 是用**渲染 canvas 的 `measureText`** 量字形的
（实测：字形度量来自 node canvas，不是 `document.fonts`）。`@napi-rs/canvas` 有
`GlobalFonts.register(buffer, family)` / `registerFromPath(path, family)`（自带 22 个 family）。
所以 Route B 需要一个 **Node 版 `FontManager`**：`fetch` 到字体字节 → `GlobalFonts.register` →
再建 `TextClip`。SDK 的 `loadFace`/`loadGoogle` 是 `protected`、本就"Overridable"，子类覆盖即可。

### 需要动 SDK 的地方：一个 renderer seam

除了上面几个消费者层适配器（Node `ExportSink`、Node `FontManager`、DOM 垫片），SDK 本身只差**一个
口子**：`Compositor.init()` 目前**硬编码** `autoDetectRenderer({ preference: 'webgpu'|'webgl' })`，
没法注入 `CanvasRenderer` 或自定义 renderer。Route B 要落地就得给 `Compositor` 加一个
**renderer 注入 seam**（如 `CompositorOptions.createRenderer?` 工厂，或允许直接传入已 init 的
renderer）——这与已有的 `VideoDecoderBackend` / `ExportSink` 两个 seam 是一致的设计。

### 落地清单（如果要做）

1. SDK：给 `Compositor.init` 加 renderer 注入 seam（唯一的核心改动，可单测）。
2. 消费者层（`example/ssr-node/`）：
   - DOM 垫片（jsdom + `requestAnimationFrame`/`addEventListener` shim + `DOMAdapter` → `@napi-rs/canvas`）。
   - 注入 `CanvasRenderer`，并**调通"真正画出像素"**（当前 PoC 的空白问题）。
   - Node `ExportSink`：读像素 → `VideoSample` → `VideoSampleSource` → `Output`+`FilePathTarget`。
   - Node `FontManager`：`GlobalFonts.register`。
   - `registerMediabunnyServer()` 开机注册。
3. 验证：`verify:ssr-node`——纯 Node（无浏览器）把 sample 时间线渲成 MP4 并解回。

### 取舍与建议

- **能力上限**：Canvas 2D 后端没有 filter，`Effect`/warp/`Transition` 全丢。这些是 SDK 的核心特性，
  所以 Route B 只适合**无滤镜的时间线**（文字/图形/图片/视频的基础合成）。要全保真仍得走 Route A
  （真 GPU）或 node 的 WebGPU 绑定（未验证）。
- **成熟度**：编解码半侧（`@mediabunny/server`）已经很实；渲染半侧要自己趟 DOM 垫片 + 空白画布 +
  自写 ExportSink，工程量和脆性都不低。
- **建议**：把 Route B 定位成"**无滤镜时间线的高吞吐快路径**"，Route A 仍是**全特性**的默认路径；
  仅当"每任务一个 Chrome"的资源/成本成为瓶颈、且目标时间线不用滤镜时，再投入把 Route B 调通。

> 沙盒实测脚本见提交记录讨论；本节所有 ✅/❌/⚠️ 均为 Node 22 下的实际运行结果，非推测。
