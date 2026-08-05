/**
 * 确定性默认封面（IK60WU 渐变首字母 → 横版卡片改版改为像素马赛克）：
 * 名称哈希驱动的 6×6 拼块，同名技能永远生成同一张图，无需后端存储。
 */

/** 马赛克调色板：深青/紫/珊瑚红 + 命中权重（需求方截图定稿）。 */
const MOSAIC_PALETTE: [color: string, weight: number][] = [
  ["#16213e", 0.34], // 深青（主色）
  ["#0d1220", 0.22], // 近黑
  ["#1c2b52", 0.18], // 亮青
  ["#5e3a9b", 0.14], // 紫
  ["#7b4fb3", 0.06], // 亮紫
  ["#e5616b", 0.06], // 珊瑚红（点缀）
];

function mosaicColor(r: number): string {
  let acc = 0;
  for (const [color, w] of MOSAIC_PALETTE) {
    acc += w;
    if (r < acc) return color;
  }
  return MOSAIC_PALETTE[0][0];
}

/** 根据技能名称生成确定性的 36 格（6×6）马赛克颜色序列。 */
export function generateMosaicCells(name: string): string[] {
  // FNV-1a 种子 + mulberry32 确定性伪随机（无 Math.random 依赖）
  let h = 2166136261;
  for (const ch of name) {
    h ^= ch.codePointAt(0) ?? 0;
    h = Math.imul(h, 16777619);
  }
  const rand = () => {
    h = (h + 0x6d2b79f5) | 0;
    let t = Math.imul(h ^ (h >>> 15), 1 | h);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return Array.from({ length: 36 }, () => mosaicColor(rand()));
}
