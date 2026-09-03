/**
 * 手机布局：上面一条状态、中间地图、下面拇指区。
 *
 * 和桌面版的区别不在排布，在信息结构：
 *
 *   - 面板不能浮在地图上。手指会挡住自己要点的地方，而且触屏没有"移开光标
 *     看一眼"这个动作 —— 浮层压住的那圈地格正好是玩家要点的。所以改成
 *     上下通栏，中间整块留给地图。
 *   - 操作按钮固定在最底下。单手握持时拇指够得到的只有屏幕下缘。
 *   - 消耗明细、快捷键提示这些不显示。横向空间要留给真正每回合都要看的数。
 */
import { Actions, CrewStepper, Resource, RESOURCE_ORDER, TileFacts } from './parts.jsx';
import { PARTY_MOVES } from '../core/state.ts';
import { t } from '../i18n.js';
import './MobileLayout.css';

export default function MobileLayout(g) {
  const { game, lang, camped, idle, detail } = g;

  return (
    <>
      <div className="hg-m-status">
        <div className="hg-m-status__line">
          <span className="hg-dim">{t(lang, 'turn')}</span>
          <b>{game.turn}</b>

          <span className="hg-dim">{t(lang, camped ? 'camped' : 'roaming')}</span>
          <b>
            {camped
              ? `${game.party.people - idle} / ${game.party.people}`
              : `${game.party.moves} / ${PARTY_MOVES}`}
          </b>

          {camped && idle > 0 && (
            <span className="hg-idle">
              {idle} {t(lang, 'idle')}
            </span>
          )}
          {game.hardship > 0 && (
            <span className="hg-warn">
              {t(lang, 'shortage')} {game.hardship}
            </span>
          )}
        </div>

        <div className="hg-m-status__line">
          {RESOURCE_ORDER.map((id) => (
            <Resource
              key={id}
              id={id}
              stock={game.stock[id]}
              income={game.lastIncome[id]}
              short={game.lastShortage[id] ?? 0}
              lang={lang}
            />
          ))}
        </div>
      </div>

      <div className="hg-m-dock">
        {detail && (
          <div className="hg-m-sheet">
            <div className="hg-m-sheet__facts">
              <TileFacts detail={detail} camped={camped} lang={lang} />
              {g.outOfPeople && <div className="hg-warn">{t(lang, 'assignBlocked.noIdle')}</div>}
            </div>

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
          </div>
        )}

        {(g.campBlocker || game.over) && (
          <div className="hg-m-notice hg-warn">
            {game.over ? t(lang, 'over') : t(lang, `blocked.${g.campBlocker}`)}
          </div>
        )}

        <Actions
          game={game}
          camped={camped}
          campBlocker={g.campBlocker}
          onToggleCamp={g.toggleCamp}
          onEndTurn={g.doEndTurn}
          onOpenCamp={g.openCamp}
          lang={lang}
        />
      </div>
    </>
  );
}
