/**
 * 把生成的地图打成 ASCII 丢到终端。调地形阈值时用 ——
 * 比开浏览器快得多，而且一屏能看完整张图的宏观结构。
 *
 *   npm run map            默认种子
 *   npm run map -- 温泉关   指定种子
 */
import { generateMap } from '../src/game/core/map.ts';
import { seedFrom } from '../src/game/core/rng.ts';
import { TERRAIN, type TerrainId } from '../src/game/core/terrain.ts';

const W = 64;
const H = 36;
const seedText = process.argv[2] ?? 'thea';
const map = generateMap({ width: W, height: H, seed: seedFrom(seedText) });

// 终端里辨识度比游戏内的符号重要，所以另用一套
const CH: Record<TerrainId, string> = {
  ocean: ' ',
  shallow: '.',
  marsh: '"',
  grass: ',',
  forest: '#',
  hills: 'n',
  mountain: '^',
  desert: '~',
  tundra: '-',
};

for (let row = 0; row < H; row += 1) {
  let line = row % 2 ? ' ' : '';
  for (let col = 0; col < W; col += 1) line += `${CH[map.tiles[row * W + col].terrain]} `;
  console.log(line);
}

const count: Record<string, number> = {};
for (const t of map.tiles) count[t.terrain] = (count[t.terrain] ?? 0) + 1;

const total = map.tiles.length;
const land = total - (count.ocean ?? 0) - (count.shallow ?? 0);
console.log(`\n种子 ${seedText}   陆地占比 ${((land / total) * 100).toFixed(1)}%`);
console.log(
  Object.entries(count)
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `${TERRAIN[k as TerrainId].label.zh} ${((v / total) * 100).toFixed(1)}%`)
    .join('   '),
);
