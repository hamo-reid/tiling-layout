import type { ReactNode } from "react";
import Link from "@docusaurus/Link";
import useDocusaurusContext from "@docusaurus/useDocusaurusContext";
import Layout from "@theme/Layout";
import LiveDemo from "../components/LiveDemo";

/**
 * 落地页。展示区是真实库驱动的可交互演示(LiveDemo 直接 import 库源码),
 * 玩法与 demo/ 完全一致;主题跟随站点明暗开关。
 */

function Feature({ k, title, children, to }: { k: string; title: string; children: ReactNode; to: string }): JSX.Element {
  return (
    <div className="landing-feature">
      <div className="landing-feature-k">{k}</div>
      <h3>{title}</h3>
      <p>{children} <Link to={to}>了解 →</Link></p>
    </div>
  );
}

export default function Home(): JSX.Element {
  const { siteConfig } = useDocusaurusContext();
  return (
    <Layout description={siteConfig.tagline}>
      <main>
        <section className="landing-hero">
          <div className="container">
            <div className="landing-kicker">React 网格分割布局库</div>
            <h1 className="landing-title">{siteConfig.title}</h1>
            <p className="landing-subtitle">
              分割、合并、停靠、调整大小,开箱即用。布局是一份可序列化的数据——
              撤销、持久化、多工作区都建立在它上面。下面就是真实的库,直接上手玩:
            </p>
            <div className="landing-cta">
              <Link className="button button--primary button--lg" to="/docs/guides/quickstart">
                快速开始
              </Link>
              <Link className="button button--secondary button--lg" to="/docs/api">
                API 参考
              </Link>
            </div>
          </div>
        </section>

        <section className="landing-demo">
          <div className="container">
            <LiveDemo />
            <p className="landing-demo-hint">
              提示:拖区域角标 ⌖ 分割/合并/交换 · 拖分界线调整大小 · 拖区域头部到另一区域停靠 ·
              双击标题最大化 · ⚡ 开启自动保存后刷新页面可恢复。
            </p>
          </div>
        </section>

        <section className="landing-features">
          <div className="container">
            <div className="landing-features-grid">
              <Feature k="split(s, area, AXIS.V, 0.5)" title="布局即数据" to="/docs/advanced/layout-operations">
                几何网格加一小组纯函数,代码里做一次 split 和用户拖一次角标效果完全等价。
              </Feature>
              <Feature k="useAreaInstance(areaId, type)" title="每区域状态" to="/docs/guides/first-content-component">
                实例状态按区域 id 分槽,分割时克隆、交换时互换,自动跟着布局操作迁移。
              </Feature>
              <Feature k="useScene((s) => s.mesh)" title="共享场景" to="/docs/advanced/shared-scene">
                跨视图共享一份数据:一个视图里改,所有视图同步。独立视角照常各管各的。
              </Feature>
              <Feature k="layoutBus.onChange" title="订阅与多工作区" to="/docs/advanced/workspaces-multilayout">
                数据实质变化才触发回调,接上 debounce 就是自动保存;每个工作区独立快照与历史。
              </Feature>
            </div>
          </div>
        </section>

        <section className="landing-cta-strip">
          <div className="container">
            <h2>五分钟,渲染出第一个可拖拽的布局。</h2>
            <Link className="button button--primary button--lg" to="/docs/guides/quickstart">
              开始使用
            </Link>
          </div>
        </section>
      </main>
    </Layout>
  );
}
