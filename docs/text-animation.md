# 剪辑动画 & 文字动效（Clip animators / Text motion）

> 状态：✅ 已落地（内置 stagger/drop-in 动画 + GSAP 绑定 seam + 文字逐行/逐词/逐字拆分）。
> 相关代码：`packages/engine/src/animation/clip-animator.ts`、`gsap-animator.ts`、
> `packages/engine/src/text/text-layout.ts`、`packages/engine/src/compositor/clips.ts`（`TextClip`）。

本文档说明两件事：

1. **剪辑（Clip）如何被动画驱动**——包括如何在不破坏引擎「`render(t)` 是
   `(对象图, t)` 的纯函数」契约（契约 #2）的前提下，接入 **GSAP**。
2. **文字动效**——把一个 `TextClip` 拆成逐行 / 逐词 / 逐字的独立对象，并做
   交错（stagger）入场，例如**逐字掉落**。

---

## 1. 为什么需要一个「动画 seam」，而不是直接跑 GSAP

引擎最核心的两条契约：

- **契约 #1** 异步 `prepare` / 同步 `render` 分离；
- **契约 #2** `render(t)` 是 `(对象图, t)` 的**纯函数**——不依赖上一帧、不依赖
  wall-clock。这正是导出可复现、golden-frame 测试成立的根基。

GSAP 默认是**有状态、由 ticker（wall-clock）推进**的补间引擎：它用
`requestAnimationFrame` 不断改写目标对象。**直接让 GSAP 播放会直接违反契约 #2**。

**解法**：把 GSAP 当作一个**可在任意时间点求值的曲线**，而不是一个播放器——
建一条 `gsap.timeline({ paused: true })`，永远不 `play()`，只在每帧
`timeline.time(localT)` **seek** 到剪辑的本地时间，然后把值从一个普通代理对象读回来。
seek 是纯函数：同一个 `localT` 永远得到同一组值。于是 GSAP 就与 `render(t)` 的
拉取（pull）模型无缝对齐了。

因此引擎**不依赖 GSAP**（`@sequio/engine` 的 `package.json` 里没有 gsap），
只提供**绑定支持**：一组结构化接口 + 一个薄适配器（消费方注入自己的 `gsap` 实例）。
这与仓库既有的 seam 风格一致（`loadMediabunny` / `setMediabunnyModule` /
`createRenderer` / `FontManager`）。

---

## 2. 动画模型：`AnimationSample` 叠加在关键帧之上

一个动画器产出的是一个 **override（覆盖量）**，叠加在剪辑既有的
`Transform2D` / `opacity` 关键帧**之上**（而不是替换）：

```ts
interface AnimationSample {
  x?: number;        // 位移增量（px，加法）
  y?: number;
  scaleX?: number;   // 缩放系数（乘法）
  scaleY?: number;
  rotation?: number; // 旋转增量（弧度，加法）
  alpha?: number;    // 不透明度系数（乘法）
}
```

- 位移 / 旋转是**加法**，缩放 / alpha 是**乘法**；缺省字段即恒等（`0` 或 `1`）。
- 单位是引擎原生单位：`x/y` 是像素，`rotation` 是**弧度**。

合成点在 `VisualClip.applyCommon` → `Transform2D.applyTo(obj, t, sample)`：
先按关键帧算基础值，再叠加 sample。所以「动画器」永远是对既有动画的一层叠加。

### 2.1 整段剪辑动画：`ClipAnimator`

```ts
interface ClipAnimator {
  sampleAt(localT: number): AnimationSample; // localT = t - clip.start
}

clip.animator = /* 任意 ClipAnimator */;
```

内置、零依赖的 `TweenAnimator`（`from → to`，带 delay/duration/easing）适合做简单
入场 / 退场；复杂编排用 GSAP 绑定（见 §4）。

### 2.2 逐部件文字动画：`TextAnimator`

```ts
interface TextAnimator {
  sampleForPart(part: TextPart, localT: number): AnimationSample;
}
```

`TextPart` 描述一个可动画单元（一行 / 一词 / 一字）及其排版几何（`index` /
`count` / `x` / `y` / `width` / …）。见 §3。

---

## 3. 文字拆分：`TextClip.split`

默认 `TextClip` 用**单个** `PIXI.Text` 渲染整段文字。设置：

```ts
text.split = 'char' | 'word' | 'line';   // 'none' 为默认（单对象）
```

后，`TextClip` 会在一个 `Container` 里为**每个单元**挂一个 `PIXI.Text`，各自可独立
动画。排版由 `computeTextParts()`（`text/text-layout.ts`）完成：

- 纯函数，宽度测量通过注入的 `measure` 回调（引擎里接 Pixi 的
  `CanvasTextMetrics`）——因此**可脱离 canvas 单测**。
- 左对齐、按 `\n` 分行、**不做自动折行**（标题 / 字幕这类值得逐字动画的文本正是如此）。
- 每个 part 的 `x/y` 是它的**中心**，因此缩放 / 旋转都绕自身中心。
- `char` / `word` 下纯空白单元会被丢弃（不产生字形），但其advance仍保留，间距不变。

排版用的是**基准字号**（`fontSize.valueAt(0)`）：拆分模式下请用动画器的
`scaleX/scaleY` 来动画字号，而不是 `fontSize` 关键帧。跨越 `'none'` 边界需要重新
mount（底层对象类型不同：`Text` vs `Container`）；在 `char/word/line` 之间切换、
或改 `text`，会就地重排。

> 每帧渲染时，各 part 会**先复位到基准排版**，再叠加 per-part 覆盖量——这样整块
> 文字的包围盒（进而 clip 级 anchor 的 pivot）在部件飞出去时保持稳定，不会抖动。

---

## 4. 逐行 / 逐词 / 逐字掉落

### 4.1 内置（零依赖，推荐起步）

`StaggerTextAnimator` 把每个 part 从一个共享的 `from` 覆盖量缓动到恒等，按
`index` 交错。**逐字掉落**：

```ts
import { TextClip, StaggerTextAnimator, easeOutCubic } from '@sequio/engine';

const text = new TextClip({ text: 'SEQUIO', fontSize: 56 });
text.split = 'char';                      // 逐字（'word' 逐词 / 'line' 逐行）
text.textAnimator = new StaggerTextAnimator({
  from: { y: -70, alpha: 0 },             // 从上方 70px、透明处掉入
  duration: 0.4,                          // 每个字的时长
  stagger: 0.12,                          // 相邻字的间隔
  easing: easeOutCubic,
  // order: 'forward' | 'reverse' | 'center' | 'edges'
});
```

改 `from` 即换风格：`{ scaleX: 0, scaleY: 0, alpha: 0 }` 是弹入，
`{ y: 70, alpha: 0 }` 是从下方升起，`{ rotation: -0.5, alpha: 0 }` 是旋入。

这条路**完全确定**，预览与导出一致，无需 GSAP。

### 4.2 GSAP 绑定（任意补间 / GSAP 的 stagger）

需要 GSAP 的缓动库、时间轴编排或 `stagger` 高级用法时，注入你自己的 `gsap`：

```ts
import gsap from 'gsap';
import { TextClip, gsapTextAnimator } from '@sequio/engine';

const text = new TextClip({ text: 'SEQUIO', fontSize: 56 });
text.split = 'char';
// partCount 需在字体加载完成后读取（排版已定）
text.textAnimator = gsapTextAnimator(gsap, text.partCount, (tl, parts) => {
  tl.from(parts, { y: -40, alpha: 0, stagger: 0.04, ease: 'power2.out' });
});
```

单个剪辑整体受 GSAP 控制：

```ts
import gsap from 'gsap';
import { gsapClipAnimator } from '@sequio/engine';

clip.animator = gsapClipAnimator(gsap, (tl, o) => {
  tl.from(o, { y: -80, alpha: 0, duration: 0.6, ease: 'back.out(1.7)' });
  tl.to(o, { rotation: Math.PI / 12, duration: 0.4 });
});
```

**绑定约定**（代理对象 `GsapTarget` 的字段）：

- 用 `scaleX` / `scaleY`，**不要**用 `scale` 简写（GSAP 只对 DOM 目标展开它）。
- `rotation` 是**弧度**（引擎原生），直接补间；别用 GSAP 的角度化 transform 简写。
- 代理已被 seed 成恒等（`x:0,y:0,scaleX:1,scaleY:1,rotation:0,alpha:1`），
  所以 `.from()` 有明确的落点。
- 时间轴必须 `paused`（适配器只 seek 不 play）；适配器已替你建好。

引擎侧接口是**结构化声明**的（`GsapLike` / `GsapTimelineLike`），**不 import
`gsap`**；真实 `gsap` 满足这些接口即可传入。

---

## 5. 确定性 & 测试

- `StaggerTextAnimator` / `TweenAnimator` / `computeTextParts` 都是
  `(输入, t)` 的纯函数 → 有确定性单测（`tests/clip-animator.test.ts`、
  `tests/text-layout.test.ts`）。
- GSAP 适配器用一个极小的 fake timeline 单测（`tests/gsap-animator.test.ts`）：
  验证「seek→读回」是纯的、`.from`/stagger 行为、越界 part 返回恒等不抛错。
- 逐字掉落的**上屏**渲染由 `pnpm verify:text-anim`（Puppeteer + WebGL）验证：
  起始隐藏、中途交错（首字已落、末字未动）、结束全部到位。

---

## 6. 已知边界

- 拆分文字**不自动折行**；需要多行请在 `text` 里显式换行（`\n`）。
- 拆分模式用基准字号排版；`fontSize` 关键帧只对 `split: 'none'` 生效（拆分下用
  动画器的 `scaleX/scaleY`）。
- `split` 跨 `'none'` 边界切换需重新 mount（移除后重新加入剪辑）。
