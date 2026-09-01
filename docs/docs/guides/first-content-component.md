---
sidebar_position: 2
---

# 第一个内容组件

落地页演示里,编辑器存自己的草稿,目录记自己的选中项,属性面板有各自己的计数。这篇讲怎么注册这样的内容类型、给它声明初始状态,以及状态如何跟着布局操作迁移。

## 注册一种内容类型

每种内容用 `contentType` 字符串标识。用 `registerContent` 声明这种内容的初始状态和渲染组件:

```tsx
// MyEditor.tsx
import { registerContent } from "@drahamo/tiling-layout";
import type { ContentProps } from "@drahamo/tiling-layout";

function MyEditor({ state, setState }: ContentProps<{ text?: string }>) {
  // 首帧渲染时 state 可能还没有 defaults 注入,读取时对缺字段兜底
  const text = state.text ?? "";

  return (
    <textarea
      value={text}
      onChange={(e) => setState({ text: e.target.value })}
      style={{ width: "100%", height: "100%" }}
    />
  );
}

registerContent({
  type: "myeditor",
  title: "编辑器", // 区域头部标题,不填则回退到 type 原文
  defaults: { text: "在这写…" },
  Comp: MyEditor,
});
```

`defaults` 声明的对象决定了 `ContentProps` 的类型参数:组件里读到的 `state` 和写用的 `setState` 都是这个形状,不需要类型断言。`registerContent` 要在渲染前执行(比如放在模块顶层)。

## 内容实例生命周期

每个「区域 × 内容类型」组合都是一个内容实例,它有自己的生命周期。注册时的 `onMount` / `onUnmount` 回调让你在实例创建和销毁时介入(挂三方库实例、开监听器等),回调收到的 `ContentLifecycleCtx` 包含 `areaId`、`contentType` 和该区域内容容器的 DOM 节点 `el`:

```tsx
import { registerContent } from "@drahamo/tiling-layout";

const charts = new WeakMap<HTMLElement, Chart>();

registerContent({
  type: "chart",
  title: "图表",
  Comp: ChartPanel,
  onMount({ el }) {
    // 面板挂载后调用(defaults 已注入);把三方实例绑到容器 DOM 上
    const chart = createChart(el);
    charts.set(el, chart);
  },
  onUnmount({ el }) {
    // 与 onMount 成对;此时 el 仍可用,可安全 dispose
    charts.get(el)?.dispose();
  },
});
```

一次完整生命周期是:区域几何被创建 → 该类型内容首次渲染(`defaults` 注入 → `onMount`)→ 存活期(组件用 `setState` 读写实例状态)→ 区域销毁或内容切换(实例状态在操作落位时同步迁移或丢弃,随后 `onUnmount` → 容器 ref 注销)。

### 什么时候触发

| 事件 | 触发时机 |
|---|---|
| `onMount` | 区域首次渲染出该类型;分割/停靠产生新区域;切回该类型;恢复快照重建布局 |
| `onUnmount` | 切换到别的类型;区域被合并吞并;恢复快照重建前的旧实例;组件树卸载;类型被注销(`unregisterContent`) |
| `defaults` 注入 | 仅当该槽位为空;由交换/停靠迁移来的状态不覆盖 |

注意 `onMount`/`onUnmount` 是**每次挂载/卸载都会触发**(同一个区域切走再切回,就是一对新的 onMount/onUnmount),不是进程内一次。需要跨挂载存活的数据放实例状态(`defaults`/`setState`)或共享层,回调里只做 DOM/三方资源的建立与释放。

### 时序保证

- **defaults 在首帧渲染后、绘制前注入**(useLayoutEffect):用户首帧交互不会丢字段。但组件**首帧 render 时 state 可能仍缺字段**,读取要兜底(如 `state.view ?? 默认值`)。
- **同区域切换类型**:旧类型的 `onUnmount` 先于新类型的 `onMount`,清理不会踩到新实例。
- **区域卸载时**:清理回调先于容器 ref 注销,所以 `onUnmount` 里注册表与 `el` 都仍有效。
- **组件抛错**只降级本面板(内置错误边界显示"面板已崩溃"),不会波及其他区域。

## 注销内容类型

要彻底下线一种内容类型,用 `unregisterContent`:

```tsx
import { unregisterContent } from "@drahamo/tiling-layout";

const removed = unregisterContent("myeditor"); // true: 确实注销过;false: 本就没注册
```

它和重复调用 `registerContent` 是两件事:再次注册同类型是**替换定义**,实例状态原样保留(热替换);`unregisterContent` 是**移除**,注册定义删除,正显示该内容的区域立即回退通用占位,该类型在所有区域的实例状态也一并清除(其他类型的槽位不受影响)。

注销时,当前存活的该类型实例会逐个触发 `onUnmount`(此时 `el` 仍有效,可安全释放三方资源),每个实例**至多一次**,之后的真实卸载不会重复调用。

状态层对应的原语是 `removeAreaStatesByType`(按类型清槽),一般不需要直接调用。注意 undo/恢复快照会把实例状态整体写回,可能带回已注销类型的槽位:这不报错,区域照常显示占位;重新注册同类型后这些槽位原样接上(不注入 `defaults`)。

## 未注册的类型

区域引用了一个没注册的 `contentType` 时,`Content` 会渲染一个通用占位,只显示类型名。注册之后,同样内容的区域自动换成你的组件,已有的实例状态原样接上:

```tsx
import { Content } from "@drahamo/tiling-layout";
<Content type="myeditor" areaId={9} />;  // 走注册的 MyEditor
<Content type="unknown" areaId={10} />;  // 通用占位
```

需要主动下线一种已注册的类型时,用 `unregisterContent`,见上文「注销内容类型」。

## 状态跟着布局操作走

实例状态存在 `areaStore` 里,按区域 id 分槽。布局操作改变区域时,状态自动跟着迁移:

| 操作 | 状态行为 |
|---|---|
| 调整大小 | 原地存续(areaId 不变) |
| 分割 | 新区域克隆来源的状态 |
| 内容交换 / 停靠到中心 | 两区域状态互换 |
| 合并 | 被吞区域的状态丢弃,保留方不变 |
| 停靠到四边 | 源内容进入新槽,状态转移到槽 |

这套迁移依赖几何重建时保持稳定的区域 id,`applySnapshot` 恢复布局时已经处理好了,正常使用不需要关心。
