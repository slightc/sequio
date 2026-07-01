# Todo — 任务管理

里程碑式任务清单。**顺序有意义**：底层契约（时间基准、资源预算、异步/同步分离）必须
先钉死，否则上层一定崩。每个文件是一个里程碑，含目标、范围、验收标准。

## 进度总览

| # | 里程碑 | 文件 | 状态 |
|---|---|---|---|
| 0 | 项目骨架 / 工具链 | [00-project-scaffold.md](00-project-scaffold.md) | ✅ Done |
| 1 | 时间 + 时钟 + Compositor 渲染核心 + 单路视频上屏 | [01-skeleton.md](01-skeleton.md) | ✅ Done |
| 2 | VideoSource（WebCodecs 解码） | [02-video-source.md](02-video-source.md) | ✅ Done |
| 3 | TextureManager + FrameCache 预算 | [03-texture-frame-budget.md](03-texture-frame-budget.md) | ✅ Done |
| 4 | Reconciler + 多轨叠层 + Transform | [04-reconciler-multitrack.md](04-reconciler-multitrack.md) | ✅ Done |
| 5 | Image / Text / Shape clips | [05-image-text-shape.md](05-image-text-shape.md) | ⬜ Todo |
| 6 | AudioEngine 音画同步 | [06-audio-engine.md](06-audio-engine.md) | ⬜ Todo |
| 7 | Effects + EffectRegistry + Transition | [07-effects-transitions.md](07-effects-transitions.md) | ⬜ Todo |
| 8 | Exporter（FixedStep + 编码封装） | [08-exporter.md](08-exporter.md) | ⬜ Todo |
| 9 | GroupClip 子合成（嵌套分组） | [09-group-clip.md](09-group-clip.md) | ✅ Done |

状态约定：`⬜ Todo` / `🚧 In progress` / `✅ Done` / `🅿️ Blocked`。

## 用法

- 开新任务前，先读对应里程碑文件的「范围」与「验收标准」。
- 实现一个 stub 后，删掉它的 `throw … not implemented`，并补一个确定性单测。
- 完成里程碑后，更新上表状态与该文件顶部状态行。
- 临时想法/小任务放 [backlog.md](backlog.md)，攒够了再升级成里程碑。
