# Tiling Layout · React

在浏览器里做可拖拽的平铺布局：**split 分割 / join 合并 / dock 停靠 / 调整大小**；几何与 UI 解耦，纯数据管理层驱动。

## 技术栈
Vite · React 18 · TypeScript · zustand · Vitest

## 功能
- **平铺布局操作**：角标拖拽(同区=分割 / 拖到相邻区=合并 / Ctrl+交换)；拖分界线调整大小(连通线族整体平移、保持矩形)；区域内部拖动=停靠(5 位热区：中心/四边分裂)；**双击区域头部=最大化(全屏)/Esc 恢复**。
- **单一渲染组件**：真实 DOM(`LayoutViewDom`，区域可承载任意 React 内容)。
- **容器策略**：`absolute` 铺定位祖先 / `flow` 铺父元素内容盒(免 positioned 祖先，padding/margin 天然适配，`style` 可透传)。
- **内容类型注册**：`registry` 声明每类型 per-area 状态默认值 + 渲染组件；`unregisterContent` 注销类型(存活实例清理 + 状态随类型清除)；`initialLayout` 可内联定义自动注册。
- **声明式初始布局**：`initialLayout` / `installInitialLayout` 替换默认布局(声明式 areas / 快照 / Screen 三种输入)，页面级一次、交互后不冲数据。
- **命令式组件查询**：`getAreaComponent(areaId)` / `getComponentsByType(type)` 按 id/类型取当前存活区域的内容容器 DOM。
- **明暗主题**：OKLCH tokens + `@layer` 现代 CSS。
- **配置**：`LayoutConfig`（`spacing`/`sizing`/`colorMode`）走 `--tl-*` CSS 变量，实例级或全局（`LayoutProvider`）；
  操作手感参数（停靠热区/吸附/最小尺寸/角点阈值/命中容差/历史上限）经 `configureRuntime()` 全局设置。
  demo 内置实时配置面板，改配置即时预览并持久化。

## 配置（LayoutConfig / runtimeConfig）

```ts
import { LayoutProvider } from "@drahamo/tiling-layout";

<LayoutProvider
  config={{
    colorMode: "system",
    spacing: { regionGap: 3, padRegion: 8, outerGap: 10 },   // 区域间隔 / 占位内边距 / 舞台四周留白
    sizing:  { headerH: 28, corner: 14, radius: 2, splitter: 12, splitterLine: 2 }, // 头部/角标/圆角/分界线命中带宽/线宽
    interaction: { dockCenter: 0.25, snapDivisions: 12, historyMax: 60 }, // 行为参数(全局)
  }}
>
  <LayoutViewDom />
</LayoutProvider>
```

- 可视项展开为 `--tl-*` 变量，`LayoutViewDom` 的 `theme` 可做实例级覆盖；未配置项走 CSS 兜底默认，零回归。
- 行为参数是**全局单例**（几何层/状态机无 React 上下文）：非 React 场景用
  `configureRuntime({ ... })`（返回还原函数）。详见文档「样式自定义」。
- `spacing.outerGap` 需 `≥ corner/2`，否则外圈角标十字会被 `.tl-stage-wrap` 裁掉。
- `sizing.splitter`（命中带宽）与 `sizing.splitterLine`（视觉线宽）已解耦：热区可宽、线可细。

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
npm run coverage   # 单测 + 覆盖率闸门
npm run typecheck  # 类型检查
npm run lint       # ESLint
npm run build      # 生产构建(库产物 dist/)
npm run build:demo # demo 生产构建(dist-demo/,仅 CI 体检)
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
  geometry.ts        # 几何层公开出口(barrel)
  geometry/          #   types(类型/矩形) · edges(分界线/命中/线族) · layout(命中/分割/合并/吸附)
  layoutStore.ts     # 状态机(组装层:状态 · 历史 · 恢复 · 最大化 · 取消)
  store/             #   手势域:corner(角标) · dock(停靠) · resize(分界线) · shared
  runtimeConfig.ts   # 行为参数(全局单例:configureRuntime / runtime)
  theme.ts           # LayoutConfig → --tl-* CSS 变量(声明式映射表)
  LayoutProvider.tsx # 全局配置入口(主题 + 行为参数)
  LayoutViewDom.tsx  # DOM 渲染(唯一渲染组件,可嵌任意内容)
  LayoutPreview.tsx  #   手势预览覆盖层(split/join/dock)
  useLayoutGestureBridge.ts # 全局指针/键盘事件桥
  domPct.ts          # 归一化比例 ↔ DOM 百分比盒换算
  areaStore.ts       # 每区域实例状态
  sceneStore.ts      # 共享场景数据
  areaInstances.ts   # 命令式组件注册表(按 id/类型查存活组件)
  layoutData.ts      # 统一快照 / 版本迁移
  layoutBus.ts       # 订阅回调(指纹去重)
  workspaces.ts      # 多布局(工作区)管理
  initialLayout.ts   # 声明式初始布局(installInitialLayout / isPristineScreen)
  useLayoutData.ts   # 单一门面 hook
  registry.tsx       # 内容类型注册
  screen.ts          # 默认初始屏幕
  public-api.ts      # 公开面白名单(TypeDoc 入口)
  index.ts           # 库入口
tests/               # Vitest(17 文件 / 230 例)
```

## 历史说明
`main` 自矩形平铺模型重写起为单提交的干净历史;重写前的完整提交存档在本地分支 `backup/main-before-squash`(不入库,不推送)。
## 许可证
[MIT](LICENSE) © 2026 Hamo
