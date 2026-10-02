/**
 * 模拟一局，把经济曲线打到终端上。
 *
 *   npm run sim            默认种子跑 24 回合
 *   npm run sim -- 海路 40  指定种子和回合数
 *
 * 派工用一个很笨的贪心策略（哪样资源少就往产那样的格子上派人）—— 它代表
 * "一个还算清醒的玩家"。如果连它都会饿死，说明数值不是难，是坏。
 */
import {
  assign,
  choiceAllowed,
  chooseEvent,
  createGame,
  crewAt,
  crewCap,
  currentEvent,
  endTurn,
  idleCount,
  makeCamp,
  unassign,
  workableTiles,
} from '../src/game/core/state.ts';
import { TERRAIN } from '../src/game/core/terrain.ts';
import { tileAt } from '../src/game/core/map.ts';

const seed = process.argv[2] ?? 'thea';
const turns = Number(process.argv[3] ?? 24);

/** 低于这个存量就认为该资源还不安全，先补它 */
const BUFFER = 20;

const game = createGame({ seed });
const start = tileAt(game.map, game.party.at)!;
console.log(`种子 ${seed}   开局 ${TERRAIN[start.terrain].label.zh} ${game.party.at.q},${game.party.at.r}`);

if (!makeCamp(game)) throw new Error('开局位置扎不了营，findStart 的条件有问题');

const tiles = workableTiles(game);
console.log(
  '作业圈：',
  tiles
    .map((h) => {
      const y = TERRAIN[tileAt(game.map, h)!.terrain];
      const parts = Object.entries(y.yields).map(([k, v]) => `${k}${v}`);
      return `${y.label.zh}(${parts.join(' ') || '—'})`;
    })
    .join('  '),
);

/**
 * 模拟"先温饱、再自给、最后升级"的玩家心智：
 * 食物垫底了就全力种地，粮柴都有富余才把人挪到石料上。
 */
function reassign() {
  for (const h of tiles) {
    while (crewAt(game, h) > 0) unassign(game, h);
  }

  while (idleCount(game) > 0) {
    const want =
      game.stock.food < BUFFER ? 'food' : game.stock.wood < BUFFER ? 'wood' : 'stone';

    let best = null;
    let bestScore = -1;
    for (const h of tiles) {
      if (crewAt(game, h) >= crewCap(game)) continue;
      const y = TERRAIN[tileAt(game.map, h)!.terrain].yields;
      const score = (y[want] ?? 0) * 10 + (y.food ?? 0) + (y.wood ?? 0) + (y.stone ?? 0);
      if (score > bestScore) {
        bestScore = score;
        best = h;
      }
    }
    if (!best || bestScore <= 0) break;
    if (!assign(game, best)) break;
  }
}

console.log('\n回合  人数  闲  食物   木材   石料   收支(食/木/石)');
for (let i = 0; i < turns; i += 1) {
  // 事件不处理的话 endTurn 会拒绝推进，之后每一回合都是空转 ——
  // 加事件系统时这里漏改了，那之后这个脚本的数字从第一个事件起全是假的。
  // 这里一律选第一个付得起的选项；更像样的策略在 balance.ts 里
  for (let ev = currentEvent(game); ev; ev = currentEvent(game)) {
    const idx = ev.choices.findIndex((c) => choiceAllowed(game, c));
    console.log(`     事件 ${ev.text.zh} → ${ev.choices[idx].label.zh}`);
    chooseEvent(game, idx);
  }
  reassign();
  const idle = idleCount(game);
  endTurn(game);

  const inc = game.lastIncome;
  const flag = game.hardship > 0 ? '  ← 短缺' : '';
  console.log(
    `${String(game.turn - 1).padStart(3)}  ${String(game.party.people).padStart(4)}` +
      `${String(idle).padStart(4)}  ${String(game.stock.food).padStart(5)}` +
      `${String(game.stock.wood).padStart(7)}${String(game.stock.stone).padStart(7)}` +
      `   ${sign(inc.food)} / ${sign(inc.wood)} / ${sign(inc.stone)}${flag}`,
  );

  if (game.over) {
    console.log('\n队伍全灭');
    break;
  }
}

function sign(n: number): string {
  return (n > 0 ? `+${n}` : String(n)).padStart(3);
}
