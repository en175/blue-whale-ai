
export const TEXT_NODE_MARKDOWN_FORMATS = [
  "heading-1",
  "heading-2",
  "heading-3",
  "paragraph",
  "bold",
  "italic",
  "ordered-list",
  "unordered-list",
] as const;

type BlockKind = "heading" | "paragraph" | "list-item" | "rule";

interface MarkdownBlock {
  kind: BlockKind;
  level?: number;
  ordered?: boolean;
  lines: string[];
}

export function parseMarkdownBlocks(md: string): MarkdownBlock[] {
  const blocks: MarkdownBlock[] = [];
  let paragraphOpen = true;
  for (const rawLine of md.split("\n")) {
    const line = rawLine.replace(/\r$/, "");
    if (line.trim() === "") { paragraphOpen = false; continue; }

    const heading = /^(#{1,3}) (.*)$/.exec(line);
    if (heading) {
      blocks.push({ kind: "heading", level: (heading[1] ?? "").length, lines: [heading[2] ?? ""] });
      paragraphOpen = false;
      continue;
    }
    if (/^---$/.test(line.trim())) {
      blocks.push({ kind: "rule", lines: [] });
      paragraphOpen = false;
      continue;
    }
    const bullet = /^[-*] (.*)$/.exec(line);
    if (bullet) {
      blocks.push({ kind: "list-item", ordered: false, lines: [bullet[1] ?? ""] });
      paragraphOpen = false;
      continue;
    }
    const ordered = /^(\d+)\. (.*)$/.exec(line);
    if (ordered) {
      blocks.push({ kind: "list-item", ordered: true, lines: [ordered[2] ?? ""] });
      paragraphOpen = false;
      continue;
    }
    const previous = blocks.at(-1);
    if (paragraphOpen && previous?.kind === "paragraph") previous.lines.push(line);
    else blocks.push({ kind: "paragraph", lines: [line] });
    paragraphOpen = true;
  }
  return blocks;
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function renderMarkdownInline(text: string): string {
  let out = "";
  let rest = text;
  while (rest.length > 0) {
    const boldStart = rest.indexOf("**");
    const italicStart = rest.indexOf("*");
    if (boldStart !== -1 && (italicStart === -1 || boldStart <= italicStart)) {
      const boldEnd = rest.indexOf("**", boldStart + 2);
      if (boldEnd === -1) {
        out += escapeHtml(rest.slice(0, boldStart + 2));
        rest = rest.slice(boldStart + 2);
        continue;
      }
      out += escapeHtml(rest.slice(0, boldStart));
      out += `<strong>${renderItalic(rest.slice(boldStart + 2, boldEnd))}</strong>`;
      rest = rest.slice(boldEnd + 2);
    } else if (italicStart !== -1) {
      const italicEnd = rest.indexOf("*", italicStart + 1);
      if (italicEnd === -1) {
        out += escapeHtml(rest.slice(0, italicStart + 1));
        rest = rest.slice(italicStart + 1);
        continue;
      }
      out += escapeHtml(rest.slice(0, italicStart));
      out += `<em>${escapeHtml(rest.slice(italicStart + 1, italicEnd))}</em>`;
      rest = rest.slice(italicEnd + 1);
    } else {
      out += escapeHtml(rest);
      rest = "";
    }
  }
  return out;
}

function renderItalic(text: string): string {
  let out = "";
  let rest = text;
  while (rest.length > 0) {
    const start = rest.indexOf("*");
    if (start === -1) { out += escapeHtml(rest); break; }
    const end = rest.indexOf("*", start + 1);
    if (end === -1) { out += escapeHtml(rest); break; }
    out += escapeHtml(rest.slice(0, start));
    out += `<em>${escapeHtml(rest.slice(start + 1, end))}</em>`;
    rest = rest.slice(end + 1);
  }
  return out;
}

export function markdownToSanitizedHtml(md: string): string {
  const blocks = parseMarkdownBlocks(md);
  const out: string[] = [];
  let index = 0;
  while (index < blocks.length) {
    const block: MarkdownBlock | undefined = blocks[index];
    if (!block) break;
    if (block.kind === "list-item") {
      const ordered = block.ordered === true;
      const items: string[] = [];
      for (let item = blocks[index]; item && item.kind === "list-item" && item.ordered === ordered; item = blocks[index]) {
        items.push(`<li>${item.lines.map(renderMarkdownInline).join("<br>")}</li>`);
        index += 1;
      }
      out.push(`<${ordered ? "ol" : "ul"}>${items.join("")}</${ordered ? "ol" : "ul"}>`);
      continue;
    }
    index += 1;
    if (block.kind === "rule") { out.push("<hr>"); continue; }
    if (block.kind === "heading") {
      out.push(`<h${block.level}>${renderMarkdownInline(block.lines[0] ?? "")}</h${block.level}>`);
      continue;
    }
    out.push(`<p>${block.lines.map(renderMarkdownInline).join("<br>")}</p>`);
  }
  return out.join("");
}

function decodeEntities(text: string): string {
  const named: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: "\u00a0" };
  return text.replace(/&([a-z]+);|&#(\d+);|&#x([0-9a-f]+);/gi, (_match, name?: string, dec?: string, hex?: string) => {
    if (name) {
      const value = named[name.toLowerCase()];
      return value ?? _match;
    }
    const code = dec ? Number(dec) : hex ? Number.parseInt(hex, 16) : NaN;
    return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : _match;
  });
}

const INLINE_BOLD_TAGS = new Set(["b", "strong"]);
const INLINE_ITALIC_TAGS = new Set(["i", "em"]);
const BLOCK_TAGS = new Set(["p", "div", "h1", "h2", "h3", "li", "ul", "ol", "br", "hr"]);

export function htmlToMarkdown(html: string): string {
  const blocks: MarkdownBlock[] = [];
  let current: MarkdownBlock | null = null;
  const listStack: boolean[] = [];
  const inlineStack: string[] = [];

  const ensureParagraph = (): MarkdownBlock => {
    if (!current) {
      const paragraph: MarkdownBlock = { kind: "paragraph", lines: [""] };
      current = paragraph;
      blocks.push(paragraph);
    }
    return current;
  };
  const appendText = (text: string) => {
    if (text === "") return;
    const block = ensureParagraph();
    block.lines[block.lines.length - 1] = (block.lines[block.lines.length - 1] ?? "") + text;
  };
  const closeBlock = () => { current = null; };

  const tokens = html.match(/<[^>]+>|[^<]+/g) ?? [];
  let index = 0;
  while (index < tokens.length) {
    const token = tokens[index] ?? "";
    index += 1;
    if (!token.startsWith("<")) {
      appendText(decodeEntities(token));
      continue;
    }
    const tagMatch = /^<\/?\s*([a-z0-9-]+)/i.exec(token);
    if (!tagMatch) continue;
    const tag = (tagMatch[1] ?? "").toLowerCase();
    const closing = token.startsWith("</");

    if (tag === "script" || tag === "style") {
      if (closing) continue;
      const closePattern = new RegExp(`^</\\s*${tag}`, "i");
      while (index < tokens.length && !closePattern.test(tokens[index] ?? "")) index += 1;
      index += 1;
      continue;
    }
    if (INLINE_BOLD_TAGS.has(tag) || INLINE_ITALIC_TAGS.has(tag)) {
      const marker = INLINE_BOLD_TAGS.has(tag) ? "**" : "*";
      if (!closing) { inlineStack.push(marker); appendText(marker); }
      else {
        const last = inlineStack.lastIndexOf(marker);
        if (last !== -1) inlineStack.splice(last, 1);
        appendText(marker);
      }
      continue;
    }
    if (!BLOCK_TAGS.has(tag)) continue;

    if (tag === "br") { ensureParagraph().lines.push(""); continue; }
    if (tag === "hr") { blocks.push({ kind: "rule", lines: [] }); closeBlock(); continue; }
    if (tag === "ul" || tag === "ol") {
      if (!closing) listStack.push(tag === "ol");
      else if (listStack.length > 0) listStack.pop();
      continue;
    }
    if (closing) { closeBlock(); continue; }
    if (tag === "li") {
      const ordered = listStack.length > 0 ? listStack[listStack.length - 1] === true : false;
      const item: MarkdownBlock = { kind: "list-item", ordered, lines: [""] };
      current = item;
      blocks.push(item);
      continue;
    }
    if (tag === "h1" || tag === "h2" || tag === "h3") {
      const heading: MarkdownBlock = { kind: "heading", level: Number(tag[1]), lines: [""] };
      current = heading;
      blocks.push(heading);
      continue;
    }
    const paragraph: MarkdownBlock = { kind: "paragraph", lines: [""] };
    current = paragraph;
    blocks.push(paragraph);
  }

  const parts: string[] = [];
  let orderedCounter = 0;
  let previous: MarkdownBlock | null = null;
  for (const block of blocks) {
    const text = block.lines.join("\n");
    if (text.trim() === "" && block.kind !== "rule") { previous = block; continue; }
    let separator = previous === null ? "" : "\n\n";
    let rendered: string;
    if (block.kind === "rule") rendered = "---";
    else if (block.kind === "heading") rendered = `${"#".repeat(block.level ?? 1)} ${text}`;
    else if (block.kind === "list-item") {
      if (previous?.kind === "list-item" && previous.ordered === block.ordered) separator = "\n";
      if (block.ordered) { orderedCounter += 1; rendered = `${orderedCounter}. ${text}`; }
      else rendered = `- ${text}`;
    } else rendered = text;
    parts.push(separator + rendered);
    previous = block;
    if (block.kind !== "list-item") orderedCounter = 0;
  }
  return parts.join("").replace(/\n{3,}/g, "\n\n").trim();
}

export function unifiedTextNodeText(data: { text?: unknown; html?: unknown }): string {
  if (typeof data.text === "string") return data.text;
  return typeof data.html === "string" ? htmlToMarkdown(data.html) : "";
}
