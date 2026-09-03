/**
 * 游戏自己的文案表，形状和站点的 i18n 一致（{ en, zh }），但**不共用实例**。
 * 这样整个 game/ 目录搬进别的项目时不需要改 import，接站点的 i18n 也只是
 * 换掉 t() 的实现。
 */
export const STRINGS = {
  turn: { en: 'turn', zh: '回合' },
  moves: { en: 'moves', zh: '行动力' },
  people: { en: 'people', zh: '人数' },
  idle: { en: 'idle', zh: '闲置' },
  endTurn: { en: 'end turn', zh: '结束回合' },
  camp: { en: 'make camp', zh: '扎营' },
  breakCamp: { en: 'break camp', zh: '拔营' },
  roaming: { en: 'roaming', zh: '游荡中' },
  camped: { en: 'camped', zh: '已扎营' },
  newGame: { en: 'new game', zh: '新游戏' },
  save: { en: 'save', zh: '存档' },
  load: { en: 'load', zh: '读档' },
  loadFailed: { en: 'could not read that save', zh: '读不了这个存档' },
  over: { en: 'everyone is gone', zh: '队伍全灭' },
  impassable: { en: 'impassable', zh: '不可通行' },
  cost: { en: 'move', zh: '移动' },
  crew: { en: 'crew', zh: '人力' },
  send: { en: 'send one', zh: '派一人' },
  recall: { en: 'recall one', zh: '撤一人' },
  progress: { en: 'progress', zh: '进度' },
  perTurn: { en: 'per turn', zh: '每回合' },
  campPanel: { en: 'camp', zh: '营地' },
  close: { en: 'close', zh: '关闭' },
  built: { en: 'built', zh: '已建' },
  tools: { en: 'tools', zh: '工具' },
  needWorkshop: { en: 'build a workshop first', zh: '要先建工棚' },
  toolRule: {
    en: 'handed out in deployment order — the first N deployed get them',
    zh: '按部署顺序发放：最先派出去的人先拿到',
  },
  tab: {
    facilities: { en: 'facilities', zh: '设施' },
    crafting: { en: 'crafting', zh: '制作' },
  },
  perHarvest: { en: 'per harvest', zh: '每次采集' },
  shortage: { en: 'SHORTAGE', zh: '短缺' },
  upkeep: { en: 'upkeep', zh: '消耗' },
  hintRoam: {
    en: 'click to move · drag to pan · wheel or pinch to zoom · C camp · Space end turn',
    zh: '点击移动 · 拖拽平移 · 滚轮或双指缩放 · C 扎营 · 空格结束回合',
  },
  hintCamped: {
    en: 'tap a ring tile to send someone · use − / + to adjust · C break camp · Space end turn',
    zh: '点外圈地格派人 · 用 − / + 增减 · C 拔营 · 空格结束回合',
  },
  blocked: {
    terrain: { en: 'cannot camp here', zh: '此地无法扎营' },
    noMoves: { en: 'no moves left this turn', zh: '本回合行动力已用尽' },
    camped: { en: 'already camped', zh: '已经扎营' },
  },
  assignBlocked: {
    noCamp: { en: 'make camp first', zh: '要先扎营' },
    notWorkable: { en: 'nothing to gather here', zh: '这里无可采集' },
    noIdle: { en: 'no one is free', zh: '没有闲置人员' },
    tileFull: { en: 'this tile is full', zh: '这一格已站满' },
  },
};

export function t(lang, path) {
  let node = STRINGS;
  for (const seg of path.split('.')) node = node?.[seg];
  return node?.[lang] ?? node?.en ?? path;
}
