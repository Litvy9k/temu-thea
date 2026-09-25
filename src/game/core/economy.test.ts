/**
 * 储量上限与比例效果的测试。
 *
 * 上限最容易出的错是**某一条让库存增加的路径没走 clamp** —— 回合结算夹住了
 * 但事件奖励没夹，于是事件成了绕过上限的后门，而绕过去的东西在界面上完全
 * 看不出来。所以这里对每一条加资源的路径都单独断言。
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  STOCK_BASE_CAP,
  STORE_CAP_BONUS,
  assign,
  buildFacility,
  chooseEvent,
  createGame,
  currentEvent,
  endTurn,
  makeCamp,
  stockCap,
  workableTiles,
  type GameState,
} from './state.ts';
import { EVENTS } from './events.ts';

function camped(): GameState {
  const g = createGame({ seed: 'thea' });
  makeCamp(g);
  return g;
}

test('没有仓库时上限是基础值，建了仓库抬高', () => {
  const g = camped();
  assert.equal(stockCap(g), STOCK_BASE_CAP);

  g.stock.wood = 999;
  g.stock.stone = 999;
  buildFacility(g, 'store');
  assert.equal(stockCap(g), STOCK_BASE_CAP + STORE_CAP_BONUS);
});

test('回合结算顶到上限就倒掉，并记在 lastWasted 里', () => {
  const g = camped();
  const cap = stockCap(g);
  g.party.people = 5;
  for (const h of workableTiles(g)) for (let i = 0; i < 5; i += 1) assign(g, h);

  // 推到刚好满仓，再跑一回合
  g.stock.food = cap;
  g.stock.wood = cap;
  g.stock.stone = cap;
  endTurn(g);

  for (const res of ['food', 'wood', 'stone'] as const) {
    assert.ok(g.stock[res] <= cap, `${res} 超过上限了`);
  }
  const anyWasted = g.lastWasted.food + g.lastWasted.wood + g.lastWasted.stone;
  assert.ok(anyWasted > 0, '满仓还在产出，应该记下浪费量');
});

test('事件奖励也夹上限 —— 不能当成绕过上限的后门', () => {
  // oldCache 给 +8❙ +6✦ +4◆。满仓时领取，一点都不该多出来
  const g = createGame({ seed: 'thea' });
  const cap = stockCap(g);
  g.stock.food = cap;
  g.stock.wood = cap;
  g.stock.stone = cap;

  g.pendingEvents.push('oldCache');
  const ev = currentEvent(g)!;
  assert.equal(ev.id, 'oldCache');
  chooseEvent(g, 0);

  assert.equal(g.stock.food, cap, '事件把食物顶出上限了');
  assert.equal(g.stock.wood, cap, '事件把木材顶出上限了');
  assert.equal(g.stock.stone, cap, '事件把石料顶出上限了');
  assert.ok(g.lastWasted.wood > 0, '事件造成的浪费也该记下来');
});

test('比例效果按当前存量算，存得越多扣得越多', () => {
  // 起始值必须在上限之内，否则 clamp 会先把它压下来，量到的就不是比例效果了
  const take30 = (start: number) => {
    const g = createGame({ seed: 'thea' });
    g.stock.food = start;
    g.pendingEvents.push('spoiled');
    // "扔掉坏的" 是不带 require 的那个
    const ev = currentEvent(g)!;
    const i = ev.choices.findIndex((c) => !c.require);
    chooseEvent(g, i);
    return start - g.stock.food;
  };

  assert.equal(take30(STOCK_BASE_CAP), 12); // 40 的三成
  assert.equal(take30(20), 6);
  assert.equal(take30(10), 3);
});

test('比例效果在存量很少时也至少拿走 1，不会悄悄变成没效果', () => {
  // 四舍五入到 0 是最让人困惑的一种"生效了但什么也没发生"
  const g = createGame({ seed: 'thea' });
  g.stock.food = 2; // 30% = 0.6，四舍五入是 1
  g.pendingEvents.push('spoiled');
  const ev = currentEvent(g)!;
  chooseEvent(g, ev.choices.findIndex((c) => !c.require));
  assert.equal(g.stock.food, 1);

  // 但存量为 0 时不该扣成负数
  const h = createGame({ seed: 'thea' });
  h.stock.food = 0;
  h.pendingEvents.push('spoiled');
  chooseEvent(h, currentEvent(h)!.choices.findIndex((c) => !c.require));
  assert.equal(h.stock.food, 0);
});

test('比例项按改动前的存量算，不受同一效果里绝对项的影响', () => {
  // "生火烘干" 是 −6❙ 和 −8% 食物。如果实现成先扣绝对项再算比例，
  // 两项都作用在食物上时结果就会随书写顺序变化
  const g = createGame({ seed: 'thea' });
  g.stock.food = 40;
  g.stock.wood = 30;
  g.pendingEvents.push('spoiled');
  const ev = currentEvent(g)!;
  chooseEvent(g, ev.choices.findIndex((c) => c.require));

  assert.equal(g.stock.wood, 24);
  assert.equal(g.stock.food, 37, '8% 该按 40 算出 3，不受同一效果里木材那一项影响');
});

test('事件表里的比例值都在 -1..1 之间', () => {
  // 写成 -30 而不是 -0.3 的话，一次就把库存清空，而且看不出是笔误
  for (const e of EVENTS) {
    for (const c of e.choices) {
      for (const [res, p] of Object.entries(c.effect.stockPct ?? {})) {
        assert.ok(p >= -1 && p <= 1, `${e.id} 的 ${res} 比例是 ${p}，应该是小数`);
      }
      const pp = c.effect.peoplePct;
      if (pp != null) assert.ok(pp >= -1 && pp <= 1, `${e.id} 的人口比例 ${pp} 应该是小数`);
    }
  }
});
