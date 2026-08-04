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

/** 从设计系统色板衍生的 8 组渐变对（DESIGN.md `skill-cover-N-from/to`，
 *  值注册在 globals.css `--tc-skill-cover-N-*`，此处一律引用 CSS 变量，不硬编码 hex）。 */
const GRADIENTS: [string, string][] = [
  ["var(--tc-skill-cover-1-from)", "var(--tc-skill-cover-1-to)"],
  ["var(--tc-skill-cover-2-from)", "var(--tc-skill-cover-2-to)"],
  ["var(--tc-skill-cover-3-from)", "var(--tc-skill-cover-3-to)"],
  ["var(--tc-skill-cover-4-from)", "var(--tc-skill-cover-4-to)"],
  ["var(--tc-skill-cover-5-from)", "var(--tc-skill-cover-5-to)"],
  ["var(--tc-skill-cover-6-from)", "var(--tc-skill-cover-6-to)"],
  ["var(--tc-skill-cover-7-from)", "var(--tc-skill-cover-7-to)"],
  ["var(--tc-skill-cover-8-from)", "var(--tc-skill-cover-8-to)"],
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
