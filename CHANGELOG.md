# Changelog

本库遵循 [Semantic Versioning](https://semver.org/lang/zh-CN/)；每次正式发版由 `release.yml`
在 GitHub Releases 生成 release notes，本文件记录人读摘要。

## [0.5.0] - 2026-09-23

**主题：命令层**。手势模块里各自私有的排布逻辑收成一套可程序化调用的命令，
并补上库此前完全缺失的 `close` 与「整族按比例定位」。**纯增量**：快照格式不变
（`SNAPSHOT_VERSION` 仍为 `1`），公开导出 0 移除、既有导出函数签名 0 变化、
无破坏性类型变更（`ResizeCtx` 的两个旧字段降级为 `@deprecated` 保留）。

### Added — 几何原语（`geometry/commands.ts`，纯函数）
- `splitAt(s, area, dir, ratio)`：**确定性**分割 —— 源区保 min 侧（V→左半、H→下半）。
  与 `split()` 的差别是侧别不随 `fac` 跨 0.5 翻面；返回 `{ kept, created }`。
- `planClose(areas, id, opts)` / `applyClose(s, plan)`：关闭区域并入紧邻者。
  四边按 [左,右,上,下] 扫描，优先取「单一整边邻居」，否则用**多邻居分摊扩张**；
  要求邻居跨距正好铺满该边。`opts.exclude` 指定不可作为吞并方的区域。
  **`opts`/返回体都不含启发式以外的承诺**，以后改选边偏好不必改签名。
- `segBetween(s, a, b)`：a/b 面对面所在的分界线。判据比 `findSharedEdge` 宽 ——
  T 型交会处两块并不共享整条边，但确实在同一条线的两侧。
- `lineBounds(s, seg)` / `clampLine` / `writeLine` / `planLineTo` / `applyLineTo` / `planRatio`：
  连通线族的夹逼与平移，`resizeMove` 与「按比例设定」共用一份实现。
- `dockSlotRect(R, side, factor)` / `dockRestRect`：停靠槽与其互补块（预览层、并集重排共用）。
- `invariants.checkTiling(entries, opts)`：**合法性唯一权威**。`layoutData` 的三处校验
  （有限值/正宽高/`[0,1]`、重叠 fail-closed、未铺满分级处理）改为调它，
  容差 `COORD_EPS=1e-9` / `TILE_EPS=1e-6` 不变，不新增第二套口径。

### Added — store 命令（收 id、返回纯数据、幂等、单点入栈）
- `useLayout.splitArea(id, dir, ratio?)` / `closeArea(id, opts?)` / `mergeAreas(keepId, removeId)` /
  `swapAreas(a, b)` / `setRatio(seg, ratio)` / `setMaximized(id | null)`。
- 命令在**克隆**上编辑：几何不成立或合法性不过时返回 `null` 且原屏分毫未动；
  实例状态迁移（split 克隆槽位 / close·merge 丢弃 / swap 互换）由命令内部完成，
  调用方不再需要记得配对。
- `setMaximized` 是幂等的"设为"，`toggleMaximize` 仍是手势要的"切回来"（前者委托实现）。

### Changed
- **停靠四边在 T 型交会处不再被取消**：闭合判定由「找**单个**共享整边的邻居」改为
  `planClose`（多邻居分摊）。此前源区位置被两块分摊时只能得到「无法闭合源区位置，已取消停靠」。
  这是本版唯一的**行为变化**；`dockUp` 的失败路径改为丢弃试算克隆，零改动比过去更彻底。
- **历史策略统一**：全库只有一个入栈点（`store/shared.landPatch`），规则是
  「实际变化才压栈，`history:'none'` 显式豁免」。`setAreaContent` 与三个手势不再各写一遍
  `past: [...st.past, pre]`。`commitHistory` 仍是公开 action（供外部手动打检查点）。
- **停靠热区/预览/并集重排**三处共用一个 `dockSlotRect`；`LayoutViewDom` 的槽预览不再自己拼四分支。

### Deprecated（保留兼容，1.0 前移除）
- `ResizeCtx.moved` / `ResizeCtx.adj`：改为 `bounds.family` / `bounds.limits` 的**同源视图**
  （都出自 `geometry.lineBounds`，不是第二套算法），并标 `@deprecated`。
  这两个字段过去是 `resizeMove` 夹逼的唯一载体，0.4.0 的读取方还能继续用；
  老代码的归约写法（逐项 `max(min)` / `min(max)`）与 `bounds.lo`/`bounds.hi` 完全一致
  —— 有测试逐项钉着，不会漂。

### Added — 类型
- `LineBounds` 新增 `limits: MemberLimit[]`（逐成员可行边界，与 `family` 同序）：
  `lo`/`hi` 是它的归约。夹逼的原子式（`memberLimit`）因此只有一处。
- `DockTarget` 改为 `"center" | DockSide | "none"`（`DockSide` 定义在几何层，两侧共用一套词表）。
  **联合类型逐字等价**，不是破坏性变更。

### Internal
- 三个手势模块（`store/corner|dock|resize`）迁移到命令层，各自只保留"把指针换算成参数"
  与状态栏文案；`store/commands.ts` 是新增的命令装配。悬停/预览/历史等既有语义不变。
- 测试 275 → **324**：新增 `geometryCommands`（含「线离开原坐标后仍用捕获 bounds 续写」的拖拽回归）、
  `storeCommands`（入栈恰好一次 / 无变化不入栈 / id 语义 / 实例状态迁移）、
  `dock`（T 型交合新行为 + 失败路径零改动的几何指纹断言）。
- 因此 `public-api.test.ts` 的公开面清单同步扩充（新增 17 个导出）。

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
