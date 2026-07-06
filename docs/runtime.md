# 代码运行时（`@video-editor-canvas/runtime`）

> **定位**：把「一段多文件的 TS/JS 程序」编译、链接、运行，得到一个 **`Composer`**。
> 这个 `Composer` 是**一处产出、三处消费**——在浏览器里**预览**、在浏览器里**导出**，
> 或把它序列化成 `TimelineSpec` JSON**直接交给服务端渲染**。
>
> SDK（engine）把「持久化 / schema」交给上层，`TimelineSpec` 协议放在 `server` 包；
> runtime 建在两者之上：`engine ← server ← runtime`，`engine ← runtime`。

## 为什么需要它

编辑器（studio）用鼠标搭时间线；很多场景更适合**用代码描述视频**——模板化批量生成、
参数化动画、把设计意图写成可复用的函数。runtime 提供这样一个「代码即合成」的入口：
用户写普通 TS/JS（跨多个文件、彼此 `import`），`export default defineComposition({...})`，
runtime 负责把它跑起来并把结果接到引擎的**同一套渲染核心**（契约 #3）——所以代码模式的
预览、导出、服务端渲染，与手搭编辑器逐字一致。

## 组成（`packages/runtime/src`）

```
vfs.ts             FileSystem 接口 + InMemoryFileSystem（浏览器安全）
node-fs.ts         NodeFileSystem —— 注入真实文件系统（不进 barrel，含 node:fs）
compile.ts         单文件 TS/JS → CommonJS（TypeScript transpileModule，纯 JS，浏览器可跑）
module-runtime.ts  极小的 CommonJS 链接器：解析相对 import + 注入的 externals
composition.ts     defineComposition() 作者 API（给 TimelineSpec 打标记）
composer.ts        Composer：preview / export（客户端）+ toSpec（服务端）
runtime.ts         Runtime.run()：编译 + 链接 + 运行入口 → Composer
```

### 虚拟文件系统（VFS）

runtime **不直接碰 `node:fs`**——它通过 {@link FileSystem} 接口读文件，所以核心是
**浏览器安全**的：studio 的「代码模式」整段跑在标签页里，文件放在
`InMemoryFileSystem`（一个 `路径→内容` 的 map）。同一接口也能**注入真实文件系统**：任何
满足 `readFile / exists / listFiles` 的对象都行，Node 侧用 `NodeFileSystem` 包一层
`node:fs`（在 `@video-editor-canvas/runtime/node-fs` 子路径，刻意不进浏览器 barrel）。

路径是 POSIX 风格、以虚拟根 `/` 为绝对基准；`normalizePath / dirname / joinPath` 是纯
函数，单测覆盖 `.`/`..` 折叠、不越过根、相对/绝对拼接。

### 编译（per-file transpile）

链接器自己接管模块，所以每个文件要降到 **CommonJS**（`require` / `module.exports`），而不是
ESM。用 TypeScript 编译器的 `transpileModule`——**逐文件**去类型，不做类型检查、不跨文件
解析（正是这里需要的隔离、快速转换，且 `typescript` 是纯 JS，浏览器里由 Vite 打包后照跑）。
`.json` 文件包装成导出解析值的模块。类型错误在**运行时**才暴露，不在编译期拦截（作者体验
上「能跑就行」，与 `isolatedModules` 一致）。

### 模块链接器（CommonJS）

`ModuleRuntime` 在 VFS 上做一个极小的 CJS 加载器，`require` 分两路解析：

- **相对**（`./foo`、`../bar`）→ 在 VFS 上按常规扩展名/index 候选查找（`.ts` `.tsx`
  `.js` `.jsx` `.mjs` `.cjs` `.json`、`/index.*`）。
- **裸标识**（`@video-editor-canvas/runtime`、宿主注入的名字…）→ 在注入的 `externals` map
  里查，于是「runtime 自己的作者 API」「engine 命名空间」「共享常量」等无需打包即可被
  `require`。默认注入 `@video-editor-canvas/runtime` → `{ defineComposition, … }`。

模块**惰性求值 + 缓存**（标准 CJS：执行前先入缓存，故循环 import 看到的是**部分**
`exports`）。执行体抛错时，包上「哪个模块失败」的信息；解析失败（找不到模块）以
`ModuleResolutionError` 类型透传，便于区分「缺模块」与「运行时抛错」。全是对 VFS +
一个代码转换钩子的**纯控制流**，脱离 GPU/DOM 单测。

### 作者 API：`defineComposition`

用户代码用它描述视频，产出的是 `server` 包里那份**可序列化** {@link TimelineSpec}：

```ts
import { defineComposition } from '@video-editor-canvas/runtime';
import { title } from './title';        // 跨文件 import 在 VFS 里解析

export default defineComposition({
  width: 640, height: 360, fps: 30,
  range: [0, 4],
  tracks: [{ clips: [title] }],
});
```

`defineComposition` 给 spec 打一个 tag（`__tag`），让 runtime 能把「用户返回了一个
composition」和「返回了别的东西」区分开，并对 `width/height/fps` 做轻校验（拼错时在作者
期就报错，而不是渲成黑帧）。入口的默认导出也可以直接是一个裸 `TimelineSpec`，或一个返回
它的函数（同步/异步皆可）。

### `Composer`：一处产出、三处消费

`Runtime.run()` 编译+运行入口，把结果规整成 `Composer`。同一个 `Composer` 对象：

1. **客户端预览** —— `composer.preview(container)`：用 `server` 的 `buildTimeline(spec)`
   建**活的** `Compositor` 对象图（解码源、加载字体），挂一个 `RealtimeClock` 驱动
   `renderPreview`，返回带 play/pause/seek 的 `PreviewHandle`。
2. **客户端导出** —— `composer.export(options)`：对同一张图跑引擎的 `Exporter`，导出视频
   `Blob`（与预览**同一渲染核心**，契约 #3）。
3. **服务端渲染** —— `composer.toSpec()`：返回纯 JSON 的 `TimelineSpec`，正是两条 SSR 路线
   （`pnpm ssr:render` 无头 Chrome / `pnpm ssr:render-node` 纯 Node WebGPU）消费的协议。

关键是**复用** `server` 的 `buildTimeline`（spec → 活对象图）而非另写一遍——SSR 路线调的是
同一个 builder，所以一段 composition 无论在这里预览、导出，还是发到远端渲染，行为一致。

## studio 的「代码模式」（Code Mode）

`packages/studio/code.html` + `src/code-mode.ts` 是 runtime 的参考消费者：一个浏览器内的
多文件编辑器（文件标签 + textarea，背后是 `InMemoryFileSystem`）。按 **Run** 把文件交给
`Runtime` → `Composer`，然后同一个 `Composer` 在本页驱动三处：**预览**（挂到画布、
play/scrub）、**导出**（`composer.export({container})` 下视频）、**Server Render JSON**
（`composer.toSpec()` 下 `timeline.json`，配文案提示用哪条 SSR 命令渲染）。默认给了一份三文件
样例（`index.ts` / `scene.ts` / `title.ts` 互相 import），编辑任意文件重跑即可即时看到变化——
无构建步骤、无服务器往返。编辑器主工具栏有「‹› Code Mode」入口。

## 校验（tests & docs 是「完成」的一部分）

- **纯逻辑单测**（`tests/`，vitest，无 GPU/DOM）：
  - `vfs.test.ts` —— 路径规范化、`InMemoryFileSystem` 读写/列举；
  - `compile.test.ts` —— 去类型、ESM→CJS、JSON 模块、诊断；
  - `module-runtime.test.ts` —— 相对/index/`..` 解析、externals、单例缓存、循环 import、
    解析错误类型、执行错误定位；
  - `composition.test.ts` —— `defineComposition` 校验与 tag 辨识；
  - `runtime.test.ts` —— 多文件程序端到端跑成 spec、裸 spec/工厂函数默认导出、入口解析、
    宿主 externals、**注入的（鸭子类型）真实文件系统**、`runComposition` 便捷函数。
- **端到端**（`pnpm verify:runtime`，Puppeteer + Chrome-for-Testing）：编译+运行一段**两文件
  TS 程序** → `Composer`，然后 ①预览渲一帧读回像素（非黑、颜色对）②导出成真视频 Blob 解回
  断言帧数/颜色 ③`toSpec()` 序列化。studio 代码模式页在浏览器里的整链路（3 文件 → Composer →
  画布出内容 → 导出/JSON 按钮就绪）手动验证通过。
