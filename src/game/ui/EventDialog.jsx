/**
 * 事件弹窗。
 *
 * 两套布局共用同一个组件：事件是"停下来做个决定"，不管屏幕多宽都该是同一件事。
 * 它盖在整块游戏区上（包括营地面板），因为在选完之前别的操作都不该继续。
 *
 * 选项的效果不写文案，从 effect 数据自动渲染成 "+3人 −6✦" —— 手写一份说明
 * 迟早会和数值对不上，而这种对不上没人会发现。
 */
import { EffectDeltas } from './parts.jsx';
import { t } from '../i18n.js';
import './EventDialog.css';

export default function EventDialog({ event, lang, allowed, onChoose }) {
  return (
    <div className="hg-event" role="dialog" aria-modal="true">
      <div className="hg-event__box">
        <p className="hg-event__text">{event.text[lang]}</p>

        <div className="hg-event__choices">
          {event.choices.map((choice, i) => {
            const ok = allowed(choice);
            return (
              <button
                type="button"
                key={choice.label.en}
                className="hg-event__choice"
                disabled={!ok}
                onClick={() => onChoose(i)}
              >
                <span className="hg-event__label">{choice.label[lang]}</span>
                <span className="hg-event__effect">
                  <EffectDeltas effect={choice.effect} lang={lang} />
                </span>
                {/* 不可选时说明差在哪，否则玩家只看到一个灰按钮 */}
                {!ok && <span className="hg-warn">{t(lang, 'cannotAfford')}</span>}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
