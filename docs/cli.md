# 命令行（`@sequio/cli`）

> **定位**：把「一个命令式的作曲文件」直接变成五件事——**免 GPU 静态校验**、**渲染成视频**、
> **导出单帧快照**、**单独导出音频**或**起一个实时预览**。`sequio check <file>`、
> `sequio render <file>`、`sequio frame <file>`、`sequio audio <file>` 和
> `sequio preview <file>`（后者支持 `--watch`）。

> **验证循环**：`check → frame → render`。`check` 证明「这段代码能建成合法对象图」（快、离线、
> 无 GPU）；`frame` 证明「这一帧长对了」（单帧 PNG）；`render` 才产出成片。绿了 `check` 不代表
> 画面对，但红了 `check` 一定别去 render——它是命令式 TS 路线里 lint 的等价物。

`<file>` 就是 runtime 那套「命令式代码」的入口：一个 TS/JS 模块，默认导出一个
`defineComposition(builder)`（或裸 builder）。它和 `example/` 里的 demo、studio 代码模式的
`index.ts` **一字不差**——用引擎自己的 class `new` 出对象图。CLI 只是把这份代码在两个目的地
跑起来，两条命令都是对**其它包已有能力**的薄封装（契约 #3：预览与渲染共用同一套渲染核心）。

## 为什么是「薄封装」

- **渲染**的重活（真正的 WebGPU 合成 + `node-av`/FFmpeg 编解码、写容器）由 **Route B**
  （纯 Node，PixiJS WebGPU）承担——它现在住在 CLI 自己的 `src/node-render/`，在 `@sequio/server`
  提供的 `serverEnv`（Node 渲染环境）下运行；`renderBundleToFile` 把一段命令式代码在 Node 里跑成
  视频，不需要浏览器。
- **预览**的重活（编译+链接+运行、挂时钟、`renderPreview`）已经存在于 `runtime` 的
  `Composer.preview()` 里，studio 的代码模式就是它的参考消费者。

所以 CLI 不重造渲染核心，只做这几件事：① 把入口文件所在目录快照成一个 `RuntimeBundle`；
② `render` 把 bundle 交给 Route B 在**纯 Node（WebGPU）**里跑成视频、写盘；③ `frame` 走同一条
Route B，只 seek 一帧导出 PNG（快速自检）；④ `audio` 走同一条 Route B，只把 `AudioEngine` 的
离线混音导出成音频文件（不渲染任何帧）；⑤ `preview` 起一个 Vite 开发服务器，页面里
`Runtime → Composer → preview()` 实时上屏。

## 组成（`packages/cli`）

```
bin/sequio.js   `sequio` 可执行文件 —— 用 tsx 跑 src/cli.ts（无需先 build，和 verify 脚本一致）
src/
  args.ts       纯函数 argv → CliCommand 解析（单测覆盖，不碰 I/O）
  bundle.ts     磁盘上的入口文件 → RuntimeBundle（NodeFileSystem 快照同目录所有文件）
  check.ts      `check <file>`：readBundle → runtime 编译+链接+跑 builder（注入 null renderer，无 GPU/网络）→ 遍历对象图静态校验 → Diagnostic[]
  render.ts     `render <file>`：readBundle → 本地 `./route-b` 的 renderBundleToFile（纯 Node WebGPU，跑在 @sequio/server 的 serverEnv 上）
  frame.ts      `frame <file>`：readBundle → `./route-b` 的 renderBundleFrameToFile（seek 一帧 → PNG，同一渲染核心）
  audio.ts      `audio <file>`：readBundle → `./route-b` 的 exportBundleAudioToFile（只导离线混音 → m4a/mp3/wav/ogg/webm）
  node-render/  Route B 代码渲染实现（Node-only，惰性 import）：export-node（GPU 读帧循环）+ render-bundle + frame-node + audio-node + barrel
  preview.ts    `preview <file>`：程序化起 Vite（根=preview/），serve /__bundle，--watch 全量刷新
  cli.ts        解析 + 分发 + 进程生命周期（退出码、Ctrl-C）；index.ts 是程序化 barrel
preview/        预览页（index.html + preview.ts：fetch /__bundle → Runtime → preview() + 播放条）
scripts/        verify-cli.ts（端到端：render + frame + audio + preview 都跑一遍 example/）
example/        一段样例作曲（index.ts + scene.ts + font.ts=内嵌 data: URL 字体，跨文件 import）
  custom-fx/    **自定义 effect · transition · animation** demo：在作曲代码里扩展引擎的四个扩展点，
                直接塞进 `clip.effects` / `track.addTransition(...)` / `clip.animator` /
                `textClip.textAnimator`。`fx.ts` 定义四个类：`FocusPull extends BlurEffect`（一个
                `focus` 旋钮做 blur→sharp 对焦）+ `PopEffect extends ColorEffect`（一个 `pop` 旋钮联动
                亮度/对比度/饱和度）、`EasedCrossfade extends CrossfadeTransition`（覆写 `progressAt`
                给溶解加缓动）、`OrbitAnimator implements ClipAnimator`（`sampleAt` 纯函数做绕圈+自转+
                脉动）、`DropInTextAnimator implements TextAnimator`（`sampleForPart` 逐字掉落淡入）。
                `index.ts` 把它们编成四个带标号的分镜依次展示：① effect 打在一个 shape emblem 上（从
                模糊对焦并 pop 一下）；② transition 在**两张网络图片**之间溶解；③ animation 用
                `OrbitAnimator` 驱动一个 shape 绕圈；④ text animation 逐字掉落拼出「sequio」。四个类都
                不碰 `pixi.js`（只 import `@sequio/engine`）、复用父类内建滤镜或为纯数学，故 preview
                (WebGL) 与 `render`(Node WebGPU) 表现一致（契约 #2/#3）。transition 分镜走网络取图，需联网
                （取图失败自动降级，和 media-network 一样）
  media-network/  引用**网络** image + video 的 demo（ImageSource/VideoSource 直接吃 URL，零本地文件）
  media-local/    引用**本地** image + video 的 demo（loadAsset('./video.mp4')；媒体 .gitignore、不进仓库）
  stress-test/    渲染管线的**负载压力测试** demo（1920×1080/30fps/12s）：顶部 LOAD KNOBS 常量可调——
                  背景是 VIDEO_LAYERS 路**各不相同**的网络视频拼成的宫格（默认 4 → 2×2，每路各占一个
                  象限、cover 裁切后用 GroupClip.maskShape 裁到格内，全程解码，最重的一档）、上面浮着
                  IMAGE_TILES 张关键帧动画的网络图卡（picsum 按 seed 取图、各不相同、留缝透出背景视频）、
                  SHAPE_CONFETTI 个飘落 ShapeClip、TEXT_LABELS 条闪烁 TextClip，外加汇报当前档位的 HUD 标题。
                  全部媒体走 URL、零本地文件，用固定种子的 PRNG 保证布局在多次 render 间确定（契约 #2）。
                  preview 看实时帧率、render/frame 压满 never-drop 路径；把 KNOBS 调大即可加压
  yc-spot/      独立 showcase：仿 Y Combinator 编辑风格的 15s 动态海报（1920×1080/30fps）——
                index.ts（入口）+ theme.ts（配色/字号/四幕时间轴）+ kit.ts（卡片/徽章/统计条/
                连线等可复用 builder）+ scenes.ts（四幕分镜）。全部用引擎自身的
                ShapeClip/TextClip/GroupClip 搭出、无位图；**动效全部由 gsap 驱动**——入场/退场
                用 `gsapClipAnimator` 绑 paused 时间轴（`back.out`/`power` 缓动 + 轻微 overshoot），
                首屏标题用 `gsapTextAnimator` + `split:'line'` 做逐行 stagger。它是独立目录、自成
                一个 bundle，不与上面的 index.ts demo 相互影响
  valentine/    独立 showcase：竖屏（1080×1920/9:16）「Valentine's Day Sale」促销短片（~11s，七个硬切
                分镜）——index.ts + theme.ts（玫瑰配色/字号/时间轴/网络图集）+ kit.ts（回声堆叠字、
                弧形字、拱形裁图、点阵等 builder）+ scenes.ts（七幕）。全部用 ShapeClip/TextClip/
                GroupClip 搭出，并用到两个引擎能力：`TextClip` 排版直通（空心 SUPER 描边、斜体
                MAKE IT YOURS、字距）与 `VisualClip.maskShape`（把网络照片裁成拱形）。图片走网络
                （Unsplash，自由授权占位图，加载失败自动降级为纯色块），不进仓库
  summer-lookbook/ 独立 showcase：仿时尚品牌「2023 Summer Collection」的 9:16 竖屏宣传片
                （720×1280/30fps，~17s、七个场景）——index.ts（入口）+ theme.ts（配色/字体/
                场景时间轴/图片 URL）+ kit.ts（带白边相框 framedPhoto、矢量地球 globe、逐字
                成弧的 arcText 等 builder）+ scenes.ts（七幕分镜）。相框是 GroupClip（白垫 +
                ImageClip）、色带/药丸/地球是 ShapeClip、所有标题都是 TextClip（含逐字符拼出
                的弧形字幕）；照片沿用 media-network 的做法用公开 Unsplash URL 直接引用、不进
                仓库；动效为关键帧 + gsap 入场，末幕相框用 BlurEffect 做动态模糊收束
tests/          args + bundle 单测
```

### 从入口文件到 bundle（`bundle.ts`）

`readBundle(entryFile)` 只读磁盘、**不运行**作曲（不碰 `@sequio/engine`、不碰 DOM，所以又轻又
好测）。入口文件所在目录就是**项目根**：目录下所有文件都被快照进 `{ files, entry }`，于是入口的
相对 import（`./scene`、`./title`，含子目录）在浏览器里能原样解析。路径用虚拟绝对形式
（`/index.ts`），和 runtime 的 VFS 约定一致。

### `check`（免 GPU 的静态校验）

`sequio check <file>` 是验证循环 `check → frame → render` 里最便宜的第一环：**不渲染、不需要
WebGPU、默认不发网络请求**，只把作曲**编译 + 链接 + 跑 builder 建对象图**，再遍历这张图，把
一批离线就能抓到的错误一次性报出来。它是给人、更是给 **AI** 用的「渲染前 lint」——比渲一整段
视频（甚至比 `frame` 渲一帧）都快得多，绿了才值得往下走。

`runCheck()` → `checkBundle(bundle)`（纯逻辑、无 Node 依赖、可单测）：`readBundle` 拿到 bundle，
`new Runtime(...)` 编译链接，`composition.build(env)` 跑 builder。关键是**三处「假环境」**让 builder
在无 GPU 的裸 Node 里也能跑完：

- **null renderer**：`CompositorOptions.createRenderer` 注入一个 no-op renderer，于是
  `await compositor.init()` 不碰 WebGPU，在没有 Vulkan 的 CI 上也能跑。
- **字体只登记不光栅化**：把 `FontManager` 的 `loadFace`/`loadGoogle` 钩子改成 no-op，作曲里的
  `fonts.load(...)` 仍会**登记字体族名**（供 C4 交叉核对），但不构造 `FontFace`、不发网络。
- **轻量 headless DOM**：给纯矢量 + 文字的作曲补一个**零依赖、离线**的 `document` + 2D canvas
  （`measureText` 返回近似字宽）与 `createImageBitmap` 桩，于是 PixiJS 的文字排版（`TextClip.split`
  的逐字/逐词测量）能在 Node 里完成。它**不**引 jsdom/`@napi-rs/canvas`（那是 Route B 真渲染的事）、
  **不**桩 `fetch`——所以在 builder 里真去解码媒体/取网络图的作曲不会「假装通过」，而是记一条 `B4` 警告。

校验项分三个阶段，每条诊断带 `severity`（`error` 令进程非零退出；`warn` 仅提示）、`code`、`message`
与 `at`（在图里的位置）：

| 阶段 | code | 抓什么 |
|---|---|---|
| A 编译/链接 | `A2`/`A3`/`A4` | 相对导入解析失败 / 外部依赖（如 gsap）未注入 / 入口没默认导出一个 `defineComposition` |
| B 跑 builder | `B1`/`B2`/`B3`/`B4` | builder 抛异常 / 命中 `throw … not implemented` / 忘了 `await compositor.init()` / **需要 check 不提供的能力**（媒体解码·网络·GPU 纹理，记 `warn`） |
| C 遍历对象图 | `C1`/`C2`/`C3`/`C4`/`C5`/`C7`/`C8`/`C9` | clip 时间非法（`end ≤ start`/`start < 0`/非有限）/ 关键帧越界（死关键帧）/ clip 超出声明的 `duration` / **字体未注册**（`warn`）/ **过渡的两 clip 不在同轨或不重叠** / 本地 `loadAsset` 资源缺失 / anchor 越出 `0..1`（把像素当归一化）/ `sourceOut < sourceIn`（`warn`） |

明确**不**捕获（绿了 `check` ≠ 渲得出来，写清避免误读）：媒体真解码（编解码器/文件损坏）、视觉正确性
（布局/颜色/文字溢出，交给 `frame`）、WebGPU 可用性 / filter shader 编译（属 `render`/`frame`）、
音频混音结果（属 `audio`）。

- `--json`：输出可机读的 `Diagnostic[]`（数组，含 `severity`/`code`/`message`/`at`），便于 agent/CI 解析。
- 退出码：有任一 `error` → `1`；只有 `warn` 或干净 → `0`。
- 无需 GPU、无需浏览器、默认离线——所以它跑得飞快，可在每次改完作曲后立刻跑一遍。

```bash
sequio check example/index.ts            # 人类可读：一行一条诊断 + 汇总
sequio check example/index.ts --json     # 机读：Diagnostic[] JSON
```

### `render`（纯 Node，PixiJS WebGPU / Route B）

`runRender()`：`readBundle` → 惰性 `import('./node-render')` 的 `renderBundleToFile(bundle,{out,scale})`（跑在 `@sequio/server` 的 `serverEnv` 上）。
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

### `frame`（导出单帧 PNG，纯 Node / Route B）

`sequio frame <file> --time <秒>` 只导出**某一时刻的一帧**成 PNG——不用等整段视频渲完，
就能快速肉眼确认「t=2.5s 时画面上是什么」。这是给人和 **AI** 用的快速自检口子：改完一段
作曲后渲一帧看看构图/位置/颜色对不对，比渲整段视频快得多。

`runFrame()`：`readBundle` → `./route-b` 的
`renderBundleFrameToFile(bundle,{ out, time, scale })`。它和 `render` 走**同一条 Route B 渲染
核心**（契约 #3）——`setupNodeEnvironment()` 装好 WebGPU/DOM/字体，`new Runtime(bundle).run()`
→ `composer.build({ target:'server', … })`，然后 seek 到 `time` 一帧：`await compositor.prepare(t)`
（等解码完成、不丢帧，契约 #1）→ `renderToTexture(t)` → 从 GPU 读回 RGBA → 用 `@napi-rs/canvas`
编码成 PNG 写盘。所以**导出的这一帧就是视频在该时刻的同一帧**，可拿来当渲染前的构图校验。

- `--time / -t <秒>`：要采样的时间轴时刻（默认 `0`）。**越界会 clamp** 到 `[0, duration]`——
  传 `--time 99` 而作曲只有 4s，就取末帧并在日志里提示 clamp。
- `--out / -o <path>`：输出 PNG 路径（默认 `frame.png`；扩展名强制成 `.png`）。
- `--scale / -s <n>`：以 N× 分辨率渲染（和 `render` 的 `--scale` 一致，字号/边缘真 N× 清晰）。
- 和 `render` 一样：gsap 由 `cliExternals()` 注入、本地媒体走 `nodeAssetLoader`，所以带 gsap
  动效或引用本地图片/视频的作曲也能正确取到那一帧；同样**需要 WebGPU 宿主**（GPU 或 Mesa lavapipe）。

> 注：读回的是 Pixi 渲染的 RGBA（与 `render` 的编码输入同源）。作曲通常有不透明背景，
> 所以 PNG 里 alpha 为满，肉眼校验无差异；这是「快速看一眼」的工具，不是带透明通道的成品出图。

### `audio`（单独导出音频，纯 Node / Route B）

`sequio audio <file>` 只导出作曲的**音轨**——把 `AudioEngine` 的离线混音（和 `render` 往视频里
muxes 的是同一份，契约 #3）单独编码成一个音频文件。做配乐/画外音的快速试听、或把成片音频抽出来
另作它用时，不必渲染整段视频。

`runAudio()`：`readBundle` → `./route-b` 的
`exportBundleAudioToFile(bundle,{ out, format, bitrate })`。它复用引擎的 **`Exporter.exportAudio`**：
不渲染任何帧、不走定步循环，只 `AudioEngine.renderOffline(duration)` 拿到整段混音，交给
`MediabunnyAudioExportSink`（单音轨、无视频轨）muxes 进音频容器。因为混音源与视频导出完全相同，
导出的音频就是成片的原声。

- `--format / -f <fmt>`：容器格式，取值 `mp3 | m4a | wav | ogg | webm`（默认 `mp3`；不显式给时也会
  从 `--out` 的扩展名推断）。各格式默认编码器：`mp3`→`mp3`、`m4a`→`aac`、`wav`→`pcm-s16`、
  `ogg`/`webm`→`opus`。
- `--out / -o <path>`：输出路径（默认 `out.<format>`；扩展名强制成所选格式）。
- `--bitrate / -b <bps>`：目标码率（默认 128 kbps；`wav`（PCM）无损、该项忽略）。
- 和 `render` 一样：gsap 由 `cliExternals()` 注入、本地音频走 `nodeAssetLoader`，所以引用本地
  `loadAsset('./song.mp3')` 的作曲也能正确混音。

> 音频本身不需要 GPU，但作曲的 builder 仍会 `new Compositor()` 并 `await compositor.init()`，故
> 该命令同样**需要 WebGPU 宿主**（GPU 或 Mesa lavapipe），与其它 Route B 命令一致。无音轨的作曲
> 导出的是一段静音文件（合法容器）。

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
预览页还订阅 `PreviewHandle.onContextLost`：标签页被浏览器后台回收内存后，GPU 上下文/资源会静默失效
——要么 WebGPU `device.lost` resolve，要么 device 仍在但 buffer 被回收、下次 `Queue.Submit` 报未捕获
的 "used in submit while destroyed"（都无异常抛出）——PixiJS 不会自恢复，于是**整块 canvas 一直黑、但
音频照常播放，只有刷新页面才恢复**。预览页据此用留存的 `Composer` **就地重建**预览（全新 compositor +
renderer + canvas），再 `seek` 回原时间、恢复播放态——等价刷新但不重新 fetch；丢失多在标签页仍隐藏时
到达，故重建推迟到 `visibilitychange → visible`，并对连续自动重建设了上限。（另有 `PreviewHandle.refresh()`
走 `reloadPreview` 清解码/纹理缓存、应对帧被回收的次要情形，供 host 手动调用。）

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

### 组合里引用 image / video

两个 demo 覆盖两种引用方式，都**不把媒体文件提交进仓库**：

- **网络资源**（`example/media-network/`）：`ImageSource` / `VideoSource` 直接吃 URL，
  浏览器预览 `fetch`、Node 渲染走 Mediabunny 的 `UrlSource`——同一份 builder（契约 #3）。
  素材留在源站，仓库里一个字节都不多（两条命令都需要联网）：

  ```ts
  new ImageSource({ src: 'https://picsum.photos/id/1015/1280/720' });
  new VideoSource({ src: 'https://…/sample.mp4' });
  ```

- **本地资源**（`example/media-local/`）：用 runtime 的 `loadAsset` 钩子按相对路径拿本地
  文件的 `Blob`（见 [runtime.md](runtime.md#引用本地媒体资源loadasset)）。CLI 在两处各注入
  一个 loader——`preview` 让 dev server 通过 `/__asset/…` 静态路由把项目目录下的文件发给
  浏览器，`render` 用 `src/assets-node.ts` 从磁盘直读——所以本地图片/视频**预览与渲染完全
  一致**（契约 #3）：

  ```ts
  import { defineComposition, loadAsset } from '@sequio/runtime';
  new VideoSource({ src: await loadAsset('./video.mp4') });
  new ImageSource({ src: await loadAsset('./image.jpg') });
  ```

  媒体文件不进仓库有两道保障：① `example/media-local/.gitignore` 忽略常见图/视频后缀；
  ② `src/bundle.ts` 快照项目时**跳过二进制媒体/字体**（`isBinaryAssetPath`），绝不把一个
  几十 MB 的 `.mp4` 当 UTF-8 读进 JSON bundle。demo 在你放文件**之前**也能跑：每个
  `loadAsset` 都兜底成占位块，提示该往哪放什么。

## 用法

```bash
# 免 GPU 静态校验（渲染前的 lint；--json 输出机读诊断；有 error 则非零退出）
pnpm sequio check example/index.ts
pnpm sequio check example/index.ts --json

# 渲染成视频（纯 Node WebGPU；--out 省略则 out.mp4；--scale N 放大分辨率）
# 需要 WebGPU 宿主（GPU 或 Mesa lavapipe）：
#   apt install mesa-vulkan-drivers
#   export VK_ICD_FILENAMES=/usr/share/vulkan/icd.d/lvp_icd.json   # 用软件驱动时
pnpm sequio render example/index.ts --out demo.mp4 --verify

# 导出单帧 PNG 做快速校验（--time 采样时刻，越界自动 clamp；--out 省略则 frame.png）
pnpm sequio frame example/index.ts --time 2 --out shot.png

# 单独导出音频（--format 容器，省略则从 --out 扩展名推断、再默认 mp3；--bitrate 码率）
pnpm sequio audio example/index.ts --out demo.mp3 --bitrate 192000

# 实时预览（默认端口 6180；--watch 改文件即时重载；--host 暴露到局域网）
pnpm sequio preview example/index.ts --watch

# 直接用 bin（等价）
node packages/cli/bin/sequio.js preview example/index.ts --watch

# 自定义 effect · transition · animation demo（扩展引擎四个扩展点，见 custom-fx/fx.ts；transition 分镜需联网取图）
pnpm sequio preview packages/cli/example/custom-fx/index.ts --watch
pnpm sequio render  packages/cli/example/custom-fx/index.ts --out custom-fx.mp4

# 独立 showcase（仿 YC 编辑风格、gsap 驱动的 15s 动态海报）
pnpm sequio render  packages/cli/example/yc-spot/index.ts --out yc.mp4 --verify
pnpm sequio preview packages/cli/example/yc-spot/index.ts --watch

# 独立 showcase（仿时尚品牌 9:16 竖屏宣传片、Unsplash 配图，需联网）
pnpm sequio render  packages/cli/example/summer-lookbook/index.ts --out summer.mp4
pnpm sequio preview packages/cli/example/summer-lookbook/index.ts --watch

# 引用网络 image + video（需联网）
pnpm sequio preview packages/cli/example/media-network/index.ts --watch
pnpm sequio render  packages/cli/example/media-network/index.ts --out network.mp4

# 引用本地 image + video（把 video.mp4 / image.jpg 放进 media-local/ 后再跑；文件不入库）
pnpm sequio preview packages/cli/example/media-local/index.ts --watch
pnpm sequio render  packages/cli/example/media-local/index.ts --out local.mp4
```

作为库调用（`@sequio/cli` barrel）：`parseArgs`、`readBundle`、`runCheck`、`checkBundle`、
`runRender`、`runFrame`、`runAudio`、`startPreviewServer`。

## 校验（tests & docs 是「完成」的一部分）

- **纯逻辑单测**（`tests/`，vitest，无 GPU/DOM）：`args`（每个子命令的旗标、错误分支、端口校验，
  含 `check` 的 `--json`/缺文件/未知旗标、`frame` 的 `--time`/越界/默认值、`audio` 的
  `--format`/`--bitrate` 校验与默认值）、`bundle`（快照入口 + 同目录/子目录文件、缺文件报错）、
  `check`（喂 in-memory bundle，故意坏样例逐个触发 A/B/C 各阶段 code、干净作曲零诊断——**全程无 GPU**）。
- **端到端**（`pnpm verify:cli`，`check` 无需 GPU；`render`/`frame`/`audio`/`preview` 需 WebGPU 宿主
  + Puppeteer/Chrome-for-Testing）：对样例作曲跑一遍 `check`（断言样例干净、且一个 `end ≤ start` 的坏
  作曲被判非零退出）、`render`（Route B 纯 Node WebGPU，断言产出合法 MP4）、`frame`（导出 t=2s 的一帧，
  断言产出合法 PNG——魔数校验）、`audio`（导出音轨，断言产出合法 m4a——`ftyp` box 校验）与 `preview`
  （无头浏览器打开预览页，断言 `window.__PREVIEW_TEST__.ok`——作曲真的在浏览器里跑起来、有轨道有时长）。
  本会话已对全部 7 个 `example/` 作曲手验 `check`：纯矢量/文字作曲（`index`/`yc-spot`/`valentine`）零诊断
  通过，builder 内解码媒体/取网络图的作曲（`custom-fx`/`summer-lookbook`/`media-network`）记 `B4` 警告仍
  通过，`media-local`（本地媒体未入库）正确报 `C7`。
