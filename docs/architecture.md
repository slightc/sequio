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
| 媒体源 | `src/media/` | 🚧 接口已定；FrameCache 已实现，解码待实现 |
| 纹理显存 | `src/texture/` | 🚧 预算/LRU 骨架已实现，upload 待实现 |
| 合成图 | `src/compositor/` | 🚧 对象图/Reconciler 已实现，渲染核心待接 PixiJS |
| 特效转场 | `src/effects/` | 🚧 抽象基类已定，内置效果待实现 |
| 音频引擎 | `src/audio/` | 🚧 接口已定，实现待开始 |
| 导出 | `src/export/` | 🚧 接口已定，编码封装待实现 |

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
| **公开**（使用者直接用） | `Compositor`、`Track` / `VisualTrack` / `AudioTrack`、各 `Clip` 子类、`Effect` / `EffectRegistry`、`Transition`、`Transform2D` / `AnimatableProperty`、`MediaSource` 子类、`Clock` 实现、`AudioEngine`、`Exporter`、`Timebase` |
| **内部**（不暴露或仅高级扩展） | `Reconciler`、`FrameCache`、`TextureManager`、`Demuxer`、`Muxer` 适配器 |

## 推荐技术选型

- **渲染**：PixiJS v8（可选 WebGPU 后端）；需要真 3D 再叠 Three.js（共享 context）。
- **解码 / 编码**：WebCodecs + `mp4box.js`（demux）+ `mp4-muxer` / `webm-muxer`（mux）；
  `ffmpeg.wasm` 兜底。
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
