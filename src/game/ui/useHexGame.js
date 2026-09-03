/**
 * 游戏的"大脑"：状态、相机、指针交互、派生数据，全部在这里。
 *
 * 抽出来是为了让布局能有两套而交互只有一套。桌面和手机的**信息结构**不同
 * （浮动面板 vs 顶部状态条 + 底部拇指区），但"点一下算移动还是派人""拖多远
 * 才算拖拽""双指怎么缩放"这些是同一套规则 —— 复制一份到两个布局里，
 * 迟早会改了一边忘了另一边。
 *
 * 布局组件拿到这个 hook 的返回值，只负责往屏幕上摆，不做任何判断。
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState } from 'react';

import {
  assign,
  assignBlocker,
  breakCamp,
  buildFacility,
  craftTool,
  campBlocker,
  createGame,
  endTurn,
  idleCount,
  makeCamp,
  moveParty,
  movesAvailable,
  unassign,
  workableTiles,
} from '../core/state.ts';
import { key } from '../core/hex.ts';
import { centerOn, clampToMap, hexAtScreen, panBy, zoomAt } from '../render/camera.ts';
import { describeHex, drawScene } from '../render/draw.ts';

/**
 * 窄于这个宽度就用手机布局。
 *
 * 量的是**游戏容器**的宽度，不是视口宽度 —— 这个游戏将来要嵌进个人站的某个
 * 容器里，落在一个窄栏里的时候，即使是桌面浏览器也该用窄布局。用 matchMedia
 * 判视口，在那种情况下会给出错误答案。
 */
export const NARROW_WIDTH = 720;

/** 超过这个位移就算拖拽不算点击。触屏上手指落下时总会抖一两像素 */
const DRAG_SLOP = 8;

/**
 * initialState 传进来就直接用它开局（读档），否则按 seed 新建一局。
 * stateRef 是给外面读当前状态用的（存档）—— 状态是原地更新的，
 * 所以只要拿到这个对象引用，任何时候读到的都是最新的。
 */
export function useHexGame({ seed, lang = 'zh', initialState = null, stateRef = null }) {
  const wrapRef = useRef(null);
  const canvasRef = useRef(null);

  const [game] = useState(() => initialState ?? createGame({ seed }));

  useEffect(() => {
    if (stateRef) stateRef.current = game;
  }, [stateRef, game]);
  const [, bump] = useReducer((n) => n + 1, 0);

  const [vp, setVp] = useState({ width: 0, height: 0 });
  const [cam, setCam] = useState({ cx: 0, cy: 0, size: 26 });
  const [hover, setHover] = useState(null);
  const [selected, setSelected] = useState(null);
  const [dragging, setDragging] = useState(false);
  /** 营地面板（设施 / 制作 / 队伍）是否展开 */
  const [campOpen, setCampOpen] = useState(false);

  const dragRef = useRef(null);
  /** 当前按下的指针。两个就是双指缩放 */
  const pointersRef = useRef(new Map());
  const pinchRef = useRef(null);

  const moves = useMemo(() => movesAvailable(game), [game, game.version]);
  const workable = useMemo(() => workableTiles(game), [game, game.version]);
  const workableKeys = useMemo(() => new Set(workable.map(key)), [workable]);
  const isWorkTile = useCallback((h) => h != null && workableKeys.has(key(h)), [workableKeys]);

  // ---------------------------------------------------------------- 尺寸

  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el) return undefined;
    const ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      setVp({ width: Math.round(width), height: Math.round(height) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // 开局把镜头对准队伍。要等 vp 量出来再做，否则 clamp 的边界是错的
  const centered = useRef(false);
  useEffect(() => {
    if (centered.current || !vp.width) return;
    centered.current = true;
    setCam((c) => clampToMap(centerOn(c, game.party.at), vp, game.map));
  }, [vp, game]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !vp.width) return;

    // 按设备像素比放大后备缓冲，否则高分屏（手机基本都是 2x/3x）上整张图是糊的
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(vp.width * dpr);
    canvas.height = Math.round(vp.height * dpr);

    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawScene(ctx, game, cam, vp, { hover, moves, workable, selected });
  }, [game, game.version, cam, vp, hover, moves, workable, selected]);

  // ---------------------------------------------------------------- 指针

  const pointAt = useCallback((e) => {
    const rect = canvasRef.current.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }, []);

  /** 两根手指的距离和中点，双指缩放的输入 */
  const pinchOf = () => {
    const [a, b] = [...pointersRef.current.values()];
    return {
      dist: Math.hypot(a.x - b.x, a.y - b.y),
      mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
    };
  };

  const onPointerDown = (e) => {
    // 指针在处理器跑到之前就被释放时 setPointerCapture 会抛 NotFoundError，
    // 不接住的话整个 pointerdown 就废了（表现为偶尔一次点击完全没反应）。
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* 拿不到捕获只是拖出元素外会断，不影响点击 */
    }
    const p = pointAt(e);
    pointersRef.current.set(e.pointerId, p);

    if (pointersRef.current.size === 2) {
      // 第二根手指落下：这一下不再是点击，转成缩放
      pinchRef.current = pinchOf();
      dragRef.current = null;
      setDragging(false);
      return;
    }
    dragRef.current = { x: p.x, y: p.y, from: p, moved: false, button: e.button };
  };

  const onPointerMove = (e) => {
    const p = pointAt(e);
    if (pointersRef.current.has(e.pointerId)) pointersRef.current.set(e.pointerId, p);

    if (pointersRef.current.size >= 2 && pinchRef.current) {
      const now = pinchOf();
      const factor = now.dist / pinchRef.current.dist;
      pinchRef.current = now;
      // 以两指中点为锚，手指按住的地方在缩放前后不动
      setCam((c) => clampToMap(zoomAt(c, vp, now.mid.x, now.mid.y, factor), vp, game.map));
      return;
    }

    const drag = dragRef.current;
    if (!drag) {
      setHover(hexAtScreen(cam, vp, p.x, p.y));
      return;
    }

    const dx = p.x - drag.x;
    const dy = p.y - drag.y;
    if (!drag.moved && Math.hypot(p.x - drag.from.x, p.y - drag.from.y) > DRAG_SLOP) {
      drag.moved = true;
      setDragging(true);
    }
    if (drag.moved) {
      setCam((c) => clampToMap(panBy(c, dx, dy), vp, game.map));
      drag.x = p.x;
      drag.y = p.y;
    }
  };

  const onPointerUp = (e) => {
    pointersRef.current.delete(e.pointerId);
    if (pointersRef.current.size < 2) pinchRef.current = null;

    const drag = dragRef.current;
    dragRef.current = null;
    setDragging(false);
    if (!drag || drag.moved) return;

    const p = pointAt(e);
    const hex = hexAtScreen(cam, vp, p.x, p.y);

    if (!game.camp) {
      setSelected(hex);
      if (moveParty(game, hex)) bump();
      return;
    }

    // 扎营时：点作业格既是选中也是派一个人。
    // 选中要无条件生效 —— 人派光了也得能选中，否则就点不出撤人的按钮了
    if (isWorkTile(hex)) {
      setSelected(hex);
      const acted = e.button === 2 ? unassign(game, hex) : assign(game, hex);
      if (acted) bump();
    } else {
      setSelected(null);
    }
  };

  // wheel 要 passive: false 才能 preventDefault，React 的 onWheel 给不了这个选项
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;

    const onWheel = (e) => {
      e.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const factor = Math.exp(-e.deltaY * 0.0015);
      setCam((c) =>
        clampToMap(zoomAt(c, vp, e.clientX - rect.left, e.clientY - rect.top, factor), vp, game.map),
      );
    };

    canvas.addEventListener('wheel', onWheel, { passive: false });
    return () => canvas.removeEventListener('wheel', onWheel);
  }, [vp, game]);

  // ---------------------------------------------------------------- 动作

  const toggleCamp = useCallback(() => {
    const ok = game.camp ? breakCamp(game) : makeCamp(game);
    if (ok) {
      setSelected(null);
      // 拔营后营地面板没有意义了（建造要有个地方摆），顺手收起来
      if (game.camp == null) setCampOpen(false);
      bump();
    }
  }, [game]);

  const build = useCallback(
    (id) => {
      if (buildFacility(game, id)) bump();
    },
    [game],
  );

  const craft = useCallback(
    (id) => {
      if (craftTool(game, id)) bump();
    },
    [game],
  );

  const doEndTurn = useCallback(() => {
    endTurn(game);
    bump();
  }, [game]);

  const step = useCallback(
    (delta) => {
      if (!selected) return;
      const ok = delta > 0 ? assign(game, selected) : unassign(game, selected);
      if (ok) bump();
    },
    [game, selected],
  );

  useEffect(() => {
    const onKey = (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
      if (e.code === 'Space' || e.code === 'Enter') {
        e.preventDefault();
        doEndTurn();
      } else if (e.code === 'KeyC') {
        toggleCamp();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [toggleCamp, doEndTurn]);

  // ---------------------------------------------------------------- 派生

  const camped = game.camp != null;
  // 选中优先于悬停：选中是玩家明确钉住的，鼠标划过不该把它顶掉
  const focus = selected ?? hover;
  const detail = describeHex(game, focus, lang);
  const stepping = camped && isWorkTile(selected);

  return {
    game,
    lang,
    wrapRef,
    canvasRef,
    /** 容器窄到该换布局了。vp 还没量出来时是 null，此时先别渲染面板 */
    narrow: vp.width === 0 ? null : vp.width < NARROW_WIDTH,

    camped,
    idle: idleCount(game),
    /** 不能扎营的原因；已扎营时为 null（那时按钮是拔营，永远可用） */
    campBlocker: camped ? null : campBlocker(game),

    detail,
    /** 当前选中的是不是一个能增减人力的作业格 */
    stepping,
    canSendMore: stepping && assignBlocker(game, selected) == null,
    canRecall: stepping && detail != null && detail.crew > 0,
    /** 选中的格子还有空位，但队伍里没闲人了 —— 值得单独提示 */
    outOfPeople: stepping && idleCount(game) <= 0 && detail != null && detail.crew < detail.crewMax,

    campOpen,
    openCamp: () => setCampOpen(true),
    closeCamp: () => setCampOpen(false),

    canvasProps: {
      className: dragging ? 'dragging' : undefined,
      onPointerDown,
      onPointerMove,
      onPointerUp,
      onPointerCancel: onPointerUp,
      onPointerLeave: () => setHover(null),
      onContextMenu: (e) => e.preventDefault(),
    },

    toggleCamp,
    doEndTurn,
    step,
    build,
    craft,
  };
}
