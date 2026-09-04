/**
 * 游戏根组件。只做四件事：挂 canvas、量宽度、选布局、决定营地面板摆在哪。
 *
 * 交互逻辑全在 useHexGame 里，布局在 DesktopLayout / MobileLayout 里。
 * 这个文件不该出现任何游戏规则或者事件处理 —— 它一长胖，就说明有东西
 * 该往那两边挪。
 *
 * 营地面板是 hg-stage 的**兄弟节点**不是子节点，有两种摆法：
 *   容器够宽   在 flex 流里占一栏，把地图挤窄而不是盖住
 *              （建什么取决于周围有什么，建造时地图不能消失）
 *   容器不够宽 绝对定位盖在地图上，因为挤完剩下的地图太窄没法用
 *
 * 布局窄宽由**最外层**容器的宽度决定，不由地图那一块决定 —— 后者会被面板
 * 改变，拿它当依据会形成反馈环，见 useHexGame 里 NARROW_WIDTH 的注释。
 */
import { useHexGame, CAMP_PANEL_WIDTH } from './useHexGame.js';
import DesktopLayout from './DesktopLayout.jsx';
import MobileLayout from './MobileLayout.jsx';
import CampPanel from './CampPanel.jsx';
import EventDialog from './EventDialog.jsx';
import './Game.css';

export default function Game({ lang = 'zh', seed, initialState = null, stateRef = null }) {
  const g = useHexGame({ seed, lang, initialState, stateRef });

  // narrow 为 null = 宽度还没量出来。这时先只画 canvas，
  // 免得先按桌面渲染一帧再跳成手机版，那一下闪烁比晚一帧难看得多
  const Layout = g.narrow ? MobileLayout : DesktopLayout;
  const overlay = g.campOpen && !g.narrow && !g.campSqueezes;

  return (
    <div
      ref={g.shellRef}
      className={[
        'hexgame',
        g.narrow ? 'hexgame--narrow' : 'hexgame--wide',
        overlay ? 'is-camp-overlay' : '',
      ]
        .join(' ')
        .trim()}
      // 面板宽度只在 JS 里定义一次，CSS 从这里读，省得两边各写一个数字
      style={{ '--camp-w': `${CAMP_PANEL_WIDTH}px` }}
    >
      <div className="hg-stage" ref={g.wrapRef}>
        <canvas ref={g.canvasRef} {...g.canvasProps} />
        {g.narrow !== null && <Layout {...g} />}
      </div>

      {g.campOpen && <CampPanel {...g} />}

      {/* 挂在 hg-stage 外面：事件挂着时营地面板也不该还能点 */}
      {g.event && (
        <EventDialog
          event={g.event}
          lang={lang}
          allowed={g.choiceAllowed}
          onChoose={g.choose}
        />
      )}
    </div>
  );
}
