import * as G from "./geometry";

/** 内置内容类型的中文标题表(未注册 title 时的回退)
 * @category 几何
 */
export const CONTENT: Record<string, string> = {
  general: "通用",
  editor: "编辑器",
  outline: "目录",
  properties: "属性",
};

/** 初始窗口：左区 + 右列上下两块（演示分界线 / T 型交会 / 排列），归一化比例坐标 [0,1]×[0,1]
 *  @returns 初始布局的屏幕(3 个矩形区域) */
export function buildInitialScreen(): G.Screen {
  const s = G.createScreen();
  const cx = 620 / 1000;  // 左右分界 x(=0.62)
  const gy = 360 / 650;   // 右列内分界 y(≈0.5538)
  G.addArea(s, G.rect(0, 0, cx, 1), "editor");
  G.addArea(s, G.rect(cx, gy, 1, 1), "outline");
  G.addArea(s, G.rect(cx, 0, 1, gy), "properties");
  return s;
}
