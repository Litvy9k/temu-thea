/**
 * 事件表。
 *
 * 一个事件 = 触发条件 + 一段文本 + 若干个选择，每个选择有自己的效果。
 * 这个文件只有数据和纯函数，不认识 GameState —— 判定时由 state.ts 把当前
 * 局面摊成一个 Snapshot 递进来，所以这里可以单独测，也不会和 state.ts 循环依赖。
 *
 * 几条定死的规则：
 *
 *   一回合最多触发一个事件。按表的顺序判定，先命中的先触发 ——
 *   **表的顺序就是优先级**，把要紧的事件往前放。
 *
 *   trigger 是一个数组，条目之间 OR，条目内部的 when 之间 AND。
 *   多个条目同时成立时取**概率最高**的那个，不叠加 —— 叠加会变成
 *   "条件写得越多越容易触发"，写表的人根本预期不了。
 *
 *   **每个事件必须至少有一个不带 require 的选择。** 否则资源不够时
 *   玩家会被卡死在弹窗里，回合都推不动。有测试盯着这条。
 */
import type { ResourceId } from './terrain.ts';
import type { ToolId } from './works.ts';

export interface Bilingual {
  en: string;
  zh: string;
}

// ---------------------------------------------------------------- 条件

/** 能拿来做条件的数值。加新的要同时在 state.ts 的 snapshot() 里给出取值 */
export type Metric = 'turn' | 'people' | 'idle' | 'food' | 'wood' | 'stone';

export type Op = '>' | '>=' | '<' | '<=' | '==';

export interface Condition {
  metric: Metric;
  op: Op;
  value: number;
}

/** 当前局面里这些数值的快照。判定只看它，不看整个 GameState */
export type Snapshot = Record<Metric, number>;

export interface Rule {
  /** 这些条件全部成立才算这一条命中（AND） */
  when: Condition[];
  /** 命中后每回合的触发概率，0..1 */
  chance: number;
}

export function meets(snap: Snapshot, c: Condition): boolean {
  const v = snap[c.metric];
  switch (c.op) {
    case '>':
      return v > c.value;
    case '>=':
      return v >= c.value;
    case '<':
      return v < c.value;
    case '<=':
      return v <= c.value;
    case '==':
      return v === c.value;
    default:
      return false;
  }
}

export function meetsAll(snap: Snapshot, cs: Condition[] | undefined): boolean {
  return (cs ?? []).every((c) => meets(snap, c));
}

/**
 * 这个事件此刻的触发概率。没有任何一条命中就是 0。
 * 多条命中取最大，不求和 —— 见文件头。
 */
export function chanceOf(snap: Snapshot, trigger: Rule[]): number {
  let best = 0;
  for (const rule of trigger) {
    if (meetsAll(snap, rule.when)) best = Math.max(best, rule.chance);
  }
  return best;
}

// ---------------------------------------------------------------- 效果

/**
 * 选择的效果。纯粹是一组增减，没有回调也没有脚本 ——
 * 这样它能被序列化、被测试，也能在界面上自动渲染成 "+8✦ −6❙"，
 * 不用再手写一遍文案（手写的那份迟早和数值对不上）。
 */
export interface Effect {
  stock?: Partial<Record<ResourceId, number>>;
  people?: number;
  tools?: Partial<Record<ToolId, number>>;
}

export interface Choice {
  label: Bilingual;
  /** 不满足就置灰。至少要有一个选择不带这个字段 */
  require?: Condition[];
  effect: Effect;
}

export interface GameEvent {
  id: string;
  text: Bilingual;
  trigger: Rule[];
  choices: Choice[];
  /** 一局里只触发一次 */
  once?: boolean;
}

// ---------------------------------------------------------------- 事件表

export const EVENTS: GameEvent[] = [
  {
    id: 'hardWinter',
    once: false,
    text: {
      en: 'The cold comes early and stays. The fire has to be fed harder than usual.',
      zh: '寒潮来得早，赖着不走。篝火得比平时烧得更旺。',
    },
    // 两条 OR：入冬本身有概率，柴不够时概率高得多
    trigger: [
      { when: [{ metric: 'turn', op: '>=', value: 12 }], chance: 0.08 },
      { when: [{ metric: 'wood', op: '<', value: 6 }], chance: 0.25 },
    ],
    choices: [
      {
        label: { en: 'Burn through the woodpile', zh: '多烧柴挺过去' },
        require: [{ metric: 'wood', op: '>=', value: 8 }],
        effect: { stock: { wood: -8 } },
      },
      {
        label: { en: 'Sit it out cold', zh: '硬扛' },
        effect: { people: -1 },
      },
    ],
  },

  {
    id: 'wanderers',
    text: {
      en: 'Three travellers follow your smoke in. They can work, and they are hungry.',
      zh: '三个人循着炊烟找过来。他们能干活，也饿着。',
    },
    trigger: [{ when: [{ metric: 'turn', op: '>=', value: 4 }], chance: 0.12 }],
    choices: [
      {
        label: { en: 'Take them in', zh: '收留他们' },
        require: [{ metric: 'food', op: '>=', value: 6 }],
        effect: { people: 3, stock: { food: -6 } },
      },
      {
        label: { en: 'Send them on', zh: '打发走' },
        effect: {},
      },
    ],
  },

  {
    id: 'spoiled',
    text: {
      en: 'Damp gets into the stores. Part of the food is turning.',
      zh: '存粮受了潮，一部分开始发霉。',
    },
    // 存粮越多越容易出这事，所以条件是"粮食多"
    trigger: [{ when: [{ metric: 'food', op: '>', value: 30 }], chance: 0.18 }],
    choices: [
      {
        label: { en: 'Dry it over the fire', zh: '生火烘干' },
        require: [{ metric: 'wood', op: '>=', value: 6 }],
        effect: { stock: { wood: -6, food: -2 } },
      },
      {
        label: { en: 'Throw out the bad sacks', zh: '扔掉坏的' },
        effect: { stock: { food: -10 } },
      },
    ],
  },

  {
    id: 'deserters',
    text: {
      en: 'People with nothing to do start talking about leaving.',
      zh: '闲着的人开始念叨要走。',
    },
    trigger: [{ when: [{ metric: 'idle', op: '>=', value: 3 }], chance: 0.2 }],
    choices: [
      {
        label: { en: 'Hand out extra rations', zh: '多分口粮安抚' },
        require: [{ metric: 'food', op: '>=', value: 8 }],
        effect: { stock: { food: -8 } },
      },
      {
        label: { en: 'Let them walk', zh: '由他们去' },
        effect: { people: -1 },
      },
    ],
  },

  {
    id: 'oldCache',
    once: true,
    text: {
      en: 'Under a fallen cairn: someone else came through here, and did not come back for their things.',
      zh: '塌了的石堆下面：有人从这里经过，再没回来取自己的东西。',
    },
    trigger: [{ when: [{ metric: 'turn', op: '>=', value: 6 }], chance: 0.12 }],
    // 只有一个选择也是合法的：不是所有事件都该给选择权
    choices: [
      {
        label: { en: 'Take what is usable', zh: '把能用的拿走' },
        effect: { stock: { wood: 8, food: 6, stone: 4 } },
      },
    ],
  },
];

/** 按 id 找事件。存档里存的是 id，读回来要还原成事件对象 */
export function findEvent(id: string): GameEvent | undefined {
  return EVENTS.find((e) => e.id === id);
}
