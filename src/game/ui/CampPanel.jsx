/**
 * 营地面板：建筑 + 装备。
 *
 * 两页按**东西放在哪**分：建筑留在这处营地址上，装备跟着队伍走。
 * "制作"出来的都是装备，所以没有单独的制作页。
 *
 * 这是一个**按需打开**的抽屉，不是常驻面板 —— 里面的决定几十回合才做一次，
 * 常驻会白占掉每回合都要看的那块空间。两套布局共用这一个组件，只是外壳不同：
 * 宽屏时它是右侧一栏，挤压地图而不是盖住（建什么取决于周围有什么，所以
 * 建造时地图不能消失）；窄屏时它盖满整块，因为手机上本来也腾不出并排的空间。
 */
import { useState } from 'react';

import { RESOURCES } from '../core/terrain.ts';
import {
  BUILDINGS,
  BUILDING_ORDER,
  GEAR,
  GEAR_ORDER,
  TOOLS,
  TOOL_ORDER,
} from '../core/works.ts';
import {
  MAX_SITES,
  buildBlocker,
  craftBlocker,
  currentSite,
  demolishBlocker,
  gearBlocker,
  hasBuilding,
  hasGear,
  slotCapacity,
  slotsUsed,
} from '../core/state.ts';
import { Amounts } from './parts.jsx';
import { fill, t } from '../i18n.js';
import './CampPanel.css';

const TABS = ['buildings', 'gear'];

export default function CampPanel(g) {
  const { game, lang } = g;
  const [tab, setTab] = useState('buildings');
  const site = currentSite(game);

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
        {tab === 'buildings' && (
          <>
            {/* 两个计数放在最上面：选建什么之前，先知道还剩几个位置 */}
            <p className="hg-dim hg-camp__note hg-camp__counts">
              <span>
                {t(lang, 'slots')} <b>{slotsUsed(site)}</b>/{slotCapacity(site)}
              </span>
              <span>
                {t(lang, 'sites')} <b>{game.map.sites.length}</b>/{MAX_SITES}
              </span>
            </p>
            {BUILDING_ORDER.map((id) => (
              <BuildingRow key={id} id={id} g={g} />
            ))}
          </>
        )}

        {tab === 'gear' && (
          <>
            {!hasBuilding(game, 'workshop') && (
              <p className="hg-warn hg-camp__note">{t(lang, 'needWorkshop')}</p>
            )}

            <h4 className="hg-camp__group">{t(lang, 'gearGroup.tools')}</h4>
            {/* 发放规则写在造工具的地方 —— 玩家问"为什么有的条是绿的"就是在这一页 */}
            <p className="hg-dim hg-camp__note">{t(lang, 'toolRule')}</p>
            {TOOL_ORDER.map((id) => (
              <Row
                key={id}
                name={TOOLS[id].label[lang]}
                desc={toolDesc(id, lang)}
                cost={TOOLS[id].cost}
                blocked={craftBlocker(game, id) != null}
                count={game.works.tools[id]}
                onAct={() => g.craft(id)}
              />
            ))}

            <h4 className="hg-camp__group">{t(lang, 'gearGroup.party')}</h4>
            {GEAR_ORDER.map((id) => (
              <Row
                key={id}
                name={GEAR[id].label[lang]}
                desc={GEAR[id].desc[lang]}
                cost={GEAR[id].cost}
                blocked={gearBlocker(game, id) != null}
                done={hasGear(game, id) ? t(lang, 'owned') : null}
                onAct={() => g.makeGear(id)}
              />
            ))}
          </>
        )}
      </div>
    </div>
  );
}

/**
 * 一座建筑。建好的显示"已建"和拆除按钮；没建的显示造价按钮，
 * 不能建的时候说清楚差在哪 —— 只给一个灰按钮的话，玩家不知道是缺材料、
 * 缺前置还是没槽位。缺材料不另外说明，造价按钮上的数字就是说明。
 */
function BuildingRow({ id, g }) {
  const { game, lang } = g;
  const b = BUILDINGS[id];
  const built = hasBuilding(game, id);
  const blocker = buildBlocker(game, id);
  const stuck = built ? demolishBlocker(game, id) : null;

  let why = null;
  if (!built && blocker === 'requires') {
    why = fill(t(lang, 'buildBlocked.requires'), { name: BUILDINGS[b.requires].label[lang] });
  } else if (!built && blocker === 'slots') {
    why = t(lang, 'buildBlocked.slots');
  } else if (!built && blocker === 'siteLimit') {
    why = fill(t(lang, 'buildBlocked.siteLimit'), { n: MAX_SITES });
  } else if (built && stuck === 'needed') {
    why = t(lang, 'demolishBlocked.needed');
  }

  return (
    <Row
      name={b.label[lang]}
      desc={b.desc[lang]}
      cost={b.cost}
      blocked={blocker != null}
      done={built ? t(lang, 'built') : null}
      why={why}
      onAct={() => g.build(id)}
      // 被依赖的不给拆按钮，而不是给一个点了没反应的按钮
      onUndo={built && stuck == null ? () => g.askDemolish(id) : null}
      undoLabel={t(lang, 'demolish')}
    />
  );
}

/**
 * 建筑、工具、行装共用一行样式：名字 + 一句效果 + 代价按钮。
 * 差别只在"造过就没了"（done）还是"能一直造"（count），以及建筑能拆（onUndo）。
 */
function Row({ name, desc, cost, blocked, done, count, why, onAct, onUndo, undoLabel }) {
  return (
    <div className={`hg-build ${blocked && !done ? 'is-off' : ''}`}>
      <div className="hg-build__text">
        <div className="hg-build__name">
          {name}
          {count > 0 && <span className="hg-build__count"> ×{count}</span>}
        </div>
        <div className="hg-dim">{desc}</div>
        {why && <div className="hg-warn hg-build__why">{why}</div>}
      </div>

      {done ? (
        <span className="hg-build__done">
          {done}
          {onUndo && (
            <button type="button" className="hg-build__undo" onClick={onUndo}>
              {undoLabel}
            </button>
          )}
        </span>
      ) : (
        <button type="button" onClick={onAct} disabled={blocked}>
          <Amounts amounts={cost} />
        </button>
      )}
    </div>
  );
}

function toolDesc(id, lang) {
  const boosts = TOOLS[id].boosts.map((r) => RESOURCES[r].label[lang]).join(' / ');
  return `${boosts} +${TOOLS[id].bonus}`;
}
