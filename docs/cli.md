# 命令行（`@sequio/cli`）

> **定位**：把「一个命令式的作曲文件」直接变成两件事——**渲染成视频**或**起一个实时预览**。
> `sequio render <file>` 和 `sequio preview <file>`（后者支持 `--watch`）。

`<file>` 就是 runtime 那套「命令式代码」的入口：一个 TS/JS 模块，默认导出一个
`defineComposition(builder)`（或裸 builder）。它和 `example/` 里的 demo、studio 代码模式的
`index.ts` **一字不差**——用引擎自己的 class `new` 出对象图。CLI 只是把这份代码在两个目的地
跑起来，两条命令都是对**其它包已有能力**的薄封装（契约 #3：预览与渲染共用同一套渲染核心）。

## 为什么是「薄封装」

- **渲染**的重活（真正的 WebGPU 合成 + `node-av`/FFmpeg 编解码、写容器）已经存在于 `server` 的
  **Route B**（纯 Node，PixiJS WebGPU）里——本次新增的 `renderBundleToFile`
  （`@sequio/server/route-b`）把一段命令式代码在 Node 里跑成视频，不需要浏览器。
- **预览**的重活（编译+链接+运行、挂时钟、`renderPreview`）已经存在于 `runtime` 的
  `Composer.preview()` 里，studio 的代码模式就是它的参考消费者。

所以 CLI 不重造渲染核心，只做三件事：① 把入口文件所在目录快照成一个 `RuntimeBundle`；
② `render` 把 bundle 交给 Route B 在**纯 Node（WebGPU）**里跑成视频、写盘；③ `preview` 起一个
Vite 开发服务器，页面里 `Runtime → Composer → preview()` 实时上屏。

## 组成（`packages/cli`）

```
bin/sequio.js   `sequio` 可执行文件 —— 用 tsx 跑 src/cli.ts（无需先 build，和 route-b/verify 脚本一致）
src/
  args.ts       纯函数 argv → CliCommand 解析（单测覆盖，不碰 I/O）
  bundle.ts     磁盘上的入口文件 → RuntimeBundle（NodeFileSystem 快照同目录所有文件）
  render.ts     `render <file>`：readBundle → @sequio/server/route-b 的 renderBundleToFile（纯 Node WebGPU）
  preview.ts    `preview <file>`：程序化起 Vite（根=preview/），serve /__bundle，--watch 全量刷新
  cli.ts        解析 + 分发 + 进程生命周期（退出码、Ctrl-C）；index.ts 是程序化 barrel
preview/        预览页（index.html + preview.ts：fetch /__bundle → Runtime → preview() + 播放条）
scripts/        verify-cli.ts（端到端：render + preview 都跑一遍 example/）
example/        一段样例作曲（index.ts + scene.ts + font.ts=内嵌 data: URL 字体，跨文件 import）
tests/          args + bundle 单测
```

### 从入口文件到 bundle（`bundle.ts`）

`readBundle(entryFile)` 只读磁盘、**不运行**作曲（不碰 `@sequio/engine`、不碰 DOM，所以又轻又
好测）。入口文件所在目录就是**项目根**：目录下所有文件都被快照进 `{ files, entry }`，于是入口的
相对 import（`./scene`、`./title`，含子目录）在浏览器里能原样解析。路径用虚拟绝对形式
（`/index.ts`），和 runtime 的 VFS 约定一致。

### `render`（纯 Node，PixiJS WebGPU / Route B）

`runRender()`：`readBundle` → `import('@sequio/server/route-b')` 的 `renderBundleToFile(bundle,{out,scale})`。
Route B 在 Node 里做完整条 decode→composite→encode：`setupNodeEnvironment()` 用 Dawn 装好
`navigator.gpu`、jsdom/`@napi-rs/canvas` 补 DOM 与字体、`@mediabunny/server`（node-av/FFmpeg）补
WebCodecs；再 `new Runtime(bundle).run()` → `composer.build({ target:'server', compositorOptions:{ createRenderer, resolution:scale } })`。
关键点：**环境差异是隐式注入的**——runtime 的 `engineForEnv` 把 `compositorOptions` fold 进用户的
`new Compositor(...)`，所以 Node 的 WebGPU renderer 和 `--scale` 倍率无需用户改一行代码就到位（契约 #3，
和浏览器预览同一套 builder）。帧由 `renderTimelineToFile` 从 GPU 读回、Mediabunny 编码写到 `--out`
（默认 `out.mp4`；容器/编码器按 node-av 能力协商，通常 `mp4/avc`）。`--verify` 按魔数校验产物。

- `--scale N`：以 N× 分辨率渲染（Route B 的 `resolution` 倍率）。渲染器会按这个 `resolution`
  生成文字等 Canvas 光栅内容(`PIXI.Text` 字形图集),所以 `--scale 2` 得到的是**真正 2× 清晰**的
  文字/边缘,而非把 1× 内容放大 —— 想和 HiDPI/retina 预览一样锐利就用 `--scale 2`。
- **需要 WebGPU 宿主**：真实 GPU，或软件 Vulkan 驱动（Mesa **lavapipe**，`apt install mesa-vulkan-drivers`）。
  没有时 `setupNodeEnvironment()` 抛出清晰的 “Route B needs a GPU or a software Vulkan driver”。

> 同一个 `renderBundleToFile` 也被 Route B worker 复用：`pnpm ssr:render-node -- --bundle bundle.json`
> （与 `--timeline` 互斥），和 Route A 的 `--bundle` 对称。

#### 字体：预览与渲染一致

浏览器里 `TextClip` 用 `document.fonts` 里的字体,Node 里 PixiJS 用 `@napi-rs/canvas` 的
`GlobalFonts` 画字——两边的**系统默认字体不同**,所以不指定字体的文字在预览和渲染里会是不同字形。
要一致就得让作曲**显式加载一个 web 字体**,两边都用它。

`TimelineSpec` 路线靠 `spec.fonts` 喂 `loadFontsNode`;**代码/bundle 路线**没有这份清单——作曲是
命令式地 `fonts.load(...)` 加载字体的,而引擎的 `FontManager` 在 Node 里是 no-op。于是
`renderBundleToFile` 在渲染前调 **`bridgeFontManagerToNode()`**:把 `FontManager` 的
`loadFace`/`loadGoogle` 钩子改接到 `loadFontsNode`,于是作曲里同一句 `fonts.load(...)` 在浏览器预览
（`document.fonts`）和 Node 渲染（`GlobalFonts`）里注册的是**同一个字体**,文字字形一致（契约 #3）。

样例 `example/font.ts` 把 Poppins 的 Latin 子集（~8 KB）作为 **`data:` URL** 内嵌,`index.ts`
`await fonts.load({ family:'Poppins', src: POPPINS_DATA_URL })` 加载它——浏览器 `FontFace` 与
Node `fetch` 都吃 `data:` URL,所以样例**零网络依赖、可复现**,预览与渲染的标题字体完全一致。

### `preview`（`--watch`）

`startPreviewServer()`：程序化起一个根在 `preview/` 的 Vite 开发服务器，并挂一个插件：

- **`/__bundle`**：每次请求都**现读磁盘**返回当前项目快照，所以任何一次刷新都拿到最新源码；
  读失败（比如语法写坏了）也照常返回 500 + 错误信息，让浏览器把错误显示出来、而不是让服务器崩。
- **`--watch`**：项目文件不在 Vite 的模块图里（是当 JSON 抓的），Vite 不会自动盯它们——插件
  显式 `watcher.add(projectDir)`，任一文件 `change/add/unlink` 就 `ws.send({ type: 'full-reload' })`。
  页面整页重载、重新 `fetch('/__bundle')`、重跑 `Runtime → Composer → preview()`——所见即改。

预览页（`preview/preview.ts`）本身就是 runtime 的又一个参考消费者：抓 bundle、
`new Runtime({ ...bundle, externals: cliExternals() }).run()` 得到 `Composer`、
`composer.preview(stage)` 挂画布 + 播放/拖动条。浏览器天生有
WebGL/WebCodecs/Web Audio，所以预览是**全保真**的渲染核心，不需要无头 worker。

### 组合里引用 gsap（开箱即用）

CLI 把 **gsap** 作为自己的依赖，并在 `render`（Node）与 `preview`（浏览器）两处都通过
runtime 的 `externals` 接缝注入（`src/externals.ts` 的 `cliExternals()` 是唯一出处，两处共用）。
所以一份组合无需任何额外安装即可：

```ts
import gsap from 'gsap';
import { gsapClipAnimator } from '@sequio/engine';
// …
title.animator = gsapClipAnimator(gsap, (tl, o) => tl.from(o, { y: -60, alpha: 0, ease: 'back.out(1.7)' }));
```

引擎本身仍**不依赖 gsap**：它只声明绑定用的结构化类型，由 CLI 这一层提供真身。服务端
Route B 的 `renderBundleToFile` 开了通用 `externals` 透传口（server 自己不引入 gsap），
`render` 命令把 `cliExternals()` 交给它——于是 Node 渲染与浏览器预览对 gsap 的解析完全一致
（契约 #3）。`example/index.ts` 的标题入场就是用 gsap 驱动的，`pnpm verify:cli` 会真跑一遍。

## 用法

```bash
# 渲染成视频（纯 Node WebGPU；--out 省略则 out.mp4；--scale N 放大分辨率）
# 需要 WebGPU 宿主（GPU 或 Mesa lavapipe）：
#   apt install mesa-vulkan-drivers
#   export VK_ICD_FILENAMES=/usr/share/vulkan/icd.d/lvp_icd.json   # 用软件驱动时
pnpm sequio render example/index.ts --out demo.mp4 --scale 2 --verify

# 实时预览（默认端口 6180；--watch 改文件即时重载；--host 暴露到局域网）
pnpm sequio preview example/index.ts --watch

# 直接用 bin（等价）
node packages/cli/bin/sequio.js preview example/index.ts --watch
```

作为库调用（`@sequio/cli` barrel）：`parseArgs`、`readBundle`、`runRender`、`startPreviewServer`。

## 校验（tests & docs 是「完成」的一部分）

- **纯逻辑单测**（`tests/`，vitest，无 GPU/DOM）：`args`（每个子命令的旗标、错误分支、端口校验）、
  `bundle`（快照入口 + 同目录/子目录文件、缺文件报错）。
- **端到端**（`pnpm verify:cli`，需 WebGPU 宿主 + Puppeteer/Chrome-for-Testing）：对样例作曲跑一遍
  `render`（Route B 纯 Node WebGPU，断言产出合法 MP4）与 `preview`（无头浏览器打开预览页，断言
  `window.__PREVIEW_TEST__.ok`——作曲真的在浏览器里跑起来、有轨道有时长）。本会话用 lavapipe 手验通过。
