# 里程碑 10 — 代码运行时（`@video-editor-canvas/runtime`）

**状态：✅ Done**（编译 + 链接 + 运行多文件 TS/JS → `Composer`；预览 / 导出 / 服务端渲染
三处消费；studio「代码模式」demo 落地。设计见 [`docs/runtime.md`](../docs/runtime.md)。）

## 目标

让上层能**用代码描述视频**：一段多文件的 TS/JS 程序，编译并运行后得到一个 `Composer`，
接到引擎的同一套渲染核心（契约 #3）。产出一处，消费三处——浏览器预览、浏览器导出、序列化成
`TimelineSpec` 交给服务端渲染。

## 范围

- **虚拟文件系统**：`FileSystem` 接口 + `InMemoryFileSystem`（浏览器安全）；可注入真实文件系统
  （`NodeFileSystem`，`node:fs`，走 `@video-editor-canvas/runtime/node-fs` 子路径，不进 barrel）。
- **编译**：`typescript` 的 `transpileModule` 逐文件 TS/JS → CommonJS（纯 JS，浏览器可跑）。
- **模块链接器**：极小 CJS 加载器；相对 import 在 VFS 解析（扩展名/index 候选），裸标识走注入的
  `externals`（默认注入 runtime 作者 API）；惰性求值 + 缓存 + 循环 import（部分 exports）。
- **作者 API**：`defineComposition(spec)` 产出带 tag 的 `TimelineSpec`（复用 `server` 协议）。
- **`Composer`**：`preview()` / `export()`（客户端，复用 `server` 的 `buildTimeline`）+ `toSpec()`
  （服务端）。
- **studio 代码模式**：`code.html` + `src/code-mode.ts`，多文件编辑器 → Run → Composer →
  预览 / 导出 / 下载 spec；主编辑器工具栏入口。

## 验收标准

- ✅ 多文件程序（互相 import）能编译 + 链接 + 运行成 `TimelineSpec`；入口默认导出可为
  composition / 裸 spec / 工厂函数。
- ✅ 相对 import、`..`、`/index.*`、externals、单例缓存、循环 import 均正确；解析失败以
  `ModuleResolutionError` 透传。
- ✅ 注入的（真实/鸭子类型）文件系统可用。
- ✅ `Composer.preview` 在浏览器出画面；`Composer.export` 导出可解回的视频；`toSpec()` 序列化
  round-trip。
- ✅ 单测覆盖 VFS / 编译 / 链接器 / composition / run（`packages/runtime/tests`）；e2e
  `pnpm verify:runtime`（两文件 TS → Composer → 预览读像素 + 导出解回）。studio 代码模式整链路
  浏览器手验通过。
