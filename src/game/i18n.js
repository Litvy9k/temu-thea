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
  season: { en: 'Season', zh: '季节' },
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
  debug: { en: 'Debug', zh: '调试' },
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
  moreEvents: { en: 'more after this', zh: '件在后面' },
  noEffect: { en: 'Nothing changes', zh: '什么也不会变' },
  cannotAfford: { en: 'Not enough for this', zh: '不够' },
  needWorkshop: { en: 'Needs a workshop at this camp', zh: '这处营地要有工棚才能制作' },
  owned: { en: 'Owned', zh: '已有' },
  slots: { en: 'Slots', zh: '槽位' },
  sites: { en: 'Camp sites', zh: '营地址' },
  /** 地格面板里：这一格是营地址 */
  siteHere: { en: 'Camp site', zh: '营地址' },
  noSlot: { en: '(no slot)', zh: '（不占槽位）' },
  demolish: { en: 'Demolish', zh: '拆除' },
  cancel: { en: 'Cancel', zh: '取消' },
  /** 拆除确认："拆除 了望塔？返还 5❙ 4◆" —— 后面接返还的数量 */
  confirmDemolish: { en: 'Demolish {name}? You get back', zh: '拆除{name}？返还' },
  /** 拔营确认，后面接要扔掉的数量 */
  confirmBreak: {
    en: 'The store stays here. Breaking camp throws away what no longer fits:',
    zh: '仓库会留在这里。拔营后放不下的东西要扔掉：',
  },
  gearGroup: {
    tools: { en: 'Tools', zh: '工具' },
    party: { en: 'Party gear', zh: '行装' },
  },
  buildBlocked: {
    requires: { en: 'Needs {name} here first', zh: '这里要先有{name}' },
    slots: { en: 'No free slot', zh: '没有空槽位' },
    siteLimit: {
      en: 'Already {n} camp sites — build at one of them',
      zh: '营地址已满 {n} 处，只能在已有的营地址建造',
    },
  },
  demolishBlocked: {
    needed: { en: 'Other buildings here depend on it', zh: '这里有建筑依赖它' },
  },
  /** 不挡操作的提示条 */
  notice: {
    season: {
      spring: { en: 'Spring has come', zh: '春天来了' },
      summer: { en: 'Summer has come', zh: '夏天到了' },
      autumn: { en: 'Autumn has come', zh: '秋天到了' },
      winter: { en: 'Winter has come', zh: '冬天来了' },
    },
    /** 没死人时只说丢了东西 —— "失去 0 人"读起来像是出了错 */
    stranded: { en: 'Caught in the thaw — lost', zh: '困在化冻的水里，丢了' },
    strandedPeople: {
      en: 'Caught in the thaw — {n} drowned, and lost',
      zh: '困在化冻的水里，淹死 {n} 人，还丢了',
    },
  },
  toolRule: {
    en: 'Handed out in deployment order — the first ones sent get them',
    zh: '按部署顺序发放：最先派出去的人先拿到',
  },
  tab: {
    buildings: { en: 'Buildings', zh: '建筑' },
    gear: { en: 'Gear', zh: '装备' },
  },
  perHarvest: { en: 'Per harvest', zh: '每次采集' },
  /** 有矿脉但还没走到跟前。面板上只说有东西，不说是什么 */
  unsurveyed: { en: 'Something here — walk next to it to find out', zh: '有东西，走到旁边才知道是什么' },
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

/**
 * 带占位符的文案："这里要先有{name}" → "这里要先有扩编"。
 *
 * 只拼接源码里写死的字符串（名字也来自各张表），所以宿主站点按源码扫描生成的
 * 字体子集照样覆盖得到 —— 拼的是现成的字，不是运行时编出来的新字。
 */
export function fill(text, vars) {
  return text.replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? ''));
}

export function t(lang, path) {
  let node = STRINGS;
  for (const seg of path.split('.')) node = node?.[seg];
  return node?.[lang] ?? node?.en ?? path;
}
