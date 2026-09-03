/**
 * 相机。
 *
 * 中心点存的是"size = 1 时的世界坐标"，不是屏幕像素 —— 这样改缩放时中心
 * 不会漂。存屏幕像素的话，size 一变，同一个数值指向的地方就变了，表现为
 * 滚轮缩放时地图往一个角落里跑。
 */
import { type Axial, axialToPixel, pixelToAxial } from '../core/hex.ts';
import type { GameMap } from '../core/map.ts';

export interface Camera {
  /** 视野中心，size=1 的世界坐标 */
  cx: number;
  cy: number;
  /** 一个六边形从中心到角的屏幕像素数。这就是缩放 */
  size: number;
}

export const MIN_SIZE = 9;
export const MAX_SIZE = 64;

export interface Viewport {
  width: number;
  height: number;
}

export function worldToScreen(cam: Camera, vp: Viewport, wx: number, wy: number) {
  return {
    x: (wx - cam.cx) * cam.size + vp.width / 2,
    y: (wy - cam.cy) * cam.size + vp.height / 2,
  };
}

export function screenToWorld(cam: Camera, vp: Viewport, sx: number, sy: number) {
  return {
    x: (sx - vp.width / 2) / cam.size + cam.cx,
    y: (sy - vp.height / 2) / cam.size + cam.cy,
  };
}

/** 屏幕坐标落在哪一格。点击命中检测就是这一个函数 */
export function hexAtScreen(cam: Camera, vp: Viewport, sx: number, sy: number): Axial {
  const w = screenToWorld(cam, vp, sx, sy);
  return pixelToAxial(w.x, w.y, 1);
}

/**
 * 以某个屏幕点为锚做缩放：那个点下面的格子在缩放前后保持不动。
 * 滚轮缩放必须这么做，否则手感是"地图在自己跑"。
 */
export function zoomAt(cam: Camera, vp: Viewport, sx: number, sy: number, factor: number): Camera {
  const size = clamp(cam.size * factor, MIN_SIZE, MAX_SIZE);
  if (size === cam.size) return cam;

  const before = screenToWorld(cam, vp, sx, sy);
  const after = screenToWorld({ ...cam, size }, vp, sx, sy);
  return { cx: cam.cx + (before.x - after.x), cy: cam.cy + (before.y - after.y), size };
}

export function panBy(cam: Camera, dxScreen: number, dyScreen: number): Camera {
  return { ...cam, cx: cam.cx - dxScreen / cam.size, cy: cam.cy - dyScreen / cam.size };
}

/**
 * 世界范围。odd-r 下 x 只和列号与行号的奇偶有关（x = √3·(col + (row&1)/2)），
 * 所以边界是闭式的，不用遍历全图去求。
 */
export function worldBounds(map: GameMap) {
  const SQRT3 = Math.sqrt(3);
  return {
    minX: -SQRT3 / 2,
    maxX: SQRT3 * (map.width - 0.5) + SQRT3 / 2,
    minY: -1,
    maxY: 1.5 * (map.height - 1) + 1,
  };
}

/** 把相机拽回地图范围内。地图比视野小的时候居中 */
export function clampToMap(cam: Camera, vp: Viewport, map: GameMap): Camera {
  const b = worldBounds(map);
  const halfW = vp.width / 2 / cam.size;
  const halfH = vp.height / 2 / cam.size;

  const cx = b.maxX - b.minX <= halfW * 2
    ? (b.minX + b.maxX) / 2
    : clamp(cam.cx, b.minX + halfW, b.maxX - halfW);
  const cy = b.maxY - b.minY <= halfH * 2
    ? (b.minY + b.maxY) / 2
    : clamp(cam.cy, b.minY + halfH, b.maxY - halfH);

  return { ...cam, cx, cy };
}

/**
 * 视野内要画哪些格子。上千格全画其实也不算慢，但拖动时每帧都全画就会掉帧，
 * 而且以后地图放大到几千格必然要有这一步。
 *
 * 返回的是 odd-r 的行列范围：行号直接对应屏幕 y，列号对应 x，都是单调的，
 * 所以矩形裁剪在这个坐标系下是精确的。
 */
export function visibleRange(cam: Camera, vp: Viewport, map: GameMap) {
  const SQRT3 = Math.sqrt(3);
  const tl = screenToWorld(cam, vp, 0, 0);
  const br = screenToWorld(cam, vp, vp.width, vp.height);

  // 多算一圈，免得边上的格子画到一半被裁掉
  const rowMin = Math.max(0, Math.floor(tl.y / 1.5) - 1);
  const rowMax = Math.min(map.height - 1, Math.ceil(br.y / 1.5) + 1);
  const colMin = Math.max(0, Math.floor(tl.x / SQRT3) - 1);
  const colMax = Math.min(map.width - 1, Math.ceil(br.x / SQRT3) + 1);

  return { rowMin, rowMax, colMin, colMax };
}

/** 把相机对准某一格 */
export function centerOn(cam: Camera, h: Axial): Camera {
  const p = axialToPixel(h, 1);
  return { ...cam, cx: p.x, cy: p.y };
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}
