# 里程碑 10 — 代码运行时（`@video-editor-canvas/runtime`）

**状态：✅ Done**（编译 + 链接 + 运行多文件 TS/JS → `Composer`；用户用引擎 class **命令式**
搭图；预览 / 导出 / 服务端渲染三处消费；studio「代码模式」demo 落地。设计见
[`docs/runtime.md`](../docs/runtime.md)。）

## 目标

让上层能**用代码描述视频**：一段多文件的 TS/JS 程序，用引擎自己的 class 命令式搭对象图
（和 `example/` demo 一样，可 `new` 自己的 `Clip`/`Effect` 子类，无 JSON 协议要同步），编译并
运行后得到一个 `Composer`，接到引擎的同一套渲染核心（契约 #3）。产出一处，消费三处——浏览器
预览、浏览器导出、把**源码 bundle** 交给服务端重新运行。

## 范围

- **虚拟文件系统**：`FileSystem` 接口 + `InMemoryFileSystem`（浏览器安全）；可注入真实文件系统
  （`NodeFileSystem`，`node:fs`，走 `@video-editor-canvas/runtime/node-fs` 子路径，不进 barrel）。
- **编译**：`typescript` 的 `transpileModule` 逐文件 TS/JS → CommonJS（纯 JS，浏览器可跑）。
- **模块链接器**：极小 CJS 加载器；相对 import 在 VFS 解析，裸标识走注入的 `externals`——**默认注入
  真实的 `@video-editor-canvas/engine` 命名空间**（让用户 `new` 引擎 class）+ runtime 作者 API；
  惰性求值 + 缓存 + 循环 import。
- **作者 API**：`defineComposition(builder)`——builder 命令式建图、返回
  `{ compositor, audioEngine?, duration? }`（duration 省略则从 clip 末端推导）；`env.compositorOptions`
  让服务端注入渲染器。
- **`Composer`**：`preview()` / `export()`（客户端，各自重跑 builder 得独立图）+ `toBundle()`
  （服务端：源码文件本身）。
- **服务端渲染（跑同一份代码）**：Route A `renderBundle(bundle)` + Node worker `ssr:render --bundle`。
- **studio 代码模式**：`code.html` + `src/code-mode.ts`，命令式多文件编辑器 → Run → Composer →
  预览 / 导出 / 下载 bundle；主编辑器工具栏入口。

## 验收标准

- ✅ 多文件命令式程序（互相 import、`new` 引擎 class）能编译 + 链接 + 运行成 `Composer`；入口默认
  导出可为 `defineComposition(builder)` 或裸 builder 函数。
- ✅ 相对 import、`..`、`/index.*`、externals（含真实 engine 命名空间）、单例缓存、循环 import 均
  正确；解析失败以 `ModuleResolutionError` 透传。
- ✅ 注入的（真实/鸭子类型）文件系统可用。
- ✅ `Composer.preview` 在浏览器出画面；`Composer.export` 导出可解回的视频；`toBundle()` 快照源码。
- ✅ 服务端 `renderBundle` / `ssr:render --bundle` 重新运行代码产出合法容器。
- ✅ 单测覆盖 VFS / 编译 / 链接器 / composition / run / node-fs（`packages/runtime/tests`，40 项）；
  e2e `pnpm verify:runtime`（两文件命令式 TS → Composer → 预览读像素 + 导出解回 + toBundle）；
  `pnpm verify:ssr` 覆盖导入 runtime 后的 SSR 页；`ssr:render --bundle` 手验通过。
