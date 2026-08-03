/** SKILL.md frontmatter 解析（IK60WU；IK60WW 提为共享纯函数）。
 *  BFF handleCreateSkill 与客户端上传校验（validate-skill-upload.ts）共用，
 *  保证编写/上传两条创建路径的格式语义一致。
 *
 *  格式：---\nname: xxx\ndescription: xxx\n---\n正文内容
 *  返回 null 表示格式不合法（无 frontmatter 或缺闭合）。 */
export function parseSkillMd(content: string): {
  name: string;
  description: string;
  body: string;
} | null {
  const normalized = content.replace(/\r\n/g, "\n");
  const openMatch = normalized.match(/^---\s*\n/);
  if (!openMatch) return null;
  const afterOpen = normalized.slice(openMatch[0].length);
  const closeIdx = afterOpen.indexOf("\n---");
  if (closeIdx === -1) return null;
  const frontmatter = afterOpen.slice(0, closeIdx);
  const body = afterOpen.slice(closeIdx + 4).trim();
  const fields: Record<string, string> = {};
  for (const line of frontmatter.split("\n")) {
    const m = line.match(/^(\w+)\s*:\s*(.*)$/);
    if (m) fields[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
  }
  return {
    name: fields.name ?? "",
    description: fields.description ?? "",
    body,
  };
}

/** parseSkillMd 的对称重建（IK60WZ 只读查看/复制，契约 §13.1）：
 *  name/description → frontmatter，body 原样接回，产出完整 SKILL.md 文本。 */
export function serializeSkillMd(input: {
  name: string;
  description: string;
  body: string;
}): string {
  return `---\nname: ${input.name}\ndescription: ${input.description}\n---\n\n${input.body}\n`;
}
