/**
 * 六边形数学的性质测试。跑：npm test
 *
 * 这些都是坐标系自带的恒等式，不是拍脑袋定的期望值 —— 任何一条挂了，
 * 说明 hex.ts 里某个公式和另一个公式对不上，而画面上只会表现为"有点歪"。
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  axialToOffset,
  axialToPixel,
  corners,
  distance,
  key,
  neighbors,
  offsetToAxial,
  pixelToAxial,
  range,
  reachable,
  ring,
  type Axial,
} from './hex.ts';

const SIZE = 24;

/** 覆盖原点四周一片，正负都有 */
function sample(): Axial[] {
  return range({ q: 0, r: 0 }, 12);
}

test('像素转换可逆：格子中心转成像素再转回来必须是同一格', () => {
  for (const h of sample()) {
    const p = axialToPixel(h, SIZE);
    assert.deepEqual(pixelToAxial(p.x, p.y, SIZE), h, `${key(h)} 转换后跑掉了`);
  }
});

test('格子内任意一点都吸附回这一格，不会选到隔壁', () => {
  // 沿中心到每个角的方向取 90% 处 —— 最容易被错误的取整方式选错的位置
  for (const h of sample()) {
    const c = axialToPixel(h, SIZE);
    for (const [x, y] of corners(c.x, c.y, SIZE)) {
      const px = c.x + (x - c.x) * 0.9;
      const py = c.y + (y - c.y) * 0.9;
      assert.deepEqual(pixelToAxial(px, py, SIZE), h, `${key(h)} 的角落吸附到了别的格`);
    }
  }
});

test('偏移坐标可逆', () => {
  for (let row = 0; row < 20; row += 1) {
    for (let col = 0; col < 20; col += 1) {
      const h = offsetToAxial(col, row);
      assert.deepEqual(axialToOffset(h), { col, row });
    }
  }
});

test('六个邻居都恰好在 1 步之外，且互不相同', () => {
  for (const h of sample()) {
    const ns = neighbors(h);
    assert.equal(new Set(ns.map(key)).size, 6);
    for (const n of ns) assert.equal(distance(h, n), 1);
  }
});

test('range(n) 的格子数是 3n²+3n+1，且都在 n 步以内', () => {
  const center = { q: 3, r: -5 };
  for (let n = 0; n <= 6; n += 1) {
    const hexes = range(center, n);
    assert.equal(hexes.length, 3 * n * n + 3 * n + 1);
    assert.equal(new Set(hexes.map(key)).size, hexes.length, '有重复');
    for (const h of hexes) assert.ok(distance(center, h) <= n);
  }
});

test('ring(n) 是 6n 格，且每格距离恰好是 n', () => {
  const center = { q: -2, r: 4 };
  for (let n = 1; n <= 6; n += 1) {
    const hexes = ring(center, n);
    assert.equal(hexes.length, 6 * n);
    assert.equal(new Set(hexes.map(key)).size, hexes.length, '有重复');
    for (const h of hexes) assert.equal(distance(center, h), n);
  }
});

test('每格代价都是 1 时，reachable 的结果等于 range，且代价等于距离', () => {
  const center = { q: 1, r: 1 };
  const budget = 4;
  const got = reachable(center, budget, () => 1);

  const want = range(center, budget).filter((h) => distance(center, h) > 0);
  assert.equal(got.size, want.length);
  for (const h of want) {
    const entry = got.get(key(h));
    assert.ok(entry, `${key(h)} 应该可达`);
    assert.equal(entry.cost, distance(center, h), `${key(h)} 的代价不等于距离`);
  }
});

test('reachable 绕得开障碍：一圈墙把中心封死后无处可去', () => {
  const center = { q: 0, r: 0 };
  const wall = new Set(ring(center, 1).map(key));
  const got = reachable(center, 10, (h) => (wall.has(key(h)) ? null : 1));
  assert.equal(got.size, 0);
})

test('reachable 会为绕远路找到更便宜的走法，而不是认下第一次算出的代价', () => {
  // 代价是'进入这一格要花多少'，与从哪边进来无关，所以沼泽格本身没法变便宜，
  // 但它后面那一格可以：穿过沼泽 9+1=10，从下面绕三步只要 3。
  // 按层推进时 (2,0) 会先在第 2 层被记成 10，必须在第 3 层被改写成 3。
  const center = { q: 0, r: 0 };
  const swamp = key({ q: 1, r: 0 });
  const behind = key({ q: 2, r: 0 });

  const got = reachable(center, 10, (h) => (key(h) === swamp ? 9 : 1));
  assert.equal(got.get(swamp)?.cost, 9, '沼泽本身只能硬穿');
  assert.equal(got.get(behind)?.cost, 3, '沼泽后面那格应该走 (0,1)→(1,1) 绕过去');
});
