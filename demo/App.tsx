import { useEffect, useRef, useState } from "react";
import { LayoutViewDom } from "../src/LayoutViewDom";
import type { ContentProps, InitialLayout, LayoutConfig } from "../src/public-api";
import { configureRuntime, RUNTIME_DEFAULTS, SIZING_DEFAULTS, SPACING_DEFAULTS } from "../src/public-api";
import { useLayout } from "../src/layoutStore";
import { serializeLayout } from "../src/layoutData";
import { useLayoutData } from "../src/useLayoutData";
import { layoutBus } from "../src/layoutBus";
import { deserializeWorkspaces, serializeWorkspaces, WORKSPACES_KEY } from "../src/workspaces";
import { ConfigPanel } from "./ConfigPanel";
import "./content"; // 演示内容组件(editor/outline/properties)

const DEFAULT_HINT =
  "就绪 — 顶栏「⚙ 配置」可实时调间距/尺寸/行为并即时预览 · 角标 ⌖ 拖拽:同区分割 / 拖到相邻区合并 / Ctrl+拖交换内容 · 拖分界线调整大小 · Ctrl 吸附 · 角标手势中 Tab 切方向 · Esc/右键 取消";

type ColorMode = NonNullable<LayoutConfig["colorMode"]>;
const THEME_ICON: Record<ColorMode, string> = { system: "🌓", light: "☀️", dark: "🌙" };
const SAVE_KEY = "tiling-layout-v1";
const CONFIG_KEY = "tiling-layout-demo-config-v1";

/** demo 默认配置 = 库出厂默认 + 保持原 demo 观感的 regionGap=5 */
const DEFAULT_CONFIG: LayoutConfig = {
  colorMode: "system",
  spacing: { ...SPACING_DEFAULTS, regionGap: 5 },
  sizing: { ...SIZING_DEFAULTS },
  interaction: { ...RUNTIME_DEFAULTS, dockSnap: [...RUNTIME_DEFAULTS.dockSnap] },
};

/** 深拷贝配置(避免「重置」时状态里残留旧引用) */
function cloneConfig(c: LayoutConfig): LayoutConfig {
  return {
    ...c,
    spacing: { ...c.spacing },
    sizing: { ...c.sizing },
    interaction: c.interaction ? { ...c.interaction, dockSnap: [...(c.interaction.dockSnap ?? [])] } : undefined,
  };
}

/** 读取持久化的配置(缺字段用默认补齐;坏数据回退默认) */
function loadConfig(): LayoutConfig {
  try {
    const raw = localStorage.getItem(CONFIG_KEY);
    if (!raw) return cloneConfig(DEFAULT_CONFIG);
    const saved = JSON.parse(raw) as LayoutConfig;
    return cloneConfig({
      ...DEFAULT_CONFIG,
      ...saved,
      spacing: { ...DEFAULT_CONFIG.spacing, ...saved.spacing },
      sizing: { ...DEFAULT_CONFIG.sizing, ...saved.sizing },
      interaction: { ...DEFAULT_CONFIG.interaction, ...saved.interaction },
    });
  } catch {
    return cloneConfig(DEFAULT_CONFIG);
  }
}

/** 演示 v0.3 声明式初始布局:上下两栏 + 右下内联内容(自动注册,type 即唯一身份)。
 *  与默认三区明显不同,打开即可看到 initialLayout 生效。 */
const DEMO_INITIAL_LAYOUT: InitialLayout = {
  areas: [
    { rect: [0, 0.5, 1, 1], content: "editor" },                       // 上 50%:编辑器
    { rect: [0, 0, 0.5, 0.5], content: "outline" },                    // 左下:目录
    { rect: [0.5, 0, 1, 0.5], content: {                               // 右下:内联监视器
        type: "monitor", title: "监视器", defaults: { zoom: 1 },
        Comp: ({ state, setState }: ContentProps<{ zoom?: number }>) => (
          <div className="dc-panel">
            <div style={{ fontSize: 14, marginBottom: 8 }}>zoom = {state.zoom ?? 1}</div>
            <button className="dc-btn" type="button"
                    onClick={(e) => { e.stopPropagation(); setState({ zoom: (state.zoom ?? 1) + 1 }); }}>
              +1
            </button>
            <div className="dc-foot">内联内容 · 状态随区域实例保存</div>
          </div>
        ),
    } },
  ],
};

/** Demo 外壳：顶栏(状态提示 + 数据操作 + 配置/主题) + DOM 渲染视图。仅演示用，不属于库。 */
export function App() {
  const status = useLayout((s) => s.status) || DEFAULT_HINT;
  const ld = useLayoutData();
  const [config, setConfig] = useState<LayoutConfig>(() => loadConfig());
  const [cfgOpen, setCfgOpen] = useState(false);
  const [cfgNonce, setCfgNonce] = useState(0); // 变更「重置」→ 重挂配置面板重灌输入框
  const [autoSave, setAutoSave] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  // 主题:config.colorMode → documentElement[data-theme]("system" 必须移除属性,
  // 否则 tokens.css 的 :not([data-theme]) 系统跟随分支失效)
  useEffect(() => {
    const root = document.documentElement;
    const mode = config.colorMode ?? "system";
    if (mode === "system") root.removeAttribute("data-theme");
    else root.dataset.theme = mode;
  }, [config.colorMode]);

  // 行为参数(全局单例):实时应用,effect 清理时还原上一份
  useEffect(() => {
    return configureRuntime(config.interaction);
  }, [config.interaction]);

  // 配置持久化:刷新后保留(demo 专用;坏值/隐私模式失败忽略)
  useEffect(() => {
    try { localStorage.setItem(CONFIG_KEY, JSON.stringify(config)); } catch { /* 忽略 */ }
  }, [config]);

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

  const cycleTheme = () => {
    const cur = config.colorMode ?? "system";
    const next: ColorMode = cur === "system" ? "light" : cur === "light" ? "dark" : "system";
    setConfig((c) => ({ ...c, colorMode: next }));
  };

  const resetConfig = () => {
    setConfig(cloneConfig(DEFAULT_CONFIG));
    setCfgNonce((n) => n + 1);
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
        <button className="theme-toggle" onClick={() => setCfgOpen((v) => !v)}
                style={{ color: cfgOpen ? "var(--tl-accent)" : undefined }}
                title="布局配置(实时预览)">⚙ 配置</button>
        <button className="theme-toggle" onClick={cycleTheme} title="切换主题：系统 / 浅色 / 深色">
          {THEME_ICON[config.colorMode ?? "system"]}
        </button>
      </header>
      <main id="canvas-wrap">
        <LayoutViewDom
          positioning="flow"
          initialLayout={DEMO_INITIAL_LAYOUT}
          theme={config}
          slots={{
            renderHeader: (ctx) => <>{ctx.title}<small style={{ opacity: .7, marginLeft: 6 }}>#{ctx.areaId}</small></>,
          }}
        />
      </main>
      {cfgOpen && (
        <ConfigPanel
          key={cfgNonce}
          config={config}
          onChange={setConfig}
          onReset={resetConfig}
          onClose={() => setCfgOpen(false)}
        />
      )}
    </>
  );
}
