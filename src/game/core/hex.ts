/**
 * 六边形网格数学。尖顶（pointy-top）+ 轴向坐标 { q, r }，r 向下增长。
 *
 * 全局只认轴向坐标一种逻辑坐标，另外三种只在各自的边界上临时出现：
 *   立方体 (x, y, z)   只在算距离和四舍五入时用，恒有 x + y + z === 0
 *   偏移 (col, row)    只在把地图存进矩形数组时用
 *   像素 (x, y)        只在渲染和处理鼠标时用
 * 跨过边界立刻转回轴向，别让两种坐标在同一个变量里流动 —— 它们都是
 * { 两个数字 }，类型系统帮不上忙，混用了也不报错，只是画歪。
 */

export interface Axial {
  q: number;
  r: number;
}

/**
 * 邻居方向。尖顶六边形没有正南正北，只有东南/西南。
 *
 * 顺序是从正东开始逆时针（屏幕上 r 向下，所以索引递增是往上转）。这个
 * 顺序不是随便定的 —— ring() 之类的环绕算法依赖"沿方向 i 走 n 步正好走完
 * 第 i 条边"，换成顺时针就得反着遍历。跟标准参考保持一致，以后照抄算法
 * 不用换算。
 */
export const DIRECTIONS: readonly Axial[] = [
  { q: 1, r: 0 },   // 东
  { q: 1, r: -1 },  // 东北
  { q: 0, r: -1 },  // 西北
  { q: -1, r: 0 },  // 西
  { q: -1, r: 1 },  // 西南
  { q: 0, r: 1 },   // 东南
];

/** Map / Set 的键。轴向坐标是对象，不能直接当键用 */
export function key(h: Axial): string {
  return `${h.q},${h.r}`;
}

export function parseKey(k: string): Axial {
  const i = k.indexOf(',');
  return { q: Number(k.slice(0, i)), r: Number(k.slice(i + 1)) };
}

export function equals(a: Axial, b: Axial): boolean {
  return a.q === b.q && a.r === b.r;
}

export function neighbor(h: Axial, direction: number): Axial {
  const d = DIRECTIONS[direction];
  return { q: h.q + d.q, r: h.r + d.r };
}

export function neighbors(h: Axial): Axial[] {
  return DIRECTIONS.map((d) => ({ q: h.q + d.q, r: h.r + d.r }));
}

/**
 * 两格之间要走几步。立方体坐标下就是三个轴差绝对值之和的一半，
 * 这里直接用 q / r 推第三维（z = -q - r），省掉建立方体对象。
 */
export function distance(a: Axial, b: Axial): number {
  const dq = a.q - b.q;
  const dr = a.r - b.r;
  return (Math.abs(dq) + Math.abs(dr) + Math.abs(dq + dr)) / 2;
}

// ---------------------------------------------------------------- 像素

const SQRT3 = Math.sqrt(3);

/**
 * size 是中心到角的距离。由此六边形宽 √3·size、高 2·size，
 * 横向间距 √3·size、纵向间距 1.5·size（相邻两行咬合，所以不是 2·size）。
 */
export function axialToPixel(h: Axial, size: number): { x: number; y: number } {
  return {
    x: size * SQRT3 * (h.q + h.r / 2),
    y: size * 1.5 * h.r,
  };
}

/** axialToPixel 的逆运算。结果一定是小数，必须经 round 才能当格子用 */
export function pixelToAxial(x: number, y: number, size: number): Axial {
  return round({
    q: ((SQRT3 / 3) * x - y / 3) / size,
    r: ((2 / 3) * y) / size,
  });
}

/**
 * 把小数轴向坐标吸附到最近的格子。
 *
 * 不能对 q / r 各自 Math.round —— 六边形的邻域不是矩形，那样在边界
 * 附近会选到隔壁格。正确做法是转立方体坐标各自取整，再把误差最大的
 * 那一维反推回来，强行满足 x + y + z === 0。
 */
export function round(h: Axial): Axial {
  const x = h.q;
  const z = h.r;
  const y = -x - z;

  let rx = Math.round(x);
  let ry = Math.round(y);
  let rz = Math.round(z);

  const dx = Math.abs(rx - x);
  const dy = Math.abs(ry - y);
  const dz = Math.abs(rz - z);

  if (dx > dy && dx > dz) rx = -ry - rz;
  else if (dy > dz) ry = -rx - rz;
  else rz = -rx - ry;

  // Math.round(-0.4) 是 -0，取反也会造出 -0。算术上 -0 === 0 没差别，但
  // Object.is 和深比较会判不等，调试时看到 { q: -12, r: -0 } 很费解。
  // 归一化掉，别让它流出这个函数。
  return { q: rx === 0 ? 0 : rx, r: rz === 0 ? 0 : rz };
}

/** 6 个角的像素坐标，从正上方开始顺时针。渲染描边用 */
export function corners(cx: number, cy: number, size: number): [number, number][] {
  const pts: [number, number][] = [];
  for (let i = 0; i < 6; i += 1) {
    const angle = (Math.PI / 180) * (60 * i - 90);
    pts.push([cx + size * Math.cos(angle), cy + size * Math.sin(angle)]);
  }
  return pts;
}

// ---------------------------------------------------------------- 偏移

/**
 * odd-r 偏移坐标：奇数行整体右移半格。只用来把地图塞进矩形数组
 * （上千格时数组比 Map 省内存也更快），存取的两头各转一次。
 *
 * 注意 (row & 1) 对负数不成立，所以行号必须是 0 起的非负整数 ——
 * 地图数组本来也只有这种行号。
 */
export function axialToOffset(h: Axial): { col: number; row: number } {
  return { col: h.q + (h.r - (h.r & 1)) / 2, row: h.r };
}

export function offsetToAxial(col: number, row: number): Axial {
  return { q: col - (row - (row & 1)) / 2, r: row };
}

// ---------------------------------------------------------------- 范围

/** 距离 center 不超过 n 步的所有格子（含 center 自己）。视野、采集范围用 */
export function range(center: Axial, n: number): Axial[] {
  const out: Axial[] = [];
  for (let dq = -n; dq <= n; dq += 1) {
    const lo = Math.max(-n, -dq - n);
    const hi = Math.min(n, -dq + n);
    for (let dr = lo; dr <= hi; dr += 1) {
      out.push({ q: center.q + dq, r: center.r + dr });
    }
  }
  return out;
}

/** 只要距离恰好为 n 的那一圈。画范围边框用 */
export function ring(center: Axial, n: number): Axial[] {
  if (n <= 0) return [{ ...center }];

  // 从西南角出发（DIRECTIONS[4] 方向 n 格），再沿六条边各走 n 步正好合围
  let h: Axial = { q: center.q - n, r: center.r + n };
  const out: Axial[] = [];
  for (let d = 0; d < 6; d += 1) {
    for (let i = 0; i < n; i += 1) {
      out.push({ ...h });
      h = neighbor(h, d);
    }
  }
  return out;
}

/**
 * 带地形代价的可达范围（Dijkstra 松弛，地图小、预算小，不值得上优先队列）。
 *
 * costOf 返回 null 表示这一格进不去（深海、悬崖）。返回值不含起点。
 */
export function reachable(
  start: Axial,
  budget: number,
  costOf: (h: Axial) => number | null,
): Map<string, { hex: Axial; cost: number }> {
  const best = new Map<string, { hex: Axial; cost: number }>();
  best.set(key(start), { hex: start, cost: 0 });

  let frontier: Axial[] = [start];
  while (frontier.length) {
    const next: Axial[] = [];
    for (const h of frontier) {
      const spent = best.get(key(h))!.cost;
      for (const nb of neighbors(h)) {
        const step = costOf(nb);
        if (step == null) continue;

        const total = spent + step;
        if (total > budget) continue;

        const k = key(nb);
        const prev = best.get(k);
        if (prev && prev.cost <= total) continue;

        best.set(k, { hex: nb, cost: total });
        next.push(nb);
      }
    }
    frontier = next;
  }

  best.delete(key(start));
  return best;
}
