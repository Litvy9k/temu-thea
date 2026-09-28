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

export type FacilityId = 'store' | 'workshop' | 'watchtower' | 'jars' | 'packs';

export interface Facility {
  label: { en: string; zh: string };
  desc: { en: string; zh: string };
  cost: Cost;
}

/** 每种设施只能有一座，效果直接写死在读它的地方，不做通用的加成管线 */
export const FACILITIES: Record<FacilityId, Facility> = {
  store: {
    label: { en: 'Store', zh: '仓库' },
    desc: {
      en: 'Storage +40 · food upkeep −1 per turn',
      zh: '储量上限 +40 · 每回合食物消耗 −1',
    },
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
  // 黏土管储量。和仓库叠加，所以"找到黏土"的回报是背包直接再大一倍
  jars: {
    label: { en: 'Clay jars', zh: '储藏瓮' },
    desc: { en: 'Storage +40', zh: '储量上限 +40' },
    cost: { wood: 6, clay: 12 },
  },
  // 兽皮管机动。这是向外迁徙那个环节的钥匙：赶路的回合没人干活，
  // 走得快一点就是少亏一点，而更远处才有铁
  packs: {
    label: { en: 'Pack frames', zh: '背架' },
    desc: { en: 'Moves +1 while roaming', zh: '游荡时行动力 +1' },
    cost: { wood: 6, hide: 10 },
  },
};

export const FACILITY_ORDER: FacilityId[] = [
  'store',
  'workshop',
  'watchtower',
  'jars',
  'packs',
];

// ---------------------------------------------------------------- 工具

export type ToolId = 'axe' | 'hoe' | 'ironAxe' | 'ironHoe' | 'pick';

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
  /*
   * 铁器的加成是 20，恰好等于一个人自己的产出（WORK_PER_PERSON）——
   * "一把铁器 = 多一双手"是句玩家一听就懂的话，而石器只抵半个人。
   * 跑二十回合去找铁，回报得是一眼看得出来的量级。
   */
  ironAxe: {
    label: { en: 'Iron axe', zh: '铁斧' },
    cost: { wood: 6, iron: 6 },
    boosts: ['wood'],
    bonus: 20,
  },
  ironHoe: {
    label: { en: 'Iron hoe', zh: '铁锄' },
    cost: { wood: 4, iron: 6 },
    boosts: ['food'],
    bonus: 20,
  },
  /*
   * 丘陵和山地一直没有对应的工具（见 terrain.ts 里的那条注）。
   * 补上它的是铁，而铁又只从山里出 —— 先采石，再找铁，再回头采得更快。
   */
  pick: {
    label: { en: 'Iron pick', zh: '铁镐' },
    cost: { wood: 6, iron: 5 },
    boosts: ['stone'],
    bonus: 20,
  },
};

/**
 * 制作菜单里的显示顺序：石器在前，铁器在后。
 *
 * 和下面的 TOOL_PRIORITY **是两回事**，当初合并成一份的后果是：开局第一回合
 * 打开制作页，最上面那一条是还要跑二十回合才做得出来的铁斧。
 * 菜单该按"现在做得出什么"排，发放该按"哪把更好"排。
 */
export const TOOL_ORDER: ToolId[] = ['axe', 'hoe', 'ironAxe', 'ironHoe', 'pick'];

/**
 * 发工具时按这个顺序找第一把用得上的，所以**同一种资源里好的排前面**：
 * 手里既有铁斧又有石斧时，最先派出去的人拿走铁斧。
 * 沼泽是食物木材并列的主产，两类工具都算数，所以斧在锄前这个相对次序也是有意义的。
 */
export const TOOL_PRIORITY: ToolId[] = ['ironAxe', 'axe', 'ironHoe', 'hoe', 'pick'];

export const NO_TOOLS: Record<ToolId, number> = Object.freeze(
  Object.fromEntries(TOOL_ORDER.map((tool) => [tool, 0])),
) as Record<ToolId, number>;

/** 老存档里只有斧和锄，缺的字段补 0 */
export function fillTools(
  partial: Partial<Record<ToolId, number>> | undefined,
): Record<ToolId, number> {
  return { ...NO_TOOLS, ...partial };
}

/** 库存够不够付这个价 */
export function canAfford(stock: Record<ResourceId, number>, cost: Cost): boolean {
  return Object.entries(cost).every(([res, n]) => stock[res as ResourceId] >= n);
}

export function payCost(stock: Record<ResourceId, number>, cost: Cost): void {
  for (const [res, n] of Object.entries(cost)) stock[res as ResourceId] -= n;
}
