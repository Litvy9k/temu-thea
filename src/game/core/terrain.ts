/**
 * 地形表。这个游戏的玩法差异几乎全部由这张表定义 —— 走哪里、在哪扎营、
 * 营地周围能采到什么，都是在读这里的数字。要调平衡就改这一处。
 *
 * yields 是"进度条填满一次（40）产出多少"，不是每回合产出。
 * 每人每回合推进 20 点，所以长期看**一个人平均每回合完成 0.5 次采集**，
 * 折算下来单人产出 = yields / 2。定数值时按这个折算，别照着字面数字估。
 */

export type ResourceId = 'food' | 'wood' | 'stone';

export const RESOURCES: Record<ResourceId, { label: { en: string; zh: string }; glyph: string }> = {
  food: { label: { en: 'food', zh: '食物' }, glyph: '✦' },
  wood: { label: { en: 'wood', zh: '木材' }, glyph: '❙' },
  stone: { label: { en: 'stone', zh: '石料' }, glyph: '◆' },
};

export type TerrainId =
  | 'ocean'
  | 'shallow'
  | 'marsh'
  | 'grass'
  | 'forest'
  | 'hills'
  | 'mountain'
  | 'desert'
  | 'tundra';

export interface Terrain {
  label: { en: string; zh: string };
  /** 进入这一格消耗的行动力；null = 进不去 */
  moveCost: number | null;
  /** 采集进度填满一次的产出 */
  yields: Partial<Record<ResourceId, number>>;
  /** 站在这里能看多远（格）。地势高看得远，林子里看不见 */
  sight: number;
  /** 底色（深底），以及叠在上面的符号和它的颜色 */
  fill: string;
  glyph: string;
  ink: string;
}

/**
 * 三种资源的定位不同，数值也按不同的口径标定：
 *
 *   食物  生存必需，消耗按人头（n 人吃 n 份）
 *         草原 4/次 = 单人 2/回合 = 一个人养活两个人。
 *         所以**大约一半劳力必须种地**，这是全局最硬的约束。
 *   木材  兼有：保命只要每回合 1（篝火，和人数无关），多出来的全是升级用料
 *         森林 5/次 = 单人 2.5/回合，一个人就够烧，第二个人开始纯攒。
 *   石料  纯升级资源，没有消耗，攒得慢是应该的
 *         丘陵 4/次 = 单人 2/回合。
 *
 * 另一条硬规则：**没有一种地形同时富含食物和木材**。只挨着草原的营地会
 * 断柴，只挨着森林的会饿死，选址必须两样都要 —— 这是"在哪扎营"这个决定的
 * 全部分量。以后加资源种类时也守住这条：一处采不全，才有搬家的理由。
 */
export const TERRAIN: Record<TerrainId, Terrain> = {
  ocean: {
    label: { en: 'ocean', zh: '深海' },
    moveCost: null,
    yields: {},
    sight: 0,
    fill: '#0a1f2b', glyph: '≈', ink: '#16465c',
  },
  shallow: {
    label: { en: 'shallow', zh: '浅滩' },
    moveCost: null,
    yields: { food: 6 },
    sight: 0,
    fill: '#10394a', glyph: '~', ink: '#2b7391',
  },
  marsh: {
    label: { en: 'marsh', zh: '沼泽' },
    moveCost: 3,
    yields: { food: 2, wood: 2 },
    sight: 1,
    fill: '#26361f', glyph: '"', ink: '#5c7a44',
  },
  grass: {
    label: { en: 'grassland', zh: '草原' },
    moveCost: 1,
    yields: { food: 4 },
    sight: 2,
    fill: '#37501f', glyph: '·', ink: '#6f9440',
  },
  forest: {
    label: { en: 'forest', zh: '森林' },
    moveCost: 2,
    yields: { food: 1, wood: 5 },
    sight: 1,
    fill: '#1e3618', glyph: '♣', ink: '#4f7c37',
  },
  hills: {
    label: { en: 'hills', zh: '丘陵' },
    moveCost: 2,
    yields: { food: 1, stone: 4 },
    sight: 3,
    fill: '#4a4227', glyph: '∩', ink: '#8a7846',
  },
  mountain: {
    label: { en: 'mountains', zh: '山地' },
    moveCost: null,
    yields: { stone: 6 },
    sight: 0,
    fill: '#3d3d45', glyph: '▲', ink: '#767683',
  },
  desert: {
    label: { en: 'desert', zh: '荒漠' },
    moveCost: 1,
    yields: {},
    sight: 3,
    fill: '#5c4e2c', glyph: '˙', ink: '#9c8752',
  },
  tundra: {
    label: { en: 'tundra', zh: '苔原' },
    moveCost: 1,
    yields: { food: 2 },
    sight: 3,
    fill: '#414a52', glyph: ',', ink: '#7d8b96',
  },
};

/** 进不去的地形（深海、山地）在寻路和扎营时都要挡住 */
export function isPassable(id: TerrainId): boolean {
  return TERRAIN[id].moveCost != null;
}

/**
 * 能不能派人上去干活。注意这和能不能走进去是两回事 ——
 * 浅滩和山地都进不去，但营地挨着它们就能捕鱼、采石。
 */
export function isWorkable(id: TerrainId): boolean {
  return Object.keys(TERRAIN[id].yields).length > 0;
}
