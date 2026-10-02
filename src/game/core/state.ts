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
import { type Axial, distance, equals, key, parseKey, range, reachable } from './hex.ts';
import { type GameMap, type Site, generateMap, tileAt } from './map.ts';
import { DEPOSITS, type DepositId, yieldsOf } from './deposits.ts';
import { seedFrom, step } from './rng.ts';
import {
  EVENTS,
  type Choice,
  type GameEvent,
  type Snapshot,
  chanceOf,
  findEvent,
  meetsAll,
} from './events.ts';
import {
  RESOURCE_IDS,
  type ResourceId,
  TERRAIN,
  type TerrainId,
  isPassable,
  primaryOf,
} from './terrain.ts';
import {
  BASE_SLOTS,
  BUILDINGS,
  type BuildingId,
  type Cost,
  DEMOLISH_REFUND,
  EXPANDED_SLOTS,
  GEAR,
  type GearId,
  NO_TOOLS,
  TOOLS,
  TOOL_PRIORITY,
  type ToolId,
  canAfford,
  payCost,
} from './works.ts';
import {
  ICE_COST,
  SPRING_GROWTH_EVERY,
  SPRING_MARSH_COST,
  SUMMER_SIGHT_BONUS,
  WADE_COST,
  WINTER_WOOD_FACTOR,
  YEAR_LENGTH,
  isWinter,
  seasonAt,
} from './seasons.ts';

/** 营地的作业半径。1 = 周围一圈六格 */
export const CAMP_RADIUS = 1;
/** 营地自带的视野 */
export const CAMP_SIGHT = 2;
/** 队伍每回合的行动力（只在游荡状态下有意义）。背架会抬高它，走 partyMoves() */
export const PARTY_MOVES = 4;
/** 背架加多少行动力 */
export const PACKS_MOVE_BONUS = 1;

/** 采集进度条的满值 */
export const HARVEST_GOAL = 40;
/** 每人每回合推进的进度 */
export const WORK_PER_PERSON = 20;
/**
 * 一格**最多**能站几个人，不管升级到什么程度。
 *
 * 定成 6 是因为六边形只有六条边：地图上每个人是一根贴着边的指示条，
 * 第七个人没地方画。真正生效的上限是 crewCap()，从 BASE_CREW_CAP 起步，
 * 以后靠设施往这里抬。
 */
export const MAX_CREW_PER_TILE = 6;
/**
 * 开局时每格的派工上限。
 *
 * 定 2 是量出来的（npm run balance 第 3、5 节）：开局那圈地大多是 4–5 格草原，
 * 上限 2 时最多养活约 18 人；上限 5 时是 45 人，一整局都撞不到顶，
 * 也就永远没有理由离开出生地。上限 2 让营地在 30 回合左右满员，
 * 那正是该去找铁器、找更好的地、或者造设施扩编的时候。
 *
 * 它不影响前期：15 人以内，各档上限下温饱之外腾出来的人手完全一样 ——
 * 开局圈里草原多，好地的工位根本没用满。
 */
export const BASE_CREW_CAP = 2;

export const START_PEOPLE = 3;
/*
 * 自然增长只发生在春天，节奏见 seasons.ts 的 SPRING_GROWTH_EVERY。
 * 故意放得很慢 —— 人口主要该由决策和事件推动，时间只是保底。
 */

/**
 * 地图上最多几处营地址。
 *
 * 拦的是"在新地点造第一座建筑"，**不拦扎营**：扎营本身不会生成营地址，
 * 拦扎营的话，一支已经有 5 处营地址的队伍在别处就没法干活，只能回去或者饿死。
 * 想腾出名额：等某处倒塌，或者回去把那里的建筑拆光。
 */
export const MAX_SITES = 5;

/**
 * 营地址多久没人来就倒塌（回合）。暂定两年，到时间直接消失，不提醒。
 * 季节性往返的营地会一直立着，一路走一路丢的营地会自己清掉 —— 也顺带
 * 限住了存档的大小。
 */
export const SITE_LIFETIME = 2 * YEAR_LENGTH;

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

/**
 * 每种资源的基础储量上限。
 *
 * 加上限是为了让"盈余"重新有意义：没有它时木材会涨到一千多，那只是个数字，
 * 后面再加多少消耗出口都激不起决策。有了上限，每回合的盈余必须**花掉或者
 * 浪费掉**，于是设施、工具、以后的任务和装备自动都变得要紧。
 *
 * 设定上也对得上：一支游牧队伍只能带走扛得动的东西。
 */
export const STOCK_BASE_CAP = 40;
/** 仓库把上限抬高多少。仓库是建筑，只在它所在的营地生效 */
export const STORE_CAP_BONUS = 40;
/** 储藏瓮把上限抬高多少。储藏瓮是装备，走到哪都算；和仓库叠加 */
export const JARS_CAP_BONUS = 40;
/** 每级扩编给每格人数上限加多少 */
export const CREW_BONUS = 2;

export interface Party {
  at: Axial;
  moves: number;
  people: number;
  /**
   * 这一回合开始时站在化了冻的浅滩上。为真时这一回合可以继续涉入别的浅滩
   * （只限浅滩，深海和山都不行）；为假时浅滩照旧进不去。
   *
   * 判断"是在往岸上走还是往深处走"交给玩家，游戏不替他判 —— 每回合结束时
   * 还泡在水里就要付代价（见 endTurn），这个代价负责逼人尽快上岸。
   */
  stranded: boolean;
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
   * 装备：工具和全队一份的行装。**不放在 camp 里** —— 拔营时 camp 置 null，
   * 这些跟着队伍走。建筑在另一处：地图上的营地址（map.sites）。
   */
  works: Works;
  turn: number;
  stock: Stock;
  /** 上一回合的净收支，给 HUD 显示 */
  lastIncome: Stock;
  /** 上一回合各资源的缺口（正数表示差多少） */
  lastShortage: { food: number; wood: number };
  /**
   * 上一回合因为顶到储量上限而倒掉的量。必须显示出来 —— 不显示的话玩家
   * 只会看到"收支 +19 但存量没动"，以为是 bug。
   */
  lastWasted: Stock;
  /**
   * 上一回合结束时泡在化了冻的水里付出的代价，给界面提示用；没有就是 null。
   * 不进存档 —— 和 visible 一样是一次性的显示信息。
   */
  lastStranded: { people: number; stock: Stock } | null;
  /** 连续吃不上饭 / 烧不上火的回合数 */
  hardship: number;
  /** 人死光了 */
  over: boolean;

  /**
   * 排队等玩家做选择的事件 id。非空时回合推不动 —— 逐个选完才继续。
   *
   * 存 id 不存对象：事件表是代码，存档里只该留引用。
   * 是队列不是单个，因为一回合可以触发多个事件。
   */
  pendingEvents: string[];
  /**
   * 玩家拥有过的资源种类。HUD 只列这些 —— 六行资源在手机竖屏上放不下，
   * 而没找到铁矿之前一直摆着一行 0 也只是噪音。
   *
   * 存下来而不是用 stock > 0 现算：现算的话花光铁那一行就消失，
   * 下回采到又冒出来，HUD 行数会跳。
   */
  seenResources: ResourceId[];
  /** 已经触发过的 once 事件 */
  seenEvents: string[];
  /**
   * 事件判定用的随机数状态。**存进 state 而不是用 Math.random()** ——
   * 否则事件既不可复现也没法测，存档读回来之后接下来抽到什么也会变。
   */
  rngState: number;

  version: number;
}

export interface Works {
  /** 全队一份的装备，每种最多一件 */
  gear: GearId[];
  /** 各类工具的数量 */
  tools: Record<ToolId, number>;
}

const NO_STOCK: Stock = Object.freeze(
  Object.fromEntries(RESOURCE_IDS.map((r) => [r, 0])),
) as Stock;

/** 把一份可能缺字段的库存补齐。老存档里只有前三种 */
export function fillStock(partial: Partial<Stock> | undefined): Stock {
  return { ...NO_STOCK, ...partial };
}

export interface NewGameOptions {
  width?: number;
  height?: number;
  seed?: string | number;
}

export function createGame(opts: NewGameOptions = {}): GameState {
  const { width = 64, height = 44 } = opts;
  const seed =
    typeof opts.seed === 'string' ? seedFrom(opts.seed) : (opts.seed ?? Date.now() >>> 0);
  const map = generateMap({ width, height, seed, campRadius: CAMP_RADIUS });

  const state: GameState = {
    map,
    party: { at: { ...map.origin }, moves: PARTY_MOVES, people: START_PEOPLE, stranded: false },
    camp: null,
    works: { gear: [], tools: { ...NO_TOOLS } },
    turn: 1,
    stock: { ...NO_STOCK, food: 12, wood: 12 },
    // 开局只显示这三种：剩下的要等玩家真的采到才上 HUD
    seenResources: ['food', 'wood', 'stone'],
    lastIncome: { ...NO_STOCK },
    lastShortage: { food: 0, wood: 0 },
    lastWasted: { ...NO_STOCK },
    lastStranded: null,
    hardship: 0,
    over: false,
    pendingEvents: [],
    seenEvents: [],
    // 和地图种子错开，免得同一个种子下地形和事件的随机序列相关
    rngState: (seed ^ 0x2545f491) >>> 0,
    version: 0,
  };

  refreshVision(state);
  return state;
}

// ---------------------------------------------------------------- 视野

/** 夏天看得远一格 */
function seasonSight(state: GameState): number {
  return seasonAt(state.turn).id === 'summer' ? SUMMER_SIGHT_BONUS : 0;
}

/** 营地视野。了望塔（这处营地的）加一格，夏天再加一格 */
export function campSight(state: GameState): number {
  return CAMP_SIGHT + (hasBuilding(state, 'watchtower') ? 1 : 0) + seasonSight(state);
}

/** 站在哪看多远由脚下地形决定，但至少能看见隔壁 */
export function sightFrom(state: GameState, h: Axial): number {
  const tile = tileAt(state.map, h);
  return Math.max(1, tile ? TERRAIN[tile.terrain].sight : 1) + seasonSight(state);
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

  // 探查：看见只知道"那儿有东西"，走到采集半径之内才知道是什么。
  // 游荡时路过也算 —— 探查是"走到跟前"，不是"扎营"
  for (const h of range(state.party.at, workRadius(state))) {
    const tile = tileAt(state.map, h);
    if (!tile || tile.surveyed) continue;
    tile.surveyed = true;
    // 资源栏在**探查**时才加那一行，不是看见时 —— 看见时就加，等于把 ? 的答案
    // 直接写在了资源栏里
    if (tile.deposit) noteResource(state, DEPOSITS[tile.deposit].res);
  }
}

// ---------------------------------------------------------------- 移动

/**
 * 进入这一格要花多少行动力。null = 进不去。
 *
 * 季节在这里改地图的形状：冬天浅滩结冰能走，春天沼泽泛滥更难走。
 * 寻路、地格面板、可达范围全都读这一个函数，季节才不会在某一处漏算。
 */
export function stepCost(state: GameState, h: Axial): number | null {
  const tile = tileAt(state.map, h);
  if (!tile) return null;

  if (tile.terrain === 'shallow') {
    if (isWinter(state.turn)) return ICE_COST;
    // 化冻后困在水里：只能在浅滩之间涉水，深海和山照样进不去
    return state.party.stranded ? WADE_COST : null;
  }
  if (tile.terrain === 'marsh' && seasonAt(state.turn).id === 'spring') return SPRING_MARSH_COST;

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
  // 浅滩在地形表里本来就是不可通行的，所以冰面上也扎不了营 ——
  // 冬天能走上去，但化冻时营地会泡在水里
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
  // 回到一处营地址扎营就算来过；这处的建筑随之重新生效
  const site = currentSite(state);
  if (site) site.lastVisit = state.turn;
  refreshVision(state);
  state.version += 1;
  return true;
}

/**
 * 拔营会扔掉多少东西。
 *
 * 仓库是建筑，留在营地址上；拔营后储量上限回到"基础 + 储藏瓮"，放不下的
 * 就得扔。界面先拿这个问玩家一句，确认了再调 breakCamp。
 */
export function breakCampLoss(state: GameState): Stock {
  const loss: Stock = { ...NO_STOCK };
  if (!state.camp) return loss;
  const after = STOCK_BASE_CAP + (hasGear(state, 'jars') ? JARS_CAP_BONUS : 0);
  for (const res of RESOURCE_IDS) loss[res] = Math.max(0, state.stock[res] - after);
  return loss;
}

/**
 * 拔营。人全部收回队伍，同样吃掉当回合剩余行动力。
 * 建筑不动 —— 它们在营地址上，营地只是不再指着那里。
 */
export function breakCamp(state: GameState): boolean {
  if (!state.camp || state.over) return false;

  state.camp = null;
  state.party.moves = 0;
  // 仓库留下了，储量上限随之降低；倒掉的量记进 lastWasted，HUD 上看得见
  const wasted = clampToCap(state);
  for (const res of RESOURCE_IDS) state.lastWasted[res] += wasted[res];
  refreshVision(state);
  state.version += 1;
  return true;
}

// ---------------------------------------------------------------- 派工

/** 一块地有没有东西可采。要把矿脉算进去 —— 光秃地形不产也可能底下有矿 */
export function workable(tile: { terrain: TerrainId; deposit: DepositId | null }): boolean {
  return Object.keys(yieldsOf(tile.terrain, tile.deposit)).length > 0;
}

/**
 * 采集半径，同时也是**探查半径**。
 *
 * 两者必须是同一个数：这样"派不了人去一块没探查过的地"由几何保证，
 * 不需要任何额外检查 —— 能派工的格子一定在营地旁边，营地就是队伍所在，
 * 而队伍旁边这一圈在 refreshVision 里已经探查过了。有测试盯着这条。
 * 以后扩大半径的设施只改这里，两件事一起变。
 */
export function workRadius(state: GameState): number {
  return CAMP_RADIUS + (hasBuilding(state, 'outskirts') ? 1 : 0);
}

/** 当前每格最多派几个人。以后的扩编设施往这里加，但永远不超过 MAX_CREW_PER_TILE */
export function crewCap(state: GameState): number {
  const bonus =
    (hasBuilding(state, 'crew1') ? CREW_BONUS : 0) + (hasBuilding(state, 'crew2') ? CREW_BONUS : 0);
  return Math.min(MAX_CREW_PER_TILE, BASE_CREW_CAP + bonus);
}

/** 营地周围能派人干活的格子。浅滩和山地进不去但能采，所以看的是产出不是通行 */
export function workableTiles(state: GameState): Axial[] {
  if (!state.camp) return [];
  const r = workRadius(state);
  return range(state.camp.at, r).filter((h) => {
    if (equals(h, state.camp!.at)) return false;
    const tile = tileAt(state.map, h);
    return tile != null && workable(tile);
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
  if (!tile || !workable(tile)) return 'notWorkable';
  const d = distance(state.camp.at, h);
  if (d < 1 || d > workRadius(state)) return 'notWorkable';

  if (idleCount(state) <= 0) return 'noIdle';
  if (crewAt(state, h) >= crewCap(state)) return 'tileFull';
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

/**
 * 把超过每格上限的人撤下来，按部署顺序从后往前撤 —— 和死了人时的 trimCrew
 * 一个口径：后来的先走，先部署的保住位置和手里的工具。
 *
 * 正常游戏里上限只升不降，用不上它；它是给读档用的：上限从 5 降到 2 之前的
 * 老存档里，一格可能站着四五个人。
 */
export function enforceCrewCap(state: GameState): void {
  if (!state.camp) return;
  const cap = crewCap(state);
  const r = workRadius(state);
  const at = state.camp.at;
  for (let i = state.camp.order.length - 1; i >= 0; i -= 1) {
    const k = state.camp.order[i];
    const n = state.camp.crew[k] ?? 0;
    // 拆了外围营地，半径缩回去了：圈外的人一并撤回
    const outside = distance(at, parseKey(k)) > r;
    if (n <= cap && !outside) continue;
    state.camp.order.splice(i, 1);
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

    // 只看主产资源：森林产 1 点食物，但它是木头地，骨锄在那儿不该算数。
    // 连矿脉一起算 —— 铁矿脉在丘陵上是石 4 + 铁 3，主产仍是石，铁镐吃得上
    const primary = primaryOf(yieldsOf(tile.terrain, tile.deposit));
    const id = TOOL_PRIORITY.find(
      (t) => left[t] > 0 && TOOLS[t].boosts.some((r) => primary.includes(r)),
    );
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

// ---------------------------------------------------------------- 营地址与建筑

/** 某一格上的营地址，没有就是 null */
export function siteAt(state: GameState, h: Axial): Site | null {
  return state.map.sites.find((s) => equals(s.at, h)) ?? null;
}

/**
 * 当前营地所在的营地址。营地和营地址靠**位置**相认，不存指针 ——
 * 营地址可能倒塌、被拆光，存下来的引用会过期，位置不会。
 */
export function currentSite(state: GameState): Site | null {
  return state.camp ? siteAt(state, state.camp.at) : null;
}

/** 当前营地有没有这座建筑。不在营地里就什么建筑都用不上 */
export function hasBuilding(state: GameState, id: BuildingId): boolean {
  return currentSite(state)?.buildings.includes(id) ?? false;
}

export function hasGear(state: GameState, id: GearId): boolean {
  return state.works.gear.includes(id);
}

/** 这处营地址一共几个槽位 */
export function slotCapacity(site: Site | null): number {
  return site?.buildings.includes('expansion') ? EXPANDED_SLOTS : BASE_SLOTS;
}

/** 已经占用的槽位。不占槽位的建筑（营地扩建、扩编）不算 */
export function slotsUsed(site: Site | null): number {
  return site ? site.buildings.filter((b) => BUILDINGS[b].slot).length : 0;
}

export type BuildBlocker =
  | 'noCamp'
  | 'built'
  | 'requires'
  | 'slots'
  | 'siteLimit'
  | 'cost'
  | null;

export function buildBlocker(state: GameState, id: BuildingId): BuildBlocker {
  // 造东西要有个地方摆，所以必须先扎营
  if (!state.camp || state.over) return 'noCamp';
  const site = currentSite(state);
  const b = BUILDINGS[id];

  if (site?.buildings.includes(id)) return 'built';
  if (b.requires && !site?.buildings.includes(b.requires)) return 'requires';
  if (b.slot && slotsUsed(site) >= slotCapacity(site)) return 'slots';
  // 在新地点造第一座，会生成一处新的营地址
  if (!site && state.map.sites.length >= MAX_SITES) return 'siteLimit';
  if (!canAfford(state.stock, b.cost)) return 'cost';
  return null;
}

export function buildBuilding(state: GameState, id: BuildingId): boolean {
  if (buildBlocker(state, id) != null) return false;

  payCost(state.stock, BUILDINGS[id].cost);
  let site = currentSite(state);
  if (!site) {
    // 营地址从第一座建筑开始存在
    site = { at: { ...state.camp!.at }, buildings: [], lastVisit: state.turn };
    state.map.sites.push(site);
  }
  site.buildings.push(id);
  // 了望塔改视野、外围营地改半径（也就改了探查范围）
  refreshVision(state);
  state.version += 1;
  return true;
}

export type DemolishBlocker = 'noCamp' | 'notBuilt' | 'needed' | null;

/**
 * 能不能拆。**被别的建筑依赖的不能拆**：扩编（二）还在，扩编就不能拆；
 * 后三个槽位还有建筑，营地扩建就不能拆 —— 拆了那几座就没槽位放了。
 */
export function demolishBlocker(state: GameState, id: BuildingId): DemolishBlocker {
  if (!state.camp || state.over) return 'noCamp';
  const site = currentSite(state);
  if (!site?.buildings.includes(id)) return 'notBuilt';

  if (site.buildings.some((b) => BUILDINGS[b].requires === id)) return 'needed';
  if (id === 'expansion' && slotsUsed(site) > BASE_SLOTS) return 'needed';
  return null;
}

/** 拆除返还多少：造价的一半，向下取整 */
export function demolishRefund(id: BuildingId): Cost {
  const out: Cost = {};
  for (const [res, n] of Object.entries(BUILDINGS[id].cost)) {
    const back = Math.floor((n as number) * DEMOLISH_REFUND);
    if (back > 0) out[res as ResourceId] = back;
  }
  return out;
}

export function demolish(state: GameState, id: BuildingId): boolean {
  if (demolishBlocker(state, id) != null) return false;

  const site = currentSite(state)!;
  site.buildings = site.buildings.filter((b) => b !== id);
  // 建筑拆光了，这里就不再是营地址
  if (!site.buildings.length) state.map.sites = state.map.sites.filter((s) => s !== site);

  for (const [res, n] of Object.entries(demolishRefund(id))) {
    state.stock[res as ResourceId] += n as number;
  }
  // 返还也是入库，一样过储量上限 —— 拆了仓库，上限本身也降了
  const wasted = clampToCap(state);
  for (const res of RESOURCE_IDS) state.lastWasted[res] += wasted[res];

  // 拆了扩编或外围营地，人数上限或半径会变小
  enforceCrewCap(state);
  refreshVision(state);
  state.version += 1;
  return true;
}

// ---------------------------------------------------------------- 装备

export type CraftBlocker = 'locked' | 'noCamp' | 'owned' | 'cost' | null;

/** 制作要有工棚 —— 而且是**这处营地**的工棚。做好的装备走到哪都能用 */
function craftGate(state: GameState): CraftBlocker {
  if (!state.camp || state.over) return 'noCamp';
  if (!hasBuilding(state, 'workshop')) return 'locked';
  return null;
}

export function craftBlocker(state: GameState, id: ToolId): CraftBlocker {
  const gate = craftGate(state);
  if (gate) return gate;
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

export function gearBlocker(state: GameState, id: GearId): CraftBlocker {
  const gate = craftGate(state);
  if (gate) return gate;
  if (hasGear(state, id)) return 'owned';
  if (!canAfford(state.stock, GEAR[id].cost)) return 'cost';
  return null;
}

export function craftGear(state: GameState, id: GearId): boolean {
  if (gearBlocker(state, id) != null) return false;

  payCost(state.stock, GEAR[id].cost);
  state.works.gear.push(id);
  state.version += 1;
  return true;
}

// ---------------------------------------------------------------- 回合

/** 这一回合要吃多少食物。仓库（这处营地的）省下的是总量里的一份，不是每人一份 */
export function foodUpkeep(state: GameState): number {
  const stored = hasBuilding(state, 'store') ? 1 : 0;
  return Math.max(0, state.party.people * UPKEEP_FOOD_PER_PERSON - stored);
}

/** 这一回合篝火烧多少柴。冬天翻倍 —— 和人数无关这一点不变 */
export function woodUpkeep(state: GameState): number {
  return UPKEEP_WOOD_PER_TURN * (isWinter(state.turn) ? WINTER_WOOD_FACTOR : 1);
}

/** 站在化了冻的浅滩上：冬天以外的浅滩都算 */
function onThawedWater(state: GameState): boolean {
  const tile = tileAt(state.map, state.party.at);
  return tile?.terrain === 'shallow' && !isWinter(state.turn);
}

/** 泡在水里每回合付的代价：0–2 人，每样东西 10%–30%（向上取整） */
export const STRANDED_PEOPLE_MAX = 2;
export const STRANDED_LOSS_MIN = 0.1;
export const STRANDED_LOSS_MAX = 0.3;

/**
 * 结算泡在水里的代价。用 state.rngState 抽，读档后结果可以复现。
 *
 * 小队伍更容易被这一下打垮，这是有意的：3 个人拖 3 回合，全灭的概率
 * 大约六成。代价存进 lastStranded 给界面提示。
 */
function strandedPenalty(state: GameState): void {
  const roll = () => {
    const r = step(state.rngState);
    state.rngState = r.next;
    return r.value;
  };

  const people = Math.min(state.party.people, Math.floor(roll() * (STRANDED_PEOPLE_MAX + 1)));
  const share = STRANDED_LOSS_MIN + roll() * (STRANDED_LOSS_MAX - STRANDED_LOSS_MIN);
  const lost: Stock = { ...NO_STOCK };
  for (const res of RESOURCE_IDS) {
    // 只扣手里有的。这一回合要是已经缺粮，库存此刻是负的 —— 对负数取比例
    // 再向上取整会得到负的"损失"，等于把缺口补平、把这次饥荒抹掉
    const have = state.stock[res];
    lost[res] = have > 0 ? Math.min(have, Math.ceil(have * share)) : 0;
    state.stock[res] -= lost[res];
  }
  state.party.people -= people;
  state.lastStranded = { people, stock: lost };
}

export function endTurn(state: GameState): void {
  if (state.over) return;
  // 还有事件等着做选择就推不动回合。UI 那边弹窗盖住了，这里是兜底 ——
  // 键盘快捷键和以后的自动化都会绕过界面
  if (state.pendingEvents.length) return;

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
        for (const [res, amount] of Object.entries(yieldsOf(tile.terrain, tile.deposit))) {
          income[res as ResourceId] += amount * times;
        }
      }
    }
  }

  // 消耗：吃饭按人头，烧柴按营火 —— 口径不同，别合并成一行
  income.food -= foodUpkeep(state);
  income.wood -= woodUpkeep(state);

  for (const res of RESOURCE_IDS) state.stock[res] += income[res];

  // 顶到上限的部分倒掉，但要记下来给 HUD 显示
  state.lastWasted = clampToCap(state);

  // 回合结束时还泡在化了冻的水里：丢人又丢货。回合一开始就上岸的不受罚
  state.lastStranded = null;
  if (onThawedWater(state)) strandedPenalty(state);

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
    // 只有日子过得下去的回合才添丁，而且只在春天
    const season = seasonAt(state.turn);
    if (season.id === 'spring' && season.day % SPRING_GROWTH_EVERY === 0) state.party.people += 1;
  }

  if (state.party.people <= 0) state.over = true;
  trimCrew(state);

  // 扎营期间每回合都算来过，所以有人住着的营地址永远不会倒塌
  const site = currentSite(state);
  if (site) site.lastVisit = state.turn;
  // 太久没人来的营地址直接消失，不提醒
  state.map.sites = state.map.sites.filter((x) => state.turn - x.lastVisit < SITE_LIFETIME);

  state.lastIncome = income;
  state.party.moves = partyMoves(state);
  state.turn += 1;
  // 换季可能刚好化冻：新回合一开始就站在水里，这一回合允许涉水
  state.party.stranded = onThawedWater(state);
  // 季节变了，视野（夏天）和冰面都跟着变
  refreshVision(state);
  noteResources(state);

  // 放在 turn += 1 之后：条件里写的 turn 指的是即将开始的那一回合
  rollEvent(state);

  state.version += 1;
}

// ---------------------------------------------------------------- 事件

/** 事件判定要看的那几个数。加新 metric 要同时改这里和 events.ts 的类型 */
export function metrics(state: GameState): Snapshot {
  return {
    turn: state.turn,
    people: state.party.people,
    camped: state.camp ? 1 : 0,
    /*
     * 游荡时算 0，不算"全员闲置"。idleCount 是"人数 − 已派工"，而游荡时
     * 没有营地、派工恒为 0 —— 直接用它的话所有人永远算闲着，"闲人要走"
     * 这类事件从第 2 回合就开始触发。游荡不是闲着，是在赶路。
     */
    idle: state.camp ? idleCount(state) : 0,
    /** 0..3，春夏秋冬 */
    season: seasonAt(state.turn).index,
    food: state.stock.food,
    wood: state.stock.wood,
    stone: state.stock.stone,
    clay: state.stock.clay,
    hide: state.stock.hide,
    iron: state.stock.iron,
  };
}

/**
 * 刚刚到手的新资源计进 HUD。只增不减 —— 花光了也要留着那一行，
 * 否则行数会跟着库存跳，每次都把下面的东西顶得挪一下。
 */
function noteResources(state: GameState): void {
  for (const res of RESOURCE_IDS) {
    if (state.stock[res] > 0) noteResource(state, res);
  }
}

/**
 * 认识一种资源。只增不减，重复调用无害 —— 视野重算每回合都会把
 * 视野里的矿脉再过一遍。这个数组里的顺序不重要：布局是拿
 * RESOURCE_ORDER 去 filter 它，按表序画。
 */
function noteResource(state: GameState, res: ResourceId): void {
  if (!state.seenResources.includes(res)) state.seenResources.push(res);
}

/**
 * 抽这一回合的事件，命中几个就排几个。
 *
 * 按事件表的顺序逐个判定，每个够格的事件各掷一次骰子、彼此独立，
 * 命中的按表序进队列 —— **表的顺序就是弹出顺序**。
 *
 * 触发条件全部用回合结算完那一刻的同一份快照来判，队列一旦排好就不再变。
 * 换成"每选完一个重新判一次"的话，玩家选了 A 之后 B 可能凭空消失，
 * 那种事在界面上完全解释不了。选项的 require 是另一回事，那个实时判 ——
 * 见 choiceAllowed。
 */
function rollEvent(state: GameState): void {
  if (state.over) return;

  const snap = metrics(state);
  for (const ev of EVENTS) {
    if (ev.once && state.seenEvents.includes(ev.id)) continue;

    const chance = chanceOf(snap, ev.trigger);
    if (chance <= 0) continue;

    const roll = step(state.rngState);
    state.rngState = roll.next;

    if (roll.value < chance) {
      state.pendingEvents.push(ev.id);
      if (ev.once) state.seenEvents.push(ev.id);
    }
  }
}

/** 队首那个事件。存档里存的是 id，这里还原成对象 */
export function currentEvent(state: GameState): GameEvent | null {
  const id = state.pendingEvents[0];
  return id ? (findEvent(id) ?? null) : null;
}

/** 还有几个事件等着（含当前这个）。多于一个时界面上要提示还有后续 */
export function pendingCount(state: GameState): number {
  return state.pendingEvents.length;
}

/** 这个选择现在能不能选。不能选的在界面上置灰，不是藏起来 —— 玩家要看得见代价 */
export function choiceAllowed(state: GameState, choice: Choice): boolean {
  return meetsAll(metrics(state), choice.require);
}

/** 做出选择：结算效果、关掉事件。返回是否真的选上了 */
export function chooseEvent(state: GameState, index: number): boolean {
  const ev = currentEvent(state);
  if (!ev) return false;

  const choice = ev.choices[index];
  if (!choice || !choiceAllowed(state, choice)) return false;

  applyEffect(state, choice.effect);
  // 只出队这一个，后面的接着弹
  state.pendingEvents.shift();
  state.version += 1;
  return true;
}

/**
 * 结算一个效果。资源和人数都夹在 0 以上 —— 事件表里写 -10 食物时，
 * 作者想的是"扣掉十份粮"，不是"允许欠债"。
 */
/** 当前每种资源的储量上限。以后要按资源分别设，改这一处 */
export function stockCap(state: GameState): number {
  return (
    STOCK_BASE_CAP +
    (hasBuilding(state, 'store') ? STORE_CAP_BONUS : 0) +
    (hasGear(state, 'jars') ? JARS_CAP_BONUS : 0)
  );
}

/** 这一回合的行动力上限。背架把它抬高一点 —— 往外迁徙的唯一加速器 */
export function partyMoves(state: GameState): number {
  return PARTY_MOVES + (hasGear(state, 'packs') ? PACKS_MOVE_BONUS : 0);
}

/**
 * 把库存夹进 0..上限，返回各资源被倒掉的量。
 *
 * **所有让库存增加的路径都要过这里** —— 回合结算、事件奖励，以后的任务奖励。
 * 漏掉一条，那条路径就能绕过上限，而绕过去的东西在界面上完全看不出来。
 */
function clampToCap(state: GameState): Stock {
  const cap = stockCap(state);
  const wasted: Stock = { ...NO_STOCK };

  for (const res of Object.keys(state.stock) as ResourceId[]) {
    const over = state.stock[res] - cap;
    if (over > 0) {
      wasted[res] = over;
      state.stock[res] = cap;
    }
  }
  return wasted;
}

/**
 * 按当前存量取一个比例，返回增减量。
 *
 * 只要还有东西可拿就至少拿走 1 —— 四舍五入到 0 会让"扣三成存粮"在存粮
 * 只剩 2 的时候变成什么也没发生，那是最让人困惑的一种"生效了但没效果"。
 */
function byPercent(current: number, pct: number): number {
  if (!pct || current <= 0) return 0;
  const raw = Math.round(current * pct);
  return raw !== 0 ? raw : Math.sign(pct);
}

function applyEffect(state: GameState, effect: Choice['effect']): void {
  // 比例部分先按**改动前**的存量算好，否则绝对项扣完会改变比例项的基数
  const pctDelta: Partial<Record<ResourceId, number>> = {};
  for (const [res, pct] of Object.entries(effect.stockPct ?? {})) {
    pctDelta[res as ResourceId] = byPercent(state.stock[res as ResourceId], pct);
  }

  for (const [res, n] of Object.entries(effect.stock ?? {})) {
    state.stock[res as ResourceId] = Math.max(0, state.stock[res as ResourceId] + n);
  }
  for (const [res, n] of Object.entries(pctDelta)) {
    state.stock[res as ResourceId] = Math.max(0, state.stock[res as ResourceId] + n);
  }

  // 事件也会给资源，一样要夹上限
  const wasted = clampToCap(state);
  for (const res of Object.keys(wasted) as ResourceId[]) state.lastWasted[res] += wasted[res];

  for (const [id, n] of Object.entries(effect.tools ?? {})) {
    const key = id as keyof GameState['works']['tools'];
    state.works.tools[key] = Math.max(0, state.works.tools[key] + n);
  }

  const peopleDelta = (effect.people ?? 0) + byPercent(state.party.people, effect.peoplePct ?? 0);

  if (peopleDelta) {
    state.party.people = Math.max(0, state.party.people + peopleDelta);
    // 人少了派工可能超编，和饿死减员走同一条收尾
    trimCrew(state);
    if (state.party.people <= 0) state.over = true;
  }
}

/** 存档 / 撤销用。状态是纯数据，深拷贝就够 */
export function snapshot(state: GameState): GameState {
  return structuredClone(state);
}
