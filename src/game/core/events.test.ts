/**
 * 事件系统的测试。
 *
 * 这里分两类：一类测机制（条件、概率、选择、结算），另一类是**对事件表本身
 * 的体检** —— 概率写成 0、选项全都带 require、once 事件重复触发这些错误，
 * 单看代码是看不出来的，只有玩到那一回合才会发现。
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  EVENTS,
  type Rule,
  type Snapshot,
  chanceOf,
  findEvent,
  meets,
  meetsAll,
} from './events.ts';
import {
  chooseEvent,
  choiceAllowed,
  createGame,
  currentEvent,
  endTurn,
  metrics,
  makeCamp,
  assign,
  workableTiles,
  type GameState,
} from './state.ts';

const snap = (over: Partial<Snapshot> = {}): Snapshot => ({
  turn: 1,
  people: 3,
  idle: 0,
  food: 10,
  wood: 10,
  stone: 0,
  ...over,
});

// ---------------------------------------------------------------- 机制

test('五个比较运算符都算对', () => {
  const s = snap({ food: 10 });
  assert.equal(meets(s, { metric: 'food', op: '>', value: 9 }), true);
  assert.equal(meets(s, { metric: 'food', op: '>', value: 10 }), false);
  assert.equal(meets(s, { metric: 'food', op: '>=', value: 10 }), true);
  assert.equal(meets(s, { metric: 'food', op: '<', value: 11 }), true);
  assert.equal(meets(s, { metric: 'food', op: '<=', value: 10 }), true);
  assert.equal(meets(s, { metric: 'food', op: '==', value: 10 }), true);
});

test('一条规则里的多个条件是 AND', () => {
  const when = [
    { metric: 'food', op: '<', value: 5 },
    { metric: 'people', op: '>', value: 4 },
  ] as const;

  assert.equal(meetsAll(snap({ food: 3, people: 6 }), [...when]), true);
  assert.equal(meetsAll(snap({ food: 3, people: 2 }), [...when]), false, '只满足一条不该算命中');
});

test('规则之间是 OR，多条命中取最大概率而不是求和', () => {
  const trigger: Rule[] = [
    { when: [{ metric: 'turn', op: '>=', value: 10 }], chance: 0.1 },
    { when: [{ metric: 'wood', op: '<', value: 5 }], chance: 0.4 },
  ];

  assert.equal(chanceOf(snap({ turn: 1, wood: 10 }), trigger), 0, '都不命中就是 0');
  assert.equal(chanceOf(snap({ turn: 12, wood: 10 }), trigger), 0.1);
  assert.equal(chanceOf(snap({ turn: 1, wood: 2 }), trigger), 0.4);
  // 求和的话这里会是 0.5：条件写得越多越容易触发，写表的人预期不了
  assert.equal(chanceOf(snap({ turn: 12, wood: 2 }), trigger), 0.4, '应该取最大不是求和');
});

test('metrics 取的是当前局面的真实数值', () => {
  const g = createGame({ seed: 'thea' });
  const m = metrics(g);
  assert.equal(m.turn, g.turn);
  assert.equal(m.people, g.party.people);
  assert.equal(m.food, g.stock.food);
  assert.equal(m.idle, 0, '游荡时不该算闲置 —— 在赶路不是没事干');
});

test('idle 只在扎营时才有意义', () => {
  // 不这么定的话 idleCount 在游荡时恒等于总人数，"闲人要走"这类事件
  // 会从第 2 回合就开始触发，而那时玩家连营地都还没扎
  const g = createGame({ seed: 'thea' });
  assert.equal(metrics(g).idle, 0, '游荡时 idle 应该是 0');

  makeCamp(g);
  assert.equal(metrics(g).idle, g.party.people, '扎营后没派工就是全员闲置');

  assign(g, workableTiles(g)[0]);
  assert.equal(metrics(g).idle, g.party.people - 1);
});

// ---------------------------------------------------------------- 流程

/** 把局面推到必然触发某个事件，返回那一局 */
function forceEvent(id: string, prep: (g: GameState) => void): GameState {
  for (let seed = 1; seed < 400; seed += 1) {
    const g = createGame({ seed });
    prep(g);
    for (let i = 0; i < 40 && !g.pendingEvent; i += 1) {
      prep(g); // 每回合重新摆好条件，免得被消耗掉
      endTurn(g);
    }
    if (g.pendingEvent === id) return g;
  }
  throw new Error(`跑了 400 个种子都没触发 ${id}，概率或条件有问题`);
}

/** 第一个不带 require 的选择。测试里用它兜底，比假设"最后一个"稳 */
function freeChoice(g: GameState): number {
  const i = currentEvent(g)!.choices.findIndex((c) => !c.require || c.require.length === 0);
  assert.ok(i >= 0, '这个事件没有无条件的选择');
  return i;
}

test('事件挂着的时候回合推不动', () => {
  const g = forceEvent('wanderers', (s) => {
    s.stock.food = 20;
    s.stock.wood = 20;
  });

  const before = g.turn;
  endTurn(g);
  assert.equal(g.turn, before, '没做选择就不该能结束回合');
  assert.ok(g.pendingEvent, '事件还该挂着');
});

test('做出选择后效果落地，事件关掉，回合又能推了', () => {
  const g = forceEvent('wanderers', (s) => {
    s.stock.food = 20;
    s.stock.wood = 20;
  });

  const people = g.party.people;
  const food = g.stock.food;

  assert.equal(chooseEvent(g, 0), true, '收留他们应该选得上');
  assert.equal(g.pendingEvent, null);
  assert.equal(g.party.people, people + 3);
  assert.equal(g.stock.food, food - 6);

  const turn = g.turn;
  endTurn(g);
  assert.ok(g.turn > turn, '选完之后回合该能推了');
});

test('资源不够时那个选择不可选，而且真的选不动', () => {
  const g = forceEvent('wanderers', (s) => {
    s.stock.food = 20;
    s.stock.wood = 20;
  });

  g.stock.food = 1; // 收留他们要 6
  const ev = currentEvent(g)!;
  assert.equal(choiceAllowed(g, ev.choices[0]), false);
  assert.equal(chooseEvent(g, 0), false, '不可选的选项不该结算得了');
  assert.ok(g.pendingEvent, '选失败了事件就该还挂着');

  // 打发走没有条件，任何时候都选得上
  assert.equal(choiceAllowed(g, ev.choices[1]), true);
  assert.equal(chooseEvent(g, 1), true);
  assert.equal(g.pendingEvent, null);
});

test('效果把资源和人数夹在 0 以上，不会变成负数', () => {
  // 触发时得让队伍活着 —— 缺柴会先饿死人，over 之后就不再抽事件了。
  // 人数压到 1 要等事件已经挂上再做
  const g = forceEvent('hardWinter', (s) => {
    s.stock.wood = 5; // < 6，命中高概率那条
    s.stock.food = 50;
  });

  g.party.people = 1;
  g.stock.wood = 0;

  const cold = currentEvent(g)!.choices.findIndex((c) => c.effect.people != null);
  assert.ok(cold >= 0, '硬扛那个选项没找到');

  assert.equal(chooseEvent(g, cold), true);
  assert.equal(g.party.people, 0, '不该变成负数');
  assert.ok(g.over, '人死光了就该结束');
});

test('once 事件一局只触发一次', () => {
  const g = forceEvent('oldCache', (s) => {
    s.stock.food = 20;
    s.stock.wood = 20;
  });

  assert.ok(g.seenEvents.includes('oldCache'));
  chooseEvent(g, 0);

  for (let i = 0; i < 200; i += 1) {
    g.stock.food = 20;
    g.stock.wood = 20;
    g.party.people = 3;
    endTurn(g);
    if (g.pendingEvent) {
      assert.notEqual(g.pendingEvent, 'oldCache', 'once 事件又触发了一次');
      chooseEvent(g, freeChoice(g));
    }
  }
});

test('同一个种子跑出同一串事件 —— 随机数状态在 state 里', () => {
  const run = () => {
    const g = createGame({ seed: 'repeat-me' });
    const seen: string[] = [];
    for (let i = 0; i < 60; i += 1) {
      g.stock.food = 40;
      g.stock.wood = 40;
      endTurn(g);
      if (g.pendingEvent) {
        seen.push(`${g.turn}:${g.pendingEvent}`);
        chooseEvent(g, freeChoice(g));
      }
    }
    return seen;
  };

  const a = run();
  assert.ok(a.length > 0, '60 回合一个事件都没出，事件表或概率有问题');
  assert.deepEqual(run(), a, '同一个种子两次跑出了不同的事件序列');
});

// ---------------------------------------------------------------- 事件表体检

test('事件 id 不重复，且 findEvent 找得到每一个', () => {
  const ids = EVENTS.map((e) => e.id);
  assert.equal(new Set(ids).size, ids.length, '有重复的事件 id');
  for (const id of ids) assert.ok(findEvent(id), `${id} 找不回来`);
});

test('每个事件都至少有一个不带 require 的选择', () => {
  // 全都带条件的话，资源不够时玩家会被卡死在弹窗里，回合都推不动
  for (const e of EVENTS) {
    assert.ok(e.choices.length >= 1, `${e.id} 一个选择都没有`);
    assert.ok(
      e.choices.some((c) => !c.require || c.require.length === 0),
      `${e.id} 的选择全都带条件，玩家可能被卡死`,
    );
  }
});

test('每个事件的概率都在 0..1 之间，而且不是 0', () => {
  for (const e of EVENTS) {
    assert.ok(e.trigger.length >= 1, `${e.id} 没有触发条件`);
    for (const r of e.trigger) {
      assert.ok(r.chance > 0 && r.chance <= 1, `${e.id} 的概率 ${r.chance} 不在 (0, 1]`);
      assert.ok(r.when.length >= 1, `${e.id} 有一条规则没有条件，会每回合无脑触发`);
    }
  }
});

test('两种语言的文案都在，而且不是照抄', () => {
  const both = (b: { en: string; zh: string }, where: string) => {
    assert.ok(b.en?.length > 0, `${where} 缺英文`);
    assert.ok(b.zh?.length > 0, `${where} 缺中文`);
    assert.notEqual(b.zh, b.en, `${where} 的中文照抄了英文`);
  };

  for (const e of EVENTS) {
    both(e.text, `${e.id} 的正文`);
    e.choices.forEach((c, i) => both(c.label, `${e.id} 的第 ${i} 个选择`));
  }
});

test('表里每个事件都真的触发得了', () => {
  // 条件写矛盾了（比如 food > 30 且 food < 5）在代码里看不出来，
  // 只有玩到那一回合才发现它永远不出现
  for (const e of EVENTS) {
    assert.doesNotThrow(
      () =>
        forceEvent(e.id, (s) => {
          s.turn = Math.max(s.turn, 20);
          s.stock.food = 40;
          s.stock.wood = 3;
          s.party.people = 8;
          // 扎营，否则 idle 恒为 0，靠闲人触发的事件永远够不着
          makeCamp(s);
        }),
      `${e.id} 触发不了`,
    );
  }
});
