/**
 * 两套布局共用的展示零件。
 *
 * 这些只管"怎么显示一个数"，不知道自己被摆在浮动面板里还是底部抽屉里 ——
 * 摆放交给各自的布局，靠外层 class 控制。
 */
import { RESOURCES } from '../core/terrain.ts';
import { HARVEST_GOAL } from '../core/state.ts';
import { t } from './../i18n.js';

export const RESOURCE_ORDER = ['food', 'wood', 'stone'];

/** 一种资源的存量和上回合收支 */
export function Resource({ id, stock, income, short, lang }) {
  const trend = short > 0 ? 'down' : income > 0 ? 'up' : income < 0 ? 'down' : '';
  return (
    <span className="hg-res">
      <span className="hg-res__name">
        {RESOURCES[id].glyph} {RESOURCES[id].label[lang]}
      </span>
      <b>{stock}</b>
      <span className={`hg-res__income ${trend}`}>{income > 0 ? `+${income}` : income}</span>
    </span>
  );
}

/** 「4✦ 2❙」这样的一串产出 */
export function Yields({ yields }) {
  return RESOURCE_ORDER.filter((id) => yields[id]).map((id) => (
    <span key={id} className="hg-yield">
      {yields[id]}
      {RESOURCES[id].glyph}
    </span>
  ));
}

/**
 * 人力增减。触屏上这排是撤人的唯一入口 —— 桌面端的右键在手机上根本不存在，
 * 所以它不是快捷方式的补充，是主路径。
 */
export function CrewStepper({ crew, crewMax, canSendMore, canRecall, onStep, lang }) {
  return (
    <div className="hg-stepper">
      <button
        type="button"
        aria-label={t(lang, 'recall')}
        onClick={() => onStep(-1)}
        disabled={!canRecall}
      >
        −
      </button>
      <span className="hg-stepper__count">
        {crew} / {crewMax}
      </span>
      <button
        type="button"
        aria-label={t(lang, 'send')}
        onClick={() => onStep(1)}
        disabled={!canSendMore}
      >
        +
      </button>
    </div>
  );
}

/** 地格详情的正文。外面的容器由布局决定 */
export function TileFacts({ detail, camped, lang }) {
  return (
    <>
      <div className="hg-tile__head">
        <b>{detail.name}</b>
        <span className="hg-dim">
          {detail.moveCost == null
            ? t(lang, 'impassable')
            : `${t(lang, 'cost')} ${detail.moveCost}`}
        </span>
      </div>

      {detail.workable && (
        <div className="hg-dim">
          {t(lang, 'perHarvest')} <Yields yields={detail.yields} />
        </div>
      )}

      {camped && detail.workable && (
        <div className="hg-dim">
          {t(lang, 'progress')} {detail.progress} / {HARVEST_GOAL}
        </div>
      )}

      {/* 加成显示在它生效的地方，别让玩家去设施页面自己算 */}
      {camped && detail.rate.crew > 0 && (
        <div>
          {t(lang, 'perTurn')} <b>{detail.rate.total}</b>
          {detail.rate.bonus > 0 && (
            <span className="hg-geared"> ({t(lang, 'tools')} +{detail.rate.bonus})</span>
          )}
        </div>
      )}
    </>
  );
}

/** 扎营 / 拔营 + 结束回合。两套布局的按钮尺寸不同，但顺序和禁用条件一样 */
export function Actions({ game, camped, campBlocker, onToggleCamp, onEndTurn, onOpenCamp, lang }) {
  return (
    <div className="hg-actions">
      <button type="button" onClick={onToggleCamp} disabled={!camped && campBlocker != null}>
        {t(lang, camped ? 'breakCamp' : 'camp')}
      </button>
      <button type="button" onClick={onEndTurn} disabled={game.over}>
        {t(lang, 'endTurn')}
      </button>
      {/* 营地入口只在扎营时出现：游荡时没地方摆设施，按钮存在只会让人点空 */}
      {onOpenCamp && camped && (
        <button type="button" className="hg-actions__camp" onClick={onOpenCamp}>
          ⌂ {t(lang, 'campPanel')}
        </button>
      )}
    </div>
  );
}
