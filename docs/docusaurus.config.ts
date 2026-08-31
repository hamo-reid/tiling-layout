import type { Config } from "@docusaurus/types";
import type * as Preset from "@docusaurus/preset-classic";
import type { SidebarItem } from "@docusaurus/plugin-content-docs";
import { themes as prismThemes } from "prism-react-renderer";

/* ────────────────────────────────────────────────────────────────────────────
 * ★ 部署相关常量:仓库确定后只改这里,url / 组织 / 导航 GitHub 链接全部由此派生。
 *   若部署到 GitHub Pages 项目站(https://<user>.github.io/<repo>),
 *   baseUrl 需同步改为 `/${REPO_NAME}/`。
 * ──────────────────────────────────────────────────────────────────────────── */
const GITHUB_USER = "hamo-reid";
const REPO_NAME = "tiling-layout";
const SITE_URL = `https://${GITHUB_USER}.github.io`; // 注意:部署到 GH Pages 项目站时,baseUrl 要同步改为 `/${REPO_NAME}/`
const REPO_URL = `https://github.com/${GITHUB_USER}/${REPO_NAME}`;
// GitHub Pages 项目站路径前缀(https://<user>.github.io/<repo>),与 package.json homepage 一致
const BASE_URL = `/${REPO_NAME}/`;

const config: Config = {
  title: "Tiling Layout",
  tagline: "React 网格分割布局库 + 纯数据管理层",
  url: SITE_URL,
  baseUrl: BASE_URL,
  onBrokenLinks: "throw",
  i18n: { defaultLocale: "zh-CN", locales: ["zh-CN"] },
  organizationName: GITHUB_USER, // GitHub 用户名/组织(docusaurus deploy 与 OG 元数据用)
  projectName: REPO_NAME,

  presets: [
    [
      "classic",
      {
        docs: {
          sidebarPath: "./sidebars.ts",
          routeBasePath: "/docs",
          // 把 TypeDoc 生成的 API 侧边栏注入到 docs/api 目录对应的分类下,
          // 生成文件由 docusaurus-plugin-typedoc 在插件初始化阶段产出(早于本钩子执行)
          async sidebarItemsGenerator({
            defaultSidebarItemsGenerator,
            ...args
          }) {
            // api 侧边栏整体由 TypeDoc 产物接管(按 @category 分组);
            // guides/advanced 走目录自动生成。
            if (args.item.dirName === "api") {
              // 懒加载:首次构建时文件由 typedoc 插件在本次初始化中生成
              // eslint-disable-next-line @typescript-eslint/no-var-requires
              const typedocItems = require("./docs/api/typedoc-sidebar.cjs") as SidebarItem[];
              return [
                { type: "doc", id: "api/index", label: "总览" },
                // 生成的首项即 api/index 本身,与上面的总览重复,剔除
                ...typedocItems.filter(
                  (sub) => !(sub.type === "doc" && sub.id === "api/index"),
                ),
              ];
            }
            return defaultSidebarItemsGenerator(args);
          },
        },
        theme: { customCss: "./src/css/custom.css" },
        blog: false,
      } satisfies Preset.Options,
    ],
  ],

  plugins: [
    [
      "docusaurus-plugin-typedoc",
      {
        // 以下为 TypeDoc 选项(相对 docs/ 目录解析)
        entryPoints: ["../src/public-api.ts"],
        tsconfig: "../tsconfig.json",
        readme: "none",
        excludePrivate: true,
        excludeInternal: true,
        categorizeByGroup: false, // 侧边栏按 @category 业务分组,而非 TS 符号种类
        categoryOrder: [
          "几何",
          "状态机与门面",
          "实例状态",
          "共享场景",
          "快照与序列化",
          "事件总线",
          "工作区",
          "渲染与主题",
        ],
        // 转义 JSDoc 中的裸 <T>/{},否则 MDX 会当成 JSX 解析导致构建失败
        sanitizeComments: true,
      },
    ],
  ],

  markdown: {
    hooks: {
      onBrokenMarkdownLinks: "throw", // 与 WRITING.md 约定一致:死链直接报错,不放行
    },
  },

  themeConfig: {
    docs: { sidebar: { hideable: true } }, // 多板块结构下,允许收起侧边栏专注阅读
    colorMode: { defaultMode: "dark", disableSwitch: false },
    navbar: {
      title: "Tiling Layout",
      items: [
        { type: "doc", docId: "guides/intro", label: "指南" },
        { type: "doc", docId: "advanced/layout-operations", label: "深入" },
        { type: "doc", docId: "api/index", label: "API 参考" },
        {
          href: REPO_URL,
          label: "GitHub",
          position: "right",
        },
      ],
    },
    footer: {
      style: "dark",
      links: [
        { title: "文档", items: [
          { label: "快速开始", to: "/docs/guides/quickstart" },
          { label: "深入", to: "/docs/advanced/layout-operations" },
          { label: "API 参考", to: "/docs/api" },
        ]},
        { title: "社区", items: [
          { label: "GitHub 仓库", href: REPO_URL },
          { label: "问题反馈", href: `${REPO_URL}/issues` },
        ]},
      ],
      copyright: `Copyright © ${new Date().getFullYear()} Tiling Layout`,
    },
    prism: {
      theme: prismThemes.github,
      darkTheme: prismThemes.dracula,
      additionalLanguages: ["bash", "json"], // 快速开始的安装命令 / 快照 JSON 示例
    },
  } satisfies Preset.ThemeConfig,
};

export default config;
