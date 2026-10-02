/**
 * 两套布局共用的展示零件。
 *
 * 这些只管"怎么显示一个数"，不知道自己被摆在浮动面板里还是底部抽屉里 ——
 * 摆放交给各自的布局，靠外层 class 控制。
 */
import { useState } from 'react';

import { RESOURCES, RESOURCE_IDS } from '../core/terrain.ts';
import { SEASONS, SEASON_LENGTH, effectsOf } from '../core/seasons.ts';
import { HARVEST_GOAL } from '../core/state.ts';
import { TOOLS } from '../core/works.ts';
import { t } from './../i18n.js';

/**
 * HUD 里的资源顺序，就是 RESOURCES 表的顺序——生存资源在前，升级资源在后。
 *
 * 但 HUD 不是把它全列出来：六行在手机竖屏上放不下，而且没找到铁矿之前
 * 那一行永远是 0。布局只画 game.seenResources 里的那几种（见 state.ts）。
 */
export const RESOURCE_ORDER = RESOURCE_IDS;

/** 一种资源的存量和上回合收支 */
export function Resource({ id, stock, cap, income, short, wasted, lang }) {
  // 顶到上限时的提示优先级最高：那一刻玩家看到的"收支 +19 存量没动"
  // 如果没人解释，会被当成 bug
  const full = stock >= cap;
  const trend = short > 0 || wasted > 0 ? 'down' : income > 0 ? 'up' : income < 0 ? 'down' : '';

  return (
    <span className="hg-res">
      <span className="hg-res__name">
        {RESOURCES[id].glyph} {RESOURCES[id].label[lang]}
      </span>
      <b className={full ? 'hg-res__full' : undefined}>
        {stock}
        <span className="hg-res__cap">/{cap}</span>
      </b>
      <span className={`hg-res__income ${trend}`}>
        {wasted > 0 ? -wasted : income > 0 ? `+${income}` : income}
      </span>
    </span>
  );
}

/**
 * 把一个事件效果渲染成 "+3人 −6✦"。
 *
 * 从数据算出来而不是让事件表手写一份说明 —— 手写的那份迟早和数值对不上，
 * 而这种对不上没人会发现：文案说 −6，实际扣 8，玩家只当自己记错了。
 */
export function EffectDeltas({ effect, stock, people, lang }) {
  const bits = [];

  // 比例项按当前存量折算成实际数字再显示 —— 写"−30%"要玩家自己心算，
  // 而他真正想知道的是"这一下会少掉多少"
  const pct = (cur, p) => {
    if (!p || cur <= 0) return 0;
    const raw = Math.round(cur * p);
    return raw !== 0 ? raw : Math.sign(p);
  };

  for (const id of RESOURCE_ORDER) {
    const n = (effect.stock?.[id] ?? 0) + pct(stock?.[id] ?? 0, effect.stockPct?.[id] ?? 0);
    if (n) bits.push({ key: id, n, unit: RESOURCES[id].glyph });
  }
  const dp = (effect.people ?? 0) + pct(people ?? 0, effect.peoplePct ?? 0);
  if (dp) bits.push({ key: 'people', n: dp, unit: t(lang, 'personUnit') });
  for (const [id, n] of Object.entries(effect.tools ?? {})) {
    if (n) bits.push({ key: id, n, unit: TOOLS[id].label[lang] });
  }

  if (!bits.length) return <span>{t(lang, 'noEffect')}</span>;

  return bits.map((b) => (
    <span key={b.key} className="hg-delta">
      {b.n > 0 ? '+' : '−'}
      {Math.abs(b.n)}
      {b.unit}
    </span>
  ));
}

/**
 * 「15✦ 3❙」这样的一串数量：造价、返还、拔营要扔掉的东西都用它。
 * 为 0 的项不显示。
 */
export function Amounts({ amounts }) {
  return RESOURCE_ORDER.filter((id) => amounts[id] > 0).map((id) => (
    <span key={id} className="hg-cost">
      {amounts[id]}
      {RESOURCES[id].glyph}
    </span>
  ));
}

/**
 * 季节小图标，原稿在 docs/season-icons.svg。
 *
 * 画出来而不是用 ☀ ❄ 这类字符：那些码位在一些系统上会显示成彩色 emoji，
 * 不听 CSS 的 color，季节配色就失效了。全部用 currentColor，跟着外层的颜色走。
 */
export function SeasonIcon({ id }) {
  return (
    <svg className="hg-season__icon" viewBox="0 0 16 16" width="1em" height="1em" aria-hidden="true">
      {SEASON_SHAPES[id]}
    </svg>
  );
}

const SEASON_SHAPES = {
  // 花瓣 75%：55% 时在深色底上发灰发紫，不像粉色
  spring: (
    <>
      <g fill="currentColor" opacity="0.75">
        <circle cx="8" cy="4.4" r="2.5" />
        <circle cx="11.42" cy="6.89" r="2.5" />
        <circle cx="10.12" cy="10.91" r="2.5" />
        <circle cx="5.88" cy="10.91" r="2.5" />
        <circle cx="4.58" cy="6.89" r="2.5" />
      </g>
      <circle cx="8" cy="8" r="1.8" fill="currentColor" />
    </>
  ),
  summer: (
    <>
      <circle cx="8" cy="8" r="3.1" fill="currentColor" />
      <path
        d="M13 8H15M11.54 11.54L12.95 12.95M8 13V15M4.46 11.54L3.05 12.95M3 8H1M4.46 4.46L3.05 3.05M8 3V1M11.54 4.46L12.95 3.05"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        fill="none"
      />
    </>
  ),
  autumn: (
    <>
      <path
        d="M3.5 12.5C3.5 6 7.2 2.5 13.5 2.5C13.5 8.8 10 12.5 3.5 12.5Z"
        fill="currentColor"
        fillOpacity="0.45"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
      <path d="M1.8 14.2L11 5" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" fill="none" />
    </>
  ),
  winter: (
    <g stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" fill="none">
      <path d="M8 1.5V14.5M2.37 4.75L13.63 11.25M2.37 11.25L13.63 4.75" />
      <path d="M6.44 2.24L8 3.8L9.56 2.24M12.21 3.77L11.64 5.9L13.76 6.47M13.76 9.53L11.64 10.1L12.21 12.23M9.56 13.76L8 12.2L6.44 13.76M3.79 12.23L4.36 10.1L2.24 9.53M2.24 6.47L4.36 5.9L3.79 3.77" />
    </g>
  ),
};

/**
 * 「❄ 冬 7/20」。季节字和图标用这一季的颜色。
 *
 * 当季规则：桌面上鼠标悬停就出来（CSS 的 :hover，只在有悬停能力的设备上），
 * 触屏上点一下展开、再点或点别处收起 —— 触屏没有悬停这个动作。
 */
export function SeasonBadge({ season, lang }) {
  const [open, setOpen] = useState(false);
  const info = SEASONS[season.id];

  return (
    <button
      type="button"
      className={`hg-season ${open ? 'is-open' : ''}`}
      style={{ color: info.color }}
      aria-expanded={open}
      onClick={() => setOpen((o) => !o)}
      onBlur={() => setOpen(false)}
    >
      <SeasonIcon id={season.id} />
      <span className="hg-season__name">{info.label[lang]}</span>
      <span className="hg-season__day">{season.day}</span>
      <span className="hg-season__len">/{SEASON_LENGTH}</span>
      <span className="hg-season__tip" role="tooltip">
        {effectsOf(season.id).map((e) => (
          <span key={e.en}>{e[lang]}</span>
        ))}
      </span>
    </button>
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

      {/* 矿脉单列一行，而且不压暗：它是这一格上唯一不能从地形推出来的信息 */}
      {detail.deposit && (
        <div className="hg-vein">
          {detail.depositGlyph} {detail.deposit}
        </div>
      )}
      {/* 营地址：建了些什么。不在这里扎营时这些建筑不生效，但玩家得知道回来能用上什么 */}
      {detail.site && (
        <div className="hg-site-line">
          ⌂ {t(lang, 'siteHere')} · {detail.site.join(lang === 'zh' ? '、' : ', ')}
        </div>
      )}
      {/* 没探查的只说"有东西"。下面那行"每次采集"也只报地形的产出 —— 不然就漏了 */}
      {detail.unsurveyed && <div className="hg-vein hg-vein--unknown">? {t(lang, 'unsurveyed')}</div>}

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
