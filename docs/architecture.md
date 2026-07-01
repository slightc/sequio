# 架构设计：基于 PixiJS 的通用 Video Editor 底座 SDK

> **定位**：一套**命令式的对象图引擎**。使用者用 SDK 的 class 自己搭出
> `Track / Clip / Effect` 的对象树并驱动时间，SDK 负责**解码、合成、音频、导出**
> 这些底层运行时。序列化、持久化、撤销、协同、UI 全部交给上层，SDK 不碰。
>
> **不变契约**：`render(t)` 对「当前对象图状态」是纯函数——同样的对象树 + 同样的
> `t`，必出同一帧。这是导出可重放、可做 golden-frame 测试的前提。

## 分层总览

```
上层（使用者自己实现）：持久化 / schema / undo / 协同 / 时间线 UI
        │  用 SDK 的 class 构建并 mutate 对象图，连接时钟
        ▼
┌─────────────────────────── SDK 边界 ───────────────────────────┐
│  Compositor（引擎根）                                           │
│   ├─ 合成图：Track / Clip / Effect / Transition                 │
│   ├─ 动画：AnimatableProperty / Keyframe / Transform2D          │
│   ├─ 媒体：MediaSource(Video/Image/Audio) / FrameCache          │
│   ├─ 资源：TextureManager（显存预算）                           │
│   ├─ 音频：AudioEngine                                          │
│   ├─ 时间：Timebase / Clock（Realtime / FixedStep）             │
│   └─ 导出：Exporter（复用同一渲染核心）                         │
└────────────────────────────────────────────────────────────────┘
```

## 模块与源码位置

| 模块 | 源码 | 状态 |
|---|---|---|
| 时间与时钟 | `src/time/` | ✅ Timebase / RealtimeClock / FixedStepClock 已实现（视频元素式控制面：play / pause / seek + 到 `duration` 自动停止）|
| 动画原语 | `src/animation/` | ✅ AnimatableProperty / Transform2D / Easing 已实现 |
| 媒体源 | `src/media/` | 🚧 `VideoSource`（Mediabunny）+ `ImageSource`（ImageBitmap→Texture）已实现；Audio 解码待实现 |
| 纹理显存 | `src/texture/` | ✅ 字节预算 + LRU + keyed upload（`sourceId:frameIdx`）；与 FrameCache 联动，Compositor 持共享池 |
| 合成图 | `src/compositor/` | 🚧 对象图 + 渲染核心 + 多轨叠层 + 视觉 clip（Video/Image/Text/Shape/Group）+ 三级 effects（clip/track/全局 `compositor.effects`）+ 轨道内重叠驱动转场（`track.addTransition`）已实现 |
| 特效转场 | `src/effects/` | 🚧 `Effect` 惰性 filter + 内置 `ColorEffect`/`BlurEffect` + warp（`BulgeEffect`/`PerspectiveEffect`/`DisplacementEffect`）+ `registerBuiltins` + clip 级接线 + `CrossfadeTransition` 已实现；chroma/LUT/wipe 及 Compositor 驱动的自动转场待后续 |
| 音频引擎 | `src/audio/` | ✅ AudioSource（Mediabunny AudioBufferSink）+ AudioEngine（Web Audio 排程 + speed/gain/fade + OfflineAudioContext 导出）已实现 |
| 导出 | `src/export/` | ✅ `Exporter`（定步循环 + `await prepare` 不丢帧 + Mediabunny `Output` 封装 MP4/WebM,视频 + 音频）已实现;golden-frame 全帧对比为后续 |

### 时钟控制面（对齐 `HTMLMediaElement`）

`Clock` 的控制接口刻意对齐 video element，方便上层直接套用播放器交互：

- `play()` 开始播放；若当前已 `ended`，从 0 重新开始（同 media element）。
- `pause()` 暂停，`currentTime` 保留。
- `seek(t)` 跳帧到绝对时间（秒），自动 clamp 到 `[0, duration]`。
- `duration` 为播放终点（默认 `Infinity` 表示开放、不自动停）；播放到达 `duration`
  时自动 `pause()` 并触发 `onEnded`，`ended` 置为 `true`。
- `onTick(t)` 订阅每帧时间；上层据此 `compositor.renderPreview(t)`。

`RealtimeClock`（预览，rAF 驱动）与 `FixedStepClock`（导出，`tick()` 逐帧确定性推进）
共享同一控制面，切换预览/导出只是换时钟，渲染核心不变（契约 #3）。

### Compositor 生命周期（同步构造 / 异步建 renderer）

`new Compositor(options)` 是**同步**的：只建对象图、reconciler 和一块（可能离屏的）
canvas，因此对象图可以在没有 GPU 的环境里构建与单测。GPU renderer 由
`await compositor.init()` **异步**创建（WebGPU 优先，WebGL 兜底，PixiJS v8 的
`autoDetectRenderer`）。`init()` 之前 `renderSync(t)` 仍会 reconcile 场景图（确定性逻辑
可测），只是不出像素；`renderToTexture(t)` 在未 `init()` 时直接抛错。典型接线：

```ts
const c = new Compositor({ width, height, timebase });
await c.init();
document.body.append(c.view);
const clock = new RealtimeClock();
clock.duration = timelineDuration;
clock.onTick((t) => c.renderPreview(t)); // 预览循环
clock.play();
```

`renderToTexture(t)` 返回的 `RenderTexture` 由调用方拥有并负责 `destroy()`（契约 #4）。
完整可运行示例见 [`example/`](../example/)（`pnpm dev`）。

**HiDPI**：渲染器以 `resolution`（默认 `devicePixelRatio`）+ `autoDensity` 创建——canvas
内部按 `width*resolution` 绘制、CSS 仍是 `width` px，所以高分屏上文字/矢量边缘清晰不糊。
`renderToTexture` 的离屏纹理也用同一 `resolution`。可用 `CompositorOptions.resolution` 覆盖。

### 多轨叠层与 Reconciler

- **每条 `VisualTrack` 映射一个 PixiJS `Container`**，按 `zIndex` 在 stage 里排序；该轨道
  的 clip mount 进它自己的 container，轨道级 `effects` 作为**调整层**挂到这个 container
  的 filter 链上（作用于该轨道全部内容）。`Reconciler` 顶层管轨道容器、每轨内嵌一个子
  `Reconciler` 管 clip，`reconcileClips` 是轨道层/分组层共用入口。
- **z 序每帧重申**：无论 clip/轨道的挂载历史如何，`reconcile` 都用 `setChildIndex` 把
  容器与 clip 重排成当前 z/数组顺序，所以「后激活的低层 clip」也会落到正确层级；
  启用/禁用轨道、改 `zIndex` 立即反映。对象跨帧复用，每帧几乎零分配。
- **anchor 语义**：`Transform2D.applyTo` 把归一化 anchor（0..1）作用为「把 anchor 点放到
  `position`」（如 anchor `[0.5,0.5]` 使内容居中于 `position`，缩放/旋转绕它进行）。
  `Sprite`/`Text` 用它们**原生的比例 `anchor`**——尺寸动画（如字号呼吸）下位置稳定、
  且不用每帧测量 bounds；`Graphics`/`Container` 无原生 anchor，则按 `getLocalBounds()`
  映射成未缩放局部 `pivot`。

### Clip 时间区间与边界（半开 `[start, end)`）

`Clip.isActiveAt(t) = t >= start && t < end`——**start 含、end 不含**。这决定了相邻 clip
在边界处的行为：

- **无重叠、无缝隙**：相邻 clip `[0, 10.5)` 与 `[10.5, 20)` 在任意 t **恰好一个**活跃。
  边界 `t=10.5` 归**后一个** clip（前一个 `10.5 < 10.5` = false 已失活）。所以边界那一刻
  不会两个都在（重叠/双画）也不会都不在（缝隙/黑帧）；Reconciler 干净切换（前者 unmount、
  后者 mount）。见 `tests/compositor.test.ts`。
- **半帧边界（如 10.5f）无歧义**：渲染帧落在整数帧序号上（导出 `t = frame/fps`），没有帧
  正好落在 10.5——切换发生在帧 10（属前 clip）与帧 11（属后 clip）之间，每帧唯一归属一个 clip。
- **末端最后一帧**：内容在 `[0, end)` 上，最后可显示帧是 `end - 1/fps`；播放头正好停在 `end`
  时该帧已失活（空/黑）。播放器式 UX 应让"播放头到末尾显示最后一帧"（示例见 `example/`）。
- **预览的过渡观感（非崩溃）**：跨到新 clip 的那一刻，新 clip 的源可能**还没解码好**，
  预览是尽力而为（fire-and-forget prepare + 立即 renderSync，契约 #1），故切换后的头几帧
  可能 miss → 短暂空白。**导出** `await prepare` 等齐、帧级精确、无此现象。
- **跨 clip 预热**：`prepare(t)` 除了预解码当前活跃 clip 的源，还会预解码**在
  `t + prewarmSeconds` 内即将变活跃**的 clip 的**首帧**（`prepare(sourceIn)`），使切换首帧
  在预览里也命中缓存。窗口 `Compositor.prewarmSeconds` 可配（默认 0.5s，`0` 关闭）、可运行时
  调整；对 `GroupClip` 递归生效（活跃组按局部时间、即将上场的组按其起点 0 递归）。
- **边界值实践**：让 `clip2.start === clip1.end`（共用同一数值，别分别算）以免浮点 sub-epsilon
  的缝/叠；边界尽量用 `Timebase.toSeconds(frame)` 对齐到帧。

### 音频排程与导出（AudioEngine）

`AudioSource.load` 用 Mediabunny `Input` + `AudioBufferSink` 把整轨解码成一个
`AudioBuffer`。`AudioEngine` 把 `AudioClip` 排到 Web Audio 图上:

- **纯排程核心**(`src/audio/scheduling.ts`,可单测):`clipPlaybackAt(clip, playhead)`
  算出 `when`(相对起播时刻)/`offset`(入缓冲)/`duration`(消耗缓冲秒)/`playbackRate`;
  `speed` 即 `playbackRate`——**变调变速**(时间线 `[playStart,end)` 以速率 s 消耗缓冲
  `[offset, offset+span*s)`,实播 span 秒)。`gainEventsAt` 把 `gain` 自动化与
  `fadeIn`/`fadeOut` 合成一串增益事件(首个 setValueAtTime、其余 linearRamp)。
- **预览**:`play(playhead)` / `pause()` / `seek(playhead)`——每个 clip 建
  `AudioBufferSourceNode → GainNode → destination`,`src.start(when, offset, duration)`。
  与视觉时钟对齐由上层同时驱动;Web Audio 采样级精确,漂移小。
- **导出**:`renderOffline(duration)` 用 `OfflineAudioContext` 建**同一套**图渲染整轨混音,
  故离线混音与预览一致(契约 #3)。
- 校验:`tests/audio-scheduling.test.ts` + `tests/audio-engine.test.ts`(假 context 记录
  节点参数);e2e `pnpm verify:audio`——真实 `OfflineAudioContext` 渲染带 fade+gain 的正弦,
  断言 `midRms≈0.5×0.707`、fade 段更弱;并用 MediaRecorder 录一段 Opus 经 `AudioSource` 解回。

### 导出（Exporter）

`Exporter` 复用**同一套渲染核心**,但换成定步、逐帧确定性导出(契约 #1 + #3):

- **纯帧时序**(`exportFrameTimes(range, fps)`,可单测):`[start,end)` 内 `round((end-start)*fps)`
  帧,第 `i` 帧在 `start + i/fps`——半开、与 clip 区间一致,不看 wall-clock。
- **逐帧循环**:字体一次性等齐(`await fonts.ready()`,绝不中途换字体)后,对每帧
  `await compositor.prepare(t)`(**await = 绝不丢帧**,与预览的 best-effort 相对)→
  `renderSync(t)`(画到共享的 `view` 画布)→ `sink.addFrame(t, 1/fps)`。音频取离线混音
  `AudioEngine.renderOffline(duration)` 一次性编码。
- **编码/封装 = `ExportSink` seam**:默认 `MediabunnyExportSink` 用 Mediabunny
  `CanvasSource`(直接抓 `view` 画布,免手动 `VideoFrame` readback)+ `AudioBufferSource` +
  `Output`(`Mp4OutputFormat` / `WebMOutputFormat`)+ `BufferTarget` → `Blob`,取代
  `mp4-muxer`/`webm-muxer`;动态 `import('mediabunny')`。`add` 返回的 Promise 被 await 以
  尊重编码器背压(长视频内存稳定)。测试可注入假 sink。
- **`ExportOptions`**:`fps` / `container`('mp4'|'webm')/ `videoCodec` / `bitrate` / `audio` /
  `audioCodec` / `audioBitrate` / `range`(默认整条时间线 = 最大 clip end)。`onProgress(p)`
  每帧上报;`cancel()` 置标志,下一帧抛 `ExportCancelledError` 并 `sink.cancel()` 释放编码器。
- 校验:`tests/exporter.test.ts`(纯 `exportFrameTimes`;用假 compositor/audio/sink 断言
  **每帧 prepare→render→addFrame 的顺序**、帧时刻、progress 单调到 1、`audio:false` 跳过音频、
  `range` 覆盖时长、`cancel` 中止且不 finalize)+ e2e `pnpm verify:export`——真实导出:
  ①视频-only 红 clip 到 MP4,解回断言帧数(8)、尺寸(160×120)、帧确实是红色(排除空画布抓取);
  ②音+画(排一段 440Hz 正弦进 `AudioEngine`)到 WebM(vp8/opus,挑能编码的),解回断言
  **视频轨 + 音频轨都在**。

### 文字与字体加载（TextClip / FontManager）

`TextClip` 用 `PIXI.Text` 渲染;`fontSize` 可关键帧动画,`text`/`fontFamily`/`fill` 为可设
字段(仅变化时才 relayout)。

字体加载**必须前置**、且是一次性设置——不是 per-frame 的 `prepare`:

- Pixi 的文字用 Canvas 度量字形,度量时字体必须已在 `document.fonts` 里;
- `render(t)` 是 (对象图, t) 的纯函数(契约 #2),若字体在播放中途才 load,前后帧会不一致;
- 导出走定步循环(契约 #1),绝不能中途从 fallback 换成真字体。

因此提供全局 `FontManager`(默认实例 `fonts`;`document.fonts` 本就是文档级全局):
`await fonts.load({ family, src })` 用 `FontFace` API 加载并注册,按 family+weight+style 去重;
`fonts.ready()` 等所有已请求字体就绪。典型流程:先 `await fonts.load(...)` → 建 `TextClip`
（`fontFamily` 指向该 family）→ 再 `renderPreview`;导出前 `await fonts.ready()`（里程碑 08
的 Exporter 会在定步循环前等齐）。

**Google Fonts**:`await fonts.loadGoogleFont({ family: 'Roboto', weights: [400, 700], italic? })`
—— 注入 css2 样式表(`buildGoogleCss2Url` 构建 URL）并 `document.fonts.load` 等齐指定字重,
同样去重、计入 `ready()`。它只是 `load` 的便捷封装,走相同的 `document.fonts` 机制。
（渲染校验见 `pnpm verify:font`:用自托管的 Pacifico 走同一路径上屏——本沙盒浏览器无外网,
但 Google css2 端点经代理 curl 可达。）

### 特效与转场（Effect / Transition）

**`Effect`** 包一个 `PIXI.Filter`，参数是 `AnimatableProperty`。关键设计是
**filter 惰性创建**——filter 需要 GPU/DOM 上下文，所以基类只在首次 `attach()` 时才调
`createFilter()`。因此一个 Effect 可以在无渲染器的环境里被构造、参数被关键帧动画（也正
因此纯逻辑能在 headless 单测里覆盖）。`attach/detach` 维护目标 `Container.filters` 链，
`updateAt(t)` 把 `t` 时刻的值写进 filter（uniform / 矩阵）。写 filter 与算值分离：内置效果
都暴露纯函数 `valuesAt(t)`，先测值、再测“值→filter”的写入。

- 内置 **`ColorEffect`**（`ColorMatrixFilter`：亮度/对比度/饱和度，各 `1`=不变，
  `updateAt` 里 `reset()` 后 `brightness/contrast/saturate` 叠加）与 **`BlurEffect`**
  （`BlurFilter`，`strength` 可动画）。`registerBuiltins(registry)` 把 `color`/`blur`
  按类型幂等注册进 `EffectRegistry`；消费者可 `register` 自定义类型。
- **三级作用域，同一套 attach/update/detach 机制**，区别只是 filter 挂到哪个 `Container`：
  - **clip 级**（`clip.effects`）：`VisualClip.applyCommon` 每帧调 `syncEffects(obj,t)`——把
    新加进的 effect `attach` 一次（`attachedEffects` 集合去重）、对全部 `updateAt(t)`、把已
    移除的 `detach`；`obj` 换新（re-mount）时清空并重挂。只影响该 clip。
  - **轨道级**（`track.effects`）：`Reconciler.syncTrackEffects` 挂到轨道 `Container`（调整层，
    见「多轨叠层」），影响该轨道全部 clip。
  - **全局**（`compositor.effects`）：`Compositor.syncStageEffects` 挂到 root `stage`，影响
    **整帧合成结果**——主调色 / 全局模糊 / 整帧 warp。`renderSync` 与 `renderToTexture` 都
    渲染同一个 stage，所以全局效果在预览与导出一致（契约 #3）。同一 effect 实例只应属于一个
    作用域（它只持有一个 filter、一次挂一个目标）。warp 的作用范围是目标 `Container` 的包围盒，
    整帧 warp 需内容铺满帧（见 warp 小节的 caveat）。
- **`Transition`**（轨道内、重叠驱动）：`transition.between(A, B)` 绑定相邻两 clip(顺序=方向
  `from→to`),`track.addTransition(transition)` 挂到轨道。**转场窗口 = 两 clip 的重叠区间**
  `[max(starts), min(ends))`,由 `windowAt()` 每帧从 clip 现算(不缓存,所以移动/裁剪 clip 会
  实时更新窗口,`render(t)` 仍是纯函数);`progressAt(t)` 把窗口映射成 0→1(半开、clamp)。
  想要 N 帧转场就让两 clip 重叠 N 帧(`durationFrames` 只是作者提示)。
  - **渲染管线**:`Reconciler` 在窗口内把 A、B **各自离屏渲成一张帧尺寸 `RenderTexture`**——
    做法是**渲染整个轨道容器、但只留目标 clip 可见**(`renderIsolated`,临时屏蔽轨道滤镜),
    走的是和最终上屏完全相同的路径,所以 clip 落位精确、且对 unmount/remount(循环重播)稳健
    (直接把带父级/带变换的 clip 容器渲到 target 在 remount 后会错位)。再调
    `transition.render(renderer, texA, texB, progress)` 混合,结果贴到一个 Sprite、把两个 clip
    隐藏;窗口外照常直渲。需要 GPU 上下文(`RenderContext`:renderer + 帧尺寸 + 分辨率),由
    `Compositor.renderSync`/`renderToTexture` 传入——所以预览与导出一致(契约 #3)。无 renderer
    的 headless 环境下转场跳过,两 clip 直接叠。
  - 内置 **`CrossfadeTransition`**:`render(renderer, from, to, progress)` 把 `from` 铺满、`to` 以
    `alpha=progress` 叠加(`out = from*(1-p) + to*p`);纯函数 `crossfadeAlpha(p)` 做 clamp。返回的
    `RenderTexture` 由 transition 自己复用/持有(`dispose` 释放),调用方不得销毁。
- 校验:`tests/effects.test.ts`（`valuesAt`、惰性创建、写矩阵、注册幂等、clip 接线的
  attach/update/detach 次数、`crossfadeAlpha` clamp）+ `tests/transition.test.ts`（`between`、
  `windowAt` 取重叠且随 clip 移动实时变、`activeAt` 半开、`progressAt` clamp、`track.addTransition`）
  + `tests/compositor.test.ts`（全局 `compositor.effects` 挂 stage：一次 attach、每帧 update、
  移除后 detach）+ e2e `pnpm verify:effects`——真实 WebGL 上用 `ColorEffect` 压暗白块、
  `BlurEffect` 让红块边缘外溢、全局 desaturate 让红/蓝两 clip 同时变灰、`CrossfadeTransition`
  独立混红→蓝、以及**轨道转场**(红 A `[0,2)` + 蓝 B `[1,3)`,`t=1.5` 重叠中点混成 `(128,0,127)`,
  `t=0.5` 全红、`t=2.5` 全蓝)。

**Warp 效果（透视 / 扭曲 / 畸变）**——`Transform2D` 只能做仿射（平移/缩放/旋转），
warp 处理的是仿射做不到的几何形变，都通过自写 `GlProgram` 片元着色器采样源纹理实现。
关键约定：着色器把 `vTextureCoord` 用系统 uniform `uInputClamp` 归一化成 clip 自身
bounds 上的 `[0,1]` 坐标，distort 后再映回采样——**所以 warp 的作用范围是 clip 的包围盒**
（贴合形状的 clip 会把外溢裁掉；要整帧 warp 就让 clip 铺满帧）。纯几何数学与着色器分离，
可脱离 GPU 单测：

- **`PerspectiveEffect`（透视/corner-pin）**：四角（TL/TR/BR/BL，`[0,1]`，可动画）定义目标
  四边形。纯函数 `squareToQuad`（Heckbert 闭式解，单位方→四边形的 3×3 单应）+ `invert3x3`
  求 dest→source 单应，`perspectiveSampleMatrix` 打包成列主序上传；着色器做 `uMatrix*vec3(uv,1)`
  透视除法采样，落在四边形外的输出透明。默认单位方=恒等；向外拉出 bounds 的 corner-pin
  （padding）留作后续。
- **`BulgeEffect`（畸变/fisheye）**：绕 `center` 在 `radius` 内做径向放大（`strength>0` 凸起）/
  收缩（`<0` 挤压），`aspect` 修正保持圆形；纯函数 `bulgeSourceUv` 是着色器的 CPU 参照，
  单测「凸起→采样点更靠近中心（放大）」。
- **`DisplacementEffect`（扭曲）**：薄封装 Pixi 内置 `DisplacementFilter`，用一张位移贴图
  （R/G 通道 = 横/纵偏移）驱动，`strength` 可动画；无贴图时用中性灰 `(0.5,0.5)`→零位移。
  适合波纹/热浪/动态扭曲。
- 校验:`tests/effects-warp.test.ts`（单应恒等/角点映射/`M·M⁻¹=I`/列主序、bulge 放大与挤压、
  各 effect `valuesAt`/`matrixAt`、注册五个内置）+ e2e `pnpm verify:effects` warp 段——真实
  WebGL 上 bulge 把圆盘外一个黑点放大成白、perspective 把整帧白矩形顶角切成透明而中心保持、
  displacement 让红蓝分界沿行位移。

尚未落地（后续里程碑）:`ChromaKeyEffect` / `LUTEffect`（需自定义采样着色器/贴图）、
向外 corner-pin 的 padding、warp 的 WGSL（WebGPU）变体、其它转场类型(`WipeTransition` 等,
基类与轨道驱动已就位,只差各自的 `render`)、以及转场输出的 HiDPI 分辨率(当前离屏混合按
resolution 1)。

### 分组 / 子合成（GroupClip）

`GroupClip` 本身是一个 `VisualClip`，可放在轨道上或嵌进另一个 `GroupClip`，把一组
子 clip 当作一个整体来变换。它的子 clip mount 进 group 自己的 PixiJS `Container`，
因此 group 的 `transform` / `opacity` / `blendMode` / `effects`（滤镜链）/ 动画会被整个
子树**原生继承**——这正是用嵌套 `Container` 表达分组的价值。

- **时间按偏移相对**：子 clip 在 group 局部时间 `lt = t - group.start` 上判活；group
  自身的动画在主时间线 `t` 上求值，子 clip 在 `lt` 上求值。嵌套时偏移逐层叠加。
- **递归 reconcile**：每个 `GroupClip` 持有一个内部 `Reconciler`，在 `update(t)` 里把
  活跃子 clip diff 进自己的 container；`Reconciler.reconcileClips(activeClips, t, stage)`
  是轨道层与分组层共用的扁平 diff 入口。group 失活时其子树整体卸载。
- **递归 prepare**：`Compositor.prepare(t)` 同样递归进 group，用 `group.localTime(t)`
  预解码嵌套子 clip 的源（并收编到共享 `TextureManager`），与 reconcile 走同一套坐标，
  保证嵌套视频也会被 prepare。
- **单一父级**：一个 clip 只能挂在一个父级（一条轨道或一个 group）下。
- `render(t)` 仍是 (对象图, t) 的纯函数：同一 t 重复 reconcile 复用已挂载子树（契约 #2）。

### VideoSource 解码管线（Mediabunny）

`VideoSource` 把「解码」藏在 `VideoDecoderBackend` 接口后面，默认实现
`MediabunnyVideoDecoder`（动态 `import('mediabunny')`：`Input` + `VideoSampleSink`）。

- `prepare(t)`（异步）：`decode(t)` 取「≤t 最近一帧」入 `FrameCache`，并按播放方向
  fire-and-forget 预读 `lookahead` 帧;`getTextureAt(t)`（同步）读 cache，命中经
  `TextureManager.acquireOrUpload(`sourceId:frameIdx`)` 上传/复用 `Texture`，miss 返回
  `null`（预览复用上一帧）—— 契约 #1。miss 时若上一帧的池化纹理已被淘汰/`destroy`（显存预算/
  缓存淘汰),`VideoClip` 会退回 `Texture.EMPTY`——绝不渲染已销毁的纹理(否则 Pixi 读 null
  source 的 `addressModeU` 崩溃;导出长/大视频时尤易触发)。
- 帧按 `round(t * fps)` 索引（**假设 CFR**，VFR 精确化是后续细化）。
- **双预算联动**（契约 #4）：解码侧 `FrameCache`（帧数预算）与显存侧 `TextureManager`
  （字节预算 + LRU）相互独立——纹理可在显存压力下被淘汰而帧仍在缓存（下次 `getTextureAt`
  重传）；帧被 `FrameCache` 淘汰时经 `onEvict` 钩子 `release` 掉它的纹理。`Compositor`
  持一个共享 `TextureManager`（`textureBudgetBytes` 可配），`prepare` 时把各 `VideoSource`
  收编到这个共享池，多轨共用一份 VRAM 预算。
- 把后端做成接口的副作用：编解码编排逻辑（keying / 预读方向 / 缓存命中 / dispose）可在
  headless 下用 fake backend 单测；真实 WebCodecs 解码由 `pnpm verify:decode` 自动验证
  （Puppeteer + Chrome-for-Testing：浏览器内录一段真 WebM → 经 `VideoSource` 解回、渲染并
  断言）。Playwright 精简 Chromium 不带 WebCodecs，故用 Puppeteer 的 Chrome-for-Testing。

## 核心契约（决定底座成败的几点）

1. **异步 prepare 与同步 render 必须分离**。视频解码是异步的：预览时
   `prepare(t)` 尽力而为、miss 就用上一帧/降级，`renderSync` 立即出帧保流畅；
   导出时 `await prepare(t)` 保证所有源就绪后再 `renderToTexture`，绝不丢帧。
2. **`render(t)` 对当前对象图纯函数**。不依赖上一帧的隐式状态、不依赖真实时间，
   只看对象图 + t。否则导出不可重放、没法做帧级回归测试。
3. **预览与导出共用同一渲染核心**。分辨率、色彩管线（sRGB↔linear、预乘 alpha）、
   滤镜参数严格对齐，否则导出和预览颜色/效果对不上。
4. **资源所有权清晰、可释放**。`VideoFrame`、`Texture`、`RenderTexture`、解码器都要
   显式 `dispose()`，三类资源各设预算 + LRU 回收。SDK 的每个对象都实现 `dispose()`。
5. **invalidate / 脏标记**。SDK 不主动重绘；对象被 mutate 时标脏，上层据此调度
   `renderPreview`，按需重绘省 GPU。

## SDK 公开面 vs 内部

| 类别 | 内容 |
|---|---|
| **公开**（使用者直接用） | `Compositor`、`Track` / `VisualTrack` / `AudioTrack`、各 `Clip` 子类（含 `GroupClip` 子合成）、`Effect` / `EffectRegistry`、`Transition`、`Transform2D` / `AnimatableProperty`、`MediaSource` 子类、`Clock` 实现、`AudioEngine`、`Exporter`、`Timebase` |
| **内部**（不暴露或仅高级扩展） | `Reconciler`、`FrameCache`、`TextureManager`、Mediabunny 读写适配层（解码 sink / 封装 output） |

## 推荐技术选型

- **渲染**：PixiJS v8（可选 WebGPU 后端）；需要真 3D 再叠 Three.js（共享 context）。
- **解码 / 编码 / 封装**：[Mediabunny](https://mediabunny.dev)（零依赖 TS，封装 WebCodecs）
  统一 demux / 解码 / mux / 编码——读侧 `Input` + `VideoSampleSink` / `AudioBufferSink`，
  写侧 `Output` + `Mp4OutputFormat`（fast-start / fragmented）/ `WebMOutputFormat`。
  取代原 `mp4box.js` + `mp4-muxer` / `webm-muxer` 组合。视频编解码依赖 WebCodecs
  硬件支持、**无纯软件兜底**；WebCodecs 不支持的冷门编码暂不承诺（可选 `ffmpeg.wasm`
  兜底见 [backlog](../todo/backlog.md)）。许可证 MPL-2.0（文件级弱 copyleft，作依赖不影响本 SDK 的 MIT）。
- **音频**：Web Audio API + `OfflineAudioContext`。

## 搭建顺序

详见 [`../todo/`](../todo/)。里程碑顺序：

1. `Timebase` + `Clock` + `Compositor` 骨架 + `VideoSource` + `VideoClip` → 单路视频 play/seek 上屏。
2. `Reconciler` + 多 `Track` 叠层 + `Transform2D` / `opacity` / `blendMode`。
3. `TextureManager` + `FrameCache` 显存/解码预算（不做多路必崩）。
4. `AudioEngine` 音画同步。
5. `AnimatableProperty` + `Effect` / `EffectRegistry`。
6. `Transition`（RenderTexture 双路混合）。
7. `Exporter`（FixedStepClock + prepare 等齐 + 编码封装）。

> 把第 1、3、7 这三块的契约钉死（时间基准、资源预算、异步/同步分离），上层无论接什么
> 文档模型、做多复杂的编辑器，都是往稳定内核上挂 class。
