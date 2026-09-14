---
sidebar_position: 5
---

# 样式自定义

库的外观默认就是成品,不配置任何东西时和你直接用库完全一致。想调整时有两条路:常用的间距、尺寸、明暗走 `LayoutConfig` 令牌;更深的定制直接覆盖 CSS 变量或用渲染插槽。两条路可以叠加。

## 用 LayoutConfig 调常用项

```ts
import type { LayoutConfig } from "@drahamo/tiling-layout";

const myTheme: LayoutConfig = {
  colorMode: "dark",                                         // "dark" | "light" | "system"
  spacing: { regionGap: 4, padRegion: 10, outerGap: 12 },     // 区域间隔 / 内边距 / 舞台四周留白(px)
  sizing:  { headerH: 30, corner: 18, radius: 8, splitter: 8 }, // 头部高 / 角标 / 圆角 / 分界线命中带宽(px)
  interaction: { dockCenter: 0.3, minAreaW: 0.08 },           // 行为参数(⚠ 只能全局，见下)
};
```

只提供想改的字段,其余用默认值(区域间隔 2px、内容内边距 8px、舞台留白 0px、头部 26px、角标 14px、圆角 6px、分界线带宽 6px)。

- `spacing.padRegion` 只作用于库自绘的头部条与「未注册占位」内容;注册面板的内容容器 `.tl-area-content` **不**套内边距(留白由面板自己决定)。
- `spacing.outerGap` 是舞台四周留白:它内缩的是铺排盒 `.tl-stage`,而区域百分比定位与指针换算都基于 `.tl-stage`,所以和 `regionGap` 叠加不冲突。注意角标手柄居中在角点上、会向外探出 `corner/2`,要让外圈角标不被裁掉需 `outerGap ≥ corner/2`。
- `sizing.splitter` 是分界线(拖拽命中带)的宽度:它同时也是命中宽度,调大更好点、调小更精细。

## 作用域:全局还是单个实例

`LayoutProvider` 把配置施加到子树里的所有布局;`LayoutViewDom` 的 `theme` 属性只管自己,优先级更高(显式配置的键覆盖全局值):

```tsx
import { LayoutProvider, LayoutViewDom } from "@drahamo/tiling-layout";

<LayoutProvider config={{ spacing: { regionGap: 4 }, colorMode: "dark" }}>
  <LayoutViewDom /> {/* 继承全局 spacing */}
  <LayoutViewDom theme={{ sizing: { corner: 20 } }} /> {/* 实例覆盖 corner,其余继承全局 */}
</LayoutProvider>
```

注意 `colorMode`(明暗切换)与 `interaction`(行为参数)只由 `LayoutProvider` 处理,写在 `LayoutViewDom` 的 `theme` 上不生效。

## 行为参数(全局)

停靠热区、槽占比吸附网格、最小区域、角点起步阈值、分界线命中容差这类「操作手感」参数,由几何层/状态机消费——它们是**模块单例纯逻辑**,没有 React 上下文,所以**只能全局一份**,不能按实例区分。

```ts
const myTheme: LayoutConfig = {
  interaction: {
    dockCenter: 0.3,                 // 中心热区半宽(比例)
    dockSnap: [0.25, 0.5, 0.75],     // 停靠槽占比吸附网格
    minAreaW: 0.08, minAreaH: 0.08,  // 分区最小尺寸(比例)
    cornerArm: 0.02,                 // 角点手势起步锁定阈值(比例)
    hitTolerance: 0.008,             // findEdgeAtPos 命中容差(比例)
  },
};
```

经 `LayoutProvider` 传入即可(卸载自动还原);非 React 场景直接调用:

```ts
import { configureRuntime } from "@drahamo/tiling-layout";

const restore = configureRuntime({ dockCenter: 0.3 }); // 返回还原函数,可安全重复调用
restore();
```

非法值(非有限数 / ≤0 / 越界)逐键忽略、不阻断其余键;多次调用按栈还原。`hitTolerance` 只影响几何查询 `findEdgeAtPos`,内置分界线命中靠 `sizing.splitter` 的 DOM 带宽。

## 深一层:CSS 变量

`LayoutConfig` 运行时被展平成 `--tl-*` CSS 变量。绕过 API 直接写这些变量,可以做配置项没有覆盖的定制:

```css
.tl-stage-wrap {
  --tl-region-gap: 6px;
  --tl-outer-gap: 12px;
  --tl-splitter: 8px;
  --tl-radius: 2px;
}
.tl-stage-wrap .tl-area-box { border-color: #3b82f6; }
```

可用的变量:`--tl-region-gap`、`--tl-pad-region`、`--tl-outer-gap`、`--tl-header-h`、`--tl-corner`、`--tl-radius`、`--tl-splitter`,与 `spacing`/`sizing` 配置项一一对应。实例 `theme` 只把**显式配置的键**内联到 `.tl-stage-wrap`,因此未配置的键直接写在 `.tl-stage-wrap` 或更外层即可生效;若同一键既由实例 `theme` 配置又被 CSS 写入,以 `theme` 为准(内联优先级最高)。配色类令牌(面板、边框、强调色等)在 `tokens.css` 里,明暗切换跟着 `colorMode` 或 `data-theme` 走。所有类名和变量都带 `tl-` 前缀,不会和宿主项目冲突。

## 最深一层:渲染插槽

令牌改的是数值,插槽改的是可见内容。交互行为(头部拖拽停靠、角标分割合并、分界线调整大小)始终由库保留,你替换的只是那一小块渲染:

```tsx
<LayoutViewDom
  slots={{
    renderHeader: (ctx) => (<>{ctx.title}<small>#{ctx.areaId}</small></>),
    renderCorner: (ctx) => <span>+</span>,
    renderEdge:   (ctx) => (ctx.hovered ? <div className="my-edge" /> : null),
  }}
/>
```

| 插槽 | 参数 |
|---|---|
| `renderHeader` | `{ areaId, contentType, title }` |
| `renderCorner` | `{ areaId, x, y, sharedIds, hovered }` |
| `renderEdge` | `{ edgeId, vertical, hovered }` |
| `renderArea` | `{ areaId, contentType, title, rect, hot }` |
| `renderPreview` | `{ mode, srcRect, tgtRect?, splitDir?, splitLine?, dockTarget?, slotRect? }` |

`rect` 坐标都是归一化比例,渲染时乘 100 换成百分比即可。分界线的插槽注意只在 `hovered` 时返回可见手柄——一条被 T 型点切分的长线不会同时冒出多个胶囊。

## 暂未开放

画布逻辑尺寸(与像素无关的固定坐标)、区域最小尺寸的像素表达还不是配置项——前者需要全局坐标缩放模型,后者依赖容器实际尺寸。可配置的数值见上文 `spacing` / `sizing` / `interaction`;主题随工作区持久化在规划中。
