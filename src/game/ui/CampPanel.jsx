/**
 * 营地面板：设施 + 制作。
 *
 * 这是一个**按需打开**的抽屉，不是常驻面板 —— 里面的决定几十回合才做一次，
 * 常驻会白占掉每回合都要看的那块空间。两套布局共用这一个组件，只是外壳不同：
 * 宽屏时它是右侧一栏，挤压地图而不是盖住（建什么取决于周围有什么，所以
 * 建造时地图不能消失）；窄屏时它盖满整块，因为手机上本来也腾不出并排的空间。
 */
import { useState } from 'react';

import { RESOURCES } from '../core/terrain.ts';
import {
  FACILITIES,
  FACILITY_ORDER,
  TOOLS,
  TOOL_ORDER,
} from '../core/works.ts';
import { buildBlocker, craftBlocker, hasFacility } from '../core/state.ts';
import { t } from '../i18n.js';
import './CampPanel.css';

const TABS = ['facilities', 'crafting'];

export default function CampPanel(g) {
  const { game, lang } = g;
  const [tab, setTab] = useState('facilities');

  return (
    <div className="hg-camp">
      <div className="hg-camp__bar">
        <div className="hg-camp__tabs">
          {TABS.map((id) => (
            <button
              type="button"
              key={id}
              className={tab === id ? 'is-on' : undefined}
              onClick={() => setTab(id)}
            >
              {t(lang, `tab.${id}`)}
            </button>
          ))}
        </div>
        <button type="button" className="hg-camp__close" aria-label={t(lang, 'close')} onClick={g.closeCamp}>
          ×
        </button>
      </div>

      <div className="hg-camp__body">
        {tab === 'facilities' &&
          FACILITY_ORDER.map((id) => (
            <BuildRow
              key={id}
              name={FACILITIES[id].label[lang]}
              desc={FACILITIES[id].desc[lang]}
              cost={FACILITIES[id].cost}
              blocker={buildBlocker(game, id)}
              built={hasFacility(game, id)}
              onAct={() => g.build(id)}
              lang={lang}
            />
          ))}

        {tab === 'crafting' && (
          <>
            {/* 发放规则写在造工具的地方 —— 玩家问"为什么有的点是绿的"就是在这一页 */}
            <p className="hg-dim hg-camp__note">{t(lang, 'toolRule')}</p>
            {!hasFacility(game, 'workshop') && (
              <p className="hg-warn hg-camp__note">{t(lang, 'needWorkshop')}</p>
            )}
            {TOOL_ORDER.map((id) => (
              <BuildRow
                key={id}
                name={TOOLS[id].label[lang]}
                desc={toolDesc(id, lang)}
                cost={TOOLS[id].cost}
                blocker={craftBlocker(game, id)}
                count={game.works.tools[id]}
                onAct={() => g.craft(id)}
                lang={lang}
              />
            ))}
          </>
        )}

      </div>
    </div>
  );
}

/** 「6❙ 4◆」这样的一串代价 */
function Cost({ cost }) {
  return Object.entries(cost).map(([res, n]) => (
    <span key={res} className="hg-cost">
      {n}
      {RESOURCES[res].glyph}
    </span>
  ));
}

/**
 * 设施和工具用同一行样式：名字 + 一句效果 + 代价 + 一个按钮。
 * 两者的差别只在"造过就没了"还是"能一直造"，用 built / count 区分。
 */
function BuildRow({ name, desc, cost, blocker, built, count, onAct, lang }) {
  return (
    <div className={`hg-build ${blocker ? 'is-off' : ''}`}>
      <div className="hg-build__text">
        <div className="hg-build__name">
          {name}
          {count > 0 && <span className="hg-build__count"> ×{count}</span>}
        </div>
        <div className="hg-dim">{desc}</div>
      </div>

      {built ? (
        <span className="hg-build__done">{t(lang, 'built')}</span>
      ) : (
        <button type="button" onClick={onAct} disabled={blocker != null}>
          <Cost cost={cost} />
        </button>
      )}
    </div>
  );
}

function toolDesc(id, lang) {
  const boosts = TOOLS[id].boosts.map((r) => RESOURCES[r].label[lang]).join(' / ');
  return `${boosts} +${TOOLS[id].bonus}`;
}
