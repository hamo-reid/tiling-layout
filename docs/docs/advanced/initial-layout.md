---
sidebar_position: 6
---

# 声明式初始布局(替换默认布局)

库加载时,默认的三区布局(编辑器 / 目录 / 属性)就固化了,公开接口也没有「注入点」直接换掉它。过去要自定义初始布局,只能在模块顶层调 `restore` 的 hack:绕不开 import 时序、首帧会闪一帧默认布局,而且只改了状态机、workspaces 的种子快照不同步。这篇讲现在的两种正规做法,以及它们和持久化恢复、撤销的关系。

## 用 `initialLayout` prop

给 `LayoutViewDom` 传 `initialLayout`,组件挂载时如果 store 仍是默认布局,就用它替换:

```tsx
import { LayoutViewDom } from "@drahamo/tiling-layout";

export function App() {
  return (
    <div style={{ height: 600 }}>
      <LayoutViewDom
        positioning="flow"
        initialLayout={{
          areas: [
            { rect: [0, 0.5, 1, 1], content: "editor" },        // 上 50%:已注册类型
            { rect: [0, 0, 0.5, 0.5], content: "outline" },
            { rect: [0.5, 0, 1, 0.5], content: "monitor" },     // 内联内容(见下文)
          ],
        }}
      />
    </div>
  );
}
```

坐标是 `[0,1]×[0,1]` 归一化比例矩形;`id` 缺省自动分配(避开你显式写的 id)。整个替换发生在 paint 前,不会闪一帧默认布局。

## 三种输入形式

`InitialLayout` 接受三样东西,按需选择:

- **声明式 areas 数组**(上文的写法):每个区域给 `rect` 和 `content`,最直观。
- **快照对象**:任何 `LayoutSnapshot`(或手写 `{ v, areas }`,缺省字段由校验兜底)。
- **几何 `Screen`**:程序化 `createScreen`/`addArea`/`split` 构造的屏幕,直接传。

```ts
import { createScreen, addArea, rect, split, AXIS, installInitialLayout } from "@drahamo/tiling-layout";

const s = createScreen();
addArea(s, rect(0, 0, 0.5, 1));
split(s, s.areas[0], AXIS.V, 0.5);
installInitialLayout(s);   // 程序化安装,见下文
```

## 内容映射:字符串还是内联定义

`content` 字段有两种写法,都决定这个区域显示什么:

- **已注册的类型名**:字符串,区域渲染 `registerContent` 注册的组件。
- **内联定义**:直接写 `ContentDef`,自动注册(相当于顺手调了一次 `registerContent`),`type` 就是最终内容类型——实例状态、命令式查询都按它寻址,单一命名空间。

```tsx
initialLayout={{
  areas: [
    {
      rect: [0, 0, 1, 1],
      content: {
        type: "monitor", title: "监视器", defaults: { zoom: 1 },
        Comp: ({ state, setState }) => (
          <button onClick={() => setState({ zoom: (state.zoom ?? 1) + 1 })}>
            zoom = {state.zoom ?? 1}
          </button>
        ),
      },
    },
  ],
}}
```

内联定义在布局校验**通过之后**才注册:如果几何非法(越界、重叠、id 重复)被拒绝,注册表不会留下残留,现有状态也不受影响。

## 什么时候生效

替换布局是**页面级**行为,只发生一次(模块内已引导标记)。三个条件都满足才会应用:还没有任何一次引导、当前活跃工作区是种子布局、store 仍是「没被动过」的状态。最后一条由 `isPristineScreen` 判定:几何等于默认三区,实例状态只含 `defaults` 自动注入的值,共享数据是默认值。因此交互过后重新挂载组件、或换到别的布局,都不会把你的改动冲回初始布局。

如果只是想在程序里随时替换当前布局(不经过组件挂载),直接调 `installInitialLayout`——它无条件安装并返回应用的快照(无效输入返回 `null`):

```ts
import { installInitialLayout } from "@drahamo/tiling-layout";

const snap = installInitialLayout({ areas: [{ rect: [0, 0, 1, 1], content: "editor" }] });
if (snap) console.log("已安装:", snap.areas.length, "个区域");
```

## 与持久化恢复的先后

如果启动时先恢复了存档(调用过 `deserializeWorkspaces`,或任何 `restore`),store 就不再是默认状态,`initialLayout` prop 会被跳过——这是有意的:存档优先,不覆盖。这种「先恢复存档、无存档时才用初始布局」的模式,请改用程序化的 `installInitialLayout`(它无条件安装),或让存档恢复走在组件挂载之后。

## 撤销:先安装,再压栈

`initialLayout` 安装走的是 `restore`,和所有恢复一样**不进 undo 历史**。想要 undo 能退回这份初始布局,先安装再手动压栈:

```ts
installInitialLayout({ areas: [{ rect: [0, 0, 1, 1], content: "editor" }] });
useLayout.getState().commitHistory(); // 把「自定义初始布局」设为可撤销的基线
```

顺序反了(`commitHistory` 在前)会把默认三区压进历史,undo 反而退回默认布局。不调 `commitHistory` 也问题不大:后续首个结构操作(分割/合并/停靠/调大小)会把操作前的布局自动入栈,undo 同样能退回。
