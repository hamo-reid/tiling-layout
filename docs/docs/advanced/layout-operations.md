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

四边停靠的可行性由**源区的位置**决定:只有当它空出来的位置能被邻居(不含停靠槽与目标区)正好铺满并吞并时才允许,否则整次停靠取消、布局分毫不动。
0.5.0 起这个判定支持"多个邻居分摊"——源区位置被两块各占一半(典型的 T 型交会)时也能停靠了;此前只认"单个共享整条边的邻居",这种情况会直接取消。

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

## 命令层:和手势完全等价的那一条路

上面那些纯函数**只改几何**。而手势除此之外还要迁移每个区域的实例状态、压撤销历史、触发重渲——
所以 0.5.0 起库把这三件事和几何一起收成了 `useLayout` 上的命令,**手势本身就是它们的调用方**。
改**当前工作区**的布局请走命令,不要自己拼几何:

```ts
import { useLayout, AXIS, segBetween } from "@drahamo/tiling-layout";

const st = useLayout.getState();

st.splitArea(3, AXIS.V, 0.5);   // 区域 3 竖着切成两半;新块继承它的内容与实例状态
st.closeArea(3);                // 关掉区域 3 —— 它占的位置由紧邻的邻居扩张吃掉
st.mergeAreas(3, 5);            // 合并两块:保留 3 的内容,丢弃 5 的
st.swapAreas(3, 5);             // 对调两块显示的内容(实例状态随同互换)
st.setMaximized(3);             // 幂等地"设为最大化";setMaximized(null) 退出

// 调比例要先指定"哪条分界线":由面对面(含 T 型交会)的两块求出来
const [a, b] = st.screen.areas;
const seg = a && b ? segBetween(st.screen, a, b) : null;
if (seg) st.setRatio(seg, 0.7); // a 侧占 70%,整条连通线族一起平移
```

六个命令遵守同一条契约:**收 id、返回纯数据、幂等、失败即零改动**(返回 `null` 时屏幕分毫未动)。
返回值(`{ created }` / `{ closed, absorbedBy, spanned }` / `{ from, to, members }` …)够你写状态栏与错误提示,不必反查 screen。
它们一律不进手势中间态:调用时会清空在手的角标/停靠/拖拽残留。

需要自己拼几何时,对应的纯函数也在公开面上,且与命令、与手势**共用同一份实现**:

| 命令 | 等价的纯函数 |
|---|---|
| `splitArea` | `splitAt`(确定性分割:源区保 min 侧,不像 `split` 那样随比例翻面) |
| `closeArea` | `planClose` + `applyClose`(含多邻居分摊) |
| `mergeAreas` | `joinAreas` |
| `swapAreas` | 内容类型互换 + `swapAreaState` |
| `setRatio` | `segBetween` + `planRatio` / `applyLineTo`(整条连通线族的夹逼与平移) |

`checkTiling(areas)` 是"这屏还合不合法"的唯一权威(重叠 fail-closed,未铺满按 `full` 档位决定),命令的提交前闸门用的就是它。

程序化构造好的屏幕要变成当前工作区的布局,有两个入口:作为 `initialLayout` / `installInitialLayout` 的输入替换默认布局(见[声明式初始布局](/docs/advanced/initial-layout)),或经 `restore` 落地到当前布局(见[撤销、持久化与快照](/docs/advanced/undo-persist-migrate))。

要注意的是:如果操作的是当前工作区的布局,请通过 `useLayoutData()` 或 `useLayout` 的状态机去改,而不是直接 mutate screen 引用——撤销历史和订阅回调以状态机为准,绕过它做的修改不会留下历史记录。上面那六个命令正是状态机的一部分。

## 最小尺寸与吸附

分割时,分割点会被自动夹住,不会切出小于 `MIN_AREA_W` / `MIN_AREA_H` 的区域;按住 Ctrl 拖拽时,分割线在两类候选位置之间择近吸附:行程区间的 12 等分点,以及与源区域角点正交对齐的其它区域边界。这两条规则内置在 `split` 和渲染器的手势处理里,你自己调几何函数时可以用 `snapCoord` 得到同样的行为:

```ts
import { snapCoord } from "@drahamo/tiling-layout";

// src: 被拖拽的源区域(其自身边界不作为吸附候选)
// delta: 相对起点的偏移;origin: 被拖边的初始坐标
// dir: 方向;ahead/behind: 沿拖拽方向与反方向的行程余量
const snapped = snapCoord(s, src, delta, origin, dir, ahead, behind); // 返回坐标或 null
```
