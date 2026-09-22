import { describe, expect, it } from "vitest";
import * as G from "../src/geometry";
import { checkTiling } from "../src/invariants";

/** 由 [xmin,ymin,xmax,ymax] 列表造一屏(id 按声明序 1..n) */
function screen(...rects: [number, number, number, number][]): G.Screen {
  const s = G.createScreen();
  for (const r of rects) G.addArea(s, G.rect(...r));
  return s;
}
const rectOf = (s: G.Screen, id: number): number[] => {
  const r = s.areas.find((a) => a.id === id)!.rect;
  return [r.xmin, r.ymin, r.xmax, r.ymax];
};
/** 几何指纹：任何"输入未被修改"的断言都拿它比 */
const snap = (s: G.Screen): string => JSON.stringify(s.areas.map((a) => [a.id, rectOf(s, a.id)]));
const ids = (s: G.Screen): number[] => s.areas.map((a) => a.id);

describe("checkTiling(合法性唯一权威)", () => {
  const entries = (s: G.Screen) => s.areas.map((a) => ({ id: a.id, rect: rectOf(s, a.id) }));

  it("合法铺满无违规", () => {
    expect(checkTiling(entries(screen([0, 0, 1, 1]))).errors).toEqual([]);
    expect(checkTiling(entries(screen([0, 0, 0.5, 1], [0.5, 0, 1, 1]))).errors).toEqual([]);
    expect(checkTiling(entries(screen([0, 0, 0.5, 0.5], [0.5, 0, 1, 0.5], [0, 0.5, 0.5, 1], [0.5, 0.5, 1, 1]))).errors).toEqual([]);
  });

  it("零面积 / 越界 / 重叠 各自拒绝", () => {
    expect(checkTiling([{ id: 1, rect: [0, 0, 1, 0] }]).errors.join()).toContain("无效");
    expect(checkTiling([{ id: 1, rect: [0, 0, 1, 1.2] }]).errors.join()).toContain("越出");
    expect(checkTiling(entries(screen([0, 0, 0.6, 1], [0.5, 0, 1, 1]))).errors.join()).toContain("重叠");
  });

  it("分量不足 / 非有限数 各自拒绝(外部来源的坏矩形)", () => {
    expect(checkTiling([{ id: 7, rect: [0, 0, 1] }]).errors.join()).toContain("无效的区域矩形(id=7)");
    expect(checkTiling([{ id: 8, rect: [0, 0, 1, Number.NaN] }]).errors.join()).toContain("无效的区域矩形(id=8)");
    expect(checkTiling([{ id: 9, rect: [0, 0, Number.POSITIVE_INFINITY, 1] }]).errors.join()).toContain("无效的区域矩形(id=9)");
  });

  it("未铺满默认放行(部分平铺是合法用法)，显式要求才算违规", () => {
    const hole = entries(screen([0, 0, 0.5, 1], [0.6, 0, 1, 1]));
    expect(checkTiling(hole).errors).toEqual([]);
    expect(checkTiling(hole, { full: "error" }).errors.join()).toContain("未铺满");
    expect(checkTiling(hole, { full: "warn" }).errors).toEqual([]);
    expect(checkTiling(hole, { full: "warn" }).warnings.join()).toContain("未铺满");
  });

  it("浮点累加的满铺误差在容差内", () => {
    const thirds = entries(screen([0, 0, 1, 1 / 3], [0, 1 / 3, 1, 2 / 3], [0, 2 / 3, 1, 1]));
    expect(checkTiling(thirds, { full: "error" }).errors).toEqual([]);
  });
});

describe("splitAt(确定性分割)", () => {
  it("源区保 min 侧，新块拿 max 侧并继承 contentType", () => {
    const s = screen([0, 0, 1, 1]);
    s.areas[0].contentType = "editor";
    const res = G.splitAt(s, s.areas[0], G.AXIS.V, 0.5)!;
    expect(res.kept).toBe(s.areas[0]);
    expect(rectOf(s, res.kept.id)).toEqual([0, 0, 0.5, 1]);
    expect(rectOf(s, res.created.id)).toEqual([0.5, 0, 1, 1]);
    expect(res.created.contentType).toBe("editor");
  });

  it("H 方向：源区保下半(与 V 保左半同一条 min 侧规则)", () => {
    const s = screen([0, 0, 1, 1]);
    const res = G.splitAt(s, s.areas[0], G.AXIS.H, 0.25)!;
    expect(rectOf(s, res.kept.id)).toEqual([0, 0, 1, 0.25]);
    expect(rectOf(s, res.created.id)).toEqual([0, 0.25, 1, 1]);
  });

  it("比例被 minArea 夹逼，两侧都不会小于下限", () => {
    const s = screen([0, 0, 1, 1]);
    const res = G.splitAt(s, s.areas[0], G.AXIS.V, 0.001)!;
    expect(rectOf(s, res.kept.id)[2]).toBeCloseTo(G.MIN_AREA_W, 9);
    expect(rectOf(s, res.created.id)[2] - rectOf(s, res.created.id)[0]).toBeGreaterThanOrEqual(G.MIN_AREA_W - 1e-9);
  });

  it("区域太小 → null 且不改动输入", () => {
    const s = screen([0, 0, 0.05, 1]);
    const before = snap(s);
    expect(G.splitAt(s, s.areas[0], G.AXIS.V, 0.5)).toBeNull();
    expect(snap(s)).toBe(before);
  });
});

describe("planClose / applyClose(库过去不存在的能力)", () => {
  it("|N|===1：四边各一例", () => {
    // 右：关 1，2 吃掉
    const right = screen([0, 0, 0.5, 1], [0.5, 0, 1, 1]);
    const rp = G.planClose(right.areas, 1)!;
    expect(rp.side).toBe("right");
    expect(rp.spanned).toBe(false);
    G.applyClose(right, rp);
    expect(rectOf(right, 2)).toEqual([0, 0, 1, 1]);
    expect(ids(right)).toEqual([2]);

    // 左：关 2，1 吃掉
    const left = screen([0, 0, 0.5, 1], [0.5, 0, 1, 1]);
    const lp = G.planClose(left.areas, 2)!;
    expect(lp.side).toBe("left");
    G.applyClose(left, lp);
    expect(rectOf(left, 1)).toEqual([0, 0, 1, 1]);

    // 上下：关 1，2 吃掉
    const up = screen([0, 0, 1, 0.5], [0, 0.5, 1, 1]);
    expect(G.planClose(up.areas, 1)!.side).toBe("top");

    // 关 2(上半)，1 吃掉
    const down = screen([0, 0, 1, 0.5], [0, 0.5, 1, 1]);
    const dp = G.planClose(down.areas, 2)!;
    expect(dp.side).toBe("bottom");
    G.applyClose(down, dp);
    expect(rectOf(down, 1)).toEqual([0, 0, 1, 1]);
  });

  it("|N|>1：整条边被两块分摊时整组扩张(T 型交会)", () => {
    // 左列一块 + 右列两块：关左列，右侧两块各自向左扩张
    const s = screen([0, 0, 0.5, 1], [0.5, 0, 1, 0.5], [0.5, 0.5, 1, 1]);
    const plan = G.planClose(s.areas, 1)!;
    expect(plan.spanned).toBe(true);
    expect(plan.side).toBe("right");
    expect(plan.expansions.map((e) => e.id).sort()).toEqual([2, 3]);
    G.applyClose(s, plan);
    expect(ids(s)).toEqual([2, 3]);
    expect(rectOf(s, 2)).toEqual([0, 0, 1, 0.5]);
    expect(rectOf(s, 3)).toEqual([0, 0.5, 1, 1]);
    expect(checkTiling(s.areas.map((a) => ({ id: a.id, rect: rectOf(s, a.id) })), { full: "error" }).errors).toEqual([]);
  });

  it("优先取 |N|===1 的那条边(即使另一侧邻居更多)", () => {
    // 1 左 2 右(整边共享)；3/4 贴 1 的左侧但被切分 → 仍选 right
    const s = screen([0, 0.25, 0.5, 0.75], [0.5, 0.25, 1, 0.75], [0, 0, 0.5, 0.25], [0, 0.75, 0.5, 1]);
    const plan = G.planClose(s.areas, 1)!;
    expect(plan.side).toBe("right");
    expect(plan.spanned).toBe(false);
  });

  it("exclude 排除的区域不能当吞并方(dock 的槽与目标区)", () => {
    // 1 的右侧由 2、3 正好铺满；把 2 排除 → 该侧不再成立
    const s = screen([0, 0, 0.5, 1], [0.5, 0, 1, 0.5], [0.5, 0.5, 1, 1]);
    expect(G.planClose(s.areas, 1, { exclude: [2] })).toBeNull();
  });

  it("邻居没铺满整条边 / 跨出 R 跨距 / id 不存在 → null 且输入分毫未动", () => {
    const partial = screen([0, 0, 0.5, 1], [0.5, 0, 1, 0.5]);   // 上半段没有邻居
    const before = snap(partial);
    expect(G.planClose(partial.areas, 1)).toBeNull();
    expect(snap(partial)).toBe(before);

    // 右邻居比 R 高：扩张后并集不是矩形
    const taller = screen([0.5, 0.25, 1, 0.75], [0, 0, 0.5, 1]);
    const before2 = snap(taller);
    expect(G.planClose(taller.areas, 1)).toBeNull();
    expect(snap(taller)).toBe(before2);

    expect(G.planClose(partial.areas, 99)).toBeNull();
  });
});

describe("segBetween / 线族平移", () => {
  it("相邻两块给出分界线；对角只共一个角点 → null", () => {
    const four = screen([0, 0, 0.5, 0.5], [0.5, 0, 1, 0.5], [0, 0.5, 0.5, 1], [0.5, 0.5, 1, 1]);
    expect(G.segBetween(four, four.areas[0], four.areas[1])).not.toBeNull();
    expect(G.segBetween(four, four.areas[0], four.areas[3])).toBeNull();
  });

  it("T 型交会也算面对面(长边被切过)", () => {
    const s = screen([0, 0, 0.5, 0.5], [0, 0.5, 0.5, 1], [0.5, 0, 1, 1]);
    expect(G.segBetween(s, s.areas[0], s.areas[2])).not.toBeNull();
    expect(G.segBetween(s, s.areas[1], s.areas[2])).not.toBeNull();
  });

  it("按比例定位：两块均分 → ratio 0.7", () => {
    const s = screen([0, 0, 0.5, 1], [0.5, 0, 1, 1]);
    const seg = G.segBetween(s, s.areas[0], s.areas[1])!;
    const plan = G.planRatio(s, seg, 0.7)!;
    expect(plan.to).toBeCloseTo(0.7, 9);
    const moved = G.applyLineTo(s, seg, plan.to)!;
    expect(moved.members).toBe(2);
    expect(rectOf(s, 1)).toEqual([0, 0, 0.7, 1]);
    expect(rectOf(s, 2)).toEqual([0.7, 0, 1, 1]);
  });

  it("整族平移：三块一线时同侧两块一起动", () => {
    const s = screen([0, 0, 0.5, 0.5], [0, 0.5, 0.5, 1], [0.5, 0, 1, 1]);
    const seg = G.segBetween(s, s.areas[0], s.areas[2])!;
    const moved = G.applyLineTo(s, seg, 0.3)!;
    expect(moved.members).toBe(3);
    expect(rectOf(s, 1)).toEqual([0, 0, 0.3, 0.5]);
    expect(rectOf(s, 2)).toEqual([0, 0.5, 0.3, 1]);
    expect(rectOf(s, 3)).toEqual([0.3, 0, 1, 1]);
  });

  it("minArea 夹逼：越界比例停在可行边界", () => {
    const s = screen([0, 0, 0.5, 1], [0.5, 0, 1, 1]);
    const seg = G.segBetween(s, s.areas[0], s.areas[1])!;
    const to = G.planRatio(s, seg, 0.99)!.to;
    expect(to).toBeCloseTo(1 - G.MIN_AREA_W, 9);
  });

  it("H 方向(上下切)：同样按 min 侧保留下半、整族平移", () => {
    const s = screen([0, 0, 1, 0.4], [0, 0.4, 1, 1]);
    const seg = G.segBetween(s, s.areas[0], s.areas[1])!;
    expect(G.lineBounds(s, seg)!.axis).toBe(G.AXIS.H);
    const moved = G.applyLineTo(s, seg, 0.15)!;
    expect(moved.members).toBe(2);
    expect(rectOf(s, 1)).toEqual([0, 0, 1, 0.15]);   // min 侧(下)改 ymax
    expect(rectOf(s, 2)).toEqual([0, 0.15, 1, 1]);   // max 侧(上)改 ymin
    expect(G.planRatio(s, G.segBetween(s, s.areas[0], s.areas[1])!, 0.75)!.to).toBeCloseTo(0.75, 9);
  });

  it("可行区间为空(两侧都被 minArea 顶死) → 一律 null", () => {
    // 窄条上的一条线：两侧各自都留不住 minArea
    const s = screen([0, 0, 0.05, 1], [0.05, 0, 0.1, 1]);
    const seg = G.segBetween(s, s.areas[0], s.areas[1])!;
    const b = G.lineBounds(s, seg)!;
    expect(b.lo).toBeGreaterThan(b.hi);
    expect(G.planLineTo(s, seg, 0.07)).toBeNull();
    expect(G.applyLineTo(s, seg, 0.07)).toBeNull();
    const before = snap(s);
    expect(G.writeLine(seg, b, 0.07)).toBeNull();
    expect(snap(s)).toBe(before);
  });

  it("线族不完整 → null", () => {
    // 只有一侧有区域(右侧的线落在舞台外框上，deriveEdges 不产生)
    const s = screen([0, 0, 0.5, 1]);
    const fake: G.Seg = { id: 0, v1: { x: 0.5, y: 0 }, v2: { x: 0.5, y: 1 } };
    expect(G.lineBounds(s, fake)).toBeNull();
    expect(G.applyLineTo(s, fake, 0.3)).toBeNull();
  });

  it("**拖拽回归**：线一旦离开原坐标，就必须用动手前捕获的 bounds 继续写", () => {
    // edgeFamilyAreas 按触线坐标精确比对 —— 线移走后再查会查不到族，
    // 这正是 resizeMove 必须复用 beginResize 那一刻 bounds 的原因。
    const s = screen([0, 0, 0.5, 1], [0.5, 0, 1, 1]);
    const seg = G.segBetween(s, s.areas[0], s.areas[1])!;
    const bounds = G.lineBounds(s, seg)!;
    expect(G.writeLine(seg, bounds, 0.7)!.members).toBe(2);
    // 此刻线已在 0.7，原 seg(0.5) 上不再有触点：
    expect(G.lineBounds(s, seg)).toBeNull();
    // 但拿旧 bounds 继续写仍然正确(整族一起动)
    const again = G.writeLine(seg, bounds, 0.4)!;
    expect(again.members).toBe(2);
    expect(rectOf(s, 1)[2]).toBeCloseTo(0.4, 9);
    expect(rectOf(s, 2)[0]).toBeCloseTo(0.4, 9);
    // 夹逼也仍按旧 bounds：越界收拢到 minArea 边界
    expect(G.writeLine(seg, bounds, 0.99)!.to).toBeCloseTo(1 - G.MIN_AREA_W, 9);
  });

  it("limits 是夹逼的逐成员展开：归约回去就是 lo/hi", () => {
    // 三块一线：左列上下两块(min 侧)+ 右侧整块(max 侧)
    const s = screen([0, 0, 0.5, 0.5], [0, 0.5, 0.5, 1], [0.5, 0, 1, 1]);
    const seg = G.segBetween(s, s.areas[0], s.areas[2])!;
    const b = G.lineBounds(s, seg)!;

    expect(b.limits).toHaveLength(b.family.length);
    // min 侧成员给 min，max 侧给 max，与 family 同序
    b.family.forEach((m, i) => {
      const l = b.limits[i];
      if (m.side === "min") expect(l.min).toBeCloseTo(0 + G.MIN_AREA_W, 9);
      else expect(l.max).toBeCloseTo(1 - G.MIN_AREA_W, 9);
      expect(l.min === undefined || l.max === undefined).toBe(true);   // 不给对面的边
    });
    // 归约：与 lineBounds 自己的 lo/hi 一致(同一个原子式的两层视图)
    const lo = Math.max(...b.limits.map((l) => l.min ?? -Infinity));
    const hi = Math.min(...b.limits.map((l) => l.max ?? Infinity));
    expect(lo).toBeCloseTo(b.lo, 9);
    expect(hi).toBeCloseTo(b.hi, 9);
  });
});

describe("dockSlotRect / dockRestRect", () => {
  const R = G.rect(0, 0, 1, 1);
  it("四边槽 + 互补块恰好并成目标", () => {
    for (const side of ["left", "right", "top", "bottom"] as const) {
      const slot = G.dockSlotRect(R, side, 0.25);
      const rest = G.dockRestRect(R, side, 0.25);
      const along = side === "left" || side === "right" ? slot.width : slot.height;
      expect(along).toBeCloseTo(0.25, 9);
      const union = G.rect(
        Math.min(slot.xmin, rest.xmin), Math.min(slot.ymin, rest.ymin),
        Math.max(slot.xmax, rest.xmax), Math.max(slot.ymax, rest.ymax),
      );
      expect([union.xmin, union.ymin, union.xmax, union.ymax]).toEqual([0, 0, 1, 1]);
      expect(slot.width * slot.height + rest.width * rest.height).toBeCloseTo(1, 9);
    }
  });

  it("槽与互补块贴合：公共边坐标位级一致(=== 不变式)", () => {
    expect(G.dockSlotRect(R, "left", 0.3).xmax).toBe(G.dockRestRect(R, "left", 0.3).xmin);
    expect(G.dockSlotRect(R, "top", 0.3).ymin).toBe(G.dockRestRect(R, "top", 0.3).ymax);
  });
});
