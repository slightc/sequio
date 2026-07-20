# 环境注入、沙箱与 RPC（架构方向）

> 本文把四个相关方向串成一个连贯的架构：**统一的环境模型（`RuntimeEnv`）**、**VM 沙箱执行**、
> **headless 包抽离**、**transport-agnostic 的 RPC 协议**。其中 §A（`RuntimeEnv` + `setEnv`）
> **已实现**；§B/§C/§D 为设计，按里程碑推进（见 [`todo/backlog.md`](../todo/backlog.md)）。

## 动机

三处渲染入口（`sequio render` / `frame` / `audio`，即 `packages/server/route-b/{render-bundle,
frame-node,audio-node}.ts`）过去**逐字重复**同一段环境引导：
`setupNodeEnvironment()` → `bridgeFontManagerToNode()` → `new Runtime({ externals, loadAsset })` →
`composer.build({ target:'server', compositorOptions:{ createRenderer, resolution } })`。
「环境」这个概念散落在每个调用点，没有一个可注入、可替换、可单测的对象。同时
[`server-side-rendering.md`](server-side-rendering.md) 明确记录：**runtime 不做沙箱**，服务端跑一份
bundle ＝ 在你的进程里执行任意 JS/TS（RCE/SSRF）。这两件事——**环境收口**与**沙箱**——共享同一个
抽象：一个描述「在某个宿主里怎么把合成跑起来」的对象。

---

## §A. 统一环境模型（已实现）：engine 层 `EngineEnv` + runtime 层 `RuntimeEnv`

「环境」按层拆成两块，**各自归属它真正影响的层**：

- **engine 层 `EngineEnv`**（`packages/engine/src/env.ts`）——引擎**跑在浏览器之外**所需的宿主能力：
  GPU renderer 工厂、输出倍率、`mediabunny` 实例、视频帧取像器、一次性 `setup()`。**进程级全局默认**，
  由 `setDefaultEngineEnv(env|null)` 一次性设置；**显式 `CompositorOptions` 永远覆盖默认**（并发/隔离
  场景仍逐个 `Compositor` 传 `createRenderer`，不受全局影响）。
- **runtime 层 `RuntimeEnv`**（`packages/runtime/src/env.ts`）——**代码运行时**才有的宿主差异：额外
  `externals`（gsap…）、`loadAsset`、一次性 `setup()`、可选的 per-build `compositorOptions` 覆盖。由
  `new Runtime({ env })` / `runtime.setEnv(env)` 安装，`Composer.build` 消费。

> 为什么分两层：DAG 是 `engine ← runtime`，engine **不能** import runtime 的类型（`Externals` /
> `AssetLoader` 都在 runtime），所以 renderer/codecs 这些引擎自己的东西必须用引擎自己的类型
> （`CompositorOptions` / `MediabunnyModule` / `FrameImageExtractor`）在 engine 层设置。

```ts
// engine 层
export interface EngineEnv {
  setup?(): Promise<void> | void;                                        // 一次性宿主引导（Compositor.init 前跑一次）
  createRenderer?: (o: Partial<AutoDetectOptions>) => Promise<Renderer>; // 默认 renderer 工厂
  resolution?: number;                                                   // 默认输出倍率
  mediabunny?: MediabunnyModule;                                         // 钉 codec 实例（委托 setMediabunnyModule）
  frameImageExtractor?: FrameImageExtractor;                             // 视频帧→纹理（委托 setFrameImageExtractor）
}
export function setDefaultEngineEnv(env: EngineEnv | null): void;        // 进程级全局默认（null 清空）
export function getDefaultEngineEnv(): EngineEnv;
```

- **`Compositor` 消费**：构造时 `resolution = options.resolution ?? getDefaultEngineEnv().resolution ??
  devicePixelRatio`；`init()` 先 `ensureEngineEnvSetup()`（跑一次 `setup`）再
  `create = options.createRenderer ?? getDefaultEngineEnv().createRenderer ?? autoDetectRenderer`。
  **显式 options 永远优先**，无默认时行为与过去逐字一致。
- **「server 变成提供一套 server env」**：`@sequio/server/route-b` 的 `nodeServerEnv()`
  （`route-b/server-env.ts`，一个 `RuntimeEnv`）在它的 `setup()` 里做 Node 引导（globals、字体桥接、
  mediabunny 钉实例）**并 `setDefaultEngineEnv({ createRenderer, resolution })` 把 renderer 注册到
  engine 层**，把创建出的 renderer 暴露成 `env.renderer` 供 GPU 读帧。于是 `render`/`frame`/`audio`
  三处入口塌缩成：

  ```ts
  const env = nodeServerEnv({ scale, externals, loadAsset });   // RuntimeEnv；setup 里 setDefaultEngineEnv
  const composer = await new Runtime({ ...bundle, env }).run();
  const built = await composer.build();                          // build 先跑 env.setup → 注册 engine 默认
  await renderTimelineToFile(built.compositor, env.renderer!, { … });
  ```

  用户 bundle 里普通的 `new Compositor({ width, height })` 因此在 Node 里也拿到 WebGPU renderer——
  renderer 的默认落在 **engine 层**，不再靠 runtime 往每个 build 折 `compositorOptions`（契约 #3）。

engine 层 `EngineEnv` 是 renderer/codecs 的进程默认；runtime 层 `RuntimeEnv`（`browserEnv` /
`nodeServerEnv` / 未来 `sandboxEnv`§B / `headlessEnv`§C）是代码运行时的 externals/loadAsset/setup 收口，
其 `setup()` 负责把 engine 层默认装好。

---

## §B. VM 沙箱 env（设计）

### 问题
`packages/runtime/src/module-runtime.ts` 用 `new Function('exports','require','module',…, compiled)`
执行每个模块体。闭包变量确实隔离，但 **ambient globals 全通**：用户代码能 `fetch()` 内网、读
`process.env`、`import('node:fs')`（若 externals 给了）——公网直接渲染用户提交的合成即 RCE + SSRF。

### 方案：可插拔的「执行策略」
把「怎么执行一段编译后的 CJS」抽成 `ModuleRuntimeOptions` 上的一个可选接口：

```ts
export interface ModuleEvaluator {
  /** 执行编译后的 CJS 工厂体；scope = { exports, require, module, __filename, __dirname }。 */
  evaluate(compiled: string, scope: CjsScope): void;
}
```

- **默认（`FunctionEvaluator`）**：现有 `new Function` 行为，零改动、给可信来源用。
- **Node 沙箱（`NodeVmEvaluator`）**：用内置 `node:vm`。`vm.createContext(sandbox)` 建一个**白名单
  全局**的上下文（不放 `process` / `fetch` / `require` / `Buffer`，只放 `Math`/`JSON`/`console` 等纯
  函数），`new vm.Script(wrapAsCjs(compiled)).runInContext(ctx)` 执行。`require` 仍走 runtime 自己的
  链接器（只能解析 VFS 相对模块 + 白名单 externals），所以用户代码**够不到宿主的任何能力**。
- **浏览器沙箱**：`node:vm` 在浏览器不可用；浏览器侧沙箱 = **iframe / Worker** 里跑 runtime，父页面
  经 §D 的 RPC 驱动。iframe 的 `sandbox` 属性 + CSP 锁死网络/存储，是浏览器天然的隔离边界。

作为 `RuntimeEnv` 的一个维度：`sandboxEnv({ evaluator: 'node-vm', allowlist })` 或在 env 上加
`evaluator` 字段，与 `nodeServerEnv` 组合（服务端沙箱渲染 = Node WebGPU env + VM evaluator）。

### 隔离强度对比

| 方案 | 隔离 | 依赖 | 逃逸风险 | 适用 |
|---|---|---|---|---|
| `new Function`（今） | 无（globals 全通） | 无 | — | 可信一方代码（CI、内部作者） |
| `node:vm` | 中（白名单 globals） | 内置 | 有已知逃逸（`constructor` 链、`vm` 非安全边界） | 半可信、纵深防御一层 |
| `isolated-vm` | 强（独立 V8 isolate） | 原生编译 | 低 | 真·多租户不可信代码 |
| Worker + frozen globals | 中高（独立 realm + 冻结原型） | 无（浏览器/Node 均有） | 中 | 浏览器侧、与 iframe/RPC 复用 |

**推荐**：`node:vm` 起步（廉价、纵深防御），**并配 SSRF 面控制**——素材 URL 协议 + 域名 allowlist
（禁 `file:`/内网），因为沙箱挡不住「素材 URL 由服务端 fetch」这条路（见
[`server-side-rendering.md`](server-side-rendering.md) 的信任边界）。真·公网多租户上 `isolated-vm`。
`node:vm` **不是**安全边界的官方保证，文档里必须写明其局限。

---

## §C. `packages/headless` 包抽离（已实现）

Route A（无头 Chrome）过去寄居在 `packages/server/route-a/`，与 server 的 Route B（Node 原生）耦合在
一个包里，但两者是**两种独立的宿主**。现已抽成独立包 **`@sequio/headless`**：

```
packages/headless/
  ssr-render.html/.ts   浏览器入口：window.__SSR__.render(spec) / renderBundle(bundle) / sample() → base64
  ssr-render.cjs        Node worker：起 Vite + Puppeteer 无头 Chrome，喂 --timeline/--bundle，写盘
  scripts/verify-page.cjs 浏览器 e2e runner（`pnpm verify:ssr`）
  package.json          private（不发布）、vite.config.ts（仅 dev server，无 build）、tsconfig.json
```

- **DAG**：`engine ← runtime ← {server, headless}`；`headless` 依赖 `@sequio/server`（复用
  `TimelineSpec` / `buildTimeline` / `sampleTimeline`）+ `@sequio/runtime`（页面里跑 bundle）+
  `@sequio/engine`。server 因此只拥有协议 + Route B，不再背 Route A。
- **迁移**：`packages/server/route-a/*` → `packages/headless/`（`git mv` 保留历史）；`verify:ssr` /
  `ssr:render` 脚本 + 那份 `verify-page.cjs` 一并迁入；根 `package.json` 的 `verify:ssr`/`ssr:render`
  改指 `-F @sequio/headless`；页面 import 从 `../src/timeline` 改成 `@sequio/server`。
- **不发布**（`private: true`、无 `vite build`）：Route A 是仓库内 verify harness——全保真、复用浏览器
  渲染核心（契约 #3），代价是每任务一个 Chrome 进程。Puppeteer 仍是**根 devDependency**。
- **后续**：把 worker 的 `page.evaluate(...)→base64` 换成 §D 的 transport-agnostic RPC，并对称暴露一个
  `headlessEnv()`（宿主 = 无头浏览器），大字节流走流式回传取代 base64。

---

## §D. RPC 协议：无头浏览器 + iframe 通用（设计，含 Comlink 对比）

### 现状与目标
今天的传输是临时的：`page.evaluate((s) => window.__SSR__.render(s), spec)` 返回 base64。要点：
① 无正式接口契约；② 只服务 Puppeteer，iframe（浏览器内沙箱预览/导出）无法复用；③ base64 有 ~33%
膨胀、大文件要在内存里过一遍字符串。目标是**一套 transport-agnostic 的 RPC**，同时服务：
- **无头浏览器**（Node worker ↔ Chrome 页面，跨 CDP 边界）
- **iframe / Worker**（父页面 ↔ 沙箱 realm，§B 的浏览器沙箱、studio Code Mode 的隔离预览）

### 接口契约
定义与传输无关的服务接口 + 一个 `Endpoint` 抽象：

```ts
export interface RenderService {
  renderBundle(bundle: RuntimeBundle, opts: RenderOpts): Promise<RenderResult>;
  renderTimeline(spec: TimelineSpec, opts: RenderOpts): Promise<RenderResult>;
  renderFrame(bundle: RuntimeBundle, time: number, opts: FrameOpts): Promise<FrameResult>;
}
// 双向消息端点：iframe/Worker 用 postMessage，Puppeteer 用自定义桥（见下）。
export interface Endpoint {
  postMessage(msg: unknown, transfer?: Transferable[]): void;
  addEventListener(type: 'message', h: (e: { data: unknown }) => void): void;
  removeEventListener(type: 'message', h: (e: { data: unknown }) => void): void;
}
```

- **iframe / Worker transport**：`Endpoint` 直接就是 `window`/`MessagePort`/`Worker`。`Transferable`
  让 `ArrayBuffer` **零拷贝**回传（取代 base64）。
- **无头浏览器 transport**：Puppeteer/CDP **没有原生 MessagePort**。桥法：Node 侧
  `page.exposeFunction('__rpcSend', …)`（页面 → Node）+ `page.evaluate` 注入回调（Node → 页面），
  在两侧各包一个满足 `Endpoint` 接口的适配器。大字节流走页面 `fetch` POST 到 worker 起的本地端点
  （替换 base64）。

### Comlink vs 自研极简 RPC

| | Comlink | 自研极简 RPC |
|---|---|---|
| 风格 | proxy（`await remote.renderBundle(...)` 像本地调用） | 显式 request/response 信封 |
| 依赖 | 引入 `comlink`（~5KB） | 无（契合仓库「依赖收口」风格） |
| iframe/Worker | 一等公民（`Comlink.wrap(windowEndpoint(iframe))`） | 需自己写 `windowEndpoint` 等价物 |
| Puppeteer/CDP | **需为 CDP 边界自定义 `Endpoint`**（Comlink 只认 MessagePort 形态） | 同样要写桥，但桥就是全部、无额外抽象 |
| Transferable | 原生支持（`Comlink.transfer`） | 自己处理 transfer 列表 |
| 可单测 | 需 mock endpoint | 纯函数信封，易单测（契合仓库单测风格） |

**推荐**：两者都要为 Puppeteer 写自定义 `Endpoint`，成本相近；差别在**是否愿为 iframe 侧的人体工学
引入一个依赖**。倾向**自研极简 RPC**（无依赖、契合「只有 engine 直接依赖 pixi/mediabunny」的收口原则、
信封可纯单测），但把 `Endpoint` 接口设计成 **Comlink 兼容形态**（`postMessage`/`addEventListener`），
这样任何时候都能无缝换成 `Comlink.wrap`。实现该里程碑时按当时的 iframe 场景复杂度再定（用户已选
「两者都探讨」）。

---

## 落地顺序

1. **§A engine 层 `EngineEnv` + runtime 层 `RuntimeEnv`** ——已实现。
2. **§C headless 包抽离** ——已实现（`@sequio/headless`，RPC 的两个宿主之一就位）。
3. **§D RPC 协议** ——先定 `Endpoint` + `RenderService` 契约与自研信封，iframe 与 Puppeteer 两个适配器。
4. **§B VM 沙箱** ——`ModuleEvaluator` 接缝 + `node:vm` + 浏览器 iframe 沙箱（复用 §D 的 RPC）。

§A 的两层 env 是贯穿其余三项的骨架：sandbox 是 runtime 的一个 evaluator 维度、headless 是一个宿主
（engine 层默认 + runtime 层 env）、RPC 是 env 之间的传输。VM 沙箱的浏览器侧隔离（iframe/Worker）也会用到
engine 层的 renderer 默认与 §D 的 RPC。
