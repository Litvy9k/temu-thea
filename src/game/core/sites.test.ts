/**
 * 营地址、建筑、槽位、装备。
 *
 * 要守住的几件事：
 *   建筑属于营地址，营地只靠位置找到它 —— 拔营不丢，回来生效，换地方不生效；
 *   槽位、前置、"被依赖的不能拆"这几条限制都成立；
 *   营地址的生灭（第一座建筑时出生，拆光或太久没人来时消失）；
 *   老存档里随队的仓库、工棚、了望塔能迁成建筑。
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { type Axial, distance, key } from './hex.ts';
import { hexOfIndex, tileAt } from './map.ts';
import { TERRAIN } from './terrain.ts';
import { BASE_SLOTS, BUILDINGS, EXPANDED_SLOTS } from './works.ts';
import { parseSave, serialize } from './save.ts';
import {
  BASE_CREW_CAP,
  CREW_BONUS,
  JARS_CAP_BONUS,
  MAX_SITES,
  PACKS_MOVE_BONUS,
  PARTY_MOVES,
  SITE_LIFETIME,
  STOCK_BASE_CAP,
  STORE_CAP_BONUS,
  type GameState,
  assign,
  breakCamp,
  breakCampLoss,
  buildBlocker,
  buildBuilding,
  craftBlocker,
  craftGear,
  createGame,
  crewCap,
  currentSite,
  demolish,
  demolishBlocker,
  endTurn,
  hasBuilding,
  makeCamp,
  partyMoves,
  slotsUsed,
  stockCap,
  workRadius,
  workableTiles,
} from './state.ts';

/** 扎好营、库存给足的一局 */
function camped(): GameState {
  const g = createGame({ seed: 'thea' });
  assert.ok(makeCamp(g), '开局位置扎不了营');
  rich(g);
  return g;
}

function rich(g: GameState) {
  for (const r of ['food', 'wood', 'stone', 'clay', 'hide', 'iron'] as const) g.stock[r] = 999;
}

/** 离开当前营地，走到别处一块能扎营的地方扎下 */
function relocate(g: GameState, avoid: Axial[] = []): Axial {
  if (g.camp) breakCamp(g);
  for (let i = 0; i < g.map.tiles.length; i += 1) {
    const t = g.map.tiles[i];
    if (TERRAIN[t.terrain].moveCost == null) continue;
    const at = hexOfIndex(g.map, i);
    if (avoid.some((a) => distance(a, at) < 3)) continue;
    if (g.map.sites.some((s) => distance(s.at, at) < 3)) continue;
    g.party.at = at;
    g.party.moves = 4;
    if (makeCamp(g)) {
      rich(g);
      return at;
    }
  }
  throw new Error('找不到能扎营的地方');
}

// ---------------------------------------------------------------- 营地址的生灭

test('扎营不会生成营地址，造第一座建筑才会', () => {
  const g = camped();
  assert.equal(g.map.sites.length, 0);
  breakCamp(g);
  assert.equal(g.map.sites.length, 0, '没造过建筑的营地拔营后不该留下营地址');

  // 拔营吃掉了这回合的行动力，原地再扎要等有行动力
  g.party.moves = 4;
  assert.ok(makeCamp(g));
  rich(g);
  buildBuilding(g, 'store');
  assert.equal(g.map.sites.length, 1);
  assert.deepEqual(currentSite(g)!.buildings, ['store']);
});

test('建筑拆光了，营地址就不在了', () => {
  const g = camped();
  buildBuilding(g, 'store');
  assert.ok(demolish(g, 'store'));
  assert.equal(g.map.sites.length, 0);
});

test('太久没人来的营地址直接消失；有人住着的永远不会', () => {
  const g = camped();
  buildBuilding(g, 'store');
  const home = { ...g.camp!.at };

  // 住着的时候跑满一整个寿命
  for (let i = 0; i < SITE_LIFETIME + 5; i += 1) {
    rich(g);
    g.pendingEvents = [];
    endTurn(g);
  }
  assert.equal(g.map.sites.length, 1, '有人住着的营地址倒塌了');

  // 走开之后，到时间就没了
  relocate(g, [home]);
  for (let i = 0; i < SITE_LIFETIME; i += 1) {
    rich(g);
    g.pendingEvents = [];
    endTurn(g);
  }
  assert.equal(g.map.sites.length, 0, '超过寿命的营地址还在');
});

test(`营地址最多 ${MAX_SITES} 处：拦的是在新地点造建筑，不拦扎营`, () => {
  const g = camped();
  const places: Axial[] = [];
  for (let i = 0; i < MAX_SITES; i += 1) {
    if (i > 0) places.push(relocate(g, places));
    else places.push({ ...g.camp!.at });
    assert.ok(buildBuilding(g, 'store'), `第 ${i + 1} 处营地址造不起来`);
  }
  assert.equal(g.map.sites.length, MAX_SITES);

  relocate(g, places);
  assert.ok(g.camp, '营地址满了也该能扎营');
  assert.equal(buildBlocker(g, 'store'), 'siteLimit');

  // 回到已有的营地址，照样能接着造
  breakCamp(g);
  g.party.at = places[0];
  g.party.moves = 4;
  makeCamp(g);
  rich(g);
  assert.equal(buildBlocker(g, 'workshop'), null);
});

// ---------------------------------------------------------------- 槽位与前置

test(`槽位：开始 ${BASE_SLOTS} 个，营地扩建之后 ${EXPANDED_SLOTS} 个；不占槽位的建筑不受限`, () => {
  const g = camped();
  const slotted = Object.entries(BUILDINGS).filter(([, b]) => b.slot).map(([id]) => id);
  assert.ok(slotted.length > BASE_SLOTS, '占槽位的建筑不够多，测不到槽位满的情况');

  for (const id of slotted.slice(0, BASE_SLOTS)) assert.ok(buildBuilding(g, id as never));
  assert.equal(slotsUsed(currentSite(g)), BASE_SLOTS);
  assert.equal(buildBlocker(g, slotted[BASE_SLOTS] as never), 'slots');

  // 不占槽位的照样能造
  assert.ok(buildBuilding(g, 'crew1'));
  assert.ok(buildBuilding(g, 'expansion'));
  assert.equal(buildBlocker(g, slotted[BASE_SLOTS] as never), null, '扩建之后还是没有槽位');
});

test('扩编（二）要先有扩编；两级叠加，每格上限 2 → 4 → 6', () => {
  const g = camped();
  assert.equal(crewCap(g), BASE_CREW_CAP);
  assert.equal(buildBlocker(g, 'crew2'), 'requires');

  buildBuilding(g, 'crew1');
  assert.equal(crewCap(g), BASE_CREW_CAP + CREW_BONUS);
  buildBuilding(g, 'crew2');
  assert.equal(crewCap(g), BASE_CREW_CAP + 2 * CREW_BONUS);
});

test('前置建筑必须在同一处营地址', () => {
  const g = camped();
  buildBuilding(g, 'crew1');
  relocate(g, [g.camp!.at]);
  assert.equal(buildBlocker(g, 'crew2'), 'requires', '另一处营地的扩编被当成了前置');
});

// ---------------------------------------------------------------- 拆除

test('拆除返还一半造价，向下取整，而且过储量上限', () => {
  const g = camped();
  buildBuilding(g, 'watchtower');
  for (const r of ['food', 'wood', 'stone'] as const) g.stock[r] = 0;
  demolish(g, 'watchtower');
  const cost = BUILDINGS.watchtower.cost;
  assert.equal(g.stock.wood, Math.floor(cost.wood! / 2));
  assert.equal(g.stock.stone, Math.floor(cost.stone! / 2));

  // 满仓时返还会被倒掉，不能拿拆房子绕过上限
  rich(g);
  assert.ok(buildBuilding(g, 'watchtower'));
  g.stock.wood = stockCap(g);
  demolish(g, 'watchtower');
  assert.equal(g.stock.wood, stockCap(g));
  assert.ok(g.lastWasted.wood > 0);
});

test('被依赖的建筑不能拆：扩编（二）在，扩编就不能拆', () => {
  const g = camped();
  buildBuilding(g, 'crew1');
  buildBuilding(g, 'crew2');
  assert.equal(demolishBlocker(g, 'crew1'), 'needed');
  assert.ok(demolish(g, 'crew2'));
  assert.equal(demolishBlocker(g, 'crew1'), null);
});

test('后三个槽位还有建筑时，营地扩建不能拆', () => {
  const g = camped();
  buildBuilding(g, 'expansion');
  for (const id of ['store', 'workshop', 'watchtower', 'outskirts'] as const) buildBuilding(g, id);
  assert.equal(slotsUsed(currentSite(g)), 4);
  assert.equal(demolishBlocker(g, 'expansion'), 'needed');

  demolish(g, 'outskirts');
  assert.equal(demolishBlocker(g, 'expansion'), null);
});

test('拆掉扩编，超出上限的人按部署顺序从后往前撤', () => {
  const g = camped();
  g.party.people = 12;
  buildBuilding(g, 'crew1');
  const tile = workableTiles(g)[0];
  for (let i = 0; i < 4; i += 1) assign(g, tile);
  demolish(g, 'crew1');
  assert.equal(g.camp!.crew[key(tile)], BASE_CREW_CAP);
});

// ---------------------------------------------------------------- 外围营地

test('外围营地把采集半径和探查半径一起扩大', () => {
  const g = camped();
  const before = workableTiles(g).length;
  buildBuilding(g, 'outskirts');
  assert.equal(workRadius(g), 2);
  assert.ok(workableTiles(g).length > before);
  for (const h of workableTiles(g)) {
    assert.ok(tileAt(g.map, h)!.surveyed, '半径扩大了，新的作业格却没有探查');
  }
});

test('拆掉外围营地，圈外的人撤回来', () => {
  const g = camped();
  g.party.people = 12;
  buildBuilding(g, 'outskirts');
  const far = workableTiles(g).find((h) => distance(h, g.camp!.at) === 2)!;
  assign(g, far);
  demolish(g, 'outskirts');
  assert.equal(g.camp!.crew[key(far)] ?? 0, 0, '半径缩回去了，圈外还站着人');
});

// ---------------------------------------------------------------- 只在本营地生效

test('仓库只在它所在的营地生效；拔营时放不下的要扔', () => {
  const g = camped();
  buildBuilding(g, 'store');
  assert.equal(stockCap(g), STOCK_BASE_CAP + STORE_CAP_BONUS);

  g.stock.food = STOCK_BASE_CAP + 15;
  g.stock.wood = STOCK_BASE_CAP - 5;
  const loss = breakCampLoss(g);
  assert.equal(loss.food, 15);
  assert.equal(loss.wood, 0);

  breakCamp(g);
  assert.equal(stockCap(g), STOCK_BASE_CAP);
  assert.equal(g.stock.food, STOCK_BASE_CAP);
  assert.ok(g.lastWasted.food >= 15, '扔掉的量要记下来给 HUD 显示');
});

test('制作要有这处营地的工棚，别处的不算', () => {
  const g = camped();
  buildBuilding(g, 'workshop');
  assert.equal(craftBlocker(g, 'axe'), null);
  relocate(g, [g.camp!.at]);
  assert.equal(craftBlocker(g, 'axe'), 'locked');
});

test('储藏瓮和背架是装备：走到哪都算，每样只能有一件', () => {
  const g = camped();
  buildBuilding(g, 'workshop');
  assert.ok(craftGear(g, 'jars'));
  assert.equal(craftGear(g, 'jars'), false);
  assert.ok(craftGear(g, 'packs'));

  breakCamp(g);
  assert.equal(stockCap(g), STOCK_BASE_CAP + JARS_CAP_BONUS);
  assert.equal(partyMoves(g), PARTY_MOVES + PACKS_MOVE_BONUS);
});

// ---------------------------------------------------------------- 存档

test('营地址和装备存得下、读得回', () => {
  const g = camped();
  buildBuilding(g, 'workshop');
  buildBuilding(g, 'crew1');
  craftGear(g, 'jars');

  const back = parseSave(serialize(g));
  assert.deepEqual(back.map.sites, g.map.sites);
  assert.deepEqual(back.works.gear, ['jars']);
  assert.ok(hasBuilding(back, 'crew1'), '读档后营地没有接上营地址');
});

test('装备分家之前的存档：仓库、工棚、了望塔迁成建筑，储藏瓮留作装备', () => {
  const g = camped();
  const file = JSON.parse(serialize(g));
  delete file.map.sites;
  file.works = { facilities: ['store', 'workshop', 'jars'], tools: file.works.tools };

  const back = parseSave(JSON.stringify(file));
  assert.equal(back.map.sites.length, 1);
  assert.deepEqual([...back.map.sites[0].buildings].sort(), ['store', 'workshop']);
  assert.deepEqual(back.works.gear, ['jars']);
  // 存档时扎着营，迁过去的建筑立刻生效
  assert.ok(hasBuilding(back, 'store'));
});
