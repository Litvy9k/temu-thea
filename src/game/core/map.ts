/**
 * 地图的存储与生成。
 *
 * 存储用 odd-r 偏移的一维数组（行优先），不是 Map<string, Tile> —— 上千格时
 * 数组的内存和访问都好一个量级，而外部只经 tileAt(map, 轴向) 存取，看不到
 * 偏移坐标的存在。
 */
import {
  type Axial,
  axialToOffset,
  axialToPixel,
  distance,
  neighbors,
  offsetToAxial,
  range,
} from './hex.ts';
import { mulberry32 } from './rng.ts';
import { DEPOSITS, DEPOSIT_ORDER, type DepositId, densityAt } from './deposits.ts';
import { TERRAIN, type TerrainId, isPassable } from './terrain.ts';

export interface Tile {
  terrain: TerrainId;
  /** 曾经看见过：画出来但压暗 */
  explored: boolean;
  /** 此刻在某个单位或营地的视野里 */
  visible: boolean;
  /**
   * 采集进度 0..39。存在地格上而不是营地上 —— 拔营再回来时进度还在，
   * 这让"以前采过一半的地方"成为地图上的一条真实信息。
   */
  progress: number;
  /**
   * 叠在地形上的矿脉，null 是绝大多数。它是**地格的属性而不是地形的**：
   * 同样是山地，有矿的那一块才值得跑过去，而且得先探明才知道。
   */
  deposit: DepositId | null;
}

export interface GameMap {
  width: number;
  height: number;
  seed: number;
  /**
   * 出生点。存在地图上而不是队伍上 —— 队伍会走，而这个点是
   * 矿脉密度梯度的圆心，属于世界本身，整局不变。
   */
  origin: Axial;
  tiles: Tile[];
}

// ---------------------------------------------------------------- 存取

/** 越界返回 null。所有存取都走这里，边界判断只写一次 */
export function indexOf(map: GameMap, h: Axial): number | null {
  const { col, row } = axialToOffset(h);
  if (row < 0 || row >= map.height || col < 0 || col >= map.width) return null;
  return row * map.width + col;
}

export function tileAt(map: GameMap, h: Axial): Tile | null {
  const i = indexOf(map, h);
  return i == null ? null : map.tiles[i];
}

export function inBounds(map: GameMap, h: Axial): boolean {
  return indexOf(map, h) != null;
}

/** 数组下标反推轴向坐标。遍历整张图时用 */
export function hexOfIndex(map: GameMap, i: number): Axial {
  return offsetToAxial(i % map.width, Math.floor(i / map.width));
}

export function forEachTile(map: GameMap, fn: (tile: Tile, h: Axial) => void): void {
  for (let i = 0; i < map.tiles.length; i += 1) fn(map.tiles[i], hexOfIndex(map, i));
}

// ---------------------------------------------------------------- 噪声

/**
 * 值噪声。取一张随机数表，在格点之间用 smoothstep 插值。
 * 比 Perlin 糙一点，但地形分类之后完全看不出区别，而且只要十几行。
 */
function valueNoise2D(seed: number): (x: number, y: number) => number {
  const N = 256;
  const rand = mulberry32(seed);
  const grid = new Float32Array(N * N);
  for (let i = 0; i < grid.length; i += 1) grid[i] = rand();

  // & (N-1) 让表在两个方向上环绕，负坐标也能取（-1 & 255 === 255）
  const at = (x: number, y: number) => grid[(y & (N - 1)) * N + (x & (N - 1))];

  return (x, y) => {
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const fx = x - x0;
    const fy = y - y0;
    const sx = fx * fx * (3 - 2 * fx);
    const sy = fy * fy * (3 - 2 * fy);

    const top = at(x0, y0) + (at(x0 + 1, y0) - at(x0, y0)) * sx;
    const bot = at(x0, y0 + 1) + (at(x0 + 1, y0 + 1) - at(x0, y0 + 1)) * sx;
    return top + (bot - top) * sy;
  };
}

/** 叠几层不同频率的噪声，让轮廓有大有小。返回值仍在 0..1 */
function fbm(
  noise: (x: number, y: number) => number,
  x: number,
  y: number,
  octaves: number,
): number {
  let sum = 0;
  let norm = 0;
  let amp = 1;
  let freq = 1;
  for (let i = 0; i < octaves; i += 1) {
    sum += amp * noise(x * freq, y * freq);
    norm += amp;
    amp *= 0.5;
    freq *= 2;
  }
  return sum / norm;
}

// ---------------------------------------------------------------- 生成

/**
 * 各地形的目标占比。生成时按分位数切，不是按固定的高度阈值 ——
 *
 * fbm 是多层噪声取平均，输出天然向 0.5 聚集（中心极限），拿绝对阈值去切
 * 两端就几乎切不到东西：实测山地会是 0%，丘陵 1.6%。更糟的是换个种子配比
 * 就完全变样，可能抽到一张全是海的图。改成分位数之后，这些数字是设计值，
 * 每张图都成立。
 */
const COMPOSITION = {
  /** 水域（深海 + 浅滩）占全图 */
  water: 0.42,
  /** 山地占陆地 */
  mountain: 0.08,
  /** 丘陵占陆地（山地之下的那一档） */
  hills: 0.16,
  /** 剩下的平地里，最湿的一部分是森林，最干的一部分是荒漠 */
  forest: 0.34,
  desert: 0.16,
} as const;

export interface MapOptions {
  width: number;
  height: number;
  seed: number;
  /** 噪声尺度：越小大陆越完整，越大越破碎 */
  scale?: number;
  /** 覆盖默认的水域占比 */
  water?: number;
  /** 营地的作业半径。由 state.ts 传进来，否则这里要反向依赖规则层 */
  campRadius?: number;
}

/** 取排好序的数组的第 p 分位。p 超出 0..1 会被夹住 */
function quantile(sorted: Float32Array, p: number): number {
  if (sorted.length === 0) return 0;
  const i = Math.round(Math.min(1, Math.max(0, p)) * (sorted.length - 1));
  return sorted[i];
}

/**
 * 高度决定海陆和山，湿度决定植被，纬度（行号）决定冷暖。
 *
 * 边缘做径向衰减收成海：世界是有边界的，但玩家撞到的是海岸线而不是一堵
 * 看不见的墙 —— 不用在规则层解释"为什么不能再往东走"。
 */
export function generateMap(opts: MapOptions): GameMap {
  const { width, height, seed, scale = 0.075, water = COMPOSITION.water } = opts;
  const n = width * height;

  const elevNoise = valueNoise2D(seed);
  const moistNoise = valueNoise2D(seed ^ 0x9e3779b9);
  const tempNoise = valueNoise2D(seed ^ 0x85ebca6b);

  const elevation = new Float32Array(n);
  const moisture = new Float32Array(n);
  const temperature = new Float32Array(n);

  for (let row = 0; row < height; row += 1) {
    for (let col = 0; col < width; col += 1) {
      const i = row * width + col;
      const h = offsetToAxial(col, row);

      // 在像素空间采样，否则奇数行的半格错位会让噪声斜着拉伸
      const p = axialToPixel(h, 1);
      const nx = p.x * scale;
      const ny = p.y * scale;

      // -1..1 的归一化位置，用来做边缘衰减和纬度
      const ux = (col / (width - 1)) * 2 - 1;
      const uy = (row / (height - 1)) * 2 - 1;

      // 离中心越远压得越狠，一半半径以内完全不压
      const dist = Math.sqrt(ux * ux + uy * uy) / Math.SQRT2;
      const falloff = Math.max(0, (dist - 0.5) / 0.5) ** 1.7;

      elevation[i] = fbm(elevNoise, nx, ny, 5) - falloff * 0.9;
      moisture[i] = fbm(moistNoise, nx + 400, ny + 400, 4);
      // 纬度是主项，噪声只让分界线不那么直
      temperature[i] =
        (1 - Math.abs(uy)) * 0.75 + fbm(tempNoise, nx + 900, ny + 900, 3) * 0.25;
    }
  }

  // 海平面按全图分位数定
  const elevSorted = Float32Array.from(elevation).sort();
  const seaLevel = quantile(elevSorted, water);

  // 山和丘陵按陆地内部的分位数定，否则水多的图山就少
  const landElev = Float32Array.from(elevation.filter((e) => e >= seaLevel)).sort();
  const mountainLevel = quantile(landElev, 1 - COMPOSITION.mountain);
  const hillsLevel = quantile(landElev, 1 - COMPOSITION.mountain - COMPOSITION.hills);

  // 湿度阈值只在"会长植被的平地"里统计 —— 把山和丘陵算进去会把分布拉偏
  const flatMoist = Float32Array.from(
    moisture.filter((_, i) => elevation[i] >= seaLevel && elevation[i] < hillsLevel),
  ).sort();
  const forestLevel = quantile(flatMoist, 1 - COMPOSITION.forest);
  const desertLevel = quantile(flatMoist, COMPOSITION.desert);

  const tiles: Tile[] = new Array(n);
  for (let i = 0; i < n; i += 1) {
    tiles[i] = {
      terrain: classify(
        elevation[i], moisture[i], temperature[i],
        { seaLevel, mountainLevel, hillsLevel, forestLevel, desertLevel },
      ),
      explored: false,
      visible: false,
      progress: 0,
      deposit: null,
    };
  }

  // origin 先给个占位：选出生点要先知道浅滩在哪，而放矿脉又要先知道出生点
  const map: GameMap = { width, height, seed, origin: { q: 0, r: 0 }, tiles };
  markShallows(map);
  map.origin = findStart(map, opts.campRadius ?? 1);
  placeDeposits(map);
  return map;
}

interface Levels {
  seaLevel: number;
  mountainLevel: number;
  hillsLevel: number;
  forestLevel: number;
  desertLevel: number;
}

function classify(e: number, m: number, t: number, lv: Levels): TerrainId {
  if (e < lv.seaLevel) return 'ocean';
  if (e >= lv.mountainLevel) return 'mountain';
  if (e >= lv.hillsLevel) return 'hills';

  // 纬度优先：够冷的地方长不出森林，也不会是荒漠
  if (t < 0.32) return 'tundra';
  // 低洼又潮湿的地方积水成沼
  if (m >= lv.forestLevel && e < lv.seaLevel + 0.05) return 'marsh';
  if (m >= lv.forestLevel) return 'forest';
  if (m <= lv.desertLevel && t > 0.55) return 'desert';
  return 'grass';
}

/**
 * 挨着陆地的海才是浅滩。
 *
 * 早先按高度分位切浅滩，切出了 17.9% —— 大陆架平缓的地方整片都成了浅水。
 * 海岸线本来就是个几何概念，直接判邻居准得多，也省掉一个要调的参数。
 */
function markShallows(map: GameMap): void {
  const coastal: number[] = [];
  for (let i = 0; i < map.tiles.length; i += 1) {
    if (map.tiles[i].terrain !== 'ocean') continue;
    const h = hexOfIndex(map, i);
    for (const nb of neighbors(h)) {
      const t = tileAt(map, nb);
      if (t && t.terrain !== 'ocean') {
        coastal.push(i);
        break;
      }
    }
  }
  for (const i of coastal) map.tiles[i].terrain = 'shallow';
}

// ---------------------------------------------------------------- 出生点

/**
 * 开局位置：靠近地图中心、能站人、而且周围一圈同时有食物和木材 ——
 * 缺任何一样都会在几回合内饿死或冻死，那不叫难度，那叫坑。
 * 从中心一圈圈往外找，第一个及格的就用。
 *
 * 它在这里而不在 state.ts：矿脉密度是以出生点为圆心算的，所以出生点
 * 必须在地图生成内部就定下来，不能等到建局的时候。
 */
export function findStart(map: GameMap, campRadius: number): Axial {
  const center = hexOfIndex(map, Math.floor(map.tiles.length / 2) + Math.floor(map.width / 2));

  let fallback: Axial | null = null;

  for (let r = 0; r < Math.max(map.width, map.height); r += 1) {
    for (const h of range(center, r)) {
      if (distance(center, h) !== r) continue;
      const tile = tileAt(map, h);
      if (!tile || !isPassable(tile.terrain)) continue;

      if (!fallback) fallback = h;

      let food = 0;
      let wood = 0;
      for (const n of neighborsWithin(map, h, campRadius)) {
        food += TERRAIN[n.terrain].yields.food ?? 0;
        wood += TERRAIN[n.terrain].yields.wood ?? 0;
      }
      // 两格产粮 + 一片林子，够开局站住脚
      if (food >= 8 && wood >= 5) return h;
    }
    if (fallback && r > 12) return fallback;
  }
  throw new Error('no landable start tile on this map');
}

function neighborsWithin(map: GameMap, h: Axial, radius: number): Tile[] {
  const out: Tile[] = [];
  for (const n of range(h, radius)) {
    if (distance(h, n) === 0) continue;
    const t = tileAt(map, n);
    if (t) out.push(t);
  }
  return out;
}

// ---------------------------------------------------------------- 矿脉

/**
 * 撑矿脉。每一块地最多一处，按 DEPOSIT_ORDER 依次掉骰子，稀有的先占 ——
 * 不这样的话在地形重叠的地方（兽道和黏土坑都能上草原），
 * 常见的那种会把少见的挤掉。
 *
 * 用单独的随机流（种子异或过）：和地形共用一个的话，以后改一下矿脉参数
 * 会把地形也推乱，同一个种子试不出对照。
 */
export function placeDeposits(map: GameMap): void {
  const rand = mulberry32((map.seed ^ 0x5bf03635) >>> 0);

  for (let i = 0; i < map.tiles.length; i += 1) {
    const tile = map.tiles[i];
    const dist = distance(map.origin, hexOfIndex(map, i));

    for (const id of DEPOSIT_ORDER) {
      const d = DEPOSITS[id];
      if (!d.terrain.includes(tile.terrain)) continue;

      // 每种都要抽一次，即使前面已经中了 —— 否则随机序列的消耗量会随
      // 地形变化，改一个密度参数就把整张图的矿脉布局洗牌一遍
      const hit = rand() < densityAt(d, dist);
      if (hit && !tile.deposit) tile.deposit = id;
    }
  }
}
