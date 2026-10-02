/**
 * 桌面布局：地图铺满，两块浮动面板压在角上。
 *
 * 前提是有鼠标：左上角的 HUD 不挡路（指针能绕开），右下角的地格面板跟着
 * 悬停实时变。信息密度可以高，因为一屏放得下，而且读者可以边看边移动光标。
 */
import { Actions, CrewStepper, Resource, RESOURCE_ORDER, SeasonBadge, TileFacts } from './parts.jsx';
import { RESOURCES } from '../core/terrain.ts';
import { Notices } from './Overlays.jsx';
import { t } from '../i18n.js';
import './DesktopLayout.css';

export default function DesktopLayout(g) {
  const { game, lang, camped, idle, detail } = g;

  return (
    <>
      {camped && !g.campOpen && (
        <button type="button" className="hg-panel hg-camp-open" onClick={g.openCamp}>
          ⌂ {t(lang, 'campPanel')}
        </button>
      )}

      <div className="hg-panel hg-hud">
        <Row label={t(lang, 'turn')} value={game.turn} />
        <div className="hg-row">
          <span>{t(lang, 'season')}</span>
          <SeasonBadge season={g.season} lang={lang} />
        </div>
        <Row
          label={t(lang, camped ? 'camped' : 'roaming')}
          value={
            camped
              ? `${game.party.people - idle} / ${game.party.people}`
              : `${game.party.moves} / ${g.maxMoves}`
          }
        />
        <Row
          label={t(lang, 'people')}
          value={
            <>
              {game.party.people}
              {camped && idle > 0 ? (
                <span className="hg-idle">
                  {' '}
                  · {idle} {t(lang, 'idle')}
                </span>
              ) : null}
            </>
          }
        />

        <div className="hg-sep" />

        {RESOURCE_ORDER.filter((id) => g.seen.includes(id)).map((id) => (
          <div className="hg-row" key={id}>
            <Resource
              id={id}
              stock={game.stock[id]}
              cap={g.stockCap}
              income={game.lastIncome[id]}
              short={game.lastShortage[id] ?? 0}
              wasted={game.lastWasted[id] ?? 0}
              lang={lang}
            />
          </div>
        ))}

        <div className="hg-row hg-dim">
          <span>{t(lang, 'upkeep')}</span>
          {/* 读规则层算好的数：仓库省的那份粮、冬天翻倍的柴都已经在里面了 */}
          <span>
            {g.foodUpkeep}
            {RESOURCES.food.glyph} {g.woodUpkeep}
            {RESOURCES.wood.glyph}
          </span>
        </div>

        {game.hardship > 0 && (
          <div className="hg-row hg-warn">
            <span>{t(lang, 'shortage')}</span>
            <b>{game.hardship}</b>
          </div>
        )}

        <div className="hg-sep" />

        <Actions
          game={game}
          camped={camped}
          campBlocker={g.campBlocker}
          onToggleCamp={g.toggleCamp}
          onEndTurn={g.doEndTurn}
          lang={lang}
        />

        {g.campBlocker && <div className="hg-warn">{t(lang, `blocked.${g.campBlocker}`)}</div>}
        {game.over && <div className="hg-warn">{t(lang, 'over')}</div>}
      </div>

      {detail && (
        <div className="hg-panel hg-tile">
          <TileFacts detail={detail} camped={camped} lang={lang} />

          {g.stepping && (
            <CrewStepper
              crew={detail.crew}
              crewMax={detail.crewMax}
              canSendMore={g.canSendMore}
              canRecall={g.canRecall}
              onStep={g.step}
              lang={lang}
            />
          )}

          {g.outOfPeople && <div className="hg-warn">{t(lang, 'assignBlocked.noIdle')}</div>}
        </div>
      )}

      <div className="hg-hint">{t(lang, camped ? 'hintCamped' : 'hintRoam')}</div>

      {/* 地图正上方居中。HUD 在左上、营地按钮在右上，中间是空的 */}
      <Notices notices={g.notices} lang={lang} />
    </>
  );
}

function Row({ label, value }) {
  return (
    <div className="hg-row">
      <span>{label}</span>
      <b>{value}</b>
    </div>
  );
}
