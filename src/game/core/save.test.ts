/**
 * 存档的往返测试。
 *
 * 存档最坏的失败方式不是报错，是**读回来少了点什么** —— 派工没了、进度清零、
 * 工具不见了。这种事只有在玩了几十回合之后才看得出来，所以这里先玩一局
 * 再存读，然后整个状态深比较。
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { SAVE_VERSION, parseSave, saveFilename, serialize } from './save.ts';
import {
  assign,
  buildFacility,
  craftTool,
  createGame,
  endTurn,
  makeCamp,
  workableTiles,
  type GameState,
} from './state.ts';
import { TERRAIN } from './terrain.ts';
import { tileAt } from './map.ts';

/** 玩出一个有内容的局面：营地、派工、设施、工具、走过的进度 */
function played(): GameState {
  const g = createGame({ seed: 'thea' });
  makeCamp(g);
  g.stock.wood = 200;
  g.stock.stone = 200;
  g.party.people = 6;

  buildFacility(g, 'workshop');
  buildFacility(g, 'watchtower');
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

test('存档比整份 stringify 小一个量级', () => {
  const g = played();
  const compact = serialize(g).length;
  const naive = JSON.stringify(g).length;

  assert.ok(compact * 5 < naive, `压缩没生效：${compact} vs ${naive}`);
});

test('坏文件抛的是人话，不是崩溃', () => {
  assert.throws(() => parseSave('这不是 json'), /有效的 JSON/);
  assert.throws(() => parseSave('123'), /不是一个对象/);
  assert.throws(() => parseSave(JSON.stringify({ v: 999 })), /版本/);
  assert.throws(() => parseSave(JSON.stringify({ v: SAVE_VERSION })), /地图尺寸/);

  const g = played();
  const broken = JSON.parse(serialize(g));
  broken.map.terrain = broken.map.terrain.slice(0, 10);
  assert.throws(() => parseSave(JSON.stringify(broken)), /地形数据长度/);
});

test('文件名带回合数，且只含文件系统安全的字符', () => {
  const g = played();
  const name = saveFilename(g);
  assert.match(name, /^temu-thea-t\d+-\d{8}-\d{4}\.json$/);
});
