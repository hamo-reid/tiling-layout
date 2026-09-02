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

> **想嵌进普通文档流(父元素不用 `position`、padding/margin 由父元素天然适配)?** 用 `positioning="flow"` —— 组件以正常流元素占满父元素内容盒:父元素的 `padding` 自动内缩舞台、`margin` 在舞台外侧、无需定位上下文;只需给父元素确定高度(flex 链或显式 `height`),否则舞台塌 0 高(控制台会 `console.warn` 提示):
>
> ```tsx
> <div style={{ height: 480, padding: 16 }}>
>   <LayoutViewDom positioning="flow" />
> </div>
> ```

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

## 自定义初始布局与内容(声明式)

默认的三区布局(编辑器 / 目录 / 属性)在库加载时固化。换成你自己的布局,给 `LayoutViewDom` 传 `initialLayout` —— 声明式描述区域矩形,并可直接把内容组件内联进去(自动注册,免提前 `registerContent`):

```tsx
import { LayoutViewDom } from "@drahamo/tiling-layout";

export function App() {
  return (
    <div style={{ height: 600 }}>
      <LayoutViewDom
        positioning="flow"
        initialLayout={{
          areas: [
            // 区域内容:内联定义(自动注册,type 即该区域的内容类型)
            {
              rect: [0, 0, 0.6, 1],
              content: {
                type: "monitor", title: "监视器", defaults: { zoom: 1 },
                Comp: ({ state, setState }) => (
                  <div style={{ padding: 12 }}>
                    zoom = {state.zoom ?? 1}{" "}
                    <button onClick={() => setState({ zoom: (state.zoom ?? 1) + 1 })}>+1</button>
                  </div>
                ),
              },
            },
            // 区域内容:引用已注册的类型名,或留空("general" 通用面板)
            { rect: [0.6, 0, 1, 1], content: "editor" },
          ],
        }}
      />
    </div>
  );
}
```

要点:

- 坐标一律是 `[0, 1]×[0, 1]` 归一化比例矩形;`id` 缺省自动分配。
- `content` 接受已注册的类型名、内联定义(自动注册)、或留空(通用面板)。内联定义的 `type` 就是最终内容类型——实例状态、命令式查询都按它寻址,单一命名空间。
- 仅在这份布局首次替换默认时生效;交互过后重新挂载不会把你的改动冲回初始布局。
- 也接受完整快照对象(`LayoutSnapshot`)或几何 `Screen`(程序化 `createScreen/addArea/split` 构造)。
- **与持久化恢复的先后**：若启动时先 `deserializeWorkspaces`(或任何 `restore`)恢复了存档,store 已非默认,`initialLayout` prop 会被跳过(不覆盖你的存档)——这种「先恢复后引导」的模式请改用程序化 `installInitialLayout(...)`。
- **多实例**：`initialLayout` 是页面级引导,多个带不同初始布局的实例共存时仅首个生效。

## 下一步

每个区域现在还是空的占位内容。接下来通常做的事,按需跳转:

- 在区域里放你自己的组件 → [第一个内容组件](/docs/guides/first-content-component)
- 让多个视图共享一份数据,或各看各的 → [共享数据与独立状态](/docs/advanced/shared-scene)
- 把用户的布局存进 localStorage 或文件 → [撤销、持久化与快照](/docs/advanced/undo-persist-migrate)
