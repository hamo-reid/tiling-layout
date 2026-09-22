/**
 * invariants.ts — 布局合法性校验的**唯一权威**。
 *
 * 两处消费，一套容差：
 *   - `layoutData.migrateSnapshot` —— 外部来源(反序列化/导入)的快照；
 *   - `geometry/commands` + `store/commands` —— 内部编辑的提交前闸门。
 * 提取而非各写一套，是为了让「什么算合法」只有一个答案：重叠会让 `deriveEdges`
 * 推导出错误分界线、命中与拖拽错位，属真实几何损坏，必须 fail-closed；满铺则
 * 是**文档不变式而非硬约束**(经公开 API addArea 程序化构造部分平铺是合法用法，
 * docs 教学示例即如此)，所以按调用方声明的等级处理。
 *
 * 不在此处校验 id 结构与 contentType —— 那是快照 schema 的事，归 layoutData。
 */

/** 单点坐标容差：内部运算的累计浮点误差远低于此值，外部来源的 ulp 级噪声也应放行 */
export const COORD_EPS = 1e-9;
/** 平铺完整性(总面积=1)容差：比单点坐标放宽一档，以吸收多矩形的累计误差 */
export const TILE_EPS = 1e-6;

/** 一条待校验的区域：只取校验需要的那两件事 */
export interface TilingEntry {
  readonly id: number;
  /** [xmin, ymin, xmax, ymax] 归一化比例矩形 */
  readonly rect: readonly number[];
}

/** 未铺满单位舞台怎么处理：skip 放行(默认) / warn 提示 / error 记为违规 */
export type FullCoverPolicy = "skip" | "warn" | "error";

export interface CheckTilingOptions {
  readonly full?: FullCoverPolicy;
}

export interface TilingReport {
  /** 硬违规：非空即不可落地 */
  readonly errors: readonly string[];
  /** 软提示：调用方自行决定是否 console.warn */
  readonly warnings: readonly string[];
}

/** 任意 `{ id, rect }` 集合(rect 为 [x,y,x,y] 元组)→ 校验入参(快照条目走这个) */
export function toEntries(areas: readonly { id: number; rect: readonly number[] }[]): TilingEntry[] {
  return areas.map((a) => ({ id: a.id, rect: a.rect }));
}

/** Screen 里的区域(rect 是带派生字段的对象)→ 校验入参。
 *  刻意只写真需要的四个字段的形状而不 import `Area`：本模块是叶子依赖，
 *  不许被 `geometry` 反向依赖。 */
export function areaEntries(
  areas: readonly { id: number; rect: { xmin: number; ymin: number; xmax: number; ymax: number } }[],
): TilingEntry[] {
  return areas.map((a) => ({ id: a.id, rect: [a.rect.xmin, a.rect.ymin, a.rect.xmax, a.rect.ymax] }));
}

/**
 * 校验一组矩形：坐标有限、正宽高、落在 [0,1]、两两不重叠；可选检查满铺。
 *  @param entries 待校验区域
 *  @param opts.full 未铺满的处理等级(默认 skip —— 部分平铺是合法用法)
 *  @returns 违规与提示清单(两者皆空 = 完全合法)
 * @category 几何
 */
export function checkTiling(
  entries: readonly TilingEntry[],
  opts: CheckTilingOptions = {},
): TilingReport {
  const errors: string[] = [];
  const warnings: string[] = [];

  for (const { id, rect } of entries) {
    if (rect.length < 4 || !rect.every((v) => Number.isFinite(v))) {
      errors.push(`无效的区域矩形(id=${id})`);
      continue;
    }
    const [xmin, ymin, xmax, ymax] = rect;
    if (!(xmax - xmin > 0) || !(ymax - ymin > 0)) {
      errors.push(`无效的区域矩形(id=${id})`);
      continue;
    }
    // [0,1] 比例坐标不变式：坐标系语义由本层兜底，不依赖调用方守约
    if (xmin < -COORD_EPS || ymin < -COORD_EPS || xmax > 1 + COORD_EPS || ymax > 1 + COORD_EPS) {
      errors.push(`区域矩形越出 [0,1] 舞台(id=${id})`);
    }
  }

  for (let i = 0; i < entries.length; i++) {
    const A = entries[i].rect;
    for (let j = i + 1; j < entries.length; j++) {
      const B = entries[j].rect;
      const ox = Math.min(A[2], B[2]) - Math.max(A[0], B[0]);
      const oy = Math.min(A[3], B[3]) - Math.max(A[1], B[1]);
      if (ox > COORD_EPS && oy > COORD_EPS) {
        errors.push(`区域矩形重叠(id=${entries[i].id} 与 id=${entries[j].id})`);
      }
    }
  }

  const full = opts.full ?? "skip";
  if (full !== "skip" && entries.length > 0) {
    const sum = entries.reduce((acc, e) => acc + (e.rect[2] - e.rect[0]) * (e.rect[3] - e.rect[1]), 0);
    if (Math.abs(sum - 1) > TILE_EPS) {
      const msg =
        `布局未铺满舞台(总面积=${sum.toFixed(9)})：平铺模型约定区域铺满 [0,1]×[0,1]，本次按现状放行`;
      if (full === "error") errors.push(msg);
      else warnings.push(msg);
    }
  }

  return { errors, warnings };
}

/** 便捷判定：无硬违规 */
export function tilingOk(report: TilingReport): boolean {
  return report.errors.length === 0;
}
