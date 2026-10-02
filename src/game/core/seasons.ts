/**
 * 季节。
 *
 * 季节**不存进状态**，完全由回合数推出来 —— 存一份就多一处可能和回合数
 * 对不上的地方，读档时还得校验它。
 *
 * 设计原则：**每个季节改变一个不同的系统，而且效果都是开 / 关，不是一个要
 * 玩家去乘的系数**。只动消耗太单薄，动每块地的产出又会让玩家每回合都得
 * 重算收支。所以这里改的是地图能不能走、看多远、什么时候添丁、篝火烧多少。
 *
 *   春  沼泽泛滥，移动消耗 3 → 5（不是不可通行，免得把营地困在里面）；
 *       自然增长只在春天发生
 *   夏  视野 +1
 *   秋  （季节事件，内容待填）
 *   冬  篝火耗柴 ×3；浅滩结冰，可以走上去；冰上不能扎营
 *
 * 数字都是暂定的。
 */
import type { Bilingual } from './events.ts';

export type SeasonId = 'spring' | 'summer' | 'autumn' | 'winter';

export const SEASON_ORDER: SeasonId[] = ['spring', 'summer', 'autumn', 'winter'];

/**
 * 一季多少回合。
 *
 * 量的是"一次搬家要花几回合"：拔营 1 回合 + 赶路两三回合 + 重新安顿，
 * 大约 4–5 回合。季节要长到搬一次家只占一季的四分之一左右，否则刚住下
 * 没几回合就又得去找过冬的地方了。
 */
export const SEASON_LENGTH = 20;
export const YEAR_LENGTH = SEASON_LENGTH * SEASON_ORDER.length;

/**
 * 开局在秋天第一回合。第一个冬天在第 21 回合到来 ——
 * 正是第一处营地刚站稳、又还没富余到可以无视冬天的时候。
 */
export const START_OFFSET = 2 * SEASON_LENGTH;

/** 冬天篝火耗柴的倍数 */
export const WINTER_WOOD_FACTOR = 3;
/** 春汛时沼泽的移动消耗 */
export const SPRING_MARSH_COST = 5;
/** 夏天的视野加成 */
export const SUMMER_SIGHT_BONUS = 1;
/**
 * 春天每隔几回合添一个人（那一回合没有短缺才算）。
 * 一个春天 20 回合，也就是一年自然增长 4 人。
 */
export const SPRING_GROWTH_EVERY = 5;
/** 走上冰面的移动消耗 */
export const ICE_COST = 2;
/** 化冻后困在水里时，涉水到相邻浅滩的移动消耗 */
export const WADE_COST = 2;
/** 冬天最后几回合，冰面画出裂纹 */
export const ICE_CRACK_TURNS = 3;

export interface Season {
  label: Bilingual;
  /**
   * 季节字和图标的颜色。避开了已经有含义的三种颜色：强调绿（收入、带工具的人）、
   * #ff8b6b（短缺）、#ffc98c（闲置）
   */
  color: string;
  /** 这一季生效的规则，HUD 的说明和换季提示都读它 —— 别在别处另写一份 */
  effects: Bilingual[];
}

export const SEASONS: Record<SeasonId, Season> = {
  spring: {
    label: { en: 'Spring', zh: '春' },
    color: '#f0a6c8',
    effects: [
      { en: `Marsh floods: move cost ${SPRING_MARSH_COST}`, zh: `沼泽泛滥：移动消耗 ${SPRING_MARSH_COST}` },
      {
        en: `A new person joins every ${SPRING_GROWTH_EVERY} turns`,
        zh: `每 ${SPRING_GROWTH_EVERY} 回合添一人`,
      },
    ],
  },
  summer: {
    label: { en: 'Summer', zh: '夏' },
    color: '#b5d86a',
    effects: [{ en: `Sight +${SUMMER_SIGHT_BONUS}`, zh: `视野 +${SUMMER_SIGHT_BONUS}` }],
  },
  autumn: {
    label: { en: 'Autumn', zh: '秋' },
    color: '#e0a24e',
    effects: [],
  },
  winter: {
    label: { en: 'Winter', zh: '冬' },
    color: '#8fc8f0',
    effects: [
      { en: `Fire burns ×${WINTER_WOOD_FACTOR} wood`, zh: `篝火耗柴 ×${WINTER_WOOD_FACTOR}` },
      { en: 'Shallows freeze and can be crossed', zh: '浅滩结冰，可以走过去' },
    ],
  },
};

/** 这一季没有特别规则时的说法，免得说明框和提示条是空的 */
const QUIET: Bilingual = { en: 'Nothing special', zh: '没有特别的规则' };

/** 这一季生效的规则，HUD 说明和换季提示都用它 */
export function effectsOf(id: SeasonId): Bilingual[] {
  return SEASONS[id].effects.length ? SEASONS[id].effects : [QUIET];
}

export interface SeasonInfo {
  id: SeasonId;
  /** 0..3，春夏秋冬。事件条件里用的就是这个数 */
  index: number;
  /** 这一季的第几回合，从 1 开始 */
  day: number;
  /** 第几年，从 1 开始 */
  year: number;
}

export function seasonAt(turn: number): SeasonInfo {
  const t = turn - 1 + START_OFFSET;
  const index = Math.floor(t / SEASON_LENGTH) % SEASON_ORDER.length;
  return {
    id: SEASON_ORDER[index],
    index,
    day: (t % SEASON_LENGTH) + 1,
    year: Math.floor(t / YEAR_LENGTH) + 1,
  };
}

export function isWinter(turn: number): boolean {
  return seasonAt(turn).id === 'winter';
}

/** 冰面快化了：冬天的最后几回合 */
export function iceCracking(turn: number): boolean {
  const s = seasonAt(turn);
  return s.id === 'winter' && s.day > SEASON_LENGTH - ICE_CRACK_TURNS;
}
