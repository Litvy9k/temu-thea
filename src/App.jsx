/**
 * 开发外壳。将来把 game/ 搬进个人站时这个文件直接丢掉 ——
 * 站点那边自己有 Layout 和路由，只需要挂 <Game /> 和 <SaveControls />。
 *
 * 这里的语言开关**不是游戏的一部分**，它替站点的全局切换演一遍：游戏本身
 * 只收一个 lang prop，谁来决定它的值不归游戏管。留着是为了本地能验两种语言。
 */
import { useRef, useState } from 'react';

import Game from './game/ui/Game.jsx';
import SaveControls from './game/ui/SaveControls.jsx';

/** 随机种子。用随机数而不是时间戳：连点两下"新游戏"可能落在同一毫秒里 */
const newSeed = () => Math.floor(Math.random() * 0xffffffff);

export default function App() {
  /**
   * 一局游戏 = { id, seed, state }。id 变了就换 key，React 会整个重挂 Game，
   * 省得单独写一套 reset —— 新游戏和读档走的是同一条路。
   */
  const [session, setSession] = useState(() => ({ id: 0, seed: newSeed(), state: null }));
  const [lang, setLang] = useState('zh');

  // Game 会把当前状态写进来，存档时从这里读。状态是原地更新的，所以引用一直有效
  const stateRef = useRef(null);

  return (
    <div className="shell">
      <header className="shell__bar">
        <span>temu-thea</span>

        <div className="shell__tools">
          <SaveControls
            lang={lang}
            getState={() => stateRef.current}
            onNew={() => setSession((s) => ({ id: s.id + 1, seed: newSeed(), state: null }))}
            onLoad={(state) => setSession((s) => ({ id: s.id + 1, seed: null, state }))}
          />
          {/* 换语言不该打断一局游戏，所以 lang 不进 key，只是重新渲染 */}
          <button type="button" onClick={() => setLang((l) => (l === 'zh' ? 'en' : 'zh'))}>
            {lang === 'zh' ? 'EN' : '中'}
          </button>
        </div>
      </header>

      <main className="shell__stage">
        <Game
          key={session.id}
          seed={session.seed}
          initialState={session.state}
          stateRef={stateRef}
          lang={lang}
        />
      </main>
    </div>
  );
}
