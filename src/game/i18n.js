/**
 * 游戏自己的文案表，形状和站点的 i18n 一致（{ en, zh }），但**不共用实例**。
 * 这样整个 game/ 目录搬进别的项目时不需要改 import，接站点的 i18n 也只是
 * 换掉 t() 的实现。
 *
 * 英文的大小写规则（加新文案照着来）：
 *   句首大写、其余小写（sentence case），不用 Title Case；
 *   但**跟在数字后面或括号里当注解的词保持全小写** —— "1 idle"、
 *   "(tools +20)" 这种位置上大写会像另起了一句。
 */
export const STRINGS = {
  turn: { en: 'Turn', zh: '回合' },
  moves: { en: 'Moves', zh: '行动力' },
  people: { en: 'People', zh: '人数' },
  /** 只作为 "1 idle" 的后缀出现，所以小写 */
  idle: { en: 'idle', zh: '闲置' },
  endTurn: { en: 'End turn', zh: '结束回合' },
  camp: { en: 'Make camp', zh: '扎营' },
  breakCamp: { en: 'Break camp', zh: '拔营' },
  roaming: { en: 'Roaming', zh: '游荡中' },
  camped: { en: 'Camped', zh: '已扎营' },
  newGame: { en: 'New game', zh: '新游戏' },
  save: { en: 'Save', zh: '存档' },
  load: { en: 'Load', zh: '读档' },
  loadFailed: { en: 'Could not read that save', zh: '读不了这个存档' },
  over: { en: 'Everyone is gone', zh: '队伍全灭' },
  impassable: { en: 'Impassable', zh: '不可通行' },
  cost: { en: 'Move', zh: '移动' },
  crew: { en: 'Crew', zh: '人力' },
  send: { en: 'Send one', zh: '派一人' },
  recall: { en: 'Recall one', zh: '撤一人' },
  progress: { en: 'Progress', zh: '进度' },
  perTurn: { en: 'Per turn', zh: '每回合' },
  campPanel: { en: 'Camp', zh: '营地' },
  close: { en: 'Close', zh: '关闭' },
  built: { en: 'Built', zh: '已建' },
  /** 只作为 "(tools +20)" 的注解出现，所以小写 */
  tools: { en: 'tools', zh: '工具' },
  personUnit: { en: ' people', zh: ' 人' },
  noEffect: { en: 'Nothing changes', zh: '什么也不会变' },
  cannotAfford: { en: 'Not enough for this', zh: '不够' },
  needWorkshop: { en: 'Build a workshop first', zh: '要先建工棚' },
  toolRule: {
    en: 'Handed out in deployment order — the first ones sent get them',
    zh: '按部署顺序发放：最先派出去的人先拿到',
  },
  tab: {
    facilities: { en: 'Facilities', zh: '设施' },
    crafting: { en: 'Crafting', zh: '制作' },
  },
  perHarvest: { en: 'Per harvest', zh: '每次采集' },
  shortage: { en: 'Shortage', zh: '短缺' },
  upkeep: { en: 'Upkeep', zh: '消耗' },
  hintRoam: {
    en: 'Click to move · Drag to pan · Wheel or pinch to zoom · C to camp · Space ends turn',
    zh: '点击移动 · 拖拽平移 · 滚轮或双指缩放 · C 扎营 · 空格结束回合',
  },
  hintCamped: {
    en: 'Tap a ring tile to send someone · Use − / + to adjust · C to break camp · Space ends turn',
    zh: '点外圈地格派人 · 用 − / + 增减 · C 拔营 · 空格结束回合',
  },
  blocked: {
    terrain: { en: 'Cannot camp here', zh: '此地无法扎营' },
    noMoves: { en: 'No moves left this turn', zh: '本回合行动力已用尽' },
    camped: { en: 'Already camped', zh: '已经扎营' },
  },
  assignBlocked: {
    noCamp: { en: 'Make camp first', zh: '要先扎营' },
    notWorkable: { en: 'Nothing to gather here', zh: '这里无可采集' },
    noIdle: { en: 'No one is free', zh: '没有闲置人员' },
    tileFull: { en: 'This tile is full', zh: '这一格已站满' },
  },
};

export function t(lang, path) {
  let node = STRINGS;
  for (const seg of path.split('.')) node = node?.[seg];
  return node?.[lang] ?? node?.en ?? path;
}
