import { useScene } from "../src/sceneStore";
import { registerContent } from "../src/registry";
import type { ContentProps } from "../src/registry";
import "./content.css";

/**
 * content — 演示内容组件集(不属于库):编辑器 / 目录 / 属性。
 * 三块面板分别演示库的三种状态形态:
 *   editor     实例状态(每区域独立草稿,split 克隆 / dock 搬移 / swap 互换)
 *   outline    实例状态的最小用法(每区域独立的选中项)
 *   properties 同屏对比"每区域独立"与"全局共享"(useScene)两种数据
 */

/** 编辑器:草稿存在本区域的实例状态槽,DOM 重塑(分割/合并/停靠)不丢 */
function EditorPanel({ state, setState }: ContentProps<{ text?: string }>) {
  const text = state.text ?? "";
  return (
    <div className="dc-panel">
      <textarea
        className="dc-editor"
        value={text}
        placeholder="在这里输入…草稿按区域独立保存,分割/交换时自动跟随"
        onChange={(e) => setState({ text: e.target.value })}
      />
      <div className="dc-foot">{text.length} 字 · 本区域独立草稿</div>
    </div>
  );
}

/** 目录:最小的实例状态用法——每区域记住自己选中了哪一项 */
const OUTLINE_ITEMS = ["简介与设计思想", "快速上手", "第一个内容组件", "深入:布局操作", "深入:快照与持久化"];

function OutlinePanel({ state, setState }: ContentProps<{ selected?: number }>) {
  const selected = state.selected ?? 0;
  return (
    <div className="dc-panel">
      <ul className="dc-outline">
        {OUTLINE_ITEMS.map((t, i) => (
          <li key={t}>
            <button type="button"
                    className={"dc-outline-item" + (i === selected ? " is-active" : "")}
                    onClick={(e) => { e.stopPropagation(); setState({ selected: i }); }}>
              {t}
            </button>
          </li>
        ))}
      </ul>
      <div className="dc-foot">选中:{OUTLINE_ITEMS[selected]} · 每区域独立选中</div>
    </div>
  );
}

/** 属性:同一面板里并排对比两种数据——左边每区域独立,右边全局共享 */
function PropertiesPanel({ state, setState }: ContentProps<{ local?: number }>) {
  const local = state.local ?? 0;
  const shared = useScene((s) => s.mesh.x);
  return (
    <div className="dc-panel">
      <div className="dc-props">
        <div className="dc-props-row">
          <span>本面板计数(独立)</span>
          <b>{local}</b>
          <button type="button" className="dc-btn"
                  onClick={(e) => { e.stopPropagation(); setState({ local: local + 1 }); }}>+1</button>
        </div>
        <div className="dc-props-row">
          <span>共享计数(全部属性面板同步)</span>
          <b>{shared}</b>
          <button type="button" className="dc-btn"
                  onClick={(e) => { e.stopPropagation(); useScene.setState((s) => ({ mesh: { ...s.mesh, x: s.mesh.x + 1 } })); }}>+1</button>
        </div>
      </div>
      <div className="dc-foot">左列按区域隔离,右列所有属性面板读同一份</div>
    </div>
  );
}

registerContent({ type: "editor", title: "编辑器", defaults: { text: "" }, Comp: EditorPanel });
registerContent({ type: "outline", title: "目录", defaults: { selected: 0 }, Comp: OutlinePanel });
registerContent({ type: "properties", title: "属性", defaults: { local: 0 }, Comp: PropertiesPanel });

/** 供宿主 import 使用:保证本模块的注册副作用不被 tree-shaking 丢弃 */
export const DEMO_CONTENT_TYPES = ["editor", "outline", "properties"] as const;
