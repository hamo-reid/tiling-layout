import { useState } from "react";
import type { LayoutConfig } from "../src/public-api";
import "./configPanel.css";

/**
 * ConfigPanel — demo 专用配置面板(不属于库)。
 *
 * 实时编辑 LayoutConfig 的每一项并立刻看到效果:
 *   - spacing / sizing:CSS 变量,实例级(本 demo 直接喂给 LayoutViewDom 的 theme)
 *   - interaction:全局单例,由 App 调 configureRuntime 应用
 *   - colorMode:写到 documentElement[data-theme]
 * 每个字段带 label + 数值输入 + 一行小字说明该配置项的作用。
 *
 * 不用遮罩层:面板是右侧浮层,画布保持可交互,便于一边调一边拖拽验证效果。
 */

export interface ConfigPanelProps {
  config: LayoutConfig;
  onChange: (next: LayoutConfig) => void;
  onReset: () => void;
  onClose: () => void;
}

type Spacing = NonNullable<LayoutConfig["spacing"]>;
type Sizing = NonNullable<LayoutConfig["sizing"]>;
type Interaction = NonNullable<LayoutConfig["interaction"]>;

/** 数值输入行:label + input + 功效小字 */
function NumField({ label, hint, value, step, min, max, onChange }: {
  label: string;
  hint: string;
  value: number;
  step?: number;
  min?: number;
  max?: number;
  onChange: (v: number) => void;
}) {
  return (
    <label className="cfg-field">
      <span className="cfg-field__label">{label}</span>
      <input
        className="cfg-field__input"
        type="number"
        value={Number.isFinite(value) ? value : 0}
        step={step ?? 1}
        {...(min !== undefined ? { min } : {})}
        {...(max !== undefined ? { max } : {})}
        onChange={(e) => {
          if (e.target.value === "") return; // 空输入保持旧值,避免 NaN 进 CSS
          const v = Number(e.target.value);
          if (Number.isFinite(v)) onChange(v);
        }}
      />
      <small className="cfg-field__hint">{hint}</small>
    </label>
  );
}

/** 逗号分隔比例列表(停靠吸附网格) */
function SnapField({ label, hint, value, onChange }: {
  label: string;
  hint: string;
  value: number[];
  onChange: (v: number[]) => void;
}) {
  const [text, setText] = useState(() => value.join(", "));
  return (
    <label className="cfg-field">
      <span className="cfg-field__label">{label}</span>
      <input
        className="cfg-field__input"
        type="text"
        spellCheck={false}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          const nums = e.target.value
            .split(/[\s,]+/)
            .map(Number)
            .filter((n) => Number.isFinite(n) && n > 0 && n < 1);
          if (nums.length > 0) onChange(nums);
        }}
      />
      <small className="cfg-field__hint">{hint}</small>
    </label>
  );
}

export function ConfigPanel({ config, onChange, onReset, onClose }: ConfigPanelProps) {
  const spacing = config.spacing ?? {};
  const sizing = config.sizing ?? {};
  const interaction = config.interaction ?? {};

  const setSpacing = (patch: Spacing): void => onChange({ ...config, spacing: { ...spacing, ...patch } });
  const setSizing = (patch: Sizing): void => onChange({ ...config, sizing: { ...sizing, ...patch } });
  const setInteraction = (patch: Interaction): void => onChange({ ...config, interaction: { ...interaction, ...patch } });

  return (
    <aside className="cfg-panel" role="dialog" aria-label="布局配置">
      <header className="cfg-head">
        <b className="cfg-head__title">布局配置</b>
        <span className="cfg-head__sub">实时预览</span>
        <button type="button" className="cfg-head__btn" onClick={onReset}>重置默认</button>
        <button type="button" className="cfg-head__close" onClick={onClose} aria-label="关闭">×</button>
      </header>

      <div className="cfg-body">
        <section className="cfg-sec">
          <h4 className="cfg-sec__title">主题 colorMode</h4>
          <label className="cfg-field">
            <span className="cfg-field__label">配色模式</span>
            <select
              className="cfg-field__input"
              value={config.colorMode ?? "system"}
              onChange={(e) => {
                const v = e.target.value;
                if (v === "dark" || v === "light" || v === "system") onChange({ ...config, colorMode: v });
              }}
            >
              <option value="system">跟随系统</option>
              <option value="light">浅色</option>
              <option value="dark">深色</option>
            </select>
            <small className="cfg-field__hint">明暗主题;「跟随系统」按操作系统偏好自动切换。</small>
          </label>
        </section>

        <section className="cfg-sec">
          <h4 className="cfg-sec__title">间距 spacing</h4>
          <NumField
            label="区域间隔 regionGap"
            hint="面板之间的分隔宽度(以区域描边实现,px)。调大缝更宽。"
            value={spacing.regionGap ?? 0}
            onChange={(v) => setSpacing({ regionGap: v })}
          />
          <NumField
            label="内容内边距 padRegion"
            hint="库自绘头部条与占位内容的留白;注册面板的内容容器不套用。"
            value={spacing.padRegion ?? 0}
            onChange={(v) => setSpacing({ padRegion: v })}
          />
          <NumField
            label="舞台外边距 outerGap"
            hint="整个布局区四周的外边距。角标会向外凸出,建议 ≥ 角标尺寸的一半。"
            value={spacing.outerGap ?? 0}
            onChange={(v) => setSpacing({ outerGap: v })}
          />
        </section>

        <section className="cfg-sec">
          <h4 className="cfg-sec__title">尺寸 sizing</h4>
          <NumField
            label="头部高 headerH"
            hint="区域标题条的高度(px)。"
            value={sizing.headerH ?? 0}
            onChange={(v) => setSizing({ headerH: v })}
          />
          <NumField
            label="角标 corner"
            hint="十字手柄的尺寸(px);越大越好点。"
            value={sizing.corner ?? 0}
            onChange={(v) => setSizing({ corner: v })}
          />
          <NumField
            label="圆角 radius"
            hint="区域外框的圆角半径(px)。"
            value={sizing.radius ?? 0}
            onChange={(v) => setSizing({ radius: v })}
          />
          <NumField
            label="分界线带宽 splitter"
            hint="拖拽分界线的命中带宽(px):调大好抓取;与下面的线宽解耦,不会把线变粗。"
            value={sizing.splitter ?? 0}
            onChange={(v) => setSizing({ splitter: v })}
          />
          <NumField
            label="分界线线宽 splitterLine"
            hint="分界线的视觉线宽(px),独立于上面的命中带宽:热区可宽、线保持纤细。"
            value={sizing.splitterLine ?? 0}
            onChange={(v) => setSizing({ splitterLine: v })}
          />
        </section>

        <section className="cfg-sec">
          <h4 className="cfg-sec__title">
            行为 interaction <em className="cfg-tag">全局</em>
          </h4>
          <NumField
            label="中心热区 dockCenter"
            hint="停靠时“正中间替换”热区的半宽(比例)。越大越容易触发替换,四边热区越小。"
            step={0.01} min={0.01} max={0.49}
            value={interaction.dockCenter ?? 0.25}
            onChange={(v) => setInteraction({ dockCenter: v })}
          />
          <SnapField
            label="吸附网格 dockSnap"
            hint="停靠槽占比的吸附网格(逗号分隔的比例)。松手时槽占比对齐到最近的网格值。"
            value={interaction.dockSnap ?? []}
            onChange={(v) => setInteraction({ dockSnap: v })}
          />
          <NumField
            label="最小宽 minAreaW"
            hint="区域最小宽度(比例)。分割/拖拽/停靠都不得低于它。"
            step={0.01} min={0.01} max={0.49}
            value={interaction.minAreaW ?? 0.06}
            onChange={(v) => setInteraction({ minAreaW: v })}
          />
          <NumField
            label="最小高 minAreaH"
            hint="区域最小高度(比例)。"
            step={0.01} min={0.01} max={0.49}
            value={interaction.minAreaH ?? 0.06}
            onChange={(v) => setInteraction({ minAreaH: v })}
          />
          <NumField
            label="角点起步 cornerArm"
            hint="角标手势要拖动超过这个距离才锁定分割目标(比例),防误触。"
            step={0.005} min={0}
            value={interaction.cornerArm ?? 0.01}
            onChange={(v) => setInteraction({ cornerArm: v })}
          />
          <NumField
            label="命中容差 hitTolerance"
            hint="仅影响几何查询 findEdgeAtPos(比例);内置拖拽热区由 splitter 决定。"
            step={0.001} min={0}
            value={interaction.hitTolerance ?? 0.005}
            onChange={(v) => setInteraction({ hitTolerance: v })}
          />
          <p className="cfg-note">
            行为参数是全局的:几何层/状态机为模块单例,只能全局一份,不能按实例区分。
          </p>
        </section>
      </div>
    </aside>
  );
}
