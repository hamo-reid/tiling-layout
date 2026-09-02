---
sidebar_position: 0
---

# 布局操作:分割、合并、停靠

这篇介绍两种改变布局的方式:用户用鼠标做的交互操作,和你在代码里对几何做的程序化操作。两者作用在同一个数据层上,效果完全等价。

## 内置的鼠标交互

用 `LayoutViewDom` 渲染后,以下操作开箱即用,不需要写任何代码:

| 手势 | 结果 |
|---|---|
| 拖区域角上的 ⌖ 手柄,落在原区域内 | 分割(按住 Ctrl 吸附,Tab 切换方向) |
| 拖 ⌖ 到相邻区域 | 合并 |
| Ctrl + 拖 ⌖ 到相邻区域 | 交换两区域内容 |
| 拖区域头部到另一区域 | 停靠(中心交换,四边分裂) |
| 拖分界线 | 调整相邻区域大小 |
| 双击区域头部 / Esc | 最大化 / 恢复 |

## 在代码里做同样的操作

几何层是一组纯函数,直接对 screen 对象做变换。下面的例子从零造出一块区域,再把它竖着切成两半——和用户拖一次 ⌖ 的效果一样:

```ts
import { createScreen, addArea, rect, split, AXIS } from "@drahamo/tiling-layout";

// 坐标是归一化比例 [0,1]×[0,1],渲染时按容器尺寸换算成百分比
const s = createScreen();
const A = addArea(s, rect(0, 0, 0.5, 1)); // 区域即矩形,分界线由相邻关系自动推导

const half = split(s, A, AXIS.V, 0.5); // 返回新区域,s.areas 现在有两个
```

预设布局模板、自动化测试、批量重排,都走这条路。

程序化构造好的屏幕要变成当前工作区的布局,有两个入口:作为 `initialLayout` / `installInitialLayout` 的输入替换默认布局(见[声明式初始布局](/docs/advanced/initial-layout)),或经 `restore` 落地到当前布局(见[撤销、持久化与快照](/docs/advanced/undo-persist-migrate))。

要注意的是:如果操作的是当前工作区的布局,请通过 `useLayoutData()` 或 `useLayout` 的状态机去改,而不是直接 mutate screen 引用——撤销历史和订阅回调以状态机为准,绕过它做的修改不会留下历史记录。

## 最小尺寸与吸附

分割时,分割点会被自动夹住,不会切出小于 `MIN_AREA_W` / `MIN_AREA_H` 的区域;按住 Ctrl 拖拽时,分割线在两类候选位置之间择近吸附:行程区间的 12 等分点,以及与源区域角点正交对齐的其它区域边界。这两条规则内置在 `split` 和渲染器的手势处理里,你自己调几何函数时可以用 `snapCoord` 得到同样的行为:

```ts
import { snapCoord } from "@drahamo/tiling-layout";

// src: 被拖拽的源区域(其自身边界不作为吸附候选)
// delta: 相对起点的偏移;origin: 被拖边的初始坐标
// dir: 方向;ahead/behind: 沿拖拽方向与反方向的行程余量
const snapped = snapCoord(s, src, delta, origin, dir, ahead, behind); // 返回坐标或 null
```
