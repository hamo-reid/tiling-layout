---
sidebar_position: 3
---

# 让布局填满哪里(容器与尺寸)

`LayoutViewDom` 不自带任何尺寸——它铺满你给它的容器,所以**容器要有确定尺寸**(快速开始里就是这么渲染的)。这篇讲两种「铺满」策略各适用于什么场景,以及容器尺寸相关的几个坑。

## 两种容器策略

布局区域按 `[0,1]×[0,1]` 归一化比例渲染成百分比,天然随容器拉伸,不需要任何尺寸监听。剩下的问题只有一个:舞台的矩形从哪算起。`positioning` prop 决定它铺的是「定位祖先」还是「父元素内容盒」:

| 策略 | 舞台铺满 | 父元素要求 | padding/margin 语义 |
|---|---|---|---|
| `"absolute"`(默认) | 最近 positioned 祖先的 padding-box | `position` 非 `static` | padding **不**内缩舞台,`border` 内缩 |
| `"flow"` | 父元素的 content-box | 无 position 要求,需确定高度 | padding 内缩舞台,margin 在舞台外侧 |

## absolute:铺满定位祖先

默认策略沿用绝对定位的包含块语义:`.tl-stage-wrap` 是 `position:absolute; inset:0`,铺满最近的 positioned 祖先。父元素必须 `position: relative`(或 `absolute`/`fixed`),否则包含块会退到更外层,舞台错位甚至溢出页面。

```tsx
<div style={{ position: "relative", height: 480 }}>
  <LayoutViewDom />  {/* 铺满这个 relative 容器 */}
</div>
```

absolute 的 padding 语义要留意:舞台铺的是 padding-box(**含** padding),父元素的 `padding` 不会把舞台往里推——要四周留白,请给 `LayoutViewDom` 传 `style={{ padding: 16 }}`,或再包一层。

## flow:铺满父元素内容盒

`positioning="flow"` 让舞台变成普通文档流元素(`width:100%; height:100%`),铺满父元素的 content-box。它修正了 absolute 的两个别扭点:父元素不再需要 `position`,`padding` 也真正把舞台往内推:

```tsx
<div style={{ height: 480, padding: 16, margin: 24 }}>
  <LayoutViewDom positioning="flow" />
</div>
```

flow 唯一的要求是**父元素有确定高度**。`height:100%` 在父级高度为 `auto` 时不解析,而舞台内部是绝对定位、不贡献高度,于是舞台塌成 0 高一片空白。控制台会 `console.warn` 提醒(它也可能是被 `display:none` 隐藏或尚未布局的容器)。给父元素显式 `height`,或让它作为 flex 子项被拉伸。

## style:给舞台本身加样式

`style` prop 原样透传到 `.tl-stage-wrap`,补舞台自身的样式——背景、边框、上文的留白,都写在这里:

```tsx
<LayoutViewDom
  positioning="flow"
  style={{ background: "var(--tl-spacer)", borderRadius: 8 }}
/>
```

## 两个常见布局

占满整个视口:

```tsx
export function App() {
  return (
    <div style={{ position: "absolute", inset: 0 }}>
      <LayoutViewDom />
    </div>
  );
}
```

顶栏固定、布局撑满剩余:

```tsx
export function Workspace() {
  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh" }}>
      <header style={{ height: 48 }}>工具栏</header>
      <main style={{ flex: 1, minHeight: 0, padding: 12 }}>
        <LayoutViewDom positioning="flow" />
      </main>
    </div>
  );
}
```

## 常见坑

- 父元素是 `static` 时,absolute 策略的舞台会铺到更外层——先给父元素 `position: relative`。
- flex 链上,`flex: 1` 的舞台父级,它的父级要有确定高度;flex 子项加 `min-height: 0` 防止内容撑爆。
- `display: none` 时舞台量不到尺寸,手势换算返回 `null`(不报错),恢复可见后自动恢复——临时隐藏请用 `visibility`。
