# Tiling Layout · React

在浏览器里做可拖拽的平铺布局：**split 分割 / join 合并 / dock 停靠 / 调整大小**；几何与 UI 解耦，纯数据管理层驱动。

## 技术栈
Vite · React 18 · TypeScript · zustand · Vitest

## 功能
- **平铺布局操作**：角标拖拽(同区=分割 / 拖到相邻区=合并 / Ctrl+交换)；拖分界线调整大小(连通线族整体平移、保持矩形)；区域内部拖动=停靠(5 位热区：中心/四边分裂)；**双击区域头部=最大化(全屏)/Esc 恢复**。
- **单一渲染组件**：真实 DOM(`LayoutViewDom`，区域可承载任意 React 内容)。
- **内容类型注册**：`registry` 声明每类型 per-area 状态默认值 + 渲染组件。
- **命令式组件查询**：`getAreaComponent(areaId)` / `getComponentsByType(type)` 按 id/类型取当前存活区域的内容容器 DOM。
- **明暗主题**：OKLCH tokens + `@layer` 现代 CSS。

## 数据管理层（纯数据，面向库消费者）
- **三层模型**：布局几何(矩形平铺，`layoutStore`) · 每区域实例(`areaStore`) · 共享场景(`sceneStore`)；**稳定 id** 是跨引用锚点。
- **统一快照**：`layoutData` 的 `collectSnapshot / applySnapshot / migrateSnapshot`；undo/redo、持久化、导出导入全部走同一快照。
- **多布局(工作区)**：`workspaces`，每布局独立快照(含 undo 历史)，切换互不串。
- **单一门面 + 订阅回调**：`useLayoutData()` 收敛三 store + 多布局；`layoutBus.onChange(prev,next)` 只报实质变化(指纹去重)，驱动自动保存。

高频操作：**顶栏**布局下拉+新建/删除、撤销/重做、导出/导入 JSON、⚡自动保存。同一套交互外壳内嵌在文档站落地页,可直接在线体验。

## 运行
```bash
npm install
npm run dev        # 开发(热更新)
npm test           # 单测(含几何/快照/总线)
npm run typecheck  # 类型检查
npm run build      # 生产构建
```

## 文档站(Docusaurus)
API 参考由 TypeDoc 从 `src/public-api.ts` 自动生成(`docs/docs/api/`,不入库)，在文档站构建/启动时由 `docusaurus-plugin-typedoc` 自动再生，无需手动步骤：
```bash
npm run docs        # 构建文档站(docs/build/)
npm run docs:start  # 本地开发服务器(API 文档随启动自动生成)
```
单独重新生成 API markdown:在 `docs/` 下执行 `npx docusaurus generate-typedoc`。

文档的写作范例、页面类型与语言规则见 [docs/WRITING.md](docs/WRITING.md);改动文档请遵循。

## 目录
```
src/
  geometry.ts        # 纯几何层(归一化比例坐标 0..1, 无 React)
  layoutStore.ts     # 状态机: corner/dock/resize + undo 历史
  areaStore.ts       # 每区域实例状态
  sceneStore.ts      # 共享场景数据
  layoutData.ts      # 统一快照 / 版本迁移
  layoutBus.ts       # 订阅回调(指纹去重)
  workspaces.ts      # 多布局(工作区)管理
  useLayoutData.ts   # 单一门面 hook
  registry.tsx       # 内容类型注册
  areaInstances.ts   # 命令式组件注册表(按 id/类型查存活组件)
  LayoutViewDom.tsx  # DOM 渲染(可嵌任意内容)
tests/               # Vitest(几何/数据/状态/组件 129 例, 覆盖率 93%)
```

## 历史说明
`main` 自矩形平铺模型重写起为单提交的干净历史;重写前的完整提交存档在本地分支 `backup/main-before-squash`(不入库,不推送)。
## 许可证
[MIT](LICENSE) © 2026 Hamo
