/**
 * 设施与工具的规则测试。
 *
 * 这里测的都是"看画面看不出来"的东西：工具发给了谁、拔营之后还剩什么、
 * 面板上显示的速度和结算时实际用的是不是同一个数。
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  BASE_CREW_CAP,
  MAX_CREW_PER_TILE,
  assign,
  assignBlocker,
  breakCamp,
  crewCap,
  enforceCrewCap,
  buildFacility,
  campSight,
  craftBlocker,
  craftTool,
  createGame,
  endTurn,
  hasFacility,
  makeCamp,
  toolAllocation,
  unassign,
  workRateAt,
  workableTiles,
  type GameState,
} from './state.ts';
import { key } from './hex.ts';
import { TERRAIN, type ResourceId, type TerrainId, primaryYields } from './terrain.ts';
import { tileAt } from './map.ts';

/**
 * 起一局、扎好营、库存拉满、工棚建好，免得每条测试都在攒资源。
 * 工棚是制作的前置，不建的话 craftTool 会静默返回 false —— 测试会以
 * "工具没发出去"的形式失败，看着像分配逻辑坏了，其实是前置没满足。
 */
function camped(): GameState {
  const g = createGame({ seed: 'thea' });
  if (!makeCamp(g)) throw new Error('开局位置扎不了营');
  g.stock.food = 999;
  g.stock.wood = 999;
  g.stock.stone = 999;
  g.party.people = 8;
  buildFacility(g, 'workshop');
  return g;
}

/**
 * 作业圈里第一个**主产**这种资源的地格。
 *
 * 按"产不产"找会找歪：森林也产 1 点食物，拿它当"粮地"来测工具，
 * 测试自己就先糊了。
 */
function tileYielding(g: GameState, res: ResourceId) {
  const h = workableTiles(g).find((x) => primaryYields(tileAt(g.map, x)!.terrain).includes(res));
  if (!h) throw new Error(`种子 thea 的作业圈里没有主产${res}的地格`);
  return h;
}

test('工具按部署顺序发：2 个人 1 把斧头，先来的拿到', () => {
  // 每格上限是 2，所以"人比工具多"只能在一格里摆出 2 对 1
  const g = camped();
  const forest = tileYielding(g, 'wood');

  assign(g, forest);
  assign(g, forest);
  craftTool(g, 'axe');

  const rate = workRateAt(g, forest);
  assert.equal(rate.crew, 2);
  assert.equal(rate.equipped, 1, '应该正好一个人有斧头');
  assert.equal(rate.bonus, 10);
  // 50 点 = 结算一次再溢出 10 —— 上限 2 之下，溢出只在有工具时才出现
  assert.equal(rate.total, 2 * 20 + 10);
});

test('斧头不会发给草原上的人 —— 用不上的地格直接跳过', () => {
  const g = camped();
  const grass = tileYielding(g, 'food');

  assign(g, grass);
  craftTool(g, 'axe');

  assert.equal(workRateAt(g, grass).equipped, 0);
  // 同一把斧头，换到林子里就用得上了
  const forest = tileYielding(g, 'wood');
  assign(g, forest);
  assert.equal(workRateAt(g, forest).equipped, 1);
});

test('骨锄不给森林加成 —— 森林产 1 点食物，但它是木头地', () => {
  // 这就是线上报的那个 bug。原先的判定只问"这一格产不产食物"，
  // 森林的 food: 1 让它成立了，于是伐木的人也吃到锄头加成。
  // 上面那条"斧头不给草原"测不到它：草原完全不产木材，
  // 少数产出这种情形根本没被覆盖。
  const g = camped();
  const forest = tileYielding(g, 'wood');
  assert.ok(TERRAIN[tileAt(g.map, forest)!.terrain].yields.food, '森林该产一点食物，测试前提不成立');

  assign(g, forest);
  craftTool(g, 'hoe');
  assert.equal(workRateAt(g, forest).equipped, 0, '锄头不该在林子里算数');

  // 同一片林子，换成斧头就吃得上
  craftTool(g, 'axe');
  assert.equal(workRateAt(g, forest).equipped, 1);
  assert.equal(workRateAt(g, forest).bonus, 10);
});

test('每种地形的主产资源都登记过', () => {
  // 加了新地形却没在这张表里露面，就是还没想清楚哪把工具吃得上它
  const expected: Record<TerrainId, ResourceId[]> = {
    ocean: [],
    shallow: ['food'],
    marsh: ['food', 'wood'],
    grass: ['food'],
    forest: ['wood'],
    hills: ['stone'],
    mountain: ['stone'],
    desert: [],
    tundra: ['food'],
  };

  assert.deepEqual(
    Object.keys(TERRAIN).sort(),
    Object.keys(expected).sort(),
    '有地形没在这条测试里登记主产',
  );
  for (const [id, want] of Object.entries(expected)) {
    assert.deepEqual([...primaryYields(id as TerrainId)].sort(), [...want].sort(), id);
  }
});

test('撤人撤的是后来的那个，先部署的保住工具', () => {
  const g = camped();
  const forest = tileYielding(g, 'wood');
  const grass = tileYielding(g, 'food');

  assign(g, forest); // 第 1 个部署
  assign(g, grass);
  assign(g, forest); // 第 3 个部署
  craftTool(g, 'axe');

  assert.equal(workRateAt(g, forest).equipped, 1);
  unassign(g, forest);

  // 走的是第 3 个，第 1 个还在，斧头还在他手上
  assert.equal(workRateAt(g, forest).crew, 1);
  assert.equal(workRateAt(g, forest).equipped, 1);
});

test('面板显示的速度就是结算时用的速度', () => {
  // 这条把 workRateAt 钉成唯一口径。它俩要是各算各的，画面上看不出来，
  // 只会表现为"显示 60 但进度只走了 40"
  const g = camped();
  const forest = tileYielding(g, 'wood');

  assign(g, forest);
  assign(g, forest);
  craftTool(g, 'axe');

  const before = tileAt(g.map, forest)!.progress;
  const shown = workRateAt(g, forest).total;

  endTurn(g);

  const after = tileAt(g.map, forest)!.progress;
  const goal = 40;
  const advanced = after - before + Math.floor((before + shown) / goal) * goal;
  assert.equal(advanced, shown, '进度实际推进量和面板上写的对不上');
});

test('拔营再扎营，设施和工具都还在', () => {
  // 这是刻意为游戏性做的取舍：设施挂在队伍上不挂在营地上，
  // 所以"保留"是模型的自然结果，不是一条要单独维护的搬运逻辑
  const g = camped();
  buildFacility(g, 'workshop');
  buildFacility(g, 'watchtower');
  craftTool(g, 'axe');

  breakCamp(g);
  assert.equal(g.camp, null);
  assert.ok(hasFacility(g, 'workshop'), '拔营后工棚没了');
  assert.equal(g.works.tools.axe, 1, '拔营后斧头没了');

  makeCamp(g);
  assert.ok(hasFacility(g, 'watchtower'));
  assert.equal(g.works.tools.axe, 1);
});

test('拔营会清空派工，工具回到未分配状态', () => {
  const g = camped();
  const forest = tileYielding(g, 'wood');
  assign(g, forest);
  craftTool(g, 'axe');
  assert.equal(workRateAt(g, forest).equipped, 1);

  breakCamp(g);
  assert.equal(toolAllocation(g).size, 0, '没扎营时不该有人拿着工具在干活');
});

test('制作要先有工棚', () => {
  // 这条不能用 camped()：那个 helper 已经把工棚建好了
  const g = createGame({ seed: 'thea' });
  makeCamp(g);
  g.stock.wood = 999;
  g.stock.stone = 999;

  assert.equal(craftBlocker(g, 'axe'), 'locked');
  assert.equal(craftTool(g, 'axe'), false, '没工棚时不该造得出来');

  buildFacility(g, 'workshop');
  assert.equal(craftBlocker(g, 'axe'), null);
  assert.equal(craftTool(g, 'axe'), true);
});

test('了望塔加视野，仓库减食物消耗', () => {
  const g = camped();
  const sight0 = campSight(g);
  buildFacility(g, 'watchtower');
  assert.equal(campSight(g), sight0 + 1);

  const plain = createGame({ seed: 'thea' });
  makeCamp(plain);
  plain.party.people = 5;
  endTurn(plain);
  const withoutStore = plain.lastIncome.food;

  const stored = createGame({ seed: 'thea' });
  makeCamp(stored);
  stored.party.people = 5;
  stored.stock.wood = 999;
  stored.stock.stone = 999;
  buildFacility(stored, 'store');
  endTurn(stored);

  assert.equal(stored.lastIncome.food, withoutStore + 1, '仓库应该少吃一份粮');
});

test('每种设施只能建一次', () => {
  const g = camped();
  assert.equal(buildFacility(g, 'store'), true);
  assert.equal(buildFacility(g, 'store'), false);
  assert.equal(g.works.facilities.filter((f) => f === 'store').length, 1);
});

test('派工顺序里的人数和 crew 始终一致', () => {
  const g = camped();
  const tiles = workableTiles(g);

  for (let i = 0; i < 6; i += 1) assign(g, tiles[i % tiles.length]);
  unassign(g, tiles[0]);
  unassign(g, tiles[1]);

  const fromCrew = Object.values(g.camp!.crew).reduce((a, b) => a + b, 0);
  assert.equal(g.camp!.order.length, fromCrew, 'order 和 crew 脱节了');

  // 每个 key 在 order 里出现的次数要等于 crew 里记的人数
  const counted: Record<string, number> = {};
  for (const k of g.camp!.order) counted[k] = (counted[k] ?? 0) + 1;
  for (const [k, n] of Object.entries(g.camp!.crew)) assert.equal(counted[k], n, `${k} 对不上`);
  assert.ok(tiles.length > 0 && key(tiles[0]).length > 0);
});

// ---------------------------------------------------------------- 每格上限

test('每格上限：开局 2 人，第三个人派不上去', () => {
  const g = camped();
  const grass = tileYielding(g, 'food');

  assert.equal(crewCap(g), BASE_CREW_CAP);
  for (let i = 0; i < BASE_CREW_CAP; i += 1) assert.ok(assign(g, grass), `第 ${i + 1} 个人派不上去`);
  assert.equal(assignBlocker(g, grass), 'tileFull');
  assert.equal(assign(g, grass), false);
});

test('上限的天花板是 6 —— 六边形只有六条边，地图上画不下第七根指示条', () => {
  assert.equal(MAX_CREW_PER_TILE, 6);
  assert.ok(BASE_CREW_CAP <= MAX_CREW_PER_TILE);
});

test('超编时按部署顺序从后往前撤，先来的保住位置', () => {
  // 读老存档时会遇到：上限从 5 降到 2 之前，一格上可能站着四个人
  const g = camped();
  const grass = tileYielding(g, 'food');
  const forest = tileYielding(g, 'wood');
  const kg = key(grass);
  const kf = key(forest);

  g.camp!.crew = { [kg]: 4, [kf]: 1 };
  g.camp!.order = [kg, kf, kg, kg, kg];
  enforceCrewCap(g);

  assert.equal(g.camp!.crew[kg], 2);
  assert.equal(g.camp!.crew[kf], 1);
  // 留下的是第 1 和第 3 个部署的人，林子里那个不受影响
  assert.deepEqual(g.camp!.order, [kg, kf, kg]);
});
