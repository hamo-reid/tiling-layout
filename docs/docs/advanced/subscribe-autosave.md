---
sidebar_position: 4
---

# 订阅数据变化与自动保存

React 组件用 `useLayoutData()` 读数据,组件自然只在读到的那片变化时重渲。但持久化、日志、外部引擎同步这些代码不在 React 树里,需要一个统一的"数据实质变了"信号——这就是 `layoutBus.onChange`。

## onChange

回调收到当前和上一次两个事件,各自带完整快照,可以自行 diff:

```ts
import { layoutBus } from "@drahamo/tiling-layout";

const off = layoutBus.onChange((cur, prev) => {
  if (!prev) return; // 首次回调只给基准,不算变化
  if (cur.snapshot.areas.length !== prev.snapshot.areas.length) {
    console.log("区域数量变化", prev.snapshot.areas.length, "→", cur.snapshot.areas.length);
  }
});
// 停止订阅: off();
```

`onChange` 只在数据实质变化时触发:内部对几何、实例状态、共享数据、当前工作区做指纹比对,拖拽过程中的预览、hover 这类瞬时 UI 状态不会刷进来。所以你可以放心地把它接到持久化上,不会被拖一次拽刷出几十条。

## 自动保存

回调太频繁时加一层 debounce。比如停止操作 250ms 后写入 localStorage:

```tsx
import { useEffect } from "react";
import { layoutBus } from "@drahamo/tiling-layout";

function useAutoSave(save: (snapshot: unknown) => void, enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;
    let t: ReturnType<typeof setTimeout>;
    const off = layoutBus.onChange((evt) => {
      clearTimeout(t);
      t = setTimeout(() => save(evt.snapshot), 250);
    });
    return () => { clearTimeout(t); off(); };
  }, [save, enabled]);
}
```

```tsx
useAutoSave((snap) => localStorage.setItem("layout", JSON.stringify(snap)), true);
```

启动时用 `restore` 读回来,就是一个可用的自动保存闭环。要更细的粒度,在 `onChange` 回调里对 `cur` / `prev` 做字段级 diff 即可,两个快照都是完整的。
