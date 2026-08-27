---
sidebar_position: 5
---

# 样式自定义

库的外观默认就是成品,不配置任何东西时和你直接用库完全一致。想调整时有两条路:常用的间距、尺寸、明暗走 `LayoutConfig` 令牌;更深的定制直接覆盖 CSS 变量或用渲染插槽。两条路可以叠加。

## 用 LayoutConfig 调常用项

```ts
import type { LayoutConfig } from "@drahamo/tiling-layout";

const myTheme: LayoutConfig = {
  colorMode: "dark",                         // "dark" | "light" | "system"
  spacing: { regionGap: 4, padRegion: 10 },  // 区域间隔 / 内容内边距(px)
  sizing:  { headerH: 30, corner: 18, radius: 8 }, // 头部高 / 角标 / 圆角(px)
};
```

只提供想改的字段,其余用默认值(区域间隔 2px、内边距 8px、头部 26px、角标 14px、圆角 6px)。

## 作用域:全局还是单个实例

`LayoutProvider` 把配置施加到子树里的所有布局;`LayoutViewDom` 的 `theme` 属性只管自己,优先级更高:

```tsx
import { LayoutProvider, LayoutViewDom } from "@drahamo/tiling-layout";

<LayoutProvider config={{ spacing: { regionGap: 4 }, colorMode: "dark" }}>
  <LayoutViewDom /> {/* 继承全局 */}
  <LayoutViewDom theme={{ sizing: { corner: 20 }, colorMode: "light" }} />
</LayoutProvider>
```

## 深一层:CSS 变量

`LayoutConfig` 运行时被展平成 `--tl-*` CSS 变量。绕过 API 直接写这些变量,可以做配置项没有覆盖的定制:

```css
.tl-stage-wrap {
  --tl-region-gap: 6px;
  --tl-radius: 2px;
}
.tl-stage-wrap .tl-area-box { border-color: #3b82f6; }
```

可用的变量:`--tl-region-gap`、`--tl-pad-region`、`--tl-header-h`、`--tl-corner`、`--tl-radius`,与上表的配置项一一对应。配色类令牌(面板、边框、强调色等)在 `tokens.css` 里,明暗切换跟着 `colorMode` 或 `data-theme` 走。所有类名和变量都带 `tl-` 前缀,不会和宿主项目冲突。

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

分界线宽度、命中灵敏度、画布逻辑尺寸还不是配置项;主题随工作区持久化在规划中。这些场景目前只能用 CSS 变量或插槽顶替。
