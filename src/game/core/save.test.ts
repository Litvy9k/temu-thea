/**
 * 存档的往返测试。
 *
 * 存档最坏的失败方式不是报错，是**读回来少了点什么** —— 派工没了、进度清零、
 * 工具不见了。这种事只有在玩了几十回合之后才看得出来，所以这里先玩一局
 * 再存读，然后整个状态深比较。
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { SAVE_VERSION, SaveError, parseSave, saveFilename, serialize } from './save.ts';
import {
  assign,
  buildBuilding,
  craftTool,
  createGame,
  endTurn,
  makeCamp,
  workableTiles,
  type GameState,
} from './state.ts';
import { TERRAIN } from './terrain.ts';
import { DEPOSITS, type DepositId } from './deposits.ts';
import { tileAt } from './map.ts';

/** 玩出一个有内容的局面：营地、派工、设施、工具、走过的进度 */
function played(): GameState {
  const g = createGame({ seed: 'thea' });
  makeCamp(g);
  g.stock.wood = 200;
  g.stock.stone = 200;
  g.party.people = 6;

  buildBuilding(g, 'workshop');
  buildBuilding(g, 'watchtower');
  craftTool(g, 'axe');
  craftTool(g, 'hoe');

  const tiles = workableTiles(g);
  assign(g, tiles[0]);
  assign(g, tiles[0]);
  assign(g, tiles[1]);

  for (let i = 0; i < 3; i += 1) endTurn(g);
  return g;
}

test('存了再读，整个状态一模一样', () => {
  const before = played();
  const after = parseSave(serialize(before));

  // version 是给 React 用的重绘计数，不属于存档内容
  assert.deepEqual({ ...after, version: 0 }, { ...before, version: 0 });
});

test('派工、工具、设施、采集进度都活着回来了', () => {
  // 上一条的 deepEqual 已经覆盖，但它挂掉时只会说"两个巨大的对象不相等"。
  // 这几条断言是为了让失败信息直接指出丢的是哪一样
  const before = played();
  const after = parseSave(serialize(before));

  assert.deepEqual(after.camp?.crew, before.camp?.crew, '派工丢了');
  assert.deepEqual(after.camp?.order, before.camp?.order, '部署顺序丢了');
  assert.deepEqual(after.works, before.works, '设施或工具丢了');
  assert.equal(after.turn, before.turn);

  const worked = workableTiles(before).find((h) => tileAt(before.map, h)!.progress > 0);
  assert.ok(worked, '这一局应该有格子留着进度，测试前提不成立');
  assert.equal(tileAt(after.map, worked)!.progress, tileAt(before.map, worked)!.progress, '进度丢了');
});

test('地图每一格的地形都对得上', () => {
  const before = played();
  const after = parseSave(serialize(before));

  assert.equal(after.map.tiles.length, before.map.tiles.length);
  for (let i = 0; i < before.map.tiles.length; i += 1) {
    assert.equal(after.map.tiles[i].terrain, before.map.tiles[i].terrain, `第 ${i} 格地形不对`);
    assert.equal(after.map.tiles[i].explored, before.map.tiles[i].explored, `第 ${i} 格探明状态不对`);
  }
});

test('所有地形都有编码 —— 加了新地形忘了登记会在这里被拦下', () => {
  const g = createGame({ seed: 'thea' });
  // 把每种地形都塞进地图里，逼序列化去编码它们
  const ids = Object.keys(TERRAIN) as (keyof typeof TERRAIN)[];
  ids.forEach((id, i) => {
    g.map.tiles[i].terrain = id;
  });

  const back = parseSave(serialize(g));
  ids.forEach((id, i) => assert.equal(back.map.tiles[i].terrain, id, `${id} 没编码对`));
});

test('所有矿脉都有编码 —— 加了新矿脉忘了登记会在这里被拦下', () => {
  const g = createGame({ seed: 'thea' });
  const ids = Object.keys(DEPOSITS) as DepositId[];
  ids.forEach((id, i) => {
    g.map.tiles[i].deposit = id;
  });
  // 再留一格空的：'.' 那条分支占绝大多数格子，反而最容易漏测
  g.map.tiles[ids.length].deposit = null;

  const back = parseSave(serialize(g));
  ids.forEach((id, i) => assert.equal(back.map.tiles[i].deposit, id, `${id} 没编码对`));
  assert.equal(back.map.tiles[ids.length].deposit, null);
});

test('没有矿脉列的老存档还读得回来', () => {
  /*
   * 矿脉、origin、三种新资源都是后加的字段。加字段并给了安全默认值
   * **不该提 v** —— 提了就等于把读得回来的存档全部作废。
   * 这里手工把新字段拆掉，模拟一份上个版本存的档。
   */
  const g = played();
  const file = JSON.parse(serialize(g));
  delete file.map.deposit;
  delete file.map.origin;
  delete file.seenResources;
  file.stock = { food: file.stock.food, wood: file.stock.wood, stone: file.stock.stone };
  file.works.tools = { axe: file.works.tools.axe, hoe: file.works.tools.hoe };

  const back = parseSave(JSON.stringify(file));
  assert.ok(back.map.tiles.every((t) => t.deposit === null), '凭空造出了矿脉');
  assert.equal(back.stock.iron, 0, '缺的资源没补成 0');
  assert.equal(back.works.tools.pick, 0, '缺的工具没补成 0');
  // undefined 的工具数量不会报错，只会让 left[t] > 0 永远为假，工具静静失效
  assert.ok(Number.isFinite(back.works.tools.ironAxe));
  assert.deepEqual(back.seenResources.slice(0, 3), ['food', 'wood', 'stone']);
});

test('存档比整份 stringify 小一个量级', () => {
  const g = played();
  const compact = serialize(g).length;
  const naive = JSON.stringify(g).length;

  assert.ok(compact * 5 < naive, `压缩没生效：${compact} vs ${naive}`);
});

test('坏文件抛的是人话，不是崩溃，而且中英文都有', () => {
  const cases: [string, RegExp][] = [
    ['这不是 json', /valid JSON/i],
    ['123', /not an object/i],
    [JSON.stringify({ v: 999 }), /version mismatch/i],
    [JSON.stringify({ v: SAVE_VERSION }), /no map size/i],
  ];

  for (const [input, pattern] of cases) {
    assert.throws(
      () => parseSave(input),
      (err: unknown) => {
        assert.ok(err instanceof SaveError, '应该抛 SaveError');
        assert.match(err.msg.en, pattern);
        // 两种语言都得有，缺一种就等于线上某个语言看到 undefined
        assert.ok(err.msg.zh.length > 0, '缺中文');
        assert.notEqual(err.msg.zh, err.msg.en, '中文没写，照抄了英文');
        return true;
      },
    );
  }

  const g = played();
  const broken = JSON.parse(serialize(g));
  broken.map.terrain = broken.map.terrain.slice(0, 10);
  assert.throws(() => parseSave(JSON.stringify(broken)), /terrain data length/i);
});

test('文件名带回合数，且只含文件系统安全的字符', () => {
  const g = played();
  const name = saveFilename(g);
  assert.match(name, /^temu-thea-t\d+-\d{8}-\d{4}\.json$/);
});

test('探查状态存得下：小写是没探查，大写是探查过', () => {
  const g = createGame({ seed: 'thea' });
  const veins = g.map.tiles
    .map((t, i) => [t, i] as const)
    .filter(([t]) => t.deposit)
    .slice(0, 2);
  assert.equal(veins.length, 2, '这张图上矿脉不够两处，测试前提不成立');
  veins[0][0].surveyed = true;
  veins[1][0].surveyed = false;

  const back = parseSave(serialize(g));
  assert.equal(back.map.tiles[veins[0][1]].surveyed, true);
  assert.equal(back.map.tiles[veins[1][1]].surveyed, false, '没探查的矿脉读回来变成探查过了');
  assert.equal(back.map.tiles[veins[1][1]].deposit, veins[1][0].deposit, '小写编码把矿脉种类读错了');
});

test('这个机制出现之前的存档，矿脉全算探查过', () => {
  // 老存档的矿脉列全是大写。读回来要是变成未探查，就等于把玩家
  // 已经知道的东西又藏了起来
  const g = createGame({ seed: 'thea' });
  for (const t of g.map.tiles) if (t.deposit) t.surveyed = false;
  const file = JSON.parse(serialize(g));
  file.map.deposit = file.map.deposit.toUpperCase();

  const back = parseSave(JSON.stringify(file));
  for (const t of back.map.tiles) if (t.deposit) assert.equal(t.surveyed, true);
});
