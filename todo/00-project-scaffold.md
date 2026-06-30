# 00 · 项目骨架 / 工具链

**状态**: ✅ Done

## 目标
建立可构建、可测试的 TypeScript 库工程，铺好分层目录与公开 API 出口。

## 已完成
- [x] `package.json`（ESM + CJS 双产物，`pixi.js` 设为 peerDependency）
- [x] `tsconfig.json`（strict）、`vite.config.ts`（library 模式 + dts）
- [x] 分层目录：`core / time / animation / media / texture / compositor / effects / audio / export`
- [x] 公开出口 `src/index.ts`
- [x] 纯逻辑模块单测（Timebase / AnimatableProperty / Easing / FrameCache）
- [x] `docs/architecture.md`、`AGENT.md`（软链 `CLAUDE.md`）、`todo/`
- [x] `pnpm typecheck` / `pnpm test` / `pnpm build` 全绿

## 验收标准
- `pnpm install && pnpm test && pnpm build` 通过 ✅
