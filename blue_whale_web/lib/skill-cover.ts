/**
 * 确定性封面生成（IK60WU）：根据技能名称稳定生成渐变色和首字母图标。
 * 同名技能永远生成相同封面，无需后端存储。
 */

/** DJB2 字符串哈希（确定性、无 Math.random 依赖）。 */
function djb2Hash(str: string): number {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash + str.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

/** 从设计系统色板衍生的 8 组渐变对。 */
const GRADIENTS: [string, string][] = [
  ["#3b82f6", "#1e3a8a"],
  ["#8b5cf6", "#4c1d95"],
  ["#ec4899", "#831843"],
  ["#f59e0b", "#78350f"],
  ["#10b981", "#064e3b"],
  ["#06b6d4", "#0c4a6e"],
  ["#ef4444", "#7f1d1d"],
  ["#6366f1", "#312e81"],
];

/** 根据技能名称生成确定性渐变封面和首字母。 */
export function generateSkillCover(name: string): {
  gradient: string;
  initials: string;
} {
  const hash = djb2Hash(name);
  const [from, to] = GRADIENTS[hash % GRADIENTS.length];
  const firstChar = name.trim().charAt(0);
  return {
    gradient: `linear-gradient(135deg, ${from}, ${to})`,
    initials: firstChar ? firstChar.toUpperCase() : "?",
  };
}
