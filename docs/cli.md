# 命令行（`@sequio/cli`）

> **定位**：把「一个命令式的作曲文件」直接变成两件事——**渲染成视频**或**起一个实时预览**。
> `sequio render <file>` 和 `sequio preview <file>`（后者支持 `--watch`）。

`<file>` 就是 runtime 那套「命令式代码」的入口：一个 TS/JS 模块，默认导出一个
`defineComposition(builder)`（或裸 builder）。它和 `example/` 里的 demo、studio 代码模式的
`index.ts` **一字不差**——用引擎自己的 class `new` 出对象图。CLI 只是把这份代码在两个目的地
跑起来，两条命令都是对**其它包已有能力**的薄封装（契约 #3：预览与渲染共用同一套渲染核心）。

## 为什么是「薄封装」

- **渲染**的重活（真正的 WebGL + WebCodecs、编解码协商、写容器）已经存在于 `server` 的
  **Route A**（无头 Chrome）页面里（`route-a/ssr-render.html` → `window.__SSR__.renderBundle`）。
- **预览**的重活（编译+链接+运行、挂时钟、`renderPreview`）已经存在于 `runtime` 的
  `Composer.preview()` 里，studio 的代码模式就是它的参考消费者。

所以 CLI 不重造渲染核心，只做三件事：① 把入口文件所在目录快照成一个 `RuntimeBundle`；
② `render` 把 bundle 交给无头 Chrome 跑 Route A 页面、写出视频；③ `preview` 起一个 Vite
开发服务器，页面里 `Runtime → Composer → preview()` 实时上屏。

## 组成（`packages/cli`）

```
bin/sequio.js   `sequio` 可执行文件 —— 用 tsx 跑 src/cli.ts（无需先 build，和 route-b/verify 脚本一致）
src/
  args.ts       纯函数 argv → CliCommand 解析（单测覆盖，不碰 I/O）
  bundle.ts     磁盘上的入口文件 → RuntimeBundle（NodeFileSystem 快照同目录所有文件）
  render.ts     `render <file>`：程序化起 Vite（根=server 包）+ Puppeteer 驱动 Route A 页面
  preview.ts    `preview <file>`：程序化起 Vite（根=preview/），serve /__bundle，--watch 全量刷新
  cli.ts        解析 + 分发 + 进程生命周期（退出码、Ctrl-C）；index.ts 是程序化 barrel
preview/        预览页（index.html + preview.ts：fetch /__bundle → Runtime → preview() + 播放条）
scripts/        verify-cli.ts（端到端：render + preview 都跑一遍 example/）
example/        一段样例作曲（index.ts + scene.ts，跨文件 import）
tests/          args + bundle 单测
```

### 从入口文件到 bundle（`bundle.ts`）

`readBundle(entryFile)` 只读磁盘、**不运行**作曲（不碰 `@sequio/engine`、不碰 DOM，所以又轻又
好测）。入口文件所在目录就是**项目根**：目录下所有文件都被快照进 `{ files, entry }`，于是入口的
相对 import（`./scene`、`./title`，含子目录）在浏览器里能原样解析。路径用虚拟绝对形式
（`/index.ts`），和 runtime 的 VFS 约定一致。

### `render`（无头 Chrome）

`runRender()`：`readBundle` → 程序化 `createServer`（Vite 根设在 `server` 包、给 engine/runtime
配好 source alias）→ Puppeteer 打开 `route-a/ssr-render.html`、等 `window.__SSR__` 就绪 →
`renderBundle(bundle)` 在浏览器里**重新运行同一份 builder**（契约 #3）并编码 → 把返回的 base64
写到 `--out`。默认输出 `out.<container>`（容器由页面按浏览器可编码的编解码器协商，无头
Chrome + SwiftShader 通常给 `mp4/avc`）。`--verify` 按魔数校验产物确实是合法容器。

> 用**程序化 Vite**（`createServer`）而不是 spawn `vite` 二进制，这样不依赖 `vite` 的 bin 在
> 某个版本的 `exports` 里怎么暴露——只要能 `import('vite')` 就行。

### `preview`（`--watch`）

`startPreviewServer()`：程序化起一个根在 `preview/` 的 Vite 开发服务器，并挂一个插件：

- **`/__bundle`**：每次请求都**现读磁盘**返回当前项目快照，所以任何一次刷新都拿到最新源码；
  读失败（比如语法写坏了）也照常返回 500 + 错误信息，让浏览器把错误显示出来、而不是让服务器崩。
- **`--watch`**：项目文件不在 Vite 的模块图里（是当 JSON 抓的），Vite 不会自动盯它们——插件
  显式 `watcher.add(projectDir)`，任一文件 `change/add/unlink` 就 `ws.send({ type: 'full-reload' })`。
  页面整页重载、重新 `fetch('/__bundle')`、重跑 `Runtime → Composer → preview()`——所见即改。

预览页（`preview/preview.ts`）本身就是 runtime 的又一个参考消费者：抓 bundle、`new Runtime(bundle).run()`
得到 `Composer`、`composer.preview(stage)` 挂画布 + 播放/拖动条。浏览器天生有
WebGL/WebCodecs/Web Audio，所以预览是**全保真**的渲染核心，不需要无头 worker。

## 用法

```bash
# 渲染成视频（无头 Chrome；--out 省略则 out.<container>）
pnpm sequio render example/index.ts --out demo.mp4 --verify

# 实时预览（默认端口 6180；--watch 改文件即时重载；--host 暴露到局域网）
pnpm sequio preview example/index.ts --watch

# 直接用 bin（等价）
node packages/cli/bin/sequio.js preview example/index.ts --watch
```

作为库调用（`@sequio/cli` barrel）：`parseArgs`、`readBundle`、`runRender`、`startPreviewServer`。

## 校验（tests & docs 是「完成」的一部分）

- **纯逻辑单测**（`tests/`，vitest，无 GPU/DOM）：`args`（每个子命令的旗标、错误分支、端口校验）、
  `bundle`（快照入口 + 同目录/子目录文件、缺文件报错）。
- **端到端**（`pnpm verify:cli`，Puppeteer + Chrome-for-Testing）：对样例作曲跑一遍
  `render`（断言产出合法 MP4）与 `preview`（无头浏览器打开预览页，断言
  `window.__PREVIEW_TEST__.ok`——作曲真的在浏览器里跑起来、有轨道有时长）。本会话手验通过。
