# 代码运行时（`@sequio/runtime`）

> **定位**：把「一段多文件的 TS/JS 程序」编译、链接、运行，得到一个 **`Composer`**。
> 用户的代码**用引擎自己的 class 命令式地搭对象图**（`new Compositor()` /
> `new VisualTrack()` / `track.add(new TextClip(...))`，和 `example/` 里的 demo 一模一样），
> 而**不是**声明一份 JSON spec——所以用户可以写自己的逻辑、`new` 自己的 `Clip` / `Effect`
> 子类，也不存在「JSON 定义要和引擎能力同步」的问题。
>
> 得到的 `Composer` 是**一处产出、三处消费**：浏览器**预览**、浏览器**导出**，或把它的
> **源码（bundle）** 交给服务端——服务端跑同一个 runtime、重新运行同一份代码。
>
> DAG：`engine ← runtime`（runtime 只依赖 engine）；`server` 依赖 `runtime` 以提供
> 「代码 → 服务端渲染」。

## 为什么是命令式代码，而不是 JSON

声明式 JSON spec 有两个硬伤：① 它只能表达 spec 作者预先定义好的字段，用户想加一种新
clip / effect 就得改协议；② spec 和引擎能力必须时刻同步。命令式代码没有这两个问题——
**能在 demo 里跑的，就能在这里跑**：用户 `import { Compositor, TextClip } from
'@sequio/engine'` 直接 `new`，写任意控制流、封装自己的工厂函数、甚至
`class MyClip extends VisualClip`。runtime 只负责把这段代码**在任意环境里跑起来**，并把结果
接到引擎的同一套渲染核心（契约 #3）。

## 组成（`packages/runtime/src`）

```
vfs.ts             FileSystem 接口 + InMemoryFileSystem（浏览器安全）
node-fs.ts         NodeFileSystem —— 注入真实文件系统（不进 barrel，含 node:fs）
compile.ts         单文件 TS/JS → CommonJS（TypeScript transpileModule，纯 JS，浏览器可跑）
module-runtime.ts  极小的 CommonJS 链接器：解析相对 import + 注入的 externals
assets.ts          本地媒体资源契约：loadAsset 钩子 + resolveAssetPath 路径规则
composition.ts     defineComposition(builder) 作者 API（给命令式 builder 打标记）
composer.ts        Composer：preview / export（客户端）+ toBundle（服务端）
runtime.ts         Runtime.run()：编译 + 链接 + 运行入口 → Composer
```

### 虚拟文件系统（VFS）

runtime **不直接碰 `node:fs`**——它通过 {@link FileSystem} 接口读文件，核心**浏览器安全**：
studio 的「代码模式」整段跑在标签页里，文件放在 `InMemoryFileSystem`（`路径→内容` map）。
同一接口也能**注入真实文件系统**：任何满足 `readFile / exists / listFiles` 的对象都行，Node
侧用 `NodeFileSystem` 包一层 `node:fs`（在 `@sequio/runtime/node-fs` 子路径，
刻意不进浏览器 barrel）。路径 POSIX 风格、以虚拟根 `/` 为绝对基准；`normalizePath /
dirname / joinPath` 纯函数、单测覆盖。

### 编译 + 模块链接

链接器自己接管模块，所以每个文件先用 TypeScript 的 `transpileModule` **逐文件**降到
CommonJS（去类型、不做类型检查、不跨文件解析；`typescript` 纯 JS，浏览器里由 Vite 打包后照跑）。
`ModuleRuntime` 在 VFS 上做一个极小的 CJS 加载器，`require` 分两路：

- **相对**（`./foo`、`../bar`）→ VFS 上按扩展名/index 候选查找（`.ts` `.tsx` `.js` `.jsx`
  `.mjs` `.cjs` `.json`、`/index.*`）。
- **裸标识** → 注入的 `externals` map。runtime **默认注入两个**：
  - `@sequio/engine` → **真实的引擎命名空间**，于是用户代码能
    `import { Compositor, VisualTrack, TextClip } from '@sequio/engine'` 并 `new` 它们；
  - `@sequio/runtime` → `defineComposition` 等作者 API。
  宿主可再追加更多 externals。

### 引用第三方库（如 gsap）

`RuntimeOptions.externals` 就是让用户代码 `import` 引擎之外第三方库的**接缝**——把
「裸标识 → 模块值」注入进来即可，无需打包、无需在 VFS 里放文件：

```ts
import gsap from 'gsap';
new Runtime({ files, externals: { gsap } });
// 用户代码里：
//   import gsap from 'gsap';
//   import { gsapClipAnimator } from '@sequio/engine';
//   clip.animator = gsapClipAnimator(gsap, (tl, o) => tl.from(o, { y: -60, alpha: 0 }));
```

引擎自身**不依赖 gsap**（只声明绑定用的结构化类型）；由**宿主**提供 gsap 并注入。
注意 `toBundle()` 只快照**源文件**、不含 externals，所以每个**重跑**点都要各自再注入一次：
`sequio` CLI 已在 `render`（Node）与 `preview`（浏览器）两处都注入了 gsap（见
[cli.md](cli.md)），服务端 Route B 的 `renderBundleToFile` 也开了 `externals` 透传口。

模块**惰性求值 + 缓存**（标准 CJS，循环 import 看到部分 `exports`）；解析失败以
`ModuleResolutionError` 透传。全是对 VFS + 代码转换钩子的纯控制流，脱离 GPU/DOM 单测。

### 引用本地媒体资源（`loadAsset`）

作曲要引用**磁盘上就在自己旁边**的本地图片/视频，用 runtime 内建的 `loadAsset`
钩子（从 `@sequio/runtime` import）——按项目相对路径要一个文件、拿回 `Blob`，
`ImageSource` / `VideoSource` 都直接吃 `Blob`：

```ts
import { defineComposition, loadAsset } from '@sequio/runtime';
export default defineComposition(async () => {
  const video = new VideoSource({ src: await loadAsset('./clip.mp4') });
  const image = new ImageSource({ src: await loadAsset('./assets/photo.jpg') });
  // …
});
```

runtime 只拥有**契约**（`@sequio/runtime` 上的 `loadAsset` 符号 + `src/assets.ts` 的
路径规则：相对项目根 `/` 解析、拒绝 `..` 越界）；真正的字节由**宿主**通过
`RuntimeOptions.loadAsset` 提供，所以同一句 `loadAsset('./clip.mp4')` 在哪跑都一致
（契约 #3）：浏览器预览从 dev server 抓、Node 渲染从磁盘读、编辑器从上传库取。未配置
loader 时 `loadAsset` **清晰报错**（不静默渲染黑帧）。

关键一点：**资源永远不进源码 bundle**（bundle 只含文本源文件）——一个几十 MB 的本地
`.mp4` 既不会撑大传输/提交体积，也不会被当 UTF-8 读坏。`sequio` CLI 在 `preview`
（dev server 的 `/__asset/…` 静态路由）与 `render`（磁盘直读）两处都注入了 loader，
服务端 Route B 的 `renderBundleToFile` 也开了 `loadAsset` 透传口（见 [cli.md](cli.md)）。

### 作者 API：`defineComposition(builder)`

用户默认导出一个 **builder 函数**，在里面用引擎 class 搭好图、返回活的对象：

```ts
import { Compositor, VisualTrack, TextClip } from '@sequio/engine';
import { defineComposition } from '@sequio/runtime';
import { title } from './title';                 // 跨文件 import 在 VFS 里解析

export default defineComposition(async () => {
  const compositor = new Compositor({ width: 640, height: 360, fps: 30 }); // fps 省略则默认 30
  await compositor.init();
  const track = new VisualTrack();
  track.add(title());                             // title() 里 new TextClip(...)
  compositor.addTrack(track);
  return { compositor, duration: 4 };             // duration 可省略，则从 clip 末端推导
});
```

注意这段代码**和 `example/` 里的 demo 一字不差**——没有 `env`、没有 spread。环境差异
（Node 的 WebGPU renderer、输出倍率）由 runtime **隐式注入**：见下节。返回值
`{ compositor, audioEngine?, duration? }`，`duration` 省略时从各轨道 clip 的最大 `end` 推导
（`deriveDuration`）。音频**默认排到 `compositor.audioEngine` 上**（每个 `Compositor` 自带一个，
共用它的 `timebase`），builder 不必自己 `new AudioEngine` 或把它 return 出来——渲染/导出会自动取
`compositor.audioEngine` 混音。`audioEngine` 返回值只在你要用**另一个**引擎覆盖时才需要。`defineComposition` 只给 builder 打个 tag，让 runtime 能区分「用户返回了
一个 composition」和「返回了别的东西」，其余全靠 builder 本体。builder 仍可选地接收一个
`env` 参数（`{ compositorOptions, target }`），需要按 preview/export/server 分支时才用。

### 隐式注入环境选项（`env.compositorOptions`）

同一个 builder 会在**客户端预览、客户端导出、服务端渲染**下各跑一次，唯一的差别是
`Compositor` 的构造选项（服务端要注入自己的 `createRenderer`、可能放大 `resolution`）。为了
让用户代码**读起来就是普通 demo**、不必写 `...env.compositorOptions`，runtime 每次 `build(env)`
都**重新 link 一遍**，并注入一个「按环境定制的引擎命名空间」——其中 `Compositor` 是真实
`Compositor` 的子类，构造时把该次环境的选项 fold 进去（`engineForEnv`）：

```ts
class RuntimeCompositor extends Compositor {
  constructor(options) { super({ ...options, ...envOverrides }); } // env 覆盖优先
}
```

于是用户写 `new Compositor({ width, height, timebase })`，服务端的 `createRenderer` /
`resolution` 依然到位；浏览器下 overrides 为空，直接返回真实命名空间、零开销。每次 build
重新 link 还带来一个好处：**每次 build 是独立的模块状态**（预览与导出互不串），转译结果按
文件缓存，所以重复 link 只是重跑一遍很轻的模块体。

### 统一环境模型（`RuntimeEnv` / `setEnv`）

上一节的 `env.compositorOptions` 只是「环境」的一部分。真正的宿主差异还包括：一次性引导
（装浏览器 globals、钉 mediabunny 实例、桥接字体）、额外 `externals`（gsap…）、`loadAsset`。过去这些
散落在每个服务端入口里逐字重复。`src/env.ts` 的 **`RuntimeEnv`** 把它们收进一个可注入对象：

```ts
export interface RuntimeEnv {
  readonly name?: string;
  readonly target?: 'preview' | 'export' | 'server';
  setup?(): Promise<void> | void;                         // 一次性宿主引导（Composer 缓存，仅跑一次）
  readonly externals?: Externals;
  readonly loadAsset?: AssetLoader;
  resolveCompositorOptions?(): Promise<Partial<CompositorOptions>> | Partial<CompositorOptions>;
  dispose?(): Promise<void> | void;
}
export const browserEnv: RuntimeEnv = { name: 'browser', target: 'preview' };
```

- **安装**：`new Runtime({ files, env })` 或 `runtime.setEnv(env)`（可链式）。`env.externals` 折进注入的
  裸模块（**显式 `RuntimeOptions.externals` 覆盖 env 的**），`env.loadAsset` 作为 loader 兜底。
- **消费**：`Composer.build()` 先跑 `env.setup()`（缓存，多次 build 仅一次）→ `resolveCompositorOptions()`
  折进该次 build 的 `compositorOptions`；显式 `build({compositorOptions})` 覆盖仍生效。无 env 时行为不变。
- **renderer 默认落在 engine 层**：renderer / codec 这些引擎自己的东西由 **engine 层的 `EngineEnv` +
  `setDefaultEngineEnv()`** 设进程默认（`Compositor` 消费，显式 `CompositorOptions` 覆盖），而不是 runtime 往
  每个 build 折 `compositorOptions`——因为 DAG 是 `engine ← runtime`，engine 不能引用 runtime 的类型。
- **具体 env 由宿主提供**——「server 提供一套 server env」：`@sequio/server/route-b` 的
  **`nodeServerEnv()`**（一个 `RuntimeEnv`）在 `setup()` 里做 Node 引导并
  **`setDefaultEngineEnv({ createRenderer, resolution })` 把 renderer 注册到 engine 层**，把创建出的 renderer
  暴露成 `env.renderer` 供 GPU 读帧。`render` / `frame` / `audio` 三处入口因此塌缩成
  `new Runtime({ ...bundle, env: nodeServerEnv({ scale, externals, loadAsset }) }).run()` → `build()`。

engine 层 `EngineEnv` 与 runtime 层 `RuntimeEnv` 的分层、沙箱执行、headless 宿主、iframe/RPC 都是这套环境
模型的延伸，见 [`environments-and-rpc.md`](environments-and-rpc.md)。

### `Composer`：一处产出、三处消费

`Runtime.run()` 编译+运行入口，把 builder 规整成 `Composer`。同一个 `Composer`：

1. **客户端预览** —— `composer.preview(container)`：跑 builder 得到活的 `Compositor`，挂一个
   `RealtimeClock` 驱动 `renderPreview`，返回带 play/pause/seek 的 `PreviewHandle`。
2. **客户端导出** —— `composer.export(options)`：**再跑一次 builder**得到一张独立的图，跑引擎
   `Exporter` 导出视频 `Blob`（所以导出绝不打扰预览；与预览同一渲染核心，契约 #3）。
3. **服务端渲染** —— `composer.toBundle()`：返回**源码文件本身**（`{ files, entry }`）。服务端
   用同一个 runtime **重新运行这段代码**建图——代码就是产物，没有 spec 要序列化/同步。

每个目的地都**重新运行 builder**得到互不干扰的独立图。

## 服务端渲染（跑同一份代码）

`server` 的 **Route A（无头 Chrome）** 暴露 `window.__SSR__.renderBundle(bundle)`：用 runtime
把 bundle 的文件编译+运行成 `Composer`，在服务端建**同一张图**（契约 #3）再编码。Node worker
`route-a/ssr-render.cjs` 新增 `--bundle bundle.json`（与 `--timeline spec.json` 互斥）：

```bash
pnpm ssr:render -- --bundle bundle.json --out out.mp4   # 无头 Chrome 重新运行这段代码
```

无头 Chrome 天生有 WebGL/WebCodecs，所以命令式代码原样运行；Route B（Node WebGPU）可经
`env.compositorOptions.createRenderer` 注入渲染器（需 GPU/lavapipe）。

## studio 的「代码模式」（Code Mode）

`packages/studio/code.html` + `src/code-mode.ts` 是 runtime 的参考消费者：一个浏览器内的
多文件编辑器（文件标签 + textarea，背后 `InMemoryFileSystem`）。默认给了三文件命令式样例
（`index.ts` / `scene.ts` / `title.ts` 互相 import，全用 `new` 引擎 class）。按 **Run** 把文件交给
`Runtime` → `Composer`，同一个 `Composer` 驱动三处：**预览**（挂画布、play/scrub）、**导出**
（`composer.export({container})` 下视频）、**Server Render**（`composer.toBundle()` 下 `bundle.json`
+ 提示用 `pnpm ssr:render -- --bundle` 渲染）。编辑任意文件重跑即时可见——无构建步骤、无服务器
往返。主编辑器工具栏有「‹› Code Mode」入口。

## 校验（tests & docs 是「完成」的一部分）

- **纯逻辑单测**（`tests/`，vitest，无 GPU/DOM）：`vfs`（路径规范化、读写）、`compile`
  （去类型、ESM→CJS、JSON、诊断）、`module-runtime`（相对/index/`..` 解析、externals、单例缓存、
  循环 import、错误类型/定位）、`composition`（`defineComposition` 打标记、`deriveDuration`）、
  `runtime`（多文件命令式程序跑成 Composition、**真实 engine 命名空间注入**并 `new Timebase`、
  裸 builder 默认导出、duration 推导、入口解析、host externals、注入的真实文件系统、
  `toBundle` 快照）、`node-fs`（从磁盘读并运行）。
- **端到端**（`pnpm verify:runtime`，Puppeteer + Chrome-for-Testing）：编译+运行一段**两文件命令式
  TS 程序**（`new Compositor` / `new ShapeClip` / `track.add`）→ `Composer`，然后 ①预览渲一帧读回
  像素（非黑、颜色对）②导出成真视频解回断言帧数/颜色 ③`toBundle()`。**服务端**：`pnpm verify:ssr`
  在无头 Chrome 里加载导入了 runtime 的 SSR 页并渲染样例；`pnpm ssr:render -- --bundle` 把一段命令式
  代码 bundle 在服务端重新运行、产出合法 MP4（本会话手验通过）。studio 代码模式整链路浏览器手验通过。
