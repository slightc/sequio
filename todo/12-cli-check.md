# 12 · `sequio check` — 免 GPU 的静态校验

状态：✅ Done（`sequio check <file>` + `--json`；null renderer + 字体只登记 + 轻量 headless DOM，
全程无 GPU/无网络；Stage A/B/C 诊断落地——A2/A3/A4、B1/B2/B3/B4、C1/C2/C3/C4/C5/C7/C8/C9；
`checkBundle` 纯逻辑单测 + args 单测；引擎侧新增 `AnimatableProperty.keyframeTimes` 与
`FontManager.families()`；docs/cli.md + SKILL.md 已写 `check → frame → render` 循环）

## 目标

给代码路线一个**闭合验证循环**里的第一环：`sequio check <file>` 编译 + 链接 +
跑 builder 建对象图 + 静态校验，**不触发渲染、不需要 WebGPU**。它是命令式 TS 路线里
lint 的等价物——比任何 HTML 层对 agent 成功率的提升都更直接、成本更低。验证循环从
`frame → render` 收敛成 **`check → frame → render`**：

- `check` 证明"这段代码能建成合法对象图"（快、离线、无 GPU）。
- `frame` 证明"这一帧长对了"（单帧 PNG）。
- `render` 才产出成片。

绿了 `check` 不代表画面对，但红了 `check` 一定别去 render。

## 可行性依据

对象图构建阶段**刻意不含 GPU 调用**：`Compositor` 与所有 clip 都同步构造、不碰 renderer
（见 `packages/server/src/timeline.ts` 顶部注释与 `buildTimeline` 的 headless 单测）。
`check` 给 `Compositor` 注入一个 **null renderer**（`CompositorOptions.createRenderer`
返回 no-op），于是 `await compositor.init()` 不需要 GPU；媒体源**只做存在性/可达性检查、
不解码**；字体**只登记不光栅化**。

## 范围

- `packages/cli/src/args.ts`：新增 `CheckCommand`（`sequio check <file>`），并进
  `parseArgs` 派发与 `USAGE`。纯解析、有单测。
- `packages/cli/src/check.ts`：`runCheck(file, opts)` —— bundle 入口文件 →
  `@sequio/runtime` compile+link+run（注入 null renderer）→ 遍历对象图跑校验 →
  收集 `Diagnostic[]`（`{ severity: 'error' | 'warn', code, message, at? }`）→
  人类可读输出 + 非零退出码（有 error 时）。`--json` 输出机读诊断。
- `packages/cli/src/cli.ts`：分发 `check`。
- **引擎小幅配合**（都不涉及 GPU，供 Stage C 校验查询）：
  - `FontManager` 暴露"已登记 family"集合（供 C4 交叉核对）。
  - `Track` / `Transition` 暴露过渡绑定的 clip 与重叠窗口（供 C5）。
  - `EffectRegistry` 暴露已实现 effect 列表（供 C6）。
- 一个 null renderer 工厂（headless，`init()`/`renderSync()` no-op），放在
  runtime 或 cli，供 check 复用。

## 校验项清单（无 GPU 阶段能捕获什么）

### Stage A — 编译 / 链接（纯 runtime，零引擎、零 GPU）
- **A1** TS/JS 转译失败（语法/类型错误）。
- **A2** 相对导入解析失败（`./scene` 不在 bundle 里）。
- **A3** 外部依赖未注入（bare import `gsap` 未经 `externals`/CLI 提供）。
- **A4** 入口形状错误（无 default export，或 default 不是 `defineComposition` builder）。

### Stage B — 跑 builder（null renderer，无 GPU）
- **B1** builder 抛异常，或未返回 `{ compositor }`。
- **B2** 命中 `throw … not implemented`（未实现里程碑）——大声暴露而非黑帧。
- **B3** 添加 track 前忘记 `await compositor.init()`。

### Stage C — 遍历已建对象图（静态校验，无 GPU）
- **C1** clip 时间非法：`start`/`end` 为 `NaN`/`undefined`、`end ≤ start`、`start < 0`。
- **C2** 关键帧时间越界：`time` 落在 clip `[start, end)` 之外（死关键帧）。
- **C3** 时长越界：clip `end` 超过声明的 `duration` / 显式 `range`。
- **C4** 字体未注册：`TextClip.fontFamily` 无对应 `fonts.load`——静默退回系统字体，
  破坏契约 #3（preview == render）。**优先级高**（失败完全静默）。
- **C5** 过渡绑定：`.between(a, b)` 的 clip 不在同一 track，或两 clip **不重叠**
  （过渡窗口为空）。**优先级高**（命令式 API 里最易写错却无报错）。
- **C6** 效果可用性：未实现/未知 effect（chroma/LUT/wipe 仍 TODO）或参数名拼错。
- **C7** 本地资源缺失：`loadAsset('./video.mp4')` 在磁盘上不存在。
- **C8** anchor 归一化越界：`anchor` 越出 `[0, 1]`（把像素值误当归一化）。
- **C9** `sourceIn/sourceOut` 越界：超过媒体时长——**仅当**元数据已取到（best-effort）。

### 明确不捕获（写进 `--help` / 文档，避免 check 通过被误读成"能渲出来"）
- 媒体真解码（编解码器支持、文件损坏）——需 WebCodecs/decoder。
- 视觉正确性（布局/颜色/文字溢出）——交给 `sequio frame`。
- WebGPU 可用性 / filter shader 编译——属 `render`/`frame`。
- 音频混音结果——属 `audio`。

## 验收标准

- [x] `parseArgs` 解析 `check <file>` + `--json`；缺 file/未知 flag 报错（单测）。
- [x] Stage A/B 诊断：故意坏样例（语法错、悬空 import、外部未注入、无 default、缺 init）各得对应
      error code（单测，喂 in-memory bundle，无 GPU）。
- [x] Stage C 诊断：`end ≤ start`、关键帧越界、字体未注册、过渡不重叠、anchor 越界
      各触发对应 code；合法组合零诊断（单测）。
- [x] 有 error 时进程非零退出；`--json` 输出可解析的 `Diagnostic[]`。
- [x] `check` 全程不初始化真实 GPU renderer（null renderer；在无 Vulkan 的 CI 也能跑）。
- [x] 文档：[`docs/cli.md`](../docs/cli.md) 增 `check` 一节 + SKILL.md 工作流章节
      写入 `check → frame → render` 循环 + 本文件。

## 实现记要（与设计的差异）

- **C6（效果可用性）未做**：命令式路线里 effect 是 `new ColorEffect()` 直接构造的，未实现的
  effect 会在编译/运行期就报错（落到 Stage A/B），没有一张「已声明 effect 名」的清单可静态比对，
  故本阶段略过 C6（`EffectRegistry.types()`/`has()` 已具备，留给声明式扩展时再用）。
- **新增 `B4`（离线能力限制 → warn，不是 error）**：作曲的 builder 若在建图阶段**真解码媒体 /
  取网络图 / 建 GPU 纹理**（`example/` 里 custom-fx、summer-lookbook、media-network 都会），
  `check` 离线无 GPU 跑不动这一步。这不是作曲的 bug（`sequio render` 能正常出片），所以判为
  `warn` 而非 `error`——否则会把合法作曲误杀、破坏「红 = 真有问题」的契约。信息里提示用
  `sequio frame` 验画面。
- **轻量 headless DOM**：为让纯矢量 + 文字的作曲（如 yc-spot 的 `TextClip.split` 逐字测量）能在
  裸 Node 跑完，`check` 装一套**零依赖、离线**的 `document`/2D-canvas/`createImageBitmap` 桩
  （近似字宽即可，`check` 不出像素）。刻意不引 jsdom/`@napi-rs/canvas`、不桩 `fetch`。

## 备注

- 媒体/网络：`check` 默认**不发网络请求**（URL 源跳过或至多可选 HEAD），保持快且离线;
  只对本地 `loadAsset` 路径做存在性检查（C7）。
- 诊断分级：能确定的（Stage A/B、C1/C2/C5/C8）报 `error`；启发式的（C4 字体、C9
  sourceIn 越界）可报 `warn`，避免误杀合法但风格化的用法。
