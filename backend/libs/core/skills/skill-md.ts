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
    const key = m?.[1];
    const value = m?.[2];
    if (key !== undefined && value !== undefined) {
      fields[key] = value.trim().replace(/^["']|["']$/g, "");
    }
  }
  return {
    name: fields.name ?? "",
    description: fields.description ?? "",
    body,
  };
}

export function serializeSkillMd(input: {
  name: string;
  description: string;
  body: string;
}): string {
  return `---\nname: ${input.name}\ndescription: ${input.description}\n---\n\n${input.body}\n`;
}
