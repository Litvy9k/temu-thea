/**
 * 设施与工具表。
 *
 * 这两样都挂在**队伍**上而不是营地上（见 state.ts 的 works 字段）：拔营时
 * 营地置 null，设施和工具跟着队伍走。所以"拔营再扎营后保留"不是一条特例
 * 规则，而是数据模型的自然结果 —— 不需要任何"拔营时先把设施存起来"的搬运
 * 逻辑，那种地方正是以后会漏掉某个字段的位置。
 *
 * 叙事上把它们理解成随队工事和行装：拆了棚子，把木料和工具装上车带走。
 */
import type { ResourceId } from './terrain.ts';

export type Cost = Partial<Record<ResourceId, number>>;

// ---------------------------------------------------------------- 设施

export type FacilityId = 'store' | 'workshop' | 'watchtower';

export interface Facility {
  label: { en: string; zh: string };
  desc: { en: string; zh: string };
  cost: Cost;
}

/** 每种设施只能有一座，效果直接写死在读它的地方，不做通用的加成管线 */
export const FACILITIES: Record<FacilityId, Facility> = {
  store: {
    label: { en: 'Store', zh: '仓库' },
    desc: { en: 'Food upkeep −1 per turn', zh: '每回合食物消耗 −1' },
    cost: { wood: 12, stone: 6 },
  },
  workshop: {
    label: { en: 'Workshop', zh: '工棚' },
    desc: { en: 'Unlocks crafting', zh: '解锁工具制作' },
    cost: { wood: 14, stone: 10 },
  },
  watchtower: {
    label: { en: 'Watchtower', zh: '了望塔' },
    desc: { en: 'Camp sight +1', zh: '营地视野 +1' },
    cost: { wood: 10, stone: 8 },
  },
};

export const FACILITY_ORDER: FacilityId[] = ['store', 'workshop', 'watchtower'];

// ---------------------------------------------------------------- 工具

export type ToolId = 'axe' | 'hoe';

export interface Tool {
  label: { en: string; zh: string };
  cost: Cost;
  /** 这把工具对采集哪些资源的地格有用 */
  boosts: ResourceId[];
  /** 拿着它的人每回合额外推进多少进度 */
  bonus: number;
}

/**
 * 工具按**数量**计，一把装备一个人：有 3 把斧头就只有 3 个人吃到加成。
 *
 * 这样"造工具"和"人口增长"是耦合的，不会变成可以无限叠加的百分比。
 * 而且工具分类型，材料花在斧头还是锄头上是个取舍 —— 它会反过来抬高
 * "营地周围有没有森林"这件事的权重。
 */
export const TOOLS: Record<ToolId, Tool> = {
  axe: {
    label: { en: 'Stone axe', zh: '石斧' },
    cost: { wood: 6, stone: 4 },
    boosts: ['wood'],
    bonus: 10,
  },
  hoe: {
    label: { en: 'Bone hoe', zh: '骨锄' },
    cost: { wood: 4, stone: 6 },
    boosts: ['food'],
    bonus: 10,
  },
};

export const TOOL_ORDER: ToolId[] = ['axe', 'hoe'];

/** 库存够不够付这个价 */
export function canAfford(stock: Record<ResourceId, number>, cost: Cost): boolean {
  return Object.entries(cost).every(([res, n]) => stock[res as ResourceId] >= n);
}

export function payCost(stock: Record<ResourceId, number>, cost: Cost): void {
  for (const [res, n] of Object.entries(cost)) stock[res as ResourceId] -= n;
}
