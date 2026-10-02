/**
 * 盖在游戏区上的两样东西：确认框和提示条。
 *
 * 它们的分量正好相反：
 *   确认框  挡住一切，等玩家回答 —— 只用在不能撤销的事上（拔营要扔东西、拆建筑）
 *   提示条  什么都不挡，自己消失 —— 换季、化冻落水，只是告诉玩家发生了什么
 *
 * 事件弹窗是第三种：要玩家做选择，所以它挡住操作，见 EventDialog。
 */
import { Amounts, SeasonIcon } from './parts.jsx';
import { BUILDINGS } from '../core/works.ts';
import { SEASONS, effectsOf } from '../core/seasons.ts';
import { fill, t } from '../i18n.js';
import './Overlays.css';

/** 复用事件弹窗的外框样式 —— 同样是"停下来回答一个问题" */
export function ConfirmDialog({ confirm, lang, onYes, onNo }) {
  const text =
    confirm.kind === 'break'
      ? t(lang, 'confirmBreak')
      : fill(t(lang, 'confirmDemolish'), { name: BUILDINGS[confirm.building].label[lang] });
  const yes = confirm.kind === 'break' ? t(lang, 'breakCamp') : t(lang, 'demolish');

  return (
    <div className="hg-event" role="dialog" aria-modal="true">
      <div className="hg-event__box">
        <p className="hg-event__text">
          {text} <Amounts amounts={confirm.amounts} />
        </p>
        <div className="hg-confirm__actions">
          <button type="button" onClick={onNo}>
            {t(lang, 'cancel')}
          </button>
          <button type="button" className="hg-confirm__yes" onClick={onYes}>
            {yes}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * 提示条。pointer-events: none，所以永远不会挡住对地图的点击；
 * 每条自己到时间消失（计时在 useHexGame 里），玩家不需要去关。
 */
export function Notices({ notices, lang }) {
  if (!notices.length) return null;
  return (
    <div className="hg-notices" aria-live="polite">
      {notices.map((n) =>
        n.kind === 'season' ? (
          <div key={n.id} className="hg-notice" style={{ '--season': SEASONS[n.season].color }}>
            {/* 用 span 不用 b：全局的 .hexgame b 会把它染成强调绿，盖掉季节色 */}
            <span className="hg-notice__title">
              <SeasonIcon id={n.season} /> {t(lang, `notice.season.${n.season}`)}
            </span>
            <span className="hg-dim">{effectsOf(n.season).map((e) => e[lang]).join(' · ')}</span>
          </div>
        ) : (
          <div key={n.id} className="hg-notice hg-notice--warn">
            <span>
              {n.people > 0
                ? fill(t(lang, 'notice.strandedPeople'), { n: n.people })
                : t(lang, 'notice.stranded')}{' '}
              <Amounts amounts={n.stock} />
            </span>
          </div>
        ),
      )}
    </div>
  );
}
