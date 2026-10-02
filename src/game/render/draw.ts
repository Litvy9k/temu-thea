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
import { DEPOSITS, yieldsOf } from '../core/deposits.ts';
import {
  HARVEST_GOAL,
  type GameState,
  crewAt,
  crewCap,
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
  /** 拿到工具的人。换色而不是加符号 —— 一格最多 6 根条，颜色一眼能数 */
  crewGeared: '#7ce6be',
  /** 还能再派人的空位：和人同色，但压暗 */
  crewOpen: 'rgba(255, 217, 160, 0.3)',
  /** 还没解锁的位置，画成虚线 */
  crewLocked: 'rgba(255, 255, 255, 0.2)',
  /** 没探查过的矿位：? 和缩远后的灰点 */
  unsurveyed: '#c9cfd4',
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
  // 三批符号：地形符号、矿位符号（含 ?）、缩远后的矿位色点。字号不同，所以分开收
  const glyphs: Mark[] = [];
  const veinMarks: Mark[] = [];
  const veinDots: Mark[] = [];

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

      // 地形符号**永远**偏上，有没有矿脉都一样 —— 否则有矿的格子符号会往上跳一下，
      // 整张图的节奏就乱了
      if (s >= 13) {
        const t = TERRAIN[tile.terrain];
        glyphs.push({ x: p.x, y: p.y + s * SLOT.terrainY, ch: t.glyph, ink: t.ink, dim: !tile.visible });
      }

      if (tile.deposit) {
        // 没探查的只知道"有东西"：? 和灰点。探查过才显出是哪种矿
        const d = DEPOSITS[tile.deposit];
        const mark = {
          x: p.x,
          y: p.y + s * SLOT.veinY,
          ch: tile.surveyed ? d.glyph : '?',
          ink: tile.surveyed ? d.ink : COLORS.unsurveyed,
          dim: !tile.visible,
        };
        // 矿位符号只有 0.36s，格子小于 20px 时就只剩几个像素、认不出形状了。
        // 那时改画一个点 —— 点在任何尺寸下都看得见，拉远扫图找矿靠的就是它
        if (s >= 20) veinMarks.push(mark);
        else if (s >= 9) veinDots.push(mark);
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

  drawMarks(ctx, glyphs, s * SLOT.terrainFont, 0.35);
  drawMarks(ctx, veinMarks, s * SLOT.veinFont, 0.45);

  if (veinDots.length) {
    const r = Math.max(1.5, s * 0.1);
    for (const m of veinDots) {
      ctx.globalAlpha = m.dim ? 0.45 : 1;
      ctx.fillStyle = m.ink;
      ctx.beginPath();
      ctx.arc(m.x, m.y, r, 0, Math.PI * 2);
      ctx.fill();
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

/**
 * 一个格子里的竖向布局，单位是格子尺寸 s（中心到顶点的距离）：
 *
 *   terrainY  地形符号，所有格子都偏上
 *   veinY     矿位：矿脉符号、? 或缩远时的色点
 *   barY      采集进度条
 *
 * 外面一圈是六根人力指示条，缩进到 BAR_INSET。所以里面三样都得比以前小：
 * 进度条原来宽 1.05s，现在会撞上左下、右下那两根条，缩到 0.62s。
 */
const SLOT = {
  terrainY: -0.16,
  terrainFont: 0.62,
  veinY: 0.24,
  veinFont: 0.36,
  barY: 0.44,
  barW: 0.62,
  barH: 0.07,
} as const;

/**
 * 人力指示条贴着的那圈六边形，缩到格子的几成；以及每根条在角上留多少空。
 *
 * 留空是为了六根条读起来是"六个"而不是"一圈"：连成环的话，五根和六根
 * 只差一截，数不出来。每根只画边长中间的 70%。
 */
const BAR_INSET = 0.8;
const BAR_GAP = 0.15;

interface Mark {
  x: number;
  y: number;
  ch: string;
  ink: string;
  dim: boolean;
}

/** 同一字号的一批符号。dimAlpha 是看不见（只是记得）时的透明度 */
function drawMarks(ctx: CanvasRenderingContext2D, marks: Mark[], size: number, dimAlpha: number): void {
  if (!marks.length) return;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `${Math.round(size)}px ${MONO}`;
  for (const m of marks) {
    ctx.globalAlpha = m.dim ? dimAlpha : 1;
    ctx.fillStyle = m.ink;
    ctx.fillText(m.ch, m.x, m.y);
  }
  ctx.globalAlpha = 1;
}

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
  /*
   * 派了人的格子画六根指示条；还没派人的只描一圈淡边，告诉玩家"这一格能点"。
   *
   * 空格子也画满一整套（两根空位、四根虚线）的话，扎营那一刻六格全是条，
   * 真正有人干活的那几格反而不显眼 —— 指示条该是"这里有人"的标记，
   * 不是"这里能派人"的标记。格子太小画不下条时，全都退回到淡边。
   */
  const bars = s >= 12;
  const staffed = bars ? workable.filter((h) => crewAt(state, h) > 0) : [];
  const empty = bars ? workable.filter((h) => crewAt(state, h) === 0) : workable;

  if (staffed.length) drawCrewBars(ctx, state, at, s, staffed);
  if (empty.length) {
    const outline = new Path2D();
    for (const h of empty) {
      const p = at(h);
      addHex(outline, p.x, p.y, shape);
    }
    ctx.strokeStyle = COLORS.workable;
    ctx.lineWidth = 1.5;
    ctx.stroke(outline);
  }

  // 进度条：派了人或者条上有存量的格子才画
  if (s >= 12) {
    const w = s * SLOT.barW;
    const bh = Math.max(2, s * SLOT.barH);
    for (const h of workable) {
      const tile = tileAt(state.map, h);
      if (!tile || (crewAt(state, h) === 0 && tile.progress === 0)) continue;
      const p = at(h);
      const x = p.x - w / 2;
      const y = p.y + s * SLOT.barY;
      ctx.fillStyle = COLORS.barBack;
      ctx.fillRect(x, y, w, bh);
      ctx.fillStyle = COLORS.barFill;
      ctx.fillRect(x, y, (w * tile.progress) / HARVEST_GOAL, bh);
    }
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
 * 每个作业格六根贴边的指示条，一根一个人。
 *
 * 六条边配六个工位，一一对应，所以人数不用读数字，看一眼就知道。
 * 从右上那条边起顺时针填（corners() 从顶点开始顺时针排，第 i 条边是
 * 第 i → i+1 个顶点），像表盘从 12 点走起。每格起点固定，不随营地方向变 ——
 * 起点一变就数不出来了。
 *
 * 四种状态，按顺序排：拿着工具的人（绿）、空手的人、还能再派的空位、
 * 没解锁的位置（虚线）。拿工具的排在最前，因为工具本来就是按部署顺序发的。
 *
 * 不可用的位置用虚线，不用条纹或波浪：条只有两三个像素粗，斜纹和波浪
 * 在这个尺寸下都会糊成一条灰线，虚线还认得出来。
 */
function drawCrewBars(
  ctx: CanvasRenderingContext2D,
  state: GameState,
  at: (h: Axial) => { x: number; y: number },
  s: number,
  workable: Axial[],
): void {
  const inner = corners(0, 0, s * BAR_INSET);
  const cap = crewCap(state);
  const alloc = toolAllocation(state);

  const geared = new Path2D();
  const bare = new Path2D();
  const open = new Path2D();
  const locked = new Path2D();

  for (const h of workable) {
    const p = at(h);
    const crew = crewAt(state, h);
    const equipped = alloc.get(key(h))?.equipped ?? 0;

    for (let i = 0; i < 6; i += 1) {
      const [ax, ay] = inner[i];
      const [bx, by] = inner[(i + 1) % 6];
      const path = i < equipped ? geared : i < crew ? bare : i < cap ? open : locked;
      path.moveTo(p.x + ax + (bx - ax) * BAR_GAP, p.y + ay + (by - ay) * BAR_GAP);
      path.lineTo(p.x + bx - (bx - ax) * BAR_GAP, p.y + by - (by - ay) * BAR_GAP);
    }
  }

  const thick = Math.max(2, s * 0.09);
  ctx.lineCap = 'butt';

  ctx.lineWidth = Math.max(1, thick * 0.6);
  ctx.setLineDash([Math.max(2, s * 0.06), Math.max(2, s * 0.06)]);
  ctx.strokeStyle = COLORS.crewLocked;
  ctx.stroke(locked);
  ctx.setLineDash([]);

  ctx.lineWidth = thick;
  ctx.strokeStyle = COLORS.crewOpen;
  ctx.stroke(open);
  ctx.strokeStyle = COLORS.crew;
  ctx.stroke(bare);
  ctx.strokeStyle = COLORS.crewGeared;
  ctx.stroke(geared);
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
  // 没探查的矿脉**不能**在面板上漏出来：产出只报地形的，矿脉那一行只写"未探查"。
  // 规则层不需要这层遮挡 —— 能派工的格子一定探查过（见 workRadius）
  const known = tile.deposit && tile.surveyed ? tile.deposit : null;
  const yields = yieldsOf(tile.terrain, known);

  return {
    name: t.label[lang],
    // 矿脉单列一行而不是拼进地名："丘陵（铁矿脉）"在窄面板上会折行，
    // 而且它和地形不是同一类信息 —— 地形永远在，矿脉是这一块地特有的
    deposit: known ? DEPOSITS[known].label[lang] : null,
    depositGlyph: known ? DEPOSITS[known].glyph : null,
    /** 有矿脉但还没走到跟前 */
    unsurveyed: Boolean(tile.deposit && !tile.surveyed),
    moveCost: t.moveCost,
    yields,
    coord: key(h),
    progress: tile.progress,
    goal: HARVEST_GOAL,
    crew: crewAt(state, h),
    crewMax: crewCap(state),
    workable: Object.keys(yields).length > 0,
    /** 采集速度的明细，面板直接显示"总量（工具 +N）" */
    rate: workRateAt(state, h),
  };
}
