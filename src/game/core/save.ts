/**
 * 存档的序列化与读取。
 *
 * 格式是 JSON，但**地图不原样存**：2816 个地格直接 stringify 大约 200KB，
 * 而其中真正的信息只有三样 —— 地形、探明与否、采集进度。压成
 * 「一格一个字符的地形串 + 0/1 的探明串 + 稀疏的进度表」之后约 6KB。
 *
 * 有两件事**刻意不存**：
 *   visible  由 refreshVision 从队伍和营地的位置重算，存了反而可能自相矛盾
 *   地图种子  只作记录用。地形是照原样存下来的，不靠种子重新生成 ——
 *            否则以后一动地形表或噪声参数，所有老存档的地图都会悄悄变样
 */
import type { GameMap, Tile } from './map.ts';
import { type GameState, refreshVision } from './state.ts';
import type { TerrainId } from './terrain.ts';

export const SAVE_VERSION = 1;

/**
 * 读档失败要说给玩家听，所以消息得有中英两种。
 *
 * 双语直接写在抛出的地方，不走查表 —— 这些消息只有这一个文件在用，
 * 抽成 key 反而要在两处之间来回对照才能看懂一条错误说的是什么。
 * detail 里只放数字，不用翻译。
 */
export interface Bilingual {
  en: string;
  zh: string;
}

export class SaveError extends Error {
  readonly msg: Bilingual;
  /** 只放数字之类不用翻译的补充信息 */
  readonly detail?: string;

  constructor(msg: Bilingual, detail?: string) {
    super(msg.en);
    this.name = 'SaveError';
    this.msg = msg;
    this.detail = detail;
  }
}

/**
 * 地形的字符编码。**只能往后追加，不能改顺序也不能删** ——
 * 这个数组的下标就是存档里那个字符的含义，动了它等于把老存档的地图打乱。
 */
const TERRAIN_CODES: readonly TerrainId[] = [
  'ocean',
  'shallow',
  'marsh',
  'grass',
  'forest',
  'hills',
  'mountain',
  'desert',
  'tundra',
];

const FIRST_CODE = 65; // 'A'

interface SavedMap {
  width: number;
  height: number;
  /** 生成这张图用的种子。只作记录，读档时不据此重新生成 */
  seed: number;
  /** 一格一个字符，行优先 */
  terrain: string;
  /** 一格一个 0/1，行优先 */
  explored: string;
  /** 下标 -> 采集进度。绝大多数格子是 0，所以存稀疏表 */
  progress: Record<string, number>;
}

interface SaveFile {
  v: number;
  savedAt: string;
  turn: number;
  stock: GameState['stock'];
  party: GameState['party'];
  camp: GameState['camp'];
  works: GameState['works'];
  lastIncome: GameState['lastIncome'];
  lastShortage: GameState['lastShortage'];
  hardship: number;
  over: boolean;
  map: SavedMap;
}

// ---------------------------------------------------------------- 写

export function serialize(state: GameState): string {
  const { map } = state;
  let terrain = '';
  let explored = '';
  const progress: Record<string, number> = {};

  for (let i = 0; i < map.tiles.length; i += 1) {
    const tile = map.tiles[i];
    const code = TERRAIN_CODES.indexOf(tile.terrain);
    if (code < 0) throw new Error(`terrain "${tile.terrain}" has no code; add it to TERRAIN_CODES`);

    terrain += String.fromCharCode(FIRST_CODE + code);
    explored += tile.explored ? '1' : '0';
    if (tile.progress) progress[i] = tile.progress;
  }

  const file: SaveFile = {
    v: SAVE_VERSION,
    savedAt: new Date().toISOString(),
    turn: state.turn,
    stock: state.stock,
    party: state.party,
    camp: state.camp,
    works: state.works,
    lastIncome: state.lastIncome,
    lastShortage: state.lastShortage,
    hardship: state.hardship,
    over: state.over,
    map: {
      width: map.width,
      height: map.height,
      seed: map.seed,
      terrain,
      explored,
      progress,
    },
  };

  return JSON.stringify(file);
}

/** 存档文件名。回合数放前面，一眼能看出是哪一局的哪个阶段 */
export function saveFilename(state: GameState): string {
  const d = new Date();
  const stamp =
    `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}` +
    `-${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}`;
  return `temu-thea-t${state.turn}-${stamp}.json`;
}

// ---------------------------------------------------------------- 读

/**
 * 读档。文件是用户给的，什么都可能是 —— 拿错文件、编辑坏了、旧版本的存档。
 * 所以每一步都校验，出错抛一句人能看懂的话，由 UI 显示出来。
 * 绝不能让一个坏文件把页面白屏。
 */
export function parseSave(text: string): GameState {
  let file: SaveFile;
  try {
    file = JSON.parse(text);
  } catch {
    throw new SaveError({ en: 'not a valid JSON file', zh: '这不是一个有效的 JSON 文件' });
  }

  if (!file || typeof file !== 'object') {
    throw new SaveError({ en: 'save content is not an object', zh: '存档内容不是一个对象' });
  }
  if (file.v !== SAVE_VERSION) {
    throw new SaveError(
      { en: 'save version mismatch', zh: '存档版本对不上' },
      `${file.v ?? '?'} → ${SAVE_VERSION}`,
    );
  }

  const m = file.map;
  if (!m || typeof m.width !== 'number' || typeof m.height !== 'number') {
    throw new SaveError({ en: 'no map size in the save', zh: '存档里没有地图尺寸' });
  }

  const n = m.width * m.height;
  if (typeof m.terrain !== 'string' || m.terrain.length !== n) {
    throw new SaveError(
      { en: 'terrain data length does not match the map', zh: '地形数据长度和地图对不上' },
      `${m.terrain?.length ?? 0} / ${n}`,
    );
  }
  if (typeof m.explored !== 'string' || m.explored.length !== n) {
    throw new SaveError({
      en: 'explored data length does not match the map',
      zh: '探明数据长度和地图对不上',
    });
  }

  const tiles: Tile[] = new Array(n);
  for (let i = 0; i < n; i += 1) {
    const code = m.terrain.charCodeAt(i) - FIRST_CODE;
    const id = TERRAIN_CODES[code];
    if (!id) {
      throw new SaveError(
        { en: 'unrecognised terrain code', zh: '有一格的地形编码无法识别' },
        `#${i}`,
      );
    }

    tiles[i] = {
      terrain: id,
      explored: m.explored[i] === '1',
      // visible 不存，下面由 refreshVision 重算
      visible: false,
      progress: m.progress?.[i] ?? 0,
    };
  }

  const map: GameMap = { width: m.width, height: m.height, seed: m.seed ?? 0, tiles };

  if (!file.party || typeof file.party.people !== 'number') {
    throw new SaveError({ en: 'no party data in the save', zh: '存档里没有队伍数据' });
  }
  if (!file.works || !file.works.tools) {
    throw new SaveError({ en: 'no works data in the save', zh: '存档里没有工事数据' });
  }

  const state: GameState = {
    map,
    party: file.party,
    camp: file.camp ?? null,
    works: file.works,
    turn: file.turn ?? 1,
    stock: file.stock,
    lastIncome: file.lastIncome ?? { food: 0, wood: 0, stone: 0 },
    lastShortage: file.lastShortage ?? { food: 0, wood: 0 },
    hardship: file.hardship ?? 0,
    over: Boolean(file.over),
    version: 0,
  };

  refreshVision(state);
  return state;
}
