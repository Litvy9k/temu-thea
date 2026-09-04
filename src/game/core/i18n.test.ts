/**
 * 双语覆盖的体检。
 *
 * 游戏没有翻译管线，中英文是成对硬编码在各处的 —— 好处是文案就在用它的
 * 地方，坏处是**加东西时很容易只写一种语言**，而且漏了不会报错：英文用户
 * 看到一句中文，或者 t() 静默回落到 en，没人会注意到。
 *
 * 所以这条测试把所有面向玩家的字符串表都走一遍。加新表要记得挂进来。
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { STRINGS } from '../i18n.js';
import { RESOURCES, TERRAIN } from './terrain.ts';
import { FACILITIES, TOOLS } from './works.ts';
import { EVENTS } from './events.ts';
import { SAVE_VERSION, parseSave } from './save.ts';

/** 一处双语文本：两种语言都得有，而且中文不能是照抄的英文 */
function checkPair(pair: unknown, where: string): void {
  const p = pair as { en?: unknown; zh?: unknown };
  assert.equal(typeof p?.en, 'string', `${where} 缺英文`);
  assert.equal(typeof p?.zh, 'string', `${where} 缺中文`);
  assert.ok((p.en as string).length > 0, `${where} 的英文是空的`);
  assert.ok((p.zh as string).length > 0, `${where} 的中文是空的`);
  // 照抄英文是最常见的"假装翻译了"，比缺字段更难发现
  assert.notEqual(p.zh, p.en, `${where} 的中文照抄了英文`);
}

/** 递归找出对象里所有的 { en, zh } 对 */
function walkPairs(node: unknown, path: string, out: [unknown, string][]): void {
  if (!node || typeof node !== 'object') return;
  const o = node as Record<string, unknown>;
  if ('en' in o || 'zh' in o) {
    out.push([o, path]);
    return;
  }
  for (const [k, v] of Object.entries(o)) walkPairs(v, `${path}.${k}`, out);
}

test('i18n.js 里每一条都有中英文', () => {
  const found: [unknown, string][] = [];
  walkPairs(STRINGS, 'STRINGS', found);
  assert.ok(found.length > 20, `只找到 ${found.length} 条，扫描没走到位`);
  for (const [pair, where] of found) checkPair(pair, where);
});

test('资源、地形、设施、工具的名字都有中英文', () => {
  for (const [id, r] of Object.entries(RESOURCES)) checkPair(r.label, `RESOURCES.${id}`);
  for (const [id, t] of Object.entries(TERRAIN)) checkPair(t.label, `TERRAIN.${id}`);
  for (const [id, f] of Object.entries(FACILITIES)) {
    checkPair(f.label, `FACILITIES.${id} 的名字`);
    checkPair(f.desc, `FACILITIES.${id} 的说明`);
  }
  for (const [id, t] of Object.entries(TOOLS)) checkPair(t.label, `TOOLS.${id}`);
});

test('事件的正文和每个选项都有中英文', () => {
  for (const e of EVENTS) {
    checkPair(e.text, `${e.id} 的正文`);
    e.choices.forEach((c, i) => checkPair(c.label, `${e.id} 的第 ${i} 个选项`));
  }
});

test('读档失败的每种提示都有中英文', () => {
  // 这些是唯一由异常携带、而不是从字符串表里取的玩家可见文本，
  // 最容易在加新校验时被漏掉
  const bad = [
    'not json',
    '123',
    JSON.stringify({ v: 999 }),
    JSON.stringify({ v: SAVE_VERSION }),
    JSON.stringify({ v: SAVE_VERSION, map: { width: 4, height: 4, terrain: 'AA' } }),
    JSON.stringify({
      v: SAVE_VERSION,
      map: { width: 2, height: 2, terrain: 'AAAA', explored: '00' },
    }),
  ];

  let checked = 0;
  for (const input of bad) {
    try {
      parseSave(input);
      assert.fail(`这份存档应该被拒绝：${input.slice(0, 40)}`);
    } catch (err) {
      const e = err as { msg?: unknown };
      assert.ok(e.msg, '读档错误没带双语消息');
      checkPair(e.msg, `读档错误 "${input.slice(0, 24)}"`);
      checked += 1;
    }
  }
  assert.equal(checked, bad.length);
});
