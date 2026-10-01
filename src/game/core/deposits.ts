/**
 * 矿脉表 —— 叠在地形之上的第二层产出。
 *
 * 和地形的分工：**地形说这块地是什么，矿脉说这块地上恰好有什么。**
 * 同样是山地，有铁矿的那一块才值得跑过去 —— 这是"在哪扎营"这个决定里
 * 除食物/木材之外的第二根轴，也是第一个需要**先探明才知道**的信息。
 *
 * 采到手就能用，没有原料→成品那一层加工。所以每种新资源都必须在
 * works.ts 里有直接的出口（工具或设施），否则它只是个数字。
 *
 * **离出生点越远，矿脉越密**（参考《西娅：觉醒》的做法）。每种矿脉有自己的
 * 起点距离，过了起点才开始出现，然后密度一路爬升：近处只有黏土且稀疏，
 * 兽道要走出去一段，铁矿更远——但越往外走，三样都越密。这条梯度给了整局一个方向 ——
 * 队伍会一路向外迁徙，而不是在开局那片地方原地转到天荒地老。
 *
 * 没有战斗，所以"远处危险"这件事是靠**后勤**成立的：赶路的回合没人干活，
 * 队伍纯消耗，走得越远越要先把补给和背架准备好。
 */
import type { ResourceId, TerrainId } from './terrain.ts';
import { TERRAIN } from './terrain.ts';

export type DepositId = 'clay' | 'game' | 'iron';

export interface Deposit {
  label: { en: string; zh: string };
  /** 这处矿脉产什么。一处只产一种 —— 混产会让地格面板和工具判定都糊掉 */
  res: ResourceId;
  /**
   * 进度条满一次额外产出多少。和地形产出相加。
   *
   * **不能超过它能出现的任一地形的主产量**（持平可以）。超了的话
   * 这块地的主产就变成了矿产，而工具是按主产判定适用的 ——
   * 沼泽是食 2 木 2，黏土坑若产 4，这格上斧头和锄头就都不算数了，
   * 而游戏里的症状只是"在这格上工具好像没生效"。有测试盯着这条。
   *
   * 所以实际上限是所有允许地形中**主产最低**的那一个：
   * 黏土卡在沼泽（2），兽道卡在苔原（2），铁卡在丘陵（4）。
   */
  per: number;
  /** 只可能出现在这些地形上 */
  terrain: TerrainId[];
  /**
   * 距离梯度：near 之内一处都没有，far 之外按 density 满密度出现，
   * 中间线性爬升。**near 是"最早可能在哪遇到"，不是"保证在哪遇到"** ——
   * 实际的首见距离要靠 scripts/deposits.ts 量，别照着这个数估。
   */
  near: number;
  far: number;
  /** 满密度时，一块合格地格上出现矿脉的概率 */
  density: number;
  glyph: string;
  ink: string;
}

/**
 * 三种资源各自把持一条升级路线，这样"我为什么要跑那么远"每次都有具体答案：
 *
 *   黏土  储量    —— 近处就有，解决的是"攒不下东西"
 *   兽皮  机动    —— 中程，背架让队伍走得更远，于是它是通往铁矿的钥匙
 *   铁    效率    —— 最远，换来加成翻倍的铁器和第一把采石工具
 *
 * 产量都压在地形主产之下或持平，理由写在下面 per 字段的注里。
 * 数字看着小，但一格站满 5 人是每回合 2.5 次结算 —— 一口储藏瓮（12 黏土）
 * 三回合就凑齐了。这些资源的代价在**路上**，不在采集台前。
 */
export const DEPOSITS: Record<DepositId, Deposit> = {
  clay: {
    label: { en: 'Clay pit', zh: '黏土坑' },
    res: 'clay',
    per: 2,
    terrain: ['marsh', 'shallow', 'grass'],
    near: 1,
    far: 20,
    density: 0.09,
    // 空心的：实心平行四边形在草绿底上是一块显眼的色块，和地形符号那种细笔画格格不入
    glyph: '▱',
    ink: '#d8b183',
  },
  game: {
    label: { en: 'Game trail', zh: '兽道' },
    res: 'hide',
    per: 2,
    terrain: ['forest', 'tundra', 'grass'],
    near: 6,
    far: 24,
    density: 0.09,
    glyph: '◗',
    ink: '#c08c6a',
  },
  iron: {
    label: { en: 'Iron vein', zh: '铁矿脉' },
    res: 'iron',
    per: 3,
    terrain: ['hills', 'mountain'],
    near: 11,
    far: 26,
    density: 0.22,
    glyph: '◈',
    ink: '#9fb4c4',
  },
};

/**
 * 放置顺序。一块地只放一处矿脉，排在前面的先占 ——
 * 稀有的放前面，否则常见的黏土会把和它地形重叠的兽道挤掉。
 */
export const DEPOSIT_ORDER: DepositId[] = ['iron', 'game', 'clay'];

/** 这处矿脉在距离 d 上的出现概率 */
export function densityAt(d: Deposit, dist: number): number {
  if (dist < d.near) return 0;
  if (d.far <= d.near) return d.density;
  const ramp = Math.min(1, (dist - d.near) / (d.far - d.near));
  return d.density * ramp;
}

/**
 * 一块地实际的产出 = 地形产出 + 矿脉产出。
 *
 * **所有读产出的地方都得走这里**，包括采集结算、地格面板和工具判定。
 * 漏掉任何一处的症状都是"面板写着能采铁，结算却没有" —— 有测试盯着。
 */
export function yieldsOf(
  terrain: TerrainId,
  deposit: DepositId | null | undefined,
): Partial<Record<ResourceId, number>> {
  const base = TERRAIN[terrain].yields;
  if (!deposit) return base;

  const d = DEPOSITS[deposit];
  return { ...base, [d.res]: (base[d.res] ?? 0) + d.per };
}
