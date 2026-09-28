/**
 * 矿脉分布的体检表。
 *
 *   npm run veins            默认跑 8 个种子
 *   npm run veins -- 12      跑 12 个
 *
 * 要回答的是**一个问题**：从出生点出发，走多远才撞得上第一处铁矿？
 * 密度参数是拍脑袋定的，只有量出来的首见距离才算数 —— 照着 deposits.ts
 * 里的 near 估会偏乐观，因为 near 只是"最早可能"，不是"实际上"。
 *
 * "首见距离"按**可达的最近一处**算：走不进去的深海不挡路（矿在陆地上），
 * 所以这里用的是直线距离，实际赶路还要更久。
 */
import { distance } from '../src/game/core/hex.ts';
import { DEPOSITS, DEPOSIT_ORDER, type DepositId } from '../src/game/core/deposits.ts';
import { generateMap, hexOfIndex } from '../src/game/core/map.ts';
import { CAMP_RADIUS } from '../src/game/core/state.ts';
import { seedFrom } from '../src/game/core/rng.ts';

const SEEDS = ['thea', 'nomad', '海路', 'thermopylae', 'ash', '冬岭', 'quarry', 'saltmarsh'];

const runs = Number(process.argv[2] ?? SEEDS.length);
const pad = (s: string | number, n: number) => String(s).padStart(n);

const totals: Record<DepositId, number[]> = { iron: [], game: [], clay: [] };
const firsts: Record<DepositId, number[]> = { iron: [], game: [], clay: [] };

console.log(
  `${pad('seed', 12)} │ ` +
    DEPOSIT_ORDER.map((id) => `${pad(DEPOSITS[id].label.en, 11)} count/first`).join(' │ '),
);
console.log('─'.repeat(12 + 3 + DEPOSIT_ORDER.length * 26));

for (let i = 0; i < runs; i += 1) {
  const name = SEEDS[i % SEEDS.length] + (i >= SEEDS.length ? `#${i}` : '');
  const map = generateMap({ width: 64, height: 44, seed: seedFrom(name), campRadius: CAMP_RADIUS });

  const count: Record<string, number> = {};
  const first: Record<string, number> = {};

  for (let t = 0; t < map.tiles.length; t += 1) {
    const dep = map.tiles[t].deposit;
    if (!dep) continue;
    const d = distance(map.origin, hexOfIndex(map, t));
    count[dep] = (count[dep] ?? 0) + 1;
    first[dep] = Math.min(first[dep] ?? Infinity, d);
  }

  for (const id of DEPOSIT_ORDER) {
    totals[id].push(count[id] ?? 0);
    firsts[id].push(first[id] ?? Infinity);
  }

  console.log(
    `${pad(name, 12)} │ ` +
      DEPOSIT_ORDER.map(
        (id) =>
          `${pad(count[id] ?? 0, 15)} / ${pad(first[id] === Infinity || first[id] == null ? '—' : first[id], 6)}`,
      ).join(' │ '),
  );
}

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

// 按距离分档的密度：这才是"越往外越密"那条设计直接对应的数字。
// 看总数看不出梯度 —— 外圈本来就格子多，均匀撒也会是外圈多
const BAND = 6;
const BANDS = 6;
const hit = DEPOSIT_ORDER.map(() => new Array(BANDS).fill(0));
const land = new Array(BANDS).fill(0);

for (let i = 0; i < runs; i += 1) {
  const name = SEEDS[i % SEEDS.length] + (i >= SEEDS.length ? `#${i}` : '');
  const map = generateMap({ width: 64, height: 44, seed: seedFrom(name), campRadius: CAMP_RADIUS });

  for (let t = 0; t < map.tiles.length; t += 1) {
    const tile = map.tiles[t];
    if (tile.terrain === 'ocean') continue;
    const b = Math.min(BANDS - 1, Math.floor(distance(map.origin, hexOfIndex(map, t)) / BAND));
    land[b] += 1;
    if (tile.deposit) hit[DEPOSIT_ORDER.indexOf(tile.deposit)][b] += 1;
  }
}

console.log();
console.log(
  `${pad('距出生点', 10)} │ ` +
    Array.from({ length: BANDS }, (_, b) =>
      pad(b === BANDS - 1 ? `${b * BAND}+` : `${b * BAND}-${(b + 1) * BAND - 1}`, 7),
    ).join(' │ '),
);
console.log('─'.repeat(12 + BANDS * 10));
DEPOSIT_ORDER.forEach((id, k) => {
  console.log(
    `${pad(DEPOSITS[id].label.en, 11)} │ ` +
      hit[k]
        .map((c, b) => pad(land[b] ? `${((c / land[b]) * 100).toFixed(1)}%` : '—', 7))
        .join(' │ '),
  );
});
console.log(`${pad('陆地格数', 10)} │ ` + land.map((c) => pad(c, 7)).join(' │ '));

console.log();
for (const id of DEPOSIT_ORDER) {
  const f = firsts[id].filter((x) => Number.isFinite(x));
  console.log(
    `${pad(DEPOSITS[id].label.en, 12)}  ` +
      `平均 ${mean(totals[id]).toFixed(1)} 处 · 首见距离 ` +
      `${f.length ? mean(f).toFixed(1) : '—'}（最近 ${f.length ? Math.min(...f) : '—'}，` +
      `最远 ${f.length ? Math.max(...f) : '—'}）` +
      (f.length < firsts[id].length ? `  ⚠ ${firsts[id].length - f.length} 张图上一处都没有` : ''),
  );
}
