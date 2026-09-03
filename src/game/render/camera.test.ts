/**
 * 相机的性质测试。
 *
 * 缩放这块在浏览器里很难验 —— 双指手势不好合成，肉眼也看不出"漂了两像素"。
 * 但它本身是纯函数，直接测数学关系就够：锚点不动、边界不越界。
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  MAX_SIZE,
  MIN_SIZE,
  type Camera,
  centerOn,
  clampToMap,
  hexAtScreen,
  panBy,
  screenToWorld,
  worldBounds,
  worldToScreen,
  zoomAt,
} from './camera.ts';
import { axialToPixel, key } from '../core/hex.ts';
import { generateMap } from '../core/map.ts';

const VP = { width: 800, height: 600 };
const CAM: Camera = { cx: 12, cy: 20, size: 26 };

/** 允许一点浮点误差 */
function near(a: number, b: number, msg: string, eps = 1e-9) {
  assert.ok(Math.abs(a - b) < eps, `${msg}：${a} vs ${b}`);
}

test('屏幕与世界坐标互为逆运算', () => {
  for (const [sx, sy] of [[0, 0], [400, 300], [799, 599], [123, 456]]) {
    const w = screenToWorld(CAM, VP, sx, sy);
    const back = worldToScreen(CAM, VP, w.x, w.y);
    near(back.x, sx, 'x 没转回来');
    near(back.y, sy, 'y 没转回来');
  }
});

test('缩放锚点不动：手指（或光标）按住的地方，缩放前后是同一个世界坐标', () => {
  // 这就是双指缩放和滚轮缩放共用的那条保证。锚点算错的表现是
  // "地图自己往一个角落里跑"，很难靠肉眼定位是哪一步错了
  for (const factor of [1.5, 0.6, 1.02, 0.98]) {
    for (const [sx, sy] of [[400, 300], [0, 0], [710, 90]]) {
      const before = screenToWorld(CAM, VP, sx, sy);
      const zoomed = zoomAt(CAM, VP, sx, sy, factor);
      const after = screenToWorld(zoomed, VP, sx, sy);

      near(after.x, before.x, `锚点 x 漂了（factor ${factor}）`, 1e-9);
      near(after.y, before.y, `锚点 y 漂了（factor ${factor}）`, 1e-9);
    }
  }
});

test('缩放夹在上下限内，到顶之后原样返回', () => {
  let cam = CAM;
  for (let i = 0; i < 50; i += 1) cam = zoomAt(cam, VP, 400, 300, 1.4);
  assert.equal(cam.size, MAX_SIZE);
  // 到顶后再放大应该原样返回（同一个对象），否则每帧都会白算一次 clamp
  assert.equal(zoomAt(cam, VP, 400, 300, 1.4), cam);

  for (let i = 0; i < 80; i += 1) cam = zoomAt(cam, VP, 400, 300, 0.7);
  assert.equal(cam.size, MIN_SIZE);
  assert.equal(zoomAt(cam, VP, 400, 300, 0.7), cam);
});

test('平移的方向和位移量与手指一致', () => {
  const moved = panBy(CAM, 52, -26);
  // 手指往右拖 52 像素，地图跟着往右走，也就是镜头往左移
  near(moved.cx, CAM.cx - 52 / CAM.size, '横向位移不对');
  near(moved.cy, CAM.cy + 26 / CAM.size, '纵向位移不对');
});

test('clampToMap 不让镜头越过地图边界', () => {
  const map = generateMap({ width: 64, height: 44, seed: 1 });
  const b = worldBounds(map);

  for (const far of [
    { cx: -9999, cy: -9999, size: 26 },
    { cx: 9999, cy: 9999, size: 26 },
    { cx: 9999, cy: -9999, size: 26 },
  ]) {
    const c = clampToMap(far, VP, map);
    const halfW = VP.width / 2 / c.size;
    const halfH = VP.height / 2 / c.size;

    assert.ok(c.cx - halfW >= b.minX - 1e-9, '左边露出图外');
    assert.ok(c.cx + halfW <= b.maxX + 1e-9, '右边露出图外');
    assert.ok(c.cy - halfH >= b.minY - 1e-9, '上边露出图外');
    assert.ok(c.cy + halfH <= b.maxY + 1e-9, '下边露出图外');
  }
});

test('地图比视野小的时候居中，而不是顶在角上', () => {
  const tiny = generateMap({ width: 4, height: 4, seed: 1 });
  const b = worldBounds(tiny);
  const c = clampToMap({ cx: -500, cy: 500, size: 26 }, VP, tiny);

  near(c.cx, (b.minX + b.maxX) / 2, '横向没居中');
  near(c.cy, (b.minY + b.maxY) / 2, '纵向没居中');
});

test('centerOn 之后，那一格正好落在视野正中', () => {
  const target = { q: 22, r: 21 };
  const cam = centerOn(CAM, target);
  const w = axialToPixel(target, 1);
  const p = worldToScreen(cam, VP, w.x, w.y);

  near(p.x, VP.width / 2, '没在横向正中');
  near(p.y, VP.height / 2, '没在纵向正中');
});

test('点屏幕上的某一点，命中的就是画在那里的格子', () => {
  // 点击命中和绘制用的是两条不同的代码路径，这条断言把它们钉在一起
  const map = generateMap({ width: 40, height: 30, seed: 7 });
  const cam = clampToMap(centerOn({ cx: 0, cy: 0, size: 30 }, { q: 10, r: 12 }), VP, map);

  for (let sx = 40; sx < VP.width; sx += 137) {
    for (let sy = 40; sy < VP.height; sy += 111) {
      const hex = hexAtScreen(cam, VP, sx, sy);
      const w = axialToPixel(hex, 1);
      const p = worldToScreen(cam, VP, w.x, w.y);
      // 命中的格子中心，必须离点击处不超过一个格子的外接半径
      const d = Math.hypot(p.x - sx, p.y - sy);
      assert.ok(d <= cam.size + 1e-6, `点 (${sx},${sy}) 命中了 ${key(hex)}，但它的中心在 ${d.toFixed(1)}px 外`);
    }
  }
});
