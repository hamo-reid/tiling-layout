---
sidebar_position: 1
---

# 共享数据与每区域独立状态

同一个库里的数据,有的要全局共享,有的要每个区域各管各的。典型场景:两个 3D 视图看同一个模型(移动模型,两个视图都变),但各有一个独立视角(转动视角,只影响自己)。这篇讲库怎么划这条线,以及两种数据各怎么读写。

## 共享:useScene

`useScene` 是全局的,没有区域的概念。所有订阅它的组件读同一个对象,一处修改,处处同步:

```tsx
import { useScene, sceneActions } from "@drahamo/tiling-layout";

function StatusBar() {
  const mesh = useScene((s) => s.mesh);
  return (
    <>
      <span>物体 X = {mesh.x.toFixed(1)}</span>
      <button onClick={() => sceneActions.moveMesh(0.5)}>移动 +X</button>
    </>
  );
}
```

把这个组件放进任何区域,按钮点下去,所有区域里的状态栏同时更新。

## 独立:useAreaInstance

区域自己的状态用 `useAreaInstance(areaId, contentType)` 读。第二个参数是内容类型——同一个区域里不同类型的内容各占一个槽,互不干扰:

```tsx
import { useAreaInstance } from "@drahamo/tiling-layout";

function View3D({ areaId }: { areaId: number }) {
  const inst = useAreaInstance(areaId, "viewport");
  const view = inst.value.view ?? { zoom: 1, rot: 0 };

  return (
    <>
      <span>视角旋转 {view.rot}°</span>
      <button onClick={() => inst.set({ view: { ...view, rot: view.rot + 15 } })}>
        仅本视图旋转
      </button>
    </>
  );
}
```

两个 3D 视图的 `areaId` 不同,各调各的视角。

## 在注册组件里两者一起用

大多数时候你写的是注册内容组件(见[第一个内容组件](/docs/guides/first-content-component)),组件收到的 `state`/`setState` 已经就是每区域独立状态,直接再叠加 `useScene` 即可:

```tsx
function View3DPanel({ state, setState }: ContentProps<{ view?: View }>) {
  const mesh = useScene((s) => s.mesh);          // 共享:动模型,全视图同步
  const view = state.view ?? { zoom: 1, rot: 0 }; // 独立:转视角,只变本视图
  // …其余同上
}
```

判断某个状态放哪一层的标准很简单:换一个区域看,这个数据应该跟着变吗?应该跟(模型、选中集)就放共享;不应该跟(视角、草稿、滚动位置)就放每区域实例。
