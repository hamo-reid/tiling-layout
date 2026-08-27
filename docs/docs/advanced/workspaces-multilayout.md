---
sidebar_position: 3
---

# 多布局(工作区)

用户经常要同时维护几套布局——"数据分析"一套、"写代码"一套,来回切。`workspaces` 就是为此准备的:每个工作区是一份完整快照(几何、每区域实例、共享数据、undo 历史),切换时互不串。

## 基本操作

```tsx
import { useLayoutData } from "@drahamo/tiling-layout";

function WorkspaceBar() {
  const ld = useLayoutData();
  return (
    <>
      <select value={ld.activeId} onChange={(e) => ld.switchTo(e.target.value)}>
        {ld.layouts.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
      </select>
      <button onClick={() => ld.createLayout()}>新建</button>
      <button onClick={() => ld.removeLayout()}>删除</button>
    </>
  );
}
```

三个方法的行为:

- `createLayout(name?)` — 以当前布局为模板新建,undo 历史从零开始。
- `switchTo(id)` — 先把当前布局存档,再恢复目标,两边状态都不丢。
- `removeLayout(id?)` — 删除指定(或当前)工作区;删当前时会先切到别的。

切换本身没有仪式感:内部就是"存档当前 → 恢复目标"两步,复用的是和持久化同一套快照机制。用户在 A 布局里切了三次分界线,B 布局不受影响,A 的撤销栈里这三刀也都还在。
