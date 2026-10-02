/**
 * 数值体检。把"资源获取合不合理"拆成五个能算出数的问题：
 *
 *   npm run balance            全部五节
 *   npm run balance -- 3       只跑第 3 节
 *
 *   1  单人产出与劳力价格   一个人一回合能产多少，每样资源折合多少"人·回合"
 *   2  投资回收期           每件工具/设施要几回合才把自己的造价挣回来
 *   3  开局承载力           开局那一圈地按不同的每格上限最多养活多少人
 *   4  迁徙半径             带着满仓补给，一口气能走多远
 *   5  前期蒙特卡洛         在开局营地原地发展 60 回合，事件照常触发
 *
 * 核心思路是**把劳力当通用货币**：所有资源最终都是人花回合采出来的，
 * 折算成"人·回合"之后，木头、石头、铁器就能放在同一把尺子上比较。
 *
 * 注意第 1、2、4 节是解析算法，用的是平均产出（一人一回合 = 半次结算），
 * 不是离散的进度条。第 5 节才是真跑规则代码。
 */
import { distance, key, reachable } from '../src/game/core/hex.ts';
import { tileAt } from '../src/game/core/map.ts';
import { TERRAIN, type ResourceId, type TerrainId, primaryYields } from '../src/game/core/terrain.ts';
import { DEPOSITS } from '../src/game/core/deposits.ts';
import {
  BUILDINGS,
  GEAR,
  TOOLS,
  type BuildingId,
  type Cost,
  type GearId,
  type ToolId,
} from '../src/game/core/works.ts';
import { EVENTS } from '../src/game/core/events.ts';
import {
  HARVEST_GOAL,
  PACKS_MOVE_BONUS,
  PARTY_MOVES,
  STOCK_BASE_CAP,
  JARS_CAP_BONUS,
  UPKEEP_FOOD_PER_PERSON,
  UPKEEP_WOOD_PER_TURN,
  WORK_PER_PERSON,
  type GameState,
  buildBuilding,
  choiceAllowed,
  chooseEvent,
  craftTool,
  createGame,
  crewAt,
  currentEvent,
  endTurn,
  foodUpkeep,
  hasBuilding,
  woodUpkeep,
  idleCount,
  makeCamp,
  stepCost,
  stockCap,
  toolAllocation,
  unassign,
  workRateAt,
  workableTiles,
} from '../src/game/core/state.ts';
import { yieldsOf } from '../src/game/core/deposits.ts';

const only = process.argv[2] ? Number(process.argv[2]) : null;
const SEEDS = Array.from({ length: 40 }, (_, i) => `bal${i}`);

const pad = (s: string | number, n: number) => String(s).padStart(n);
const fix = (n: number, d = 1) => (Number.isFinite(n) ? n.toFixed(d) : '—');
const median = (xs: number[]) => {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
};
const pct = (xs: number[], p: number) => {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(p * s.length))];
};
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);

function section(n: number, title: string): boolean {
  if (only != null && only !== n) return false;
  console.log(`\n${'═'.repeat(72)}\n ${n}  ${title}\n${'═'.repeat(72)}`);
  return true;
}

/** 某地形上一个人一回合的平均产出。gear = 每人额外推进量（0 / 10 / 20） */
function perWorker(terrain: TerrainId, gear = 0, deposit: keyof typeof DEPOSITS | null = null) {
  const y = yieldsOf(terrain, deposit);
  const primary = primaryYields(terrain);
  const out: Partial<Record<ResourceId, number>> = {};
  for (const [r, n] of Object.entries(y) as [ResourceId, number][]) {
    // 工具只给主产加速 —— 但进度条是整块推进的，加速后副产也一起多出来
    const bars = (WORK_PER_PERSON + (primary.length ? gear : 0)) / HARVEST_GOAL;
    out[r] = n * bars;
  }
  return out;
}

// ---------------------------------------------------------------- 劳力价格

/**
 * 每样资源折合多少人·回合。取**常见的那种主产地形**，不取最好的 ——
 * 浅滩产粮更高，但只在海边有，拿它定价会让食物看起来比实际便宜。
 *
 * 矿脉资源是联产品：铁矿上的人同时采到石和铁。这里把整个人·回合都记在
 * 矿产头上，所以是**上限**；实际上那份石料也有用，真实价格更低。
 */
const PRICE: Record<ResourceId, number> = {
  food: 1 / perWorker('grass').food!,
  wood: 1 / perWorker('forest').wood!,
  stone: 1 / perWorker('hills').stone!,
  clay: 1 / perWorker('grass', 0, 'clay').clay!,
  hide: 1 / perWorker('forest', 0, 'game').hide!,
  iron: 1 / perWorker('hills', 0, 'iron').iron!,
};

const costInWT = (c: Cost) =>
  Object.entries(c).reduce((s, [r, n]) => s + (n as number) * PRICE[r as ResourceId], 0);

if (section(1, '单人产出与劳力价格')) {
  console.log('\n一个人一回合的平均产出（徒手 / 石器 +10 / 铁器 +20）\n');
  console.log(`${pad('地形', 8)} │ ${pad('徒手', 18)} │ ${pad('石器', 18)} │ ${pad('铁器', 18)}`);
  console.log('─'.repeat(72));
  const fmt = (o: Partial<Record<ResourceId, number>>) =>
    Object.entries(o)
      .map(([r, n]) => `${fix(n as number)}${r[0]}`)
      .join(' ') || '—';
  for (const id of Object.keys(TERRAIN) as TerrainId[]) {
    if (!Object.keys(TERRAIN[id].yields).length) continue;
    console.log(
      `${pad(TERRAIN[id].label.zh, 8)} │ ${pad(fmt(perWorker(id)), 18)} │ ` +
        `${pad(fmt(perWorker(id, 10)), 18)} │ ${pad(fmt(perWorker(id, 20)), 18)}`,
    );
  }

  console.log('\n劳力价格：采一单位要花多少人·回合（越小越便宜）\n');
  for (const [r, p] of Object.entries(PRICE)) {
    const note = ['clay', 'hide', 'iron'].includes(r) ? '  （联产品，按上限计）' : '';
    console.log(`  ${pad(r, 6)}  ${fix(p, 2)}${note}`);
  }

  const N = 3;
  console.log(
    `\n供养比：一个草原农夫产 ${fix(perWorker('grass').food!)} 食，吃 ${UPKEEP_FOOD_PER_PERSON}` +
      ` —— 每 ${fix(perWorker('grass').food! / UPKEEP_FOOD_PER_PERSON, 0)} 个人里要有 1 个种地，一半劳力要去产粮。` +
      `\n篝火一回合烧 ${UPKEEP_WOOD_PER_TURN} 木，折合 ${fix(UPKEEP_WOOD_PER_TURN * PRICE.wood, 2)} 个人的全职。` +
      `\n所以 ${N} 人队伍的闲余劳力 = ${N} − ${N}×${fix(PRICE.food, 2)} − ${fix(PRICE.wood, 2)} = ` +
      `${fix(N - N * PRICE.food - UPKEEP_WOOD_PER_TURN * PRICE.wood, 2)} 人`,
  );
}

// ---------------------------------------------------------------- 回收期

if (section(2, '投资回收期')) {
  /**
   * 每回合收益，也折成人·回合。工具按"装在主产对口的那个人手上"算：
   * 石器多推 10 点 = 多 0.25 次结算，铁器多 0.5 次。
   */
  type Id = ToolId | BuildingId | GearId;
  const gain: Partial<Record<Id, { wt: number; note: string }>> = {
    hoe: { wt: (perWorker('grass', 10).food! - perWorker('grass').food!) * PRICE.food, note: '草原农夫 +1 食' },
    axe: { wt: (perWorker('forest', 10).wood! - perWorker('forest').wood!) * PRICE.wood, note: '森林樵夫 +1.25 木' },
    ironHoe: { wt: (perWorker('grass', 20).food! - perWorker('grass').food!) * PRICE.food, note: '草原农夫 +2 食' },
    ironAxe: { wt: (perWorker('forest', 20).wood! - perWorker('forest').wood!) * PRICE.wood, note: '森林樵夫 +2.5 木' },
    pick: { wt: (perWorker('hills', 20).stone! - perWorker('hills').stone!) * PRICE.stone, note: '丘陵石匠 +2 石' },
    store: { wt: 1 * PRICE.food, note: '每回合少吃 1 食，另加 +40 储量' },
    workshop: { wt: 0, note: '不直接产出，是制作的前置' },
    watchtower: { wt: 0, note: '只加视野' },
    expansion: { wt: 0, note: '槽位 3 → 6' },
    crew1: { wt: 0, note: '每格上限 +2：价值看工位是否吃紧（见第 3 节）' },
    crew2: { wt: 0, note: '每格上限再 +2' },
    outskirts: { wt: 0, note: '半径 +1：作业格 6 → 18' },
    jars: { wt: 0, note: '只加储量 —— 价值在迁徙半径（见第 4 节）' },
    packs: { wt: 0, note: '只加行动力 —— 价值在迁徙半径（见第 4 节）' },
  };

  console.log(`\n${pad('项目', 10)} │ ${pad('造价(人·回合)', 13)} │ ${pad('每回合回报', 10)} │ ${pad('回收期', 8)} │ 说明`);
  console.log('─'.repeat(80));
  const rows: [string, Cost, Id][] = [
    ...(Object.keys(BUILDINGS) as BuildingId[]).map((id) => [BUILDINGS[id].label.zh, BUILDINGS[id].cost, id] as [string, Cost, Id]),
    ...(Object.keys(GEAR) as GearId[]).map((id) => [GEAR[id].label.zh, GEAR[id].cost, id] as [string, Cost, Id]),
    ...(Object.keys(TOOLS) as ToolId[]).map((id) => [TOOLS[id].label.zh, TOOLS[id].cost, id] as [string, Cost, Id]),
  ];
  for (const [label, cost, id] of rows) {
    const c = costInWT(cost);
    const g = gain[id]!;
    const back = g.wt > 0 ? c / g.wt : Infinity;
    console.log(
      `${pad(label, 10)} │ ${pad(fix(c), 13)} │ ${pad(g.wt ? fix(g.wt, 2) : '—', 10)} │ ` +
        `${pad(Number.isFinite(back) ? `${fix(back)} 回合` : '—', 8)} │ ${g.note}`,
    );
  }
  const shed = costInWT(BUILDINGS.workshop.cost);
  console.log(
    `\n工棚 ${fix(shed)} 人·回合是一次性门槛：只造 1 把骨锄的话，骨锄的实际回收期是 ` +
      `${fix((shed + costInWT(TOOLS.hoe.cost)) / gain.hoe!.wt)} 回合；造到 4 把才摊薄到 ` +
      `${fix((shed + 4 * costInWT(TOOLS.hoe.cost)) / (4 * gain.hoe!.wt))} 回合。`,
  );
}

// ---------------------------------------------------------------- 承载力

/**
 * 一圈地最多养活多少人：先派够烧柴的人，剩下的人按产粮从高到低填格子，
 * 每格不超过 cap。食物够吃就算养得活。gear = 每人工具加成。
 *
 * 这是**上界**：假设人人都在最优位置、工具人手一把、没有事件。
 */
function carrying(ring: TerrainId[], cap: number, gear: number): { K: number; freeAt: (n: number) => number } {
  const plan = (N: number) => {
    const slots = ring.map((t) => ({ t, used: 0 }));
    let wood = 0;
    let food = 0;
    let left = N;
    // 柴：挑产柴最多的格子
    const woodTiles = [...slots].sort((a, b) => (perWorker(b.t, gear).wood ?? 0) - (perWorker(a.t, gear).wood ?? 0));
    for (const s of woodTiles) {
      const w = perWorker(s.t, gear);
      if (!w.wood) break;
      while (wood < UPKEEP_WOOD_PER_TURN && s.used < cap && left > 0) {
        s.used += 1;
        left -= 1;
        wood += w.wood;
        food += w.food ?? 0;
      }
    }
    if (wood < UPKEEP_WOOD_PER_TURN) return { ok: false, free: 0 };
    const foodTiles = [...slots].sort((a, b) => (perWorker(b.t, gear).food ?? 0) - (perWorker(a.t, gear).food ?? 0));
    for (const s of foodTiles) {
      const f = perWorker(s.t, gear).food ?? 0;
      if (!f) break;
      while (food < N * UPKEEP_FOOD_PER_PERSON && s.used < cap && left > 0) {
        s.used += 1;
        left -= 1;
        food += f;
      }
    }
    return { ok: food >= N * UPKEEP_FOOD_PER_PERSON, free: left };
  };
  let K = 0;
  for (let N = 1; N <= 6 * cap + 30; N += 1) {
    if (plan(N).ok) K = N;
  }
  return { K, freeAt: (n) => (plan(n).ok ? plan(n).free : -1) };
}

function startRing(seed: string): TerrainId[] {
  const g = createGame({ seed });
  makeCamp(g);
  return workableTiles(g).map((h) => tileAt(g.map, h)!.terrain);
}

if (section(3, '开局承载力（40 个种子的开局作业圈）')) {
  const rings = SEEDS.map(startRing);
  const CAPS = [2, 3, 4, 5, 6];

  console.log('\n承载上限 K：这一圈地最多养活几个人（中位数 / 最差的 10%）\n');
  console.log(`${pad('每格上限', 8)} │ ${pad('徒手', 12)} │ ${pad('石器人手一把', 14)} │ ${pad('铁器人手一把', 14)} │ ${pad('工位', 4)}`);
  console.log('─'.repeat(66));
  for (const cap of CAPS) {
    const cell = (gear: number) => {
      const ks = rings.map((r) => carrying(r, cap, gear).K);
      return `${median(ks)} / ${pct(ks, 0.1)}`;
    };
    console.log(`${pad(cap, 8)} │ ${pad(cell(0), 12)} │ ${pad(cell(10), 14)} │ ${pad(cell(20), 14)} │ ${pad(rings[0].length * cap, 4)}`);
  }

  console.log('\n闲余劳力：温饱之外还能腾出几个人去采石（徒手，中位数）\n');
  console.log(`${pad('每格上限', 8)} │ ${[3, 6, 9, 12, 15].map((n) => pad(`${n}人`, 6)).join(' │ ')}`);
  console.log('─'.repeat(56));
  for (const cap of CAPS) {
    console.log(
      `${pad(cap, 8)} │ ` +
        [3, 6, 9, 12, 15]
          .map((n) => {
            const fs = rings.map((r) => carrying(r, cap, 0).freeAt(n));
            const m = median(fs);
            return pad(m < 0 ? '养不活' : m, 6);
          })
          .join(' │ '),
    );
  }

  const withStone = rings.filter((r) => r.some((t) => (TERRAIN[t].yields.stone ?? 0) > 0)).length;
  console.log(
    `
开局作业圈里有石料可采的：${withStone} / ${rings.length}。` +
      `剩下的那些，不搬家就连工棚都造不了（要 ${BUILDINGS.workshop.cost.stone} 石）。`,
  );

  const kinds = new Map<string, number>();
  for (const r of rings) for (const t of r) kinds.set(t, (kinds.get(t) ?? 0) + 1);
  console.log(
    '\n开局作业圈的地形构成（40 圈合计）：' +
      [...kinds.entries()].sort((a, b) => b[1] - a[1]).map(([t, n]) => `${TERRAIN[t as TerrainId].label.zh} ${n}`).join('  '),
  );
}

// ---------------------------------------------------------------- 迁徙

if (section(4, '迁徙半径')) {
  // 实测每走一格平均花多少行动力：从出生点做最短路，看各距离上的 路费/格数
  const ratios: number[] = [];
  for (const seed of SEEDS.slice(0, 12)) {
    const g = createGame({ seed });
    const reach = reachable(g.map.origin, 120, (h) => stepCost(g, h));
    for (const { hex, cost } of reach.values()) {
      const d = distance(g.map.origin, hex);
      if (d >= 6 && d <= 20) ratios.push(cost / d);
    }
  }
  const cph = median(ratios);
  console.log(
    `\n实测：沿最短路每推进 1 格平均花 ${fix(cph, 2)} 行动力（中位数，12 张图，距离 6–20）` +
      `\n所以游荡时每回合推进 ${fix(PARTY_MOVES / cph)} 格，有背架 ${fix((PARTY_MOVES + PACKS_MOVE_BONUS) / cph)} 格。`,
  );

  console.log(
    '\n满仓出发，不靠沿途补给，一口气最远能走几格（拔营那一回合也要吃饭）：\n' +
      '  公式：距离 = (仓里的粮 ÷ 人数 − 1) × 每回合推进格数\n',
  );
  // 仓库是建筑，留在营地址上；赶路时能带的只有基础储量和储藏瓮
  const caps = [
    ['基础 40', STOCK_BASE_CAP],
    ['+储藏瓮 80', STOCK_BASE_CAP + JARS_CAP_BONUS],
  ] as const;
  const crews = [3, 5, 8, 12, 16];
  console.log(`${pad('储量', 12)} │ ${crews.map((n) => pad(`${n}人`, 9)).join(' │ ')}`);
  console.log('─'.repeat(70));
  for (const [label, cap] of caps) {
    for (const moves of [PARTY_MOVES, PARTY_MOVES + PACKS_MOVE_BONUS]) {
      const tag = moves > PARTY_MOVES ? `${label}+背架` : label;
      console.log(
        `${pad(tag, 12)} │ ` +
          crews
            .map((n) => {
              const turns = Math.floor(cap / n) - 1;
              return pad(turns <= 0 ? '走不动' : `${fix((turns * moves) / cph, 0)}格`, 9);
            })
            .join(' │ '),
      );
    }
  }
  console.log(
    '\n对照 npm run veins 的首见距离：黏土约 6 格、兽道约 9 格、铁约 14 格（都是从出生点量的直线距离，' +
      '\n实际要绕路，再乘一下上面的路费比）。',
  );
}

// ---------------------------------------------------------------- 蒙特卡洛

interface RunLog {
  people: number[];
  idle: number[];
  shortTurns: number;
  over: boolean;
  workshopAt: number | null;
  firstToolAt: number | null;
  storeAt: number | null;
  joined: number;
  grown: number;
  lost: number;
  eventsSeen: Record<string, number>;
}

/** 这样资源在这一格上一个人一回合产多少（带上已经分配到的工具） */
function projected(g: GameState): Record<ResourceId, number> {
  const out = { food: 0, wood: 0, stone: 0, clay: 0, hide: 0, iron: 0 } as Record<ResourceId, number>;
  const alloc = toolAllocation(g);
  for (const h of workableTiles(g)) {
    const rate = workRateAt(g, h, alloc);
    if (!rate.crew) continue;
    const tile = tileAt(g.map, h)!;
    for (const [r, n] of Object.entries(yieldsOf(tile.terrain, tile.deposit))) {
      out[r as ResourceId] += (n as number) * (rate.total / HARVEST_GOAL);
    }
  }
  return out;
}

/**
 * 派工策略："先温饱、再自给、最后升级"。
 * 每回合清空重派：先保住柴，再保住粮（库存低时多留余量），剩下的人去采石；
 * 没石可采或者石料已经满仓，就回去种地。
 */
function reassign(g: GameState, cap: number): void {
  const tiles = workableTiles(g);
  for (const h of tiles) while (crewAt(g, h) > 0) unassign(g, h);

  const N = g.party.people;
  const eat = foodUpkeep(g);
  const capStock = stockCap(g);

  const pick = (r: ResourceId) => {
    let best: (typeof tiles)[number] | null = null;
    let bestN = 0;
    for (const h of tiles) {
      if (crewAt(g, h) >= cap) continue;
      const t = tileAt(g.map, h)!;
      const n = yieldsOf(t.terrain, t.deposit)[r] ?? 0;
      if (n > bestN) {
        bestN = n;
        best = h;
      }
    }
    return best;
  };
  // 不走 assign()：它会按游戏里真实的每格上限拒绝，而这里要比较的正是不同的上限。
  // 用 assign() 的话，上限 3 和 5 的那两组会被悄悄压成 2，表上三行数字一模一样
  const send = (r: ResourceId) => {
    const h = pick(r);
    if (!h || !g.camp || idleCount(g) <= 0) return false;
    const k = key(h);
    g.camp.crew[k] = (g.camp.crew[k] ?? 0) + 1;
    g.camp.order.push(k);
    return true;
  };

  // 冬天柴耗翻三倍，入冬前也要多囤：秋天最后几回合就开始多派人砍柴
  const woodWant = woodUpkeep(g) + (g.stock.wood < 16 ? 1.5 : 0);
  while (idleCount(g) > 0 && projected(g).wood < woodWant) if (!send('wood')) break;

  const foodWant = eat + (g.stock.food < 3 * N ? Math.ceil(N / 3) : 0);
  while (idleCount(g) > 0 && projected(g).food < foodWant) if (!send('food')) break;

  // 剩下的人：石料没满就采石，否则补粮，再否则补柴
  while (idleCount(g) > 0) {
    const order: ResourceId[] =
      g.stock.stone < capStock - 4 ? ['stone', 'food', 'wood'] : ['food', 'wood', 'stone'];
    let placed = false;
    for (const r of order) {
      if (r !== 'stone' && g.stock[r] >= capStock - 2) continue;
      if (send(r)) {
        placed = true;
        break;
      }
    }
    if (!placed) break;
  }
}

/** 造东西。永远给篝火留 8 根柴 */
function build(g: GameState): number | null {
  const reserve = (c: Cost) => (c.wood ?? 0) <= g.stock.wood - 8;
  const tryFac = (id: BuildingId) => !hasBuilding(g, id) && reserve(BUILDINGS[id].cost) && buildBuilding(g, id);
  const tryTool = (id: ToolId) => reserve(TOOLS[id].cost) && craftTool(g, id);

  if (tryFac('workshop')) return null;
  if (hasBuilding(g, 'workshop')) {
    // 工具只造到用得上的数量：派在对口格子上的人数
    let farmers = 0;
    let loggers = 0;
    for (const h of workableTiles(g)) {
      const t = tileAt(g.map, h)!.terrain;
      const n = crewAt(g, h);
      if (primaryYields(t).includes('food')) farmers += n;
      if (primaryYields(t).includes('wood')) loggers += n;
    }
    if (g.works.tools.hoe < farmers && tryTool('hoe')) return null;
    if (g.works.tools.axe < loggers && tryTool('axe')) return null;
  }
  if (tryFac('store')) return null;
  if (tryFac('watchtower')) return null;
  return null;
}

/** 事件策略：一个还算清醒的玩家会怎么选 */
function decide(g: GameState, cap: number, log: RunLog): void {
  for (let guard = 0; guard < 20; guard += 1) {
    const ev = currentEvent(g);
    if (!ev) return;
    log.eventsSeen[ev.id] = (log.eventsSeen[ev.id] ?? 0) + 1;
    const N = g.party.people;
    let want = 0;
    switch (ev.id) {
      case 'hardWinter':
        want = g.stock.wood >= 8 ? 0 : 1;
        break;
      case 'wanderers':
        // 收留：粮够、而且工位还装得下
        want = g.stock.food >= 6 && N + 3 <= 6 * cap ? 0 : 1;
        if (want === 0) log.joined += 3;
        break;
      case 'spoiled':
        want = g.stock.wood >= 10 ? 0 : 1;
        break;
      case 'deserters':
        // 付得起就付：付完还剩一回合口粮就行。早先写的是 8 + 2N，
        // 人一多就超过储量上限永远付不起，把死亡率虚抬了一大截
        want = g.stock.food >= 8 + N ? 0 : 1;
        break;
      default:
        want = 0;
    }
    const choices = ev.choices;
    const idx = choiceAllowed(g, choices[want]) ? want : choices.findIndex((c) => choiceAllowed(g, c));
    const before = g.party.people;
    chooseEvent(g, idx);
    const delta = g.party.people - before;
    if (delta < 0) log.lost += -delta;
  }
}

function runOnce(seed: string, cap: number, turns: number, events = true): RunLog {
  const g = createGame({ seed });
  makeCamp(g);
  const log: RunLog = {
    people: [], idle: [], shortTurns: 0, over: false,
    workshopAt: null, firstToolAt: null, storeAt: null,
    joined: 0, grown: 0, lost: 0, eventsSeen: {},
  };

  for (let t = 0; t < turns; t += 1) {
    if (!events) g.pendingEvents = [];
    decide(g, cap, log);
    build(g);
    reassign(g, cap);
    build(g);
    reassign(g, cap);

    const idle = idleCount(g);
    const before = g.party.people;
    const turnBefore = g.turn;
    endTurn(g);
    if (g.turn === turnBefore) throw new Error(`${seed} 回合推不动：还有待选事件 ${g.pendingEvents}`);

    if (g.lastShortage.food > 0 || g.lastShortage.wood > 0) {
      log.shortTurns += 1;
      log.lost += Math.max(0, before - g.party.people);
    } else if (g.party.people > before) {
      log.grown += g.party.people - before;
    }

    if (log.workshopAt == null && hasBuilding(g, 'workshop')) log.workshopAt = turnBefore;
    if (log.storeAt == null && hasBuilding(g, 'store')) log.storeAt = turnBefore;
    if (log.firstToolAt == null && Object.values(g.works.tools).some((n) => n > 0)) log.firstToolAt = turnBefore;

    log.people.push(g.party.people);
    log.idle.push(idle);
    if (g.over) {
      log.over = true;
      break;
    }
  }
  return log;
}

if (section(5, '前期蒙特卡洛：原地发展 60 回合（40 个种子）')) {
  const TURNS = 60;
  const CAPS = [2, 3, 5];
  const at = (log: RunLog, t: number) => log.people[Math.min(t, log.people.length) - 1] ?? 0;

  for (const events of [true, false]) {
    console.log(`\n── ${events ? '事件开启' : '事件关闭（对照组：只看经济本身）'} ──\n`);
    console.log(
      `${pad('每格上限', 8)} │ ${[15, 30, 45, 60].map((t) => pad(`第${t}回合人数`, 13)).join(' │ ')} │ ${pad('闲置率', 6)}`,
    );
    console.log('─'.repeat(86));
    const all: Record<number, RunLog[]> = {};
    for (const cap of CAPS) {
      const logs = SEEDS.map((s) => runOnce(s, cap, TURNS, events));
      all[cap] = logs;
      const cell = (t: number) => {
        const xs = logs.map((l) => at(l, t));
        return `${median(xs)} (${pct(xs, 0.1)}–${pct(xs, 0.9)})`;
      };
      const idleRate = mean(logs.map((l) => mean(l.idle.slice(29).map((v, i) => v / Math.max(1, l.people[29 + i])))));
      console.log(`${pad(cap, 8)} │ ${[15, 30, 45, 60].map((t) => pad(cell(t), 13)).join(' │ ')} │ ${pad(`${fix(idleRate * 100, 0)}%`, 6)}`);
    }

    console.log(`\n${pad('每格上限', 8)} │ ${pad('工棚', 12)} │ ${pad('首件工具', 12)} │ ${pad('仓库', 12)} │ ${pad('短缺回合', 8)} │ ${pad('有死人', 6)} │ ${pad('全灭', 4)}`);
    console.log('─'.repeat(70));
    for (const cap of CAPS) {
      const logs = all[cap];
      const ms = (f: (l: RunLog) => number | null) => {
        const xs = logs.map(f).filter((x): x is number => x != null);
        if (!xs.length) return '—';
        return xs.length < logs.length ? `${median(xs)} (${xs.length}/${logs.length})` : `${median(xs)}`;
      };
      console.log(
        `${pad(cap, 8)} │ ${pad(ms((l) => l.workshopAt), 12)} │ ${pad(ms((l) => l.firstToolAt), 12)} │ ` +
          `${pad(ms((l) => l.storeAt), 12)} │ ${pad(fix(mean(logs.map((l) => l.shortTurns))), 8)} │ ` +
          `${pad(`${fix((logs.filter((l) => l.lost > 0).length / logs.length) * 100, 0)}%`, 6)} │ ` +
          `${pad(logs.filter((l) => l.over).length, 4)}`,
      );
    }

    if (events) {
      console.log('\n人口从哪来、到哪去（60 回合，40 局平均）\n');
      for (const cap of CAPS) {
        const logs = all[cap];
        console.log(
          `  上限 ${cap}：自然增长 +${fix(mean(logs.map((l) => l.grown)))}   ` +
            `收留流民 +${fix(mean(logs.map((l) => l.joined)))}   损失 −${fix(mean(logs.map((l) => l.lost)))}`,
        );
      }
      const seen: Record<string, number> = {};
      for (const l of all[5]) for (const [k, v] of Object.entries(l.eventsSeen)) seen[k] = (seen[k] ?? 0) + v;
      console.log(
        '\n  每局平均触发次数（上限 5）：' +
          EVENTS.map((e) => `${e.id} ${fix((seen[e.id] ?? 0) / SEEDS.length)}`).join('  '),
      );
    }
  }
  console.log('\n括号里是 60 回合内走到这一步的局数，中位数只算走到了的那些局。');
}
