/**
 * Canvas 绘制。只读状态，不改状态。
 *
 * 按地形分批：把同一种地形的所有六边形攒进一条 Path，再一次 fill()。
 * 逐格 beginPath + fill 在两千格上会明显掉帧，而 fillStyle 的切换本身就是
 * 开销大头 —— 分批之后每帧只切九次。
 *
 * 分批只对地形有效。营地那一圈最多七格，逐格画反而更简单。
 */
import { type Axial, axialToPixel, corners, key, offsetToAxial } from '../core/hex.ts';
import { tileAt } from '../core/map.ts';
import { TERRAIN, type TerrainId } from '../core/terrain.ts';
import {
  HARVEST_GOAL,
  MAX_CREW_PER_TILE,
  type GameState,
  crewAt,
  toolAllocation,
  workRateAt,
} from '../core/state.ts';
import { type Camera, type Viewport, visibleRange, worldToScreen } from './camera.ts';

export const COLORS = {
  bg: '#05090b',
  grid: 'rgba(0, 0, 0, 0.35)',
  /** 探明过但此刻看不见：盖一层这个色 */
  memory: 'rgba(5, 12, 16, 0.62)',
  reach: 'rgba(120, 230, 190, 0.16)',
  reachEdge: 'rgba(120, 230, 190, 0.55)',
  hover: 'rgba(230, 240, 200, 0.55)',
  selected: '#f2f6dc',
  party: '#ffe9a8',
  camp: '#ff9d5c',
  campRing: 'rgba(255, 157, 92, 0.5)',
  /** 可派工但还没派人的地格 */
  workable: 'rgba(255, 200, 140, 0.5)',
  crew: '#ffd9a0',
  /** 拿到工具的人。换色而不是加符号 —— 一格最多 5 个点，颜色一眼能数 */
  crewGeared: '#7ce6be',
  crewPad: 'rgba(8, 14, 18, 0.75)',
  barBack: 'rgba(0, 0, 0, 0.55)',
  barFill: '#7ce6be',
};

export interface DrawOptions {
  hover: Axial | null;
  /** movesAvailable() 的结果，画可达范围用 */
  moves: Map<string, { hex: Axial; cost: number }>;
  /** workableTiles() 的结果，扎营时画作业圈用 */
  workable: Axial[];
  /**
   * 被点中钉住的地格。触屏没有 hover，面板和加减按钮都得靠它来定目标，
   * 所以它比 hover 更重要，画得也更实。
   */
  selected: Axial | null;
}

export function drawScene(
  ctx: CanvasRenderingContext2D,
  state: GameState,
  cam: Camera,
  vp: Viewport,
  opts: DrawOptions,
): void {
  const { map } = state;
  const s = cam.size;

  ctx.fillStyle = COLORS.bg;
  ctx.fillRect(0, 0, vp.width, vp.height);

  // 六个角相对中心的偏移，全图同一个形状，只算一次
  const shape = corners(0, 0, s);
  const at = (h: Axial) => {
    const w = axialToPixel(h, 1);
    return worldToScreen(cam, vp, w.x, w.y);
  };

  const { rowMin, rowMax, colMin, colMax } = visibleRange(cam, vp, map);

  const lit = new Map<TerrainId, Path2D>();
  const dim = new Map<TerrainId, Path2D>();
  const glyphs: { x: number; y: number; ch: string; ink: string; dim: boolean }[] = [];

  for (let row = rowMin; row <= rowMax; row += 1) {
    for (let col = colMin; col <= colMax; col += 1) {
      const tile = map.tiles[row * map.width + col];
      if (!tile.explored) continue;

      const p = at(offsetToAxial(col, row));

      const bucket = tile.visible ? lit : dim;
      let path = bucket.get(tile.terrain);
      if (!path) {
        path = new Path2D();
        bucket.set(tile.terrain, path);
      }
      addHex(path, p.x, p.y, shape);

      if (s >= 13) {
        const t = TERRAIN[tile.terrain];
        glyphs.push({ x: p.x, y: p.y, ch: t.glyph, ink: t.ink, dim: !tile.visible });
      }
    }
  }

  for (const [id, path] of lit) {
    ctx.fillStyle = TERRAIN[id].fill;
    ctx.fill(path);
  }
  for (const [id, path] of dim) {
    ctx.fillStyle = TERRAIN[id].fill;
    ctx.fill(path);
    ctx.fillStyle = COLORS.memory;
    ctx.fill(path);
  }

  // 格线放在填充之后、内容之前：压在地形上，但不压住单位和进度条
  if (s >= 11) {
    ctx.strokeStyle = COLORS.grid;
    ctx.lineWidth = 1;
    for (const bucket of [lit, dim]) for (const path of bucket.values()) ctx.stroke(path);
  }

  if (glyphs.length) {
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `${Math.round(s * 0.8)}px ${MONO}`;
    for (const g of glyphs) {
      ctx.globalAlpha = g.dim ? 0.35 : 1;
      ctx.fillStyle = g.ink;
      ctx.fillText(g.ch, g.x, g.y);
    }
    ctx.globalAlpha = 1;
  }

  drawReach(ctx, cam, vp, shape, opts.moves);

  if (state.camp) drawCampSite(ctx, state, at, shape, s, opts.workable);
  else drawParty(ctx, at(state.party.at), s);

  // 悬停画虚一点，选中画实一点。两个同时存在时选中要压过悬停，所以后画
  if (opts.hover && tileAt(map, opts.hover)) {
    outlineHex(ctx, at(opts.hover), shape, COLORS.hover, 2);
  }
  if (opts.selected && tileAt(map, opts.selected)) {
    outlineHex(ctx, at(opts.selected), shape, COLORS.selected, 2.5);
  }
}

function outlineHex(
  ctx: CanvasRenderingContext2D,
  p: { x: number; y: number },
  shape: [number, number][],
  color: string,
  width: number,
): void {
  const path = new Path2D();
  addHex(path, p.x, p.y, shape);
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.stroke(path);
}

const MONO = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';

function addHex(path: Path2D, cx: number, cy: number, shape: [number, number][]): void {
  path.moveTo(cx + shape[0][0], cy + shape[0][1]);
  for (let i = 1; i < 6; i += 1) path.lineTo(cx + shape[i][0], cy + shape[i][1]);
  path.closePath();
}

function drawReach(
  ctx: CanvasRenderingContext2D,
  cam: Camera,
  vp: Viewport,
  shape: [number, number][],
  moves: DrawOptions['moves'],
): void {
  if (!moves.size) return;

  const path = new Path2D();
  for (const { hex } of moves.values()) {
    const w = axialToPixel(hex, 1);
    const p = worldToScreen(cam, vp, w.x, w.y);
    // 屏幕外的不建路径，省得给几百个看不见的格子记顶点
    if (p.x < -cam.size || p.x > vp.width + cam.size) continue;
    if (p.y < -cam.size || p.y > vp.height + cam.size) continue;
    addHex(path, p.x, p.y, shape);
  }

  ctx.fillStyle = COLORS.reach;
  ctx.fill(path);
  ctx.strokeStyle = COLORS.reachEdge;
  ctx.lineWidth = 1;
  ctx.stroke(path);
}

/** 营地本身 + 周围一圈作业格上的人力和进度 */
function drawCampSite(
  ctx: CanvasRenderingContext2D,
  state: GameState,
  at: (h: Axial) => { x: number; y: number },
  shape: [number, number][],
  s: number,
  workable: Axial[],
): void {
  // 可派工的格子描个边，告诉玩家"这一圈能点"
  const outline = new Path2D();
  for (const h of workable) {
    const p = at(h);
    addHex(outline, p.x, p.y, shape);
  }
  ctx.strokeStyle = COLORS.workable;
  ctx.lineWidth = 1.5;
  ctx.stroke(outline);

  // 工具分配要看全营地的部署顺序，整帧算一次
  const alloc = toolAllocation(state);
  for (const h of workable) {
    const rate = workRateAt(state, h, alloc);
    if (rate.crew === 0 && rate.progress === 0) continue;
    drawTileWork(ctx, at(h), s, rate.crew, rate.equipped, rate.progress);
  }

  // 营地
  const p = at(state.camp!.at);
  ctx.strokeStyle = COLORS.campRing;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(p.x, p.y, s * 0.6, 0, Math.PI * 2);
  ctx.stroke();

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `${Math.round(s * 1.0)}px ${MONO}`;
  ctx.fillStyle = COLORS.camp;
  ctx.fillText('⌂', p.x, p.y);
}

/**
 * 一格上的人力和采集进度。
 *
 * 人用点表示不用数字：一眼能数出来的量级（上限 5）用点比读数字快，
 * 而且不用为了塞下数字去挑字号。
 */
function drawTileWork(
  ctx: CanvasRenderingContext2D,
  p: { x: number; y: number },
  s: number,
  crew: number,
  equipped: number,
  progress: number,
): void {
  if (crew > 0 && s >= 14) {
    const dot = Math.max(2, s * 0.12);
    const gap = dot * 2.7;
    const y = p.y - s * 0.5;
    const x0 = p.x - (gap * (crew - 1)) / 2;

    // 先垫一条暗底：点直接压在地形符号上时两者会糊成一团，
    // 而地形色是随地格变的，靠调点的颜色救不了
    ctx.fillStyle = COLORS.crewPad;
    ctx.beginPath();
    ctx.roundRect(x0 - dot * 2, y - dot * 1.9, gap * (crew - 1) + dot * 4, dot * 3.8, dot * 1.9);
    ctx.fill();

    // 拿到工具的排在前面 —— 工具是按部署顺序发的，点的排列就是那个顺序
    for (let i = 0; i < crew; i += 1) {
      ctx.fillStyle = i < equipped ? COLORS.crewGeared : COLORS.crew;
      ctx.beginPath();
      ctx.arc(x0 + gap * i, y, dot, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  if (s >= 12) {
    const w = s * 1.05;
    const h = Math.max(2, s * 0.1);
    const x = p.x - w / 2;
    const y = p.y + s * 0.42;

    ctx.fillStyle = COLORS.barBack;
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = COLORS.barFill;
    ctx.fillRect(x, y, (w * progress) / HARVEST_GOAL, h);
  }
}

function drawParty(
  ctx: CanvasRenderingContext2D,
  p: { x: number; y: number },
  s: number,
): void {
  ctx.fillStyle = COLORS.party;
  ctx.beginPath();
  ctx.arc(p.x, p.y, s * 0.34, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = COLORS.bg;
  ctx.lineWidth = 2;
  ctx.stroke();
}

/** 悬停格的说明，HUD 直接用 */
export function describeHex(state: GameState, h: Axial | null, lang: 'en' | 'zh') {
  if (!h) return null;
  const tile = tileAt(state.map, h);
  if (!tile || !tile.explored) return null;

  const t = TERRAIN[tile.terrain];

  return {
    name: t.label[lang],
    moveCost: t.moveCost,
    yields: t.yields,
    coord: key(h),
    progress: tile.progress,
    goal: HARVEST_GOAL,
    crew: crewAt(state, h),
    crewMax: MAX_CREW_PER_TILE,
    workable: Object.keys(t.yields).length > 0,
    /** 采集速度的明细，面板直接显示"总量（工具 +N）" */
    rate: workRateAt(state, h),
  };
}
