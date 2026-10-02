/**
 * 建筑、装备与工具表。
 *
 * 按**东西放在哪**分成两类：
 *
 *   建筑  钉在地图上的营地址里（见 map.ts 的 sites）。拔营后留在原地，回来在
 *         同一格扎营就重新生效。仓库、工棚、了望塔在设定上本来就是房子 ——
 *         它们早先能随队走，只是因为那时还没有"固定建筑"这一类。
 *   装备  跟着队伍走（state.works）：工具按人数计，储藏瓮和背架全队一份。
 *         **凡是"制作"出来的都是装备**，所以营地面板只有"建筑 / 装备"两页。
 *
 * 两类都不需要任何"拔营时先存起来、扎营时再取回来"的搬运逻辑：装备本来就在
 * 队伍身上，建筑本来就在营地址上，营地只是通过位置找到它。那种搬运步骤
 * 正是以后会漏掉某个字段的地方。
 */
import type { ResourceId } from './terrain.ts';

export type Cost = Partial<Record<ResourceId, number>>;

// ---------------------------------------------------------------- 建筑

export type BuildingId =
  | 'store'
  | 'workshop'
  | 'watchtower'
  | 'expansion'
  | 'crew1'
  | 'crew2'
  | 'outskirts';

export interface Building {
  label: { en: string; zh: string };
  desc: { en: string; zh: string };
  cost: Cost;
  /**
   * 占不占建筑槽位。营地扩建和两级扩编不占 —— 前者本身就是开槽位的，
   * 后两者是营地规模的一部分。改成占槽位只需要动这一个字段。
   */
  slot: boolean;
  /** 前置建筑：必须**在同一处营地址**已经建好。跨营地的前置没有意义 */
  requires?: BuildingId;
}

/**
 * 一处营地址最多几种建筑，每种一座。效果直接写死在读它的地方
 * （crewCap、workRadius、stockCap……），不做通用的加成管线。
 *
 * 造价都是**占位数字**，等机制跑起来以后用 npm run balance 量回收期再定。
 */
export const BUILDINGS: Record<BuildingId, Building> = {
  store: {
    label: { en: 'Store', zh: '仓库' },
    desc: {
      en: 'Storage +40 · food upkeep −1 per turn',
      zh: '储量上限 +40 · 每回合食物消耗 −1',
    },
    cost: { wood: 12, stone: 6 },
    slot: true,
  },
  workshop: {
    label: { en: 'Workshop', zh: '工棚' },
    desc: { en: 'Gear can be made here', zh: '可以在这里制作装备' },
    cost: { wood: 14, stone: 10 },
    slot: true,
  },
  watchtower: {
    label: { en: 'Watchtower', zh: '了望塔' },
    desc: { en: 'Camp sight +1', zh: '营地视野 +1' },
    cost: { wood: 10, stone: 8 },
    slot: true,
  },
  expansion: {
    label: { en: 'Camp expansion', zh: '营地扩建' },
    desc: { en: 'Building slots 3 → 6 · takes no slot', zh: '建筑槽位 3 → 6 · 不占槽位' },
    cost: { wood: 24, stone: 16 },
    slot: false,
  },
  crew1: {
    label: { en: 'Larger crews', zh: '扩编' },
    desc: { en: 'Crew per tile +2 · takes no slot', zh: '每格人数上限 +2 · 不占槽位' },
    cost: { wood: 16, stone: 10 },
    slot: false,
  },
  crew2: {
    label: { en: 'Larger crews II', zh: '扩编（二）' },
    desc: { en: 'Crew per tile +2 more · takes no slot', zh: '每格人数上限再 +2 · 不占槽位' },
    cost: { wood: 20, stone: 14, iron: 4 },
    slot: false,
    requires: 'crew1',
  },
  outskirts: {
    label: { en: 'Outer grounds', zh: '外围营地' },
    desc: {
      en: 'Work and survey radius +1',
      zh: '采集和探查半径 +1',
    },
    cost: { wood: 30, stone: 20 },
    slot: true,
  },
};

export const BUILDING_ORDER: BuildingId[] = [
  'store',
  'workshop',
  'watchtower',
  'outskirts',
  'expansion',
  'crew1',
  'crew2',
];

/** 一处营地址开始时的槽位，以及营地扩建之后的槽位 */
export const BASE_SLOTS = 3;
export const EXPANDED_SLOTS = 6;

/** 拆除返还多少，向下取整 */
export const DEMOLISH_REFUND = 0.5;

// ---------------------------------------------------------------- 装备

/** 全队一份的装备。工具另算，按人数计 */
export type GearId = 'jars' | 'packs';

export interface Gear {
  label: { en: string; zh: string };
  desc: { en: string; zh: string };
  cost: Cost;
}

export const GEAR: Record<GearId, Gear> = {
  // 黏土管储量。现在仓库留在营地址上，赶路时的储量全靠它 ——
  // 它成了迁徙的关键装备，正好对上黏土"管储量"的定位
  jars: {
    label: { en: 'Clay jars', zh: '储藏瓮' },
    desc: { en: 'Storage +40, wherever you are', zh: '储量上限 +40，走到哪都算' },
    cost: { wood: 6, clay: 12 },
  },
  // 兽皮管机动。赶路的回合没人干活，走得快一点就是少亏一点，而更远处才有铁
  packs: {
    label: { en: 'Pack frames', zh: '背架' },
    desc: { en: 'Moves +1 while roaming', zh: '游荡时行动力 +1' },
    cost: { wood: 6, hide: 10 },
  },
};

export const GEAR_ORDER: GearId[] = ['jars', 'packs'];

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
