/**
 * 游戏根组件。只做四件事：挂 canvas、量宽度、选布局、决定营地面板摆在哪。
 *
 * 交互逻辑全在 useHexGame 里，布局在 DesktopLayout / MobileLayout 里。
 * 这个文件不该出现任何游戏规则或者事件处理 —— 它一长胖，就说明有东西
 * 该往那两边挪。
 *
 * 营地面板是 hg-stage 的**兄弟节点**不是子节点：宽屏时它在 flex 流里占一栏，
 * 把地图挤窄而不是盖住（建什么取决于周围有什么，建造时地图不能消失）；
 * 窄屏时它绝对定位盖满，因为手机上腾不出并排的空间。
 */
import { useHexGame } from './useHexGame.js';
import DesktopLayout from './DesktopLayout.jsx';
import MobileLayout from './MobileLayout.jsx';
import CampPanel from './CampPanel.jsx';
import './Game.css';

export default function Game({ lang = 'zh', seed, initialState = null, stateRef = null }) {
  const g = useHexGame({ seed, lang, initialState, stateRef });

  // narrow 为 null = 宽度还没量出来。这时先只画 canvas，
  // 免得先按桌面渲染一帧再跳成手机版，那一下闪烁比晚一帧难看得多
  const Layout = g.narrow ? MobileLayout : DesktopLayout;

  return (
    <div className={`hexgame ${g.narrow ? 'hexgame--narrow' : 'hexgame--wide'}`}>
      <div className="hg-stage" ref={g.wrapRef}>
        <canvas ref={g.canvasRef} {...g.canvasProps} />
        {g.narrow !== null && <Layout {...g} />}
      </div>

      {g.campOpen && <CampPanel {...g} />}
    </div>
  );
}
