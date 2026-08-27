---
sidebar_position: 1
---

# 快速开始

这一篇带你把库装进一个 React 项目,渲染出可交互的布局,并验证拖拽操作真的在改数据。全程大约五分钟。

## 安装

```bash
npm install @drahamo/tiling-layout react react-dom zustand
```

react、react-dom、zustand 是 peer 依赖,库不会把它们打进产物——如果你的项目里已经有,只需要第一条。

## 渲染一个布局

`LayoutViewDom` 是库唯一的渲染组件。它不要求你先描述布局——内部有一份默认的三区布局,直接渲染就有完整的交互:

```tsx
import { LayoutViewDom } from "@drahamo/tiling-layout";
import "@drahamo/tiling-layout/styles.css";

export function App() {
  return (
    <div style={{ position: "absolute", inset: 0 }}>
      <LayoutViewDom />
    </div>
  );
}
```

`LayoutViewDom` 铺满它的容器,所以容器自身要有确定的尺寸(这里用 `inset: 0` 占满视口)。

**验证**:打开页面,你应该看到三个区域。把鼠标移到左上区域,找到角上的 ⌖ 手柄,往右拖——区域被切成了两半。拖分界线可以调整大小,双击区域头部会全屏最大化,Esc 恢复。

## 让布局进代码

到目前为止布局只受鼠标控制。要读写布局状态,用 `useLayoutData()`:这是库的门面,布局操作、多工作区、撤销重做都从这里走。

下面的例子在布局上方加了一条工具栏,可以新建工作区、撤销、把布局导出成 JSON:

```tsx
import { useLayoutData, LayoutViewDom } from "@drahamo/tiling-layout";

export function Workspace() {
  const ld = useLayoutData();

  return (
    <>
      <select value={ld.activeId} onChange={(e) => ld.switchTo(e.target.value)}>
        {ld.layouts.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
      </select>
      <button onClick={() => ld.createLayout()}>新建布局</button>
      <button onClick={() => ld.undo()}>撤销</button>
      <button onClick={() => console.log(ld.serialize())}>导出 JSON</button>
      <div style={{ position: "absolute", inset: "48px 0 0 0" }}>
        <LayoutViewDom />
      </div>
    </>
  );
}
```

**验证**:拖几刀之后点"导出 JSON",控制台里打印的就是当前的布局快照——你刚才的每次拖拽都真实地改了这份数据。点"撤销"几次,布局逐步回退。

## 下一步

每个区域现在还是空的占位内容。接下来通常做的事,按需跳转:

- 在区域里放你自己的组件 → [第一个内容组件](/docs/guides/first-content-component)
- 让多个视图共享一份数据,或各看各的 → [共享数据与独立状态](/docs/advanced/shared-scene)
- 把用户的布局存进 localStorage 或文件 → [撤销、持久化与快照](/docs/advanced/undo-persist-migrate)
