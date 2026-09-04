/**
 * 可复现的伪随机。地图生成必须能靠一个种子完整重来 ——
 * 否则玩家报"这张图有问题"时你复现不出来，存档也存不住地形。
 */

/**
 * mulberry32 的一步，写成纯函数：拿一个状态，给出 0..1 的值和下一个状态。
 *
 * 事件判定需要把随机数状态**存进 GameState** —— 用 Math.random() 的话事件
 * 没法复现也没法测，而存档读回来之后接下来抽到什么也会和存档前不一致。
 */
export function step(seed: number): { value: number; next: number } {
  const a = (seed + 0x6d2b79f5) >>> 0;
  let t = a;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return { value: ((t ^ (t >>> 14)) >>> 0) / 4294967296, next: a };
}

/** 地图生成用的流式接口。和 step 是同一个发生器，别各写一份 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    const r = step(a);
    a = r.next;
    return r.value;
  };
}

/** 把任意字符串揉成一个种子，方便玩家输"温泉关"这种可读的种子 */
export function seedFrom(text: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
