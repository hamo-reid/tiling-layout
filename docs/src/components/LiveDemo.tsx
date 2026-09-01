import { useEffect, useRef, useState } from "react";
import { LayoutViewDom } from "../../../src/LayoutViewDom";
import { useLayout } from "../../../src/layoutStore";
import { serializeLayout } from "../../../src/layoutData";
import { useLayoutData } from "../../../src/useLayoutData";
import { layoutBus } from "../../../src/layoutBus";
import { deserializeWorkspaces, serializeWorkspaces, WORKSPACES_KEY } from "../../../src/workspaces";
// 库的组件样式(tl-* 令牌与组件)。主题跟随站点:data-theme 由 Docusaurus 写在 <html> 上,
// 库的 :root / :root[data-theme="light"] 令牌自动响应,组件内不再自带主题切换。
import "../../../src/styles/index.css";
import { DEMO_CONTENT_TYPES } from "../../../demo/content"; // 演示内容组件(与 demo/ 共用)
import styles from "./LiveDemo.module.css";

const DEFAULT_HINT =
  "就绪 — 角标 ⌖ 拖拽：同区分割 / 拖到相邻区合并 / Ctrl+拖交换内容 · 拖分界线调整大小 · Ctrl 吸附 · 角标手势中 Tab 切方向 · Esc/右键 取消";
const SAVE_KEY = "tiling-layout-v1";

/**
 * LiveDemo — 落地页的可交互演示：库源码直接驱动(与 demo/ 同一套交互外壳,
 * 移除主题切换——文档站自身已有明暗开关)。仅演示用，不属于库。
 */
export default function LiveDemo(): JSX.Element {
  const status = useLayout((s) => s.status) || DEFAULT_HINT;
  const ld = useLayoutData();
  const [autoSave, setAutoSave] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  // 载入最近持久化工作区(刷新恢复)：优先整集合，回退旧单布局存档
  useEffect(() => {
    const ws = localStorage.getItem(WORKSPACES_KEY);
    if (ws) { try { deserializeWorkspaces(ws); return; } catch { /* 坏数据则回退 */ } }
    const raw = localStorage.getItem(SAVE_KEY);
    if (raw) { try { useLayout.getState().restore(JSON.parse(raw)); } catch { /* 忽略 */ } }
  }, []);

  // 自动保存：订阅布局实质变化 → debounce 持久化整组工作区
  useEffect(() => {
    if (!autoSave) return;
    let t: ReturnType<typeof setTimeout> | undefined;
    const un = layoutBus.onChange(() => {
      clearTimeout(t);
      t = setTimeout(() => { localStorage.setItem(WORKSPACES_KEY, serializeWorkspaces()); }, 250);
    });
    return () => { clearTimeout(t); un(); };
  }, [autoSave]);

  const exportLayout = () => {
    const snap = serializeLayout(useLayout.getState().screen);
    localStorage.setItem(SAVE_KEY, snap);
    const url = URL.createObjectURL(new Blob([snap], { type: "application/json" }));
    const a = document.createElement("a");
    a.href = url; a.download = `layout-${Date.now()}.json`; a.click();
    URL.revokeObjectURL(url);
  };

  const importLayout = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    try {
      useLayout.getState().restore(JSON.parse(text));
      localStorage.setItem(SAVE_KEY, text);
    } catch { /* 无效数据忽略 */ }
    e.target.value = "";
  };

  void DEMO_CONTENT_TYPES; // 保证注册模块被打包
  return (
    <div className={styles.shell}>
      <header className={styles.topbar}>
        <span className={styles.status}>{status}</span>
        <select className={styles.btn} value={ld.activeId}
                onChange={(e) => ld.switchTo(e.target.value)} title="当前布局(工作区)">
          {ld.layouts.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
        </select>
        <button className={styles.btn} onClick={() => ld.createLayout()} title="新建布局(复制当前)">＋</button>
        <button className={styles.btn} onClick={() => ld.removeLayout()} title="删除当前布局">－</button>
        <button className={styles.btn} onClick={() => setAutoSave((v) => !v)}
                style={{ color: autoSave ? "var(--tl-accent)" : undefined }}
                title={autoSave ? "自动保存：开(布局变化自动写入本机)" : "自动保存：关"}>{autoSave ? "⚡开" : "⚡"}</button>
        <button className={styles.btn} onClick={() => useLayout.getState().undo()} title="撤销">↩️</button>
        <button className={styles.btn} onClick={() => useLayout.getState().redo()} title="重做">↪️</button>
        <button className={styles.btn} onClick={exportLayout} title="导出布局 JSON 文件">⬇️</button>
        <button className={styles.btn} onClick={() => fileRef.current?.click()} title="导入布局 JSON 文件">⬆️</button>
        <input ref={fileRef} type="file" accept="application/json,.json" onChange={importLayout} style={{ display: "none" }} />
      </header>
      <div className={styles.stage}>
        <LayoutViewDom
          theme={{ spacing: { regionGap: 5 } }}
          slots={{
            renderHeader: (ctx) => <>{ctx.title}<small style={{ opacity: .7, marginLeft: 6 }}>#{ctx.areaId}</small></>,
          }}
        />
      </div>
    </div>
  );
}
