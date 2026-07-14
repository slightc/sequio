# 复刻一个视频：方法论与技巧

以 `packages/cli/example/handbag-promo`（一支 15s 竖屏 9:16、30fps 的暖橙复古
手袋广告）为案例，记录**怎样把一支参考视频拆成 sequio 作曲**、过程中踩到的坑，以及
沉淀下来的可复用技巧。目标是「≥90% 相似」——文字效果、动画、特效、转场都还原。

配套代码：

```
example/handbag-promo/
  theme.ts    设计 token（画布 / 调色板 / 字体 / 时间线）
  kit.ts      可复用构件 + 动画助手（object-fit、脉动标题、入场、转场助手…）
  scenes.ts   分镜脚本（四章 + 转场 overlay + 颗粒）
  photos.ts   真实照片（Pexels URL）
  twirl.ts    自带特效：旋涡 TwirlEffect（GLSL + WGSL）
  index.ts    入口：加载字体/素材、拼轨道、排音乐
  assets/     程序化贴图 + 转码短视频 + 音乐
```

---

## 0. 迭代循环

复刻不是一次成型，而是一个**验证环**——sequio 的三档 verify loop 正好对上：

```
拆镜 → 搭骨架 → check → frame → render → 逐帧对比参考片 → 调 → 回到 frame/render
        （静态校验，无 GPU）  （单帧 PNG，快）  （整段 MP4）
```

- `sequio check` 最便宜：编译 + 链接 + 跑 builder（null renderer，无 WebGPU、无
  网络），静态走一遍对象图，抓非法 clip 时间、死关键帧、没注册的字体、不重叠的
  转场、越界锚点、缺失的本地素材。
- `sequio frame <file> --time 3` 只 seek 一帧导出 PNG——改一个入场、对一个位置时
  用它，秒级反馈，不必等整段渲染。
- `sequio render` 出整段 MP4，用来看动态：节奏、转场衔接、运动是否连贯。

每一轮都拿渲染结果和参考片**逐帧并排**看，记录差距，再回到 `frame`/`render`。本案例
的评分就是这么从「20 分」一路调到「≥90 分」的。

---

## 1. 拆镜：把视频读成 shot list

先把参考片切成**章节（chapter）**，每章记四件事：**时间窗、文字、入场/出场、转场**。
本片拆成四章：

| # | 时间 | 标题 | 发生了什么 |
|---|------|------|-----------|
| 1 | 0.0–5.2s | FASHIONABLE HANDBAG | 太阳光背景；产品卡带倾斜猛推入（punch-in）→ 持续推近 → 溢出旋涡切出 |
| 2 | 5.2–8.5s | MINIMALIST · RETRO-STYLE | 胶片框从顶端带模糊滑入，推近（裁掉脚），whip-spin 切出 |
| 3 | 8.5–11.2s | LUXURIOUS | 接触印相网格甩入，下移 + 推近，旋涡 + 撑开切出 |
| 4 | 11.2–15.0s | GET IT NOW | 上下分屏（腰部持包视频 / 人像照），迷你包轮播，CTA 脉动、URL 逐字打出 |

拆完的结论固化进 **`theme.ts`** 的 token：画布 `W/H/FPS/DURATION`、暖橙调色板、
两款字体栈（`DISPLAY` = Anton，`COND` = Oswald）、四个 `Chapter { start, end }`。
`scenes.ts` 于是读起来就是一份 shot list。

---

## 2. 时间模型：为什么每章是一个 GroupClip

这是最容易翻车、也最关键的一点：

- **顶层 clip** 的 `transform`/`opacity` 关键帧按**全局时间线**求值。
- **`GroupClip`** 把它的**子级**按**局部时间**求值（`t − group.start`）。

所以每章包一个 `GroupClip`（`scenes.ts` 的 `chapter()`），章内每个关键帧都能从 0
起算——写第二章时不用把所有时间加上 5.2。而转场 overlay（太阳爆、光晕）**不**包组、
挂在顶层轨道，用绝对时间，才能骑在两章交界处。

> 早期把四章直接铺在一条轨道上（全局时间），第 2–4 章的入场全错位——就是这个时间
> 模型没对上。包成 group 后一次修好。

---

## 3. 布局与裁剪：object-fit: cover

平面素材要像 CSS `object-fit: cover` 那样填满一个盒子且不变形、不漏出盒外。
`kit.ts` 的 `coverImage` / `coverVideo` 做这件事：

- 外面套一个 `GroupClip`，`maskShape = { kind:'rect', width, height }` 把内容裁到盒子；
- 内层 sprite 缩放取 `Math.max(w/img.w, h/img.h)`（填满而非留白），再居中偏移。

`panel()` 在此之上加一个 `focus` 偏移，把主体推到构图想要的位置（如人像偏上
`[0.5, 0.42]`）。

---

## 4. 锚点与 pivot 的坑（重要）

PixiJS 容器的 pivot 来自 `getLocalBounds()`——**内容溢出会把整组的支点带偏**。
sprite 则用原生 anchor，稳定。这条坑直接决定了两个设计：

1. **章节组用中心锚点**：`chapter()` 里 `anchor = [0.5, 0.5]`、`position =
   [W/2, H/2]`，再用 mask 裁掉溢出。若用左上角锚点 `[0,0]`，一个 punch-in 到
   溢出画面的 cover 会把 bounds 撑到负坐标，整组右移/漂移。
2. **第一章产品用单个 `VideoClip` 而不是 group**：它要缩放到 2× 溢出做旋涡，
   若包在 group 里，group 的 pivot 会随溢出 bounds 乱跳。直接用一个 sprite，
   锚点 `[0.5,0.5]` 是它自己的中心，缩放/旋转都绕稳定的中心。

> 症状是「整个第一镜向右偏移」。根因就是组锚点从溢出 bounds 取 pivot。

---

## 5. 文字：脉动标题与打字机

参考片的标题在**实心与空心之间呼吸**，并常以字距炸开退场。`kit.ts` 的
`pulseHeadline` 复刻这套处理：

- **两份同词叠放**：一份空心 `outline`（透明填充 + `stroke`，进场后常驻），一份
  实心 `label` 在其下**交叉脉动**（`0 → 1 → 0.55 → 1 …`，底线保持 ~0.55 保证
  始终可读，只是「呼吸」）。
- **模糊解析入场**：`blurIn` 让标题从一团模糊里对焦出来，而非硬淡入——对上参考
  片的「虚焦入」。
- **字距炸开退场**（`spreadExit`）：出场时把 scale 拉成 `[2.1, 1.0]`，字母横向
  撑开飞散。
- **打字机 URL**：`url.split = 'char'` + `StaggerTextAnimator({ from:{alpha:0},
  stagger:0.07, ... })`，逐字浮现。

空心字靠 `TextClip` 的 `stroke` + `HOLLOW`（`rgba(255,255,255,0)` 透明填充）实现。

---

## 6. 运动原则：不让任何一帧静止

复古广告的「贵气」来自镜头**一直在动**。所以每个静态素材都叠一层持续运动：

- 连续 Ken-Burns 推近（`kenBurns`）、平移 drift/pan、极小的持续 tilt；
- 第一章的 cover 从 `0.5×` 一路推到 `2.0×`（`scene1` 的 scale 关键帧），中途还
  带 drift + 微旋，**全程不坐死**。

> 用户反馈「第一个镜头静止太久」。修复就是把「推入后 hold」改成**贯穿全程的连续
> 推近 + 平移**，让画面永远在走。

---

## 7. 转场：用同一套图形串起所有硬切

四个切点用一致的语汇，观感才连贯（`scenes.ts` 的 `transitions()`）：

- **撕纸太阳爆 `burst`**：一张旋转的撕纸太阳图 pop 开盖住切点，再溶解露出下一章
  （`at−0.42` 弹到 `1.85×`、转着、`at+0.58` 淡出）。1→2、2→3、3→4 都用它，
  于是每次切都「在同一张图上翻页」，而不是各切各的。
- **光晕 `lightLeak`**：`blendMode:'add'` 的暖光图，在章内/切点上涨落，藏住接缝。
- **whip + 模糊**：出场时给一记 `blurBurst` 甩动，但**模糊压低**——盖切靠 burst，
  不靠糊。
- **旋涡 `twirlOut`**：溢出的内容旋进漩涡再切（见下一节的自带特效）。

**避免「空盘」**：切点两侧的内容必须**第一帧就不透明**。第三章网格早期用了
`fadeIn`，切换瞬间露出底下的灰底一拍，看着像「空盘子」；去掉 fade（`blurIn` 从
第 1 帧就满不透明，只是先糊后清）后接缝就实了。

> 「8s 左右有个小问题」「2→3 太快没连接」这两条反馈，分别是空盘和切点不统一，
> 都靠上面两招修好。

---

## 8. 自带特效：TwirlEffect（WebGL + WebGPU 双份 shader）

引擎不内置旋涡，于是在**作曲里自带一个 Effect**（`twirl.ts`）——这演示了 sequio
的扩展 seam：

- 继承引擎的 `Effect`，自建一个 `PIXI.Filter`；
- **同时提供 `glProgram`（GLSL）和 `gpuProgram`（WGSL）**：浏览器预览走 WebGL、
  纯 Node 渲染走 WebGPU，两条路像素一致（契约 #3）。只写 GLSL 的话，Node 的
  WebGPU 渲染会静默变 no-op——这正是早期 `BulgeEffect` 在 Node 里不生效的原因。
- UV 用 `uInputClamp` 在 clip 边界内归一化，**自动按 clip 尺寸居中**，并 `clamp`
  到 [0,1] 让边缘像素重复而不是漏出背景（对应「旋转时用内容填充四周、不漏背景」
  的要求）。

**为什么 `pixi.js` 能在作曲里 import**：`sequio` CLI 把 `pixi.js` 和 `gsap` 一样
作为运行时 external 注入（`packages/cli/src/externals.ts` → `cliExternals`），用户
代码于是能 `import * as PIXI` 写真正的 filter，而**引擎不必为此发布**这个特效。
自定义特效属于作曲层，不属于引擎层。

---

## 9. 真实素材优于平面矢量

第一版用 SVG 风格的平面插画，观感「像素材图」。换成**真实影像**后质感立刻上来：

- **照片**：`photos.ts` 按 URL 引用 Pexels（免费可用）同一组暖橙棚拍——模特、
  锈色套装、灰色无缝背景读起来是一个 campaign。
- **视频**：第 1、4 章的动态镜头用短视频（Pexels 素材转码到 720×1280），手/包
  真的在动，而不是静止图。`VideoClip` + `VideoSource` 在 Node 渲染里也能解码。
- **降级**：任一张照片抓取失败，`ok()` 用一张灰色占位 `fallback` 顶上，不崩。

---

## 10. 音频内置在 Compositor

音乐**排到 compositor 自己的音频引擎**上，作曲不必自建 `AudioEngine`：

```ts
const musicSource = new AudioSource({ src: await loadAsset('./assets/music.webm') });
await musicSource.load();
const music = new AudioClip();
music.start = 0; music.end = DURATION;
music.fadeIn = 0.3; music.fadeOut = 1.2;
music.gain.setStatic(0.72);
compositor.audioEngine.schedule(music, musicSource);   // ← 内置引擎
return { compositor, duration: DURATION };
```

`sequio render` 会自动把 `compositor.audioEngine` 的离线混音 mux 进视频（runtime
的 `build()` 默认取 `compositor.audioEngine`，`hasClips` 为空则跳过 mux）。音乐本身
是程序化合成的原创复古 house，几轮调过响度：太吵 → 降峰值 → 去掉转场 riser 音效、
整体调响到 `gain 0.72`。**编码用 Opus-in-WebM（免版税）**：浏览器预览经 WebCodecs
`AudioDecoder` 解码，AAC/m4a 只在随附了授权 AAC 解码器的 Chrome/Edge 上能解，开源
Chromium / Firefox 会抛 WebCodecs `Decoding error`——Opus 则处处可解。

---

## 11. 渲染管线：无 GPU 也能出片

本环境没有物理 GPU，用 **Route B（纯 Node WebGPU / Dawn）+ Mesa lavapipe 软件
Vulkan**：

```bash
VK_ICD_FILENAMES=/usr/share/vulkan/icd.d/lvp_icd.json \
VK_DRIVER_FILES=/usr/share/vulkan/icd.d/lvp_icd.json \
pnpm sequio render example/handbag-promo/index.ts --out handbag.mp4
```

约 0.2s/帧解码视频，450 帧出一支带 AAC 立体声音轨的 720×1280 MP4。`ffmpeg -i` 验
两条流都在（h264 + aac）。

---

## 12. 问题 → 修复速查

| 症状 | 根因 | 修复 |
|------|------|------|
| 第 2–4 章入场全错位 | 章节铺在全局时间轨上 | 每章包 `GroupClip` → 章内局部时间 |
| 整个第一镜右移 | 章节组左上锚点从溢出 bounds 取 pivot | 章节组**中心锚点** `[0.5,0.5]@中心` + mask 裁溢出 |
| 产品旋涡时漂移 | 产品包在 group 里，pivot 随溢出跳 | 产品用**单个 sprite**（原生锚点稳定）|
| 旋涡在 Node 渲染里不生效 | 特效只写了 GLSL | Effect 同时给 **WGSL** `gpuProgram` |
| 旋转漏出背景 | UV 未夹取 | `uInputClamp` 归一化 + `clamp` 重复边缘 |
| 第一镜静止太久 | 推入后 hold | 改成**贯穿全程**的连续推近 + 平移 |
| 8s 附近「空盘」 | 网格 `fadeIn` 先露灰底 | 去掉 fade，`blurIn` 从第 1 帧满不透明 |
| 2→3 太快、没连接 | 用了独立 whip 硬切 | 换成和别处一致的**撕纸太阳爆** |
| 音乐太吵/抢耳 | 峰值高 + 转场 SFX | 降峰值、去 riser、整体调响 |
| render 丢音频 | `renderBundleToFile` 没转发音频引擎 | `BuiltComposition.hasAudio` + 转发 `audio` |

---

## 13. 可复用清单

复刻下一支视频时，这套动作可以照搬：

1. **拆镜**成章，token 化进 `theme.ts`（画布/调色板/字体/时间窗）。
2. **每章一个 `GroupClip`**，转场 overlay 挂顶层轨（绝对时间）。
3. 组用**中心锚点** + mask；要溢出做特效的主体用**单个 sprite**。
4. `coverImage`/`coverVideo` 做 object-fit: cover。
5. 文字：`stroke`+透明填充做空心，实心副本**交叉脉动**，`blurIn` 入场，字距炸开退场。
6. **不让任何一帧静止**：连续 Ken-Burns / drift / 微 tilt。
7. 转场用**一套一致图形**串起所有切点；切点两侧内容第 1 帧就不透明（防空盘）。
8. 自定义特效放**作曲层**（`pixi.js` 作 CLI external），GLSL + WGSL 都写。
9. 优先用**真实影像**（Pexels URL / 转码短视频），带 fallback 降级。
10. 音频排到 `compositor.audioEngine`，`render` 自动混音。
11. `check → frame → render` 逐轮和参考片**并排逐帧对比**，直到相似度达标。
```
