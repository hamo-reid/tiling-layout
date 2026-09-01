import { useEffect, useRef, useState } from "react";
import { LayoutViewDom } from "../src/LayoutViewDom";
import { useLayout } from "../src/layoutStore";
import { serializeLayout } from "../src/layoutData";
import { useLayoutData } from "../src/useLayoutData";
import { layoutBus } from "../src/layoutBus";
import { deserializeWorkspaces, serializeWorkspaces, WORKSPACES_KEY } from "../src/workspaces";
import "./content"; // 演示内容组件(editor/outline/properties)

const DEFAULT_HINT =
  "就绪 — 角标 ⌖ 拖拽：同区分割 / 拖到相邻区合并 / Ctrl+拖交换内容 · 拖分界线调整大小 · Ctrl 吸附 · 角标手势中 Tab 切方向 · Esc/右键 取消";

type Theme = "" | "light" | "dark"; // "" = 跟随系统
const THEME_ICON: Record<Theme, string> = { "": "🌓", light: "☀️", dark: "🌙" };
const SAVE_KEY = "tiling-layout-v1";

/** Demo 外壳：顶栏(状态提示 + 数据操作 + 主题) + DOM 渲染视图。仅演示用，不属于库。 */
export function App() {
  const status = useLayout((s) => s.status) || DEFAULT_HINT;
  const ld = useLayoutData();
  const [theme, setTheme] = useState<Theme>("");
  const [autoSave, setAutoSave] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  // ""=跟随系统：必须移除属性(写空值属性会让 tokens.css 的 :not([data-theme]) 失效)
  useEffect(() => {
    const root = document.documentElement;
    if (theme === "") root.removeAttribute("data-theme");
    else root.dataset.theme = theme;
  }, [theme]);
  const cycleTheme = () => setTheme(theme === "" ? "light" : theme === "light" ? "dark" : "");

  // 载入最近持久化工作区(刷新恢复)：优先整集合，回退旧单布局存档
  useEffect(() => {
    const ws = localStorage.getItem(WORKSPACES_KEY);
    if (ws) { try { deserializeWorkspaces(ws); return; } catch { /* 坏数据则回退 */ } }
    const raw = localStorage.getItem(SAVE_KEY);
    if (raw) { try { useLayout.getState().restore(JSON.parse(raw)); } catch { /* 忽略 */ } }
  }, []);

  // 自动保存：订阅布局实质变化 → debounce 持久化整组工作区(全部布局+当前活跃)
  useEffect(() => {
    if (!autoSave) return;
    let t: ReturnType<typeof setTimeout> | undefined;
    const un = layoutBus.onChange(() => {
      clearTimeout(t);
      t = setTimeout(() => { localStorage.setItem(WORKSPACES_KEY, serializeWorkspaces()); }, 250);
    });
    return () => { clearTimeout(t); un(); };
  }, [autoSave]);

  /** 导出：写本地缓存 + 下载 .json 文件 */
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
      const snap = JSON.parse(text);
      useLayout.getState().restore(snap);
      localStorage.setItem(SAVE_KEY, text);
    } catch { /* 无效数据忽略 */ }
    e.target.value = "";
  };

  return (
    <>
      <header id="topbar">
        <h1>Tiling Layout · 网格分割窗口 (React)</h1>
        <span id="status">{status}</span>
        <select className="theme-toggle" value={ld.activeId}
                onChange={(e) => ld.switchTo(e.target.value)} title="当前布局(工作区)">
          {ld.layouts.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
        </select>
        <button className="theme-toggle" onClick={() => ld.createLayout()} title="新建布局(复制当前)">＋</button>
        <button className="theme-toggle" onClick={() => ld.removeLayout()} title="删除当前布局">－</button>
        <button className="theme-toggle" onClick={() => setAutoSave((v) => !v)}
                style={{ color: autoSave ? "var(--tl-accent)" : undefined }}
                title={autoSave ? "自动保存：开(布局变化自动写入本机)" : "自动保存：关"}>{autoSave ? "⚡开" : "⚡"}</button>
        <button className="theme-toggle" onClick={() => useLayout.getState().undo()}>↩️</button>
        <button className="theme-toggle" onClick={() => useLayout.getState().redo()}>↪️</button>
        <button className="theme-toggle" onClick={exportLayout} title="导出布局 JSON 文件">⬇️</button>
        <button className="theme-toggle" onClick={() => fileRef.current?.click()} title="导入布局 JSON 文件">⬆️</button>
        <input ref={fileRef} type="file" accept="application/json,.json" onChange={importLayout} style={{ display: "none" }} />
        <button className="theme-toggle" onClick={cycleTheme} title="切换主题：系统 / 浅色 / 深色">
          {THEME_ICON[theme]}
        </button>
      </header>
      <main id="canvas-wrap">
        <LayoutViewDom
          theme={{ spacing: { regionGap: 5 } }}
          slots={{
            renderHeader: (ctx) => <>{ctx.title}<small style={{ opacity: .7, marginLeft: 6 }}>#{ctx.areaId}</small></>,
          }}
        />
      </main>
    </>
  );
}