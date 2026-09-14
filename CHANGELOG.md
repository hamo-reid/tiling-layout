# Changelog

本库遵循 [Semantic Versioning](https://semver.org/lang/zh-CN/)；每次正式发版由 `release.yml`
在 GitHub Releases 生成 release notes，本文件记录人读摘要。

## [0.4.0] - 2026-09-14

### Added
- **配置项**：`spacing.outerGap`（舞台四周留白；需 ≥ `corner/2` 才露全外圈角标）、
  `sizing.splitterLine`（分界线视觉线宽，与命中带宽 `splitter` 解耦）。
- **行为参数 `interaction`**：新增 `edgeArm`（角点方向判定阈值）、`snapDivisions`（拖拽吸附分格）、
  `historyMax`（历史上限）；连同 `dockCenter` / `dockSnap` / `minAreaW` / `minAreaH` /
  `cornerArm` / `hitTolerance` 一起经 `configureRuntime()` 全局设置。
- **demo**：右侧实时配置面板（改配置即时预览；label + 输入 + 功效小字 + 重置 + 预设 + 持久化）。

### Changed
- **停靠四边**：源区仅与目标共享整条边（无第三方可吞并）时，按并集重排为两块完成停靠 ——
  修复「类似 explorer/terminal 这类互为唯一整边邻居的布局只能拖到正中间替换」的问题。
- **分界线**：hover 高亮由整条命中带改为中央细线；线宽与命中带宽彻底解耦（线可宽于热区且居中不偏移）。
- **健壮性**：`.tl-area-box` 自带 `box-sizing: border-box`，`regionGap` 当 border 的表现不再依赖宿主全局 reset。

### Internal
- 重构：`geometry.ts` 拆为 `geometry/{types,edges,layout}`（barrel 出口不变）；
  `layoutStore.ts` 抽取 `store/{corner,dock,resize,shared}`；
  `LayoutViewDom.tsx` 抽 `useLayoutGestureBridge` / `LayoutPreview` / `domPct`。
- 工程化：新增 `build:demo`（demo 生产构建）+ CI 步骤、ESLint、`engines`、Actions 升级至当前大版本、本 CHANGELOG。
- 测试：覆盖率提升至 **100 / 93.9 / 100 / 100**（语句/分支/函数/行）；闸门抬至 98/90/98/98。

## [0.3.1] - 2026-09-14
- 修复停靠四边：源区仅与目标共享整边时按并集重排（此前 `canClose` 门会一律拒绝）。

## [0.3.0] - 2026-09-02
- 集成友好化：`flow` 容器策略、声明式 `initialLayout`、内容内联自动注册、主题穿透修复。
