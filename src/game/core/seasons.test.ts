/**
 * 季节、冰面和化冻滞留。
 *
 * 季节完全由回合数推出来，所以这里的测试大多是"把回合数拨到某一季，
 * 看规则有没有跟着变"。
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { type Axial, distance, neighbors } from './hex.ts';
import { hexOfIndex, tileAt } from './map.ts';
import {
  ICE_COST,
  SEASON_LENGTH,
  SPRING_GROWTH_EVERY,
  SPRING_MARSH_COST,
  WADE_COST,
  WINTER_WOOD_FACTOR,
  iceCracking,
  seasonAt,
} from './seasons.ts';
import { inSeason, meets } from './events.ts';
import {
  STRANDED_LOSS_MAX,
  STRANDED_LOSS_MIN,
  STRANDED_PEOPLE_MAX,
  UPKEEP_WOOD_PER_TURN,
  type GameState,
  campBlocker,
  campSight,
  createGame,
  endTurn,
  makeCamp,
  metrics,
  moveParty,
  stepCost,
  woodUpkeep,
} from './state.ts';

/** 第 n 季（0 = 开局那个秋天）的第 day 回合 */
function turnOf(seasonsFromStart: number, day = 1): number {
  return seasonsFromStart * SEASON_LENGTH + day;
}
const AUTUMN = 0;
const WINTER = 1;
const SPRING = 2;
const SUMMER = 3;

function tileOf(g: GameState, terrain: string): Axial {
  const i = g.map.tiles.findIndex((t) => t.terrain === terrain);
  assert.ok(i >= 0, `这张图上没有 ${terrain}`);
  return hexOfIndex(g.map, i);
}

/** 一块挨着可通行陆地的浅滩，以及那块陆地 */
function shoreline(g: GameState): { water: Axial; land: Axial } {
  for (let i = 0; i < g.map.tiles.length; i += 1) {
    if (g.map.tiles[i].terrain !== 'shallow') continue;
    const water = hexOfIndex(g.map, i);
    for (const n of neighbors(water)) {
      const t = tileAt(g.map, n);
      if (t && ['grass', 'tundra', 'desert'].includes(t.terrain)) return { water, land: n };
    }
  }
  throw new Error('找不到挨着平地的浅滩');
}

// ---------------------------------------------------------------- 历法

test('开局是秋天第一回合，第 21 回合入冬，第 41 回合开春并进入第二年', () => {
  assert.deepEqual(seasonAt(1), { id: 'autumn', index: 2, day: 1, year: 1 });
  assert.equal(seasonAt(SEASON_LENGTH).day, SEASON_LENGTH);
  assert.equal(seasonAt(21).id, 'winter');
  assert.equal(seasonAt(41).id, 'spring');
  assert.equal(seasonAt(41).year, 2);
  assert.equal(seasonAt(61).id, 'summer');
});

test('冰面只在冬天的最后几回合开裂', () => {
  assert.equal(iceCracking(turnOf(WINTER, 1)), false);
  assert.equal(iceCracking(turnOf(WINTER, SEASON_LENGTH)), true);
  assert.equal(iceCracking(turnOf(SPRING, SEASON_LENGTH)), false);
});

test('季节是事件条件里的一个数，inSeason() 写出来的条件判得对', () => {
  const g = createGame({ seed: 'thea' });
  g.turn = turnOf(WINTER, 3);
  const snap = metrics(g);
  assert.equal(snap.season, 3);
  assert.ok(meets(snap, inSeason('winter')));
  assert.ok(!meets(snap, inSeason('summer')));
});

// ---------------------------------------------------------------- 各季效果

test('冬天篝火耗柴翻三倍，其他季节照旧', () => {
  const g = createGame({ seed: 'thea' });
  g.turn = turnOf(AUTUMN, 5);
  assert.equal(woodUpkeep(g), UPKEEP_WOOD_PER_TURN);
  g.turn = turnOf(WINTER, 5);
  assert.equal(woodUpkeep(g), UPKEEP_WOOD_PER_TURN * WINTER_WOOD_FACTOR);

  // 结算里真的按这个数扣，不只是显示
  g.stock.wood = 20;
  endTurn(g);
  assert.equal(g.lastIncome.wood, -UPKEEP_WOOD_PER_TURN * WINTER_WOOD_FACTOR);
});

test('春天沼泽泛滥，更难走但走得进去', () => {
  const g = createGame({ seed: 'thea' });
  const marsh = tileOf(g, 'marsh');
  g.turn = turnOf(SUMMER, 3);
  assert.equal(stepCost(g, marsh), 3);
  g.turn = turnOf(SPRING, 3);
  assert.equal(stepCost(g, marsh), SPRING_MARSH_COST, '春天的沼泽应该更难走');
});

test('夏天视野 +1', () => {
  const g = createGame({ seed: 'thea' });
  makeCamp(g);
  g.turn = turnOf(AUTUMN, 3);
  const base = campSight(g);
  g.turn = turnOf(SUMMER, 3);
  assert.equal(campSight(g), base + 1);
});

test('自然增长只在春天，而且只在没有短缺的回合', () => {
  const g = createGame({ seed: 'thea' });
  makeCamp(g);
  g.stock.food = 30;
  g.stock.wood = 30;

  // 秋天整整一季，自然增长一个人都不该有
  g.turn = turnOf(AUTUMN, 1);
  const before = g.party.people;
  for (let i = 0; i < SEASON_LENGTH - 1; i += 1) {
    g.stock.food = 30;
    g.stock.wood = 30;
    g.pendingEvents = [];
    endTurn(g);
  }
  assert.equal(g.party.people, before, '秋天不该自然增长');

  // 春天第 SPRING_GROWTH_EVERY 回合添一人
  g.turn = turnOf(SPRING, SPRING_GROWTH_EVERY);
  g.pendingEvents = [];
  const p = g.party.people;
  endTurn(g);
  assert.equal(g.party.people, p + 1, '春天到了该添丁的回合没有添');
});

// ---------------------------------------------------------------- 冰面

test('冬天浅滩结冰能走上去，但冰上不能扎营', () => {
  const g = createGame({ seed: 'thea' });
  const { water } = shoreline(g);

  g.turn = turnOf(AUTUMN, 5);
  assert.equal(stepCost(g, water), null, '秋天的浅滩不该走得进去');

  g.turn = turnOf(WINTER, 5);
  assert.equal(stepCost(g, water), ICE_COST);

  g.party.at = water;
  g.party.moves = 4;
  assert.equal(campBlocker(g), 'terrain', '冰上扎营，开春时营地会泡在水里');
});

test('深海和山在冬天也照样进不去', () => {
  const g = createGame({ seed: 'thea' });
  g.turn = turnOf(WINTER, 5);
  assert.equal(stepCost(g, tileOf(g, 'ocean')), null);
  assert.equal(stepCost(g, tileOf(g, 'mountain')), null);
});

// ---------------------------------------------------------------- 化冻滞留

/** 冬天最后一回合站在冰上，结束回合 → 开春第一回合 */
function strandedAtThaw(): { g: GameState; water: Axial; land: Axial } {
  const g = createGame({ seed: 'thea' });
  const { water, land } = shoreline(g);
  g.turn = turnOf(WINTER, SEASON_LENGTH);
  g.party.at = water;
  g.party.people = 6;
  for (const r of ['food', 'wood', 'stone'] as const) g.stock[r] = 20;
  endTurn(g);
  g.pendingEvents = [];
  return { g, water, land };
}

test('化冻那一刻站在冰上：这一回合可以涉水，但只限浅滩', () => {
  const { g, water } = strandedAtThaw();
  assert.equal(seasonAt(g.turn).id, 'spring');
  assert.equal(g.party.stranded, true, '开春时站在水里，应该算被困');
  assert.equal(g.lastStranded, null, '冬天最后一回合还是冰，不该罚');

  const nextWater = neighbors(water).find((n) => tileAt(g.map, n)?.terrain === 'shallow');
  if (nextWater) assert.equal(stepCost(g, nextWater), WADE_COST);
  assert.equal(stepCost(g, tileOf(g, 'ocean')), null, '困在水里也不能走进深海');
  assert.equal(stepCost(g, tileOf(g, 'mountain')), null, '困在水里也不能翻山');
});

test('没被困的队伍不能走进化冻的浅滩', () => {
  const g = createGame({ seed: 'thea' });
  const { water } = shoreline(g);
  g.turn = turnOf(SPRING, 5);
  g.party.stranded = false;
  assert.equal(stepCost(g, water), null);
});

test('回合结束时还泡在水里：丢 0–2 人，每样东西丢 10%–30%（向上取整）', () => {
  const { g } = strandedAtThaw();
  const people = g.party.people;
  // 用没有日常消耗的两种资源量比例，食物和木材在惩罚之前先被吃掉了一截
  g.stock.stone = 20;
  g.stock.iron = 20;
  endTurn(g);

  assert.ok(g.lastStranded, '泡在水里结束回合却没有付代价');
  const lost = g.lastStranded!;
  assert.ok(lost.people >= 0 && lost.people <= STRANDED_PEOPLE_MAX);
  assert.equal(g.party.people <= people, true);
  for (const r of ['stone', 'iron'] as const) {
    assert.ok(lost.stock[r] >= Math.ceil(20 * STRANDED_LOSS_MIN), `${r} 丢得太少：${lost.stock[r]}`);
    assert.ok(lost.stock[r] <= Math.ceil(20 * STRANDED_LOSS_MAX), `${r} 丢得太多：${lost.stock[r]}`);
  }
});

test('开春第一回合就上岸的不受罚', () => {
  const { g, land } = strandedAtThaw();
  assert.ok(moveParty(g, land), '困在水里应该能走上岸');
  endTurn(g);
  assert.equal(g.lastStranded, null);
});

test('滞留惩罚不会把一次饥荒抹掉', () => {
  // 结算顺序是 收支 → 滞留 → 短缺。缺粮时库存此刻是负的，对负数取比例会算出
  // 负的"损失"，等于替玩家补平了缺口
  const { g } = strandedAtThaw();
  g.stock.food = 0;
  const people = g.party.people;
  endTurn(g);
  assert.ok(g.lastShortage.food > 0, '没粮了却没记成短缺');
  assert.ok(g.party.people < people);
  assert.equal(g.lastStranded!.stock.food, 0);
});

test('滞留惩罚可以复现：同一份状态结算两次，结果一样', () => {
  const a = strandedAtThaw().g;
  const b = strandedAtThaw().g;
  endTurn(a);
  endTurn(b);
  assert.deepEqual(a.lastStranded, b.lastStranded);
  assert.ok(distance(a.party.at, b.party.at) === 0);
});
