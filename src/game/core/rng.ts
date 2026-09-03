/**
 * 可复现的伪随机。地图生成必须能靠一个种子完整重来 ——
 * 否则玩家报"这张图有问题"时你复现不出来，存档也存不住地形。
 */

/** mulberry32：32 位状态，质量够做地形，代码短到可以放心内联 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
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
