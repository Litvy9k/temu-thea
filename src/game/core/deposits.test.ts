/**
 * 矿脉系统的测试。
 *
 * 这一套要守住的是三件事：
 *   分布   密度确实随距离升高，而且每张图上三种都找得到；
 *   合流   矿产真的进了结算，不只是显示在面板上；
 *   兼容   老存档读得回来，新存档存得下矿脉。
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { distance } from './hex.ts';
import { DEPOSITS, DEPOSIT_ORDER, densityAt, yieldsOf } from './deposits.ts';
import { generateMap, hexOfIndex, tileAt } from './map.ts';
import { RESOURCES, TERRAIN, primaryOf } from './terrain.ts';
import { TOOLS, TOOL_ORDER, TOOL_PRIORITY } from './works.ts';
import { seedFrom } from './rng.ts';
import {
  CAMP_RADIUS,
  HARVEST_GOAL,
  createGame,
  endTurn,
  makeCamp,
  refreshVision,
  workableTiles,
} from './state.ts';

const SEEDS = ['thea', 'nomad', 'ash', 'quarry', '冬岭'];

const mapFor = (seed: string) =>
  generateMap({ width: 64, height: 44, seed: seedFrom(seed), campRadius: CAMP_RADIUS });

// ---------------------------------------------------------------- 分布

test('矿脉只出现在它允许的地形上', () => {
  for (const seed of SEEDS) {
    const map = mapFor(seed);
    for (const tile of map.tiles) {
      if (!tile.deposit) continue;
      assert.ok(
        DEPOSITS[tile.deposit].terrain.includes(tile.terrain),
        `${seed}: ${tile.deposit} 出现在了 ${tile.terrain} 上`,
      );
    }
  }
});

test('出生点周围一圈永远没有矿脉', () => {
  // near 最小的是黏土（1），所以半径 1 的作业圈内必定为空 ——
  // 开局第一眼就看见铁矿会把整条向外迁徙的线直接跳过
  for (const seed of SEEDS) {
    const map = mapFor(seed);
    for (let i = 0; i < map.tiles.length; i += 1) {
      if (distance(map.origin, hexOfIndex(map, i)) > CAMP_RADIUS) continue;
      assert.equal(map.tiles[i].deposit, null, `${seed}: 出生点旁边就有 ${map.tiles[i].deposit}`);
    }
  }
});

test('离出生点越远矿脉越密', () => {
  // 这是玩家能感觉到的那条设计：往外走有回报。分档统计，
  // 只比"近处一半"和"远处一半"，避免被单个环的噪声带偏
  const near: Record<string, number> = { iron: 0, game: 0, clay: 0, land: 0 };
  const far: Record<string, number> = { iron: 0, game: 0, clay: 0, land: 0 };

  for (const seed of SEEDS) {
    const map = mapFor(seed);
    for (let i = 0; i < map.tiles.length; i += 1) {
      const tile = map.tiles[i];
      if (tile.terrain === 'ocean') continue;
      const d = distance(map.origin, hexOfIndex(map, i));
      // 12 是铁矿的 near，两侧都有足够的样本
      const bucket = d < 12 ? near : far;
      bucket.land += 1;
      if (tile.deposit) bucket[tile.deposit] += 1;
    }
  }

  for (const id of DEPOSIT_ORDER) {
    const a = near[id] / near.land;
    const b = far[id] / far.land;
    assert.ok(b > a, `${id} 在远处反而更稀疏：近 ${(a * 100).toFixed(2)}% 远 ${(b * 100).toFixed(2)}%`);
  }
});

test('每张图上三种矿脉都找得到', () => {
  // 一张图上完全没有铁，等于那一局的升级线被砍掉一整条，
  // 而玩家会一直找下去，永远不知道是自己没找到还是根本没有
  for (const seed of SEEDS) {
    const map = mapFor(seed);
    const seen = new Set(map.tiles.map((t) => t.deposit).filter(Boolean));
    for (const id of DEPOSIT_ORDER) {
      assert.ok(seen.has(id), `${seed} 这张图上一处 ${id} 都没有`);
    }
  }
});

test('同一个种子生成同一张矿脉布局', () => {
  const a = mapFor('thea').tiles.map((t) => t.deposit ?? '.').join('');
  const b = mapFor('thea').tiles.map((t) => t.deposit ?? '.').join('');
  assert.equal(a, b);
});

test('densityAt 在 near 之前是 0，到 far 之后满值', () => {
  const d = DEPOSITS.iron;
  assert.equal(densityAt(d, d.near - 1), 0);
  assert.equal(densityAt(d, d.near), 0);
  assert.equal(densityAt(d, d.far), d.density);
  assert.equal(densityAt(d, d.far + 50), d.density);
  // 中点应该恰好是一半
  assert.ok(Math.abs(densityAt(d, (d.near + d.far) / 2) - d.density / 2) < 1e-9);
});

// ---------------------------------------------------------------- 产出合流

test('矿产叠加在地形产出之上，不顶掉它', () => {
  const y = yieldsOf('hills', 'iron');
  assert.equal(y.stone, TERRAIN.hills.yields.stone, '丘陵的石料被矿脉改掉了');
  assert.equal(y.iron, DEPOSITS.iron.per);
  assert.deepEqual(yieldsOf('hills', null), TERRAIN.hills.yields);
});

test('矿产不超过地形主产，所以工具还认这块地', () => {
  /*
   * 这是一条**表级的不变量**，不是某一格的性质：矿产一旦高过地形主产，
   * 这块地的"主业"就变成了采矿，而工具是跟着主业走的——于是斧头锄头
   * 全部失效，而玩家看到的只是"在这格上工具好像没生效"。
   *
   * 历史上真撑到过：黏土坑曾经产 4，而沼泽是食 2 木 2。
   */
  for (const [id, d] of Object.entries(DEPOSITS)) {
    for (const terrain of d.terrain) {
      const bare = TERRAIN[terrain].yields;
      const top = Math.max(...Object.values(bare));
      assert.ok(
        d.per <= top,
        `${id} 在 ${terrain} 上产 ${d.per}，高过了该地形的主产 ${top}`,
      );

      // 同时从结果上再确认一遍：原来的主产一个都不能丢
      const primary = primaryOf(yieldsOf(terrain, id as keyof typeof DEPOSITS));
      for (const res of primaryOf(bare)) {
        assert.ok(primary.includes(res), `${id} 在 ${terrain} 上把主产 ${res} 顶掉了`);
      }
    }
  }
});

test('发工具时铁器排在石器前面', () => {
  /*
   * TOOL_PRIORITY 决定谁先拿，TOOL_ORDER 决定菜单怎么排 —— 两回事。
   * 合并成一份时，开局第一回合的制作页最上面摆的是做不出来的铁斧。
   */
  for (const [better, worse] of [
    ['ironAxe', 'axe'],
    ['ironHoe', 'hoe'],
  ] as const) {
    assert.ok(TOOLS[better].bonus > TOOLS[worse].bonus, `${better} 应该比 ${worse} 强`);
    assert.ok(
      TOOL_PRIORITY.indexOf(better) < TOOL_PRIORITY.indexOf(worse),
      `发放顺序里 ${worse} 排在了 ${better} 前面，先部署的人会拿到差的那把`,
    );
  }

  // 两张表必须盖全工具：漏了的那把要么制作页上看不见，要么造了发不出去
  const all = Object.keys(TOOLS).sort();
  assert.deepEqual([...TOOL_ORDER].sort(), all, 'TOOL_ORDER 漏了工具');
  assert.deepEqual([...TOOL_PRIORITY].sort(), all, 'TOOL_PRIORITY 漏了工具');
});

/** 离 h 正好 d 格、而且站得上去的一块地 */
function standAt(g: ReturnType<typeof createGame>, h: { q: number; r: number }, d: number) {
  for (let i = 0; i < g.map.tiles.length; i += 1) {
    const x = hexOfIndex(g.map, i);
    if (distance(x, h) !== d) continue;
    if (TERRAIN[g.map.tiles[i].terrain].moveCost != null) return x;
  }
  throw new Error(`矿脉周围 ${d} 格找不到站得住的地方`);
}

test('远远看见只知道有东西，走到跟前才知道是什么', () => {
  /*
   * 看见和探查是两档信息。资源栏要等**探查**才加那一行 ——
   * 看见时就加，等于把 ? 的答案直接写在了资源栏里。
   */
  const g = createGame({ seed: 'thea' });
  const idx = g.map.tiles.findIndex((t) => t.deposit === 'iron');
  assert.ok(idx >= 0, '这张图上没有铁矿，测试前提不成立');
  const vein = hexOfIndex(g.map, idx);
  const tile = g.map.tiles[idx];

  // 站在两格外：看得见，但不在采集半径里
  g.party.at = standAt(g, vein, 2);
  refreshVision(g);
  assert.ok(tile.explored, '两格外应该看得见');
  assert.equal(tile.surveyed, false, '还没走到跟前就探查了');
  assert.ok(!g.seenResources.includes('iron'), '没探查，资源栏却已经泄露了答案');

  // 走到旁边一格：游荡时路过也算探查
  g.party.at = standAt(g, vein, 1);
  refreshVision(g);
  assert.equal(tile.surveyed, true, '走到旁边了还没探查');
  assert.ok(g.seenResources.includes('iron'), '探查到铁了，资源栏却没把它列出来');
  assert.equal(g.stock.iron, 0, '只是探查，不该白给资源');

  // 走远了也不会忘
  g.party.at = standAt(g, vein, 4);
  refreshVision(g);
  assert.equal(tile.surveyed, true, '走开以后又变回未探查了');
});

test('能派工的格子一定已经探查过', () => {
  /*
   * 这条不变量靠"探查半径 = 采集半径"成立，没有任何显式检查。
   * 哪天两个半径被分开，这里会先炸 —— 否则症状是派了人才发现
   * 那块地在产一种玩家从没见过的资源。
   */
  for (const seed of ['thea', 'nomad', 'ash', 'quarry']) {
    const g = createGame({ seed });
    makeCamp(g);
    for (const h of workableTiles(g)) {
      assert.ok(tileAt(g.map, h)!.surveyed, `${seed}: 作业格 ${h.q},${h.r} 还没探查`);
    }
  }
});

test('派人到矿脉格上，结算时真的进库存', () => {
  // 最要紧的一条：面板显示和 endTurn 结算是两条代码路径，
  // 只改了一条的症状是"写着能采铁，采了一回合库存没动"
  const g = createGame({ seed: 'thea' });
  const map = g.map;

  const idx = map.tiles.findIndex((t) => t.deposit === 'iron');
  assert.ok(idx >= 0, '这张图上没有铁矿，测试前提不成立');
  const vein = hexOfIndex(map, idx);

  // 直接把营地摆到矿脉旁边，省掉一路走过去
  const spot = { q: vein.q + 1, r: vein.r };
  g.party.at = spot;
  const k = `${vein.q},${vein.r}`;
  g.camp = { at: spot, crew: { [k]: 2 }, order: [k, k] };
  g.party.people = 2;
  tileAt(map, vein)!.progress = HARVEST_GOAL - 1;

  const before = g.stock.iron;
  endTurn(g);
  assert.ok(g.stock.iron > before, `铁没进库存：${before} → ${g.stock.iron}`);
  assert.ok(g.seenResources.includes('iron'), '采到铁了，HUD 却还没把它列出来');
});

test('矿脉符号和它产的资源符号是同一个', () => {
  // 地图上画矿脉符号，资源栏和采集面板画资源符号。两边不一致的话，
  // 玩家会以为是两种东西 —— 黏土就曾经是地图上 ▱、资源栏里 ▰
  for (const [id, d] of Object.entries(DEPOSITS)) {
    assert.equal(d.glyph, RESOURCES[d.res].glyph, `${id} 的符号和 ${d.res} 不一致`);
  }
});
