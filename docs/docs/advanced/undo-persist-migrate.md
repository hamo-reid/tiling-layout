---
sidebar_position: 2
---

# 撤销、持久化与快照

布局的每次结构操作(分割、合并、停靠、调整大小)都会产生一份完整的可序列化快照。撤销重做、存盘、导出导入文件,用的都是这同一份数据。这篇讲怎么接上这些能力。

## 撤销与重做

`useLayout` 内置快照式撤销。结构操作开始时自动记录操作前的快照,不需要你手动打点:

```tsx
import { useLayout } from "@drahamo/tiling-layout";

<button onClick={() => useLayout.getState().undo()}>撤销</button>
<button onClick={() => useLayout.getState().redo()}>重做</button>
```

撤销会把几何、每区域实例状态、共享场景一起回退。多个工作区的历史互相独立,切换工作区不会串。

## 快照的三种形态

```ts
import { collectSnapshot, applySnapshot, serializeLayout } from "@drahamo/tiling-layout";

const snap = collectSnapshot(screen);            // 对象:三层数据的完整快照
const json = serializeLayout(screen);            // 字符串:可直接入库或下载
const restored = applySnapshot(JSON.parse(json)); // 重建 Screen,同步各 store
```

`applySnapshot` 恢复时会原样还原区域 id,所以恢复出来的布局里,每个区域的实例状态还能对上号。

## 导出与导入文件

```ts
const save = () => {
  const url = URL.createObjectURL(
    new Blob([serializeLayout(useLayout.getState().screen)], { type: "application/json" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = "layout.json";
  a.click();
};

const load = async (file: File) => {
  useLayout.getState().restore(JSON.parse(await file.text()));
};
```

`restore` 接受 `JSON.parse` 的结果,内部会先校验、归一,再应用到状态机;几何非法时直接抛错。

## 版本归一

快照带一个 `v` 字段。导入时,`restore` 会经过 `migrateSnapshot` 校验结构并把版本固定到当前格式:

```ts
import { migrateSnapshot, SNAPSHOT_VERSION } from "@drahamo/tiling-layout";

const norm = migrateSnapshot(raw); // 校验 + 固定 v = SNAPSHOT_VERSION
```

当前版本(v1)只存区域矩形(分界线由相邻关系推导,不持久化)。未来格式演进时,在 `migrateSnapshot` 里新增升级分支即可,调用方流程不变。
