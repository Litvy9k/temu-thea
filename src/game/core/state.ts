/**
 * 游戏状态与规则。
 *
 * 核心结构是**两种互斥状态**：
 *
 *   游荡  camp === null   能在地图上走，但没人干活，队伍纯消耗
 *   扎营  camp !== null   不能走，但能把人派到营地周围一圈的地格上采集
 *
 * 扎营和拔营各消耗当回合剩余的行动力，所以搬家至少要一整个回合 ——
 * 代价是时间不是材料，这样不会出现"没木材了永远走不了"的死锁。
 *
 * 状态是纯数据（能直接 JSON.stringify 存档），动作都是"拿状态 + 参数，改状态"。
 * 这里用原地修改 + version 计数驱动 React 重绘，没有做不可变更新：地图有几千个
 * tile，每走一步整份复制不值当。代价是撤销要靠 snapshot() 显式存快照。
 */
import { type Axial, distance, equals, key, parseKey, range, reachable, ring } from './hex.ts';
import { type GameMap, generateMap, hexOfIndex, tileAt } from './map.ts';
import { seedFrom } from './rng.ts';
import { type ResourceId, TERRAIN, isPassable, isWorkable } from './terrain.ts';
import {
  FACILITIES,
  type FacilityId,
  TOOLS,
  TOOL_ORDER,
  type ToolId,
  canAfford,
  payCost,
} from './works.ts';

/** 营地的作业半径。1 = 周围一圈六格 */
export const CAMP_RADIUS = 1;
/** 营地自带的视野 */
export const CAMP_SIGHT = 2;
/** 队伍每回合的行动力（只在游荡状态下有意义） */
export const PARTY_MOVES = 4;

/** 采集进度条的满值 */
export const HARVEST_GOAL = 40;
/** 每人每回合推进的进度 */
export const WORK_PER_PERSON = 20;
/** 一格最多站几个人 */
export const MAX_CREW_PER_TILE = 5;

export const START_PEOPLE = 3;
/**
 * 每隔几回合人口 +1。挨饿的回合不涨。
 *
 * 自然增长故意放得很慢 —— 人口主要该由决策和事件推动，时间只是保底。
 */
export const GROWTH_EVERY = 10;

/** 每人每回合吃掉的食物。食物是唯一按人头算的消耗 */
export const UPKEEP_FOOD_PER_PERSON = 1;
/**
 * 每回合固定烧掉的木材，与人数无关 —— 篝火烧一晚，三个人烤和十个人烤
 * 一样多。游荡时也照烧。
 *
 * 名字里的 PER_PERSON / PER_TURN 是故意写死的：两笔消耗口径不同，
 * 在 endTurn 里给木材错乘一个人数属于跑得通、只是数字不对的 bug。
 */
export const UPKEEP_WOOD_PER_TURN = 1;

export interface Party {
  at: Axial;
  moves: number;
  people: number;
}

export interface Camp {
  at: Axial;
  /** 地格 key -> 派了几个人 */
  crew: Record<string, number>;
  /**
   * 部署顺序：每派一个人就往后追加一次他所在地格的 key，撤人时从后往前删。
   *
   * crew 只有人数，而发工具需要知道谁先来 —— "有 3 把斧头"就是先部署的
   * 3 个人拿到。顺序是玩家看得见也能利用的信息，所以它是状态的一部分，
   * 不是渲染时临时排出来的。
   */
  order: string[];
}

export type Stock = Record<ResourceId, number>;

export interface GameState {
  map: GameMap;
  party: Party;
  /** null 表示正在游荡 */
  camp: Camp | null;
  /**
   * 随队工事与行装。**不放在 camp 里** —— 拔营时 camp 置 null，这些跟着
   * 队伍走，于是"拔营再扎营后保留"是模型的自然结果而不是特例逻辑。
   */
  works: Works;
  turn: number;
  stock: Stock;
  /** 上一回合的净收支，给 HUD 显示 */
  lastIncome: Stock;
  /** 上一回合各资源的缺口（正数表示差多少） */
  lastShortage: { food: number; wood: number };
  /** 连续吃不上饭 / 烧不上火的回合数 */
  hardship: number;
  /** 人死光了 */
  over: boolean;
  version: number;
}

export interface Works {
  /** 已建成的设施。每种只能有一座 */
  facilities: FacilityId[];
  /** 各类工具的数量 */
  tools: Record<ToolId, number>;
}

const NO_STOCK: Stock = { food: 0, wood: 0, stone: 0 };

export interface NewGameOptions {
  width?: number;
  height?: number;
  seed?: string | number;
}

export function createGame(opts: NewGameOptions = {}): GameState {
  const { width = 64, height = 44 } = opts;
  const seed =
    typeof opts.seed === 'string' ? seedFrom(opts.seed) : (opts.seed ?? Date.now() >>> 0);
  const map = generateMap({ width, height, seed });

  const state: GameState = {
    map,
    party: { at: findStart(map), moves: PARTY_MOVES, people: START_PEOPLE },
    camp: null,
    works: { facilities: [], tools: { axe: 0, hoe: 0 } },
    turn: 1,
    stock: { food: 12, wood: 12, stone: 0 },
    lastIncome: { ...NO_STOCK },
    lastShortage: { food: 0, wood: 0 },
    hardship: 0,
    over: false,
    version: 0,
  };

  refreshVision(state);
  return state;
}

/**
 * 开局位置：靠近地图中心、能站人、而且周围一圈同时有食物和木材 ——
 * 缺任何一样都会在几回合内饿死或冻死，那不叫难度，那叫坑。
 * 从中心一圈圈往外找，第一个及格的就用。
 */
function findStart(map: GameMap): Axial {
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
      for (const n of ring(h, CAMP_RADIUS)) {
        const t = tileAt(map, n);
        if (!t) continue;
        food += TERRAIN[t.terrain].yields.food ?? 0;
        wood += TERRAIN[t.terrain].yields.wood ?? 0;
      }
      // 两格产粮 + 一片林子，够开局站住脚
      if (food >= 8 && wood >= 5) return h;
    }
    if (fallback && r > 12) return fallback;
  }
  throw new Error('这张图上找不到能落脚的地方');
}

// ---------------------------------------------------------------- 视野

/** 营地视野。了望塔加一格 */
export function campSight(state: GameState): number {
  return CAMP_SIGHT + (hasFacility(state, 'watchtower') ? 1 : 0);
}

/** 站在哪看多远由脚下地形决定，但至少能看见隔壁 */
export function sightFrom(state: GameState, h: Axial): number {
  const tile = tileAt(state.map, h);
  return Math.max(1, tile ? TERRAIN[tile.terrain].sight : 1);
}

/**
 * 重算全图可见性。explored 只会从 false 变 true（记忆不会丢），
 * visible 每次从头算（走开了就该看不见了）。
 */
export function refreshVision(state: GameState): void {
  for (const tile of state.map.tiles) tile.visible = false;

  const reveal = (center: Axial, radius: number) => {
    for (const h of range(center, radius)) {
      const tile = tileAt(state.map, h);
      if (!tile) continue;
      tile.visible = true;
      tile.explored = true;
    }
  };

  reveal(state.party.at, sightFrom(state, state.party.at));
  if (state.camp) reveal(state.camp.at, campSight(state));
}

// ---------------------------------------------------------------- 移动

/** 进入这一格要花多少行动力。null = 进不去 */
export function stepCost(state: GameState, h: Axial): number | null {
  const tile = tileAt(state.map, h);
  if (!tile) return null;
  // 没探明的地方照样能走进去 —— 探索本来就是往看不见的地方走
  return TERRAIN[tile.terrain].moveCost;
}

/** 这回合还能走到哪。扎营状态下哪也去不了 */
export function movesAvailable(state: GameState) {
  if (state.camp || state.over) return new Map<string, { hex: Axial; cost: number }>();
  return reachable(state.party.at, state.party.moves, (h) => stepCost(state, h));
}

/** 返回是否真的走了。走不到就原样不动，不报错 —— 点到走不了的地方是常事 */
export function moveParty(state: GameState, to: Axial): boolean {
  if (state.camp || state.over) return false;
  if (equals(state.party.at, to)) return false;

  const target = movesAvailable(state).get(key(to));
  if (!target) return false;

  state.party.at = to;
  state.party.moves -= target.cost;
  refreshVision(state);
  state.version += 1;
  return true;
}

// ---------------------------------------------------------------- 扎营

export type CampBlocker = 'camped' | 'terrain' | 'noMoves' | null;

/** 不能扎营的原因，能扎就是 null。UI 直接拿它显示提示 */
export function campBlocker(state: GameState): CampBlocker {
  if (state.over) return 'camped';
  if (state.camp) return 'camped';

  const tile = tileAt(state.map, state.party.at);
  if (!tile || !isPassable(tile.terrain)) return 'terrain';
  // 走光了行动力就没法当回合再扎营，否则"走到底 + 立刻开工"没有代价
  if (state.party.moves <= 0) return 'noMoves';
  return null;
}

export function makeCamp(state: GameState): boolean {
  if (campBlocker(state) != null) return false;

  state.camp = { at: { ...state.party.at }, crew: {}, order: [] };
  // 扎营吃掉当回合剩下的行动力
  state.party.moves = 0;
  refreshVision(state);
  state.version += 1;
  return true;
}

/** 拔营。人全部收回队伍，同样吃掉当回合剩余行动力 */
export function breakCamp(state: GameState): boolean {
  if (!state.camp || state.over) return false;

  state.camp = null;
  state.party.moves = 0;
  refreshVision(state);
  state.version += 1;
  return true;
}

// ---------------------------------------------------------------- 派工

/** 营地周围一圈里能派人干活的格子。浅滩和山地进不去但能采，所以看的是产出不是通行 */
export function workableTiles(state: GameState): Axial[] {
  if (!state.camp) return [];
  return ring(state.camp.at, CAMP_RADIUS).filter((h) => {
    const tile = tileAt(state.map, h);
    return tile != null && isWorkable(tile.terrain);
  });
}

export function crewAt(state: GameState, h: Axial): number {
  return state.camp?.crew[key(h)] ?? 0;
}

/** 已经派出去的总人数 */
export function assignedCount(state: GameState): number {
  if (!state.camp) return 0;
  let n = 0;
  for (const v of Object.values(state.camp.crew)) n += v;
  return n;
}

/** 还没派活的人。他们照样吃饭烧柴，所以闲人是纯亏损 */
export function idleCount(state: GameState): number {
  return state.party.people - assignedCount(state);
}

export type AssignBlocker = 'noCamp' | 'notWorkable' | 'noIdle' | 'tileFull' | null;

export function assignBlocker(state: GameState, h: Axial): AssignBlocker {
  if (!state.camp || state.over) return 'noCamp';

  const tile = tileAt(state.map, h);
  if (!tile || !isWorkable(tile.terrain)) return 'notWorkable';
  if (distance(state.camp.at, h) !== CAMP_RADIUS) return 'notWorkable';

  if (idleCount(state) <= 0) return 'noIdle';
  if (crewAt(state, h) >= MAX_CREW_PER_TILE) return 'tileFull';
  return null;
}

/** 往某格加一个人 */
export function assign(state: GameState, h: Axial): boolean {
  if (assignBlocker(state, h) != null) return false;

  const k = key(h);
  state.camp!.crew[k] = (state.camp!.crew[k] ?? 0) + 1;
  state.camp!.order.push(k);
  state.version += 1;
  return true;
}

/** 从某格撤一个人 */
export function unassign(state: GameState, h: Axial): boolean {
  if (!state.camp || state.over) return false;

  const k = key(h);
  const n = state.camp.crew[k] ?? 0;
  if (n <= 0) return false;

  if (n === 1) delete state.camp.crew[k];
  else state.camp.crew[k] = n - 1;

  // 从后往前删：撤的是这一格上最后部署的那个人，先来的保住工具
  const i = state.camp.order.lastIndexOf(k);
  if (i >= 0) state.camp.order.splice(i, 1);

  state.version += 1;
  return true;
}

/**
 * 死了人之后派工会超编，按部署顺序从最后一个往回撤 ——
 * 后来的先走，先部署的人保住位置和手里的工具。
 */
function trimCrew(state: GameState): void {
  if (!state.camp) return;

  while (state.camp.order.length > state.party.people) {
    const k = state.camp.order.pop();
    if (k == null) return;
    const n = state.camp.crew[k] ?? 0;
    if (n <= 1) delete state.camp.crew[k];
    else state.camp.crew[k] = n - 1;
  }
}

// ---------------------------------------------------------------- 工具

/**
 * 按部署顺序把工具发下去，返回每个地格拿到了几把、加成多少。
 *
 * 规则：先部署的人先拿。有 3 把斧头就是最早派到林子里的 3 个人吃到加成，
 * 第 4 个人空手。所以"先派谁"是玩家能看见也能利用的决定 —— 这也是为什么
 * camp.order 要存进状态，而不是渲染时临时排。
 *
 * 一把工具只对用得上的地格算数：斧头发给站在草原上的人是浪费，所以跳过。
 */
export function toolAllocation(state: GameState): Map<string, { equipped: number; bonus: number }> {
  const out = new Map<string, { equipped: number; bonus: number }>();
  if (!state.camp) return out;

  const left = { ...state.works.tools };

  for (const k of state.camp.order) {
    const tile = tileAt(state.map, parseKey(k));
    if (!tile) continue;

    const yields = TERRAIN[tile.terrain].yields;
    const id = TOOL_ORDER.find((t) => left[t] > 0 && TOOLS[t].boosts.some((r) => yields[r]));
    if (!id) continue;

    left[id] -= 1;
    const cur = out.get(k) ?? { equipped: 0, bonus: 0 };
    cur.equipped += 1;
    cur.bonus += TOOLS[id].bonus;
    out.set(k, cur);
  }
  return out;
}

export interface WorkRate {
  crew: number;
  /** 这一格上有几个人拿到了工具 */
  equipped: number;
  /** 人力本身的推进量 */
  base: number;
  /** 工具额外带来的推进量 */
  bonus: number;
  total: number;
  progress: number;
  /** 这回合结算时会完成几次采集 */
  times: number;
}

/**
 * 某格这回合推进多少、能结算几次。**这是采集速度的唯一口径** ——
 * 地格面板、进度条、endTurn 全都读它，加成才不会在某一处漏算。
 *
 * 进度可以溢出：3 个人推 60 点是"结算一次 + 条上留 20"，4 个人推 80 点
 * 结算两次。所以第 5 个人不会被浪费，只是收益不再是整块的。
 */
export function workRateAt(state: GameState, h: Axial, alloc = toolAllocation(state)): WorkRate {
  const tile = tileAt(state.map, h);
  const crew = crewAt(state, h);
  const progress = tile?.progress ?? 0;

  if (!tile || crew === 0) {
    return { crew: 0, equipped: 0, base: 0, bonus: 0, total: 0, progress, times: 0 };
  }

  const gear = alloc.get(key(h)) ?? { equipped: 0, bonus: 0 };
  const base = crew * WORK_PER_PERSON;
  const total = base + gear.bonus;

  return {
    crew,
    equipped: gear.equipped,
    base,
    bonus: gear.bonus,
    total,
    progress,
    times: Math.floor((progress + total) / HARVEST_GOAL),
  };
}

// ---------------------------------------------------------------- 建造

export function hasFacility(state: GameState, id: FacilityId): boolean {
  return state.works.facilities.includes(id);
}

export type BuildBlocker = 'built' | 'noCamp' | 'cost' | null;

export function buildBlocker(state: GameState, id: FacilityId): BuildBlocker {
  if (hasFacility(state, id)) return 'built';
  // 造东西要有个地方摆，所以必须先扎营
  if (!state.camp || state.over) return 'noCamp';
  if (!canAfford(state.stock, FACILITIES[id].cost)) return 'cost';
  return null;
}

export function buildFacility(state: GameState, id: FacilityId): boolean {
  if (buildBlocker(state, id) != null) return false;

  payCost(state.stock, FACILITIES[id].cost);
  state.works.facilities.push(id);
  refreshVision(state);
  state.version += 1;
  return true;
}

export type CraftBlocker = 'locked' | 'noCamp' | 'cost' | null;

export function craftBlocker(state: GameState, id: ToolId): CraftBlocker {
  if (!state.camp || state.over) return 'noCamp';
  if (!hasFacility(state, 'workshop')) return 'locked';
  if (!canAfford(state.stock, TOOLS[id].cost)) return 'cost';
  return null;
}

export function craftTool(state: GameState, id: ToolId): boolean {
  if (craftBlocker(state, id) != null) return false;

  payCost(state.stock, TOOLS[id].cost);
  state.works.tools[id] += 1;
  state.version += 1;
  return true;
}

// ---------------------------------------------------------------- 回合

export function endTurn(state: GameState): void {
  if (state.over) return;

  const income: Stock = { ...NO_STOCK };

  // 采集：先按人头推进度，进度每满 40 结算一次，余数留在条上
  if (state.camp) {
    // 工具分配和派工顺序有关，整回合算一次，别在循环里反复重算
    const alloc = toolAllocation(state);

    for (const k of Object.keys(state.camp.crew)) {
      const h = parseKey(k);
      const tile = tileAt(state.map, h);
      if (!tile) continue;

      tile.progress += workRateAt(state, h, alloc).total;
      const times = Math.floor(tile.progress / HARVEST_GOAL);
      tile.progress -= times * HARVEST_GOAL;

      if (times > 0) {
        for (const [res, amount] of Object.entries(TERRAIN[tile.terrain].yields)) {
          income[res as ResourceId] += amount * times;
        }
      }
    }
  }

  // 消耗：吃饭按人头，烧柴按营火 —— 口径不同，别合并成一行。
  // 仓库省下的是总量里的一份，不是每人一份，所以减在乘法之外
  const stored = hasFacility(state, 'store') ? 1 : 0;
  income.food -= Math.max(0, state.party.people * UPKEEP_FOOD_PER_PERSON - stored);
  income.wood -= UPKEEP_WOOD_PER_TURN;

  state.stock.food += income.food;
  state.stock.wood += income.wood;
  state.stock.stone += income.stone;

  // 缺口：任何一样不够，都要减员。食物是饿死，木材是冻死，代价一样
  const shortage = {
    food: Math.max(0, -state.stock.food),
    wood: Math.max(0, -state.stock.wood),
  };
  state.stock.food = Math.max(0, state.stock.food);
  state.stock.wood = Math.max(0, state.stock.wood);
  state.lastShortage = shortage;

  if (shortage.food > 0 || shortage.wood > 0) {
    state.hardship += 1;
    state.party.people = Math.max(0, state.party.people - 1);
    trimCrew(state);
  } else {
    state.hardship = 0;
    // 只有日子过得下去的回合才添丁
    if (state.turn % GROWTH_EVERY === 0) state.party.people += 1;
  }

  if (state.party.people <= 0) state.over = true;

  state.lastIncome = income;
  state.party.moves = PARTY_MOVES;
  state.turn += 1;
  state.version += 1;
}

/** 存档 / 撤销用。状态是纯数据，深拷贝就够 */
export function snapshot(state: GameState): GameState {
  return structuredClone(state);
}
