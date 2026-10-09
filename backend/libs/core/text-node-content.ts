export function extractTextNodeText(data: Record<string, unknown> | undefined): string {
  if (typeof data?.text === "string") return data.text;
  if (typeof data?.html !== "string") return "";
  const entities: Record<string, string> = { nbsp: " ", lt: "<", gt: ">", quot: '\"', apos: "'", amp: "&" };
  return data.html
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(?:p|div|li|h[1-6]|blockquote|pre|tr)\s*>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&(#x[0-9a-f]+|#\d+|nbsp|lt|gt|quot|apos|amp);/gi, (match, entity: string) => {
      if (!entity.startsWith("#")) return entities[entity.toLowerCase()] ?? match;
      const code = entity.charAt(1).toLowerCase() === "x" ? parseInt(entity.slice(2), 16) : Number(entity.slice(1));
      return code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff) ? String.fromCodePoint(code) : "\ufffd";
    })
    .trim();
}
