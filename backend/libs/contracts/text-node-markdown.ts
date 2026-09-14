/**
 * 统一文本卡正文契约 v1（IKFM3L）：受限 Markdown 子集与受限 HTML 的互转。
 *
 * 契约：docs/specs/2026-09-14-ikfm3l-unified-text-node-content-contract.md
 * - data.text 是文本卡正文唯一权威字段，内容为八类格式的 Markdown 子集；
 *   data.html 退役为读兼容字段，仅存量节点升级前保留。
 * - 子集外的 Markdown 语法按字面文本对待，不渲染为格式。
 * - 转换为同构纯函数：不依赖 DOM，供前端渲染与历史卡升级共用。
 */

/** v1 首期支持的八类格式能力声明 */
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
  /** heading 层级（1–3）；有序列表项的序号由组装层按连续段派生，不在此存储 */
  level?: number;
  ordered?: boolean;
  /** 块内行（软换行分隔，未渲染行内格式） */
  lines: string[];
}

/** 把 Markdown 源解析为块序列：标题/段落/列表项/分隔线。 */
export function parseMarkdownBlocks(md: string): MarkdownBlock[] {
  const blocks: MarkdownBlock[] = [];
  // 空行终结段落：空行后的正文行开新段，不并入上一段（软换行=同段）
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

/** 行内 HTML 转义（Markdown 字面内容不得注入标签）。 */
function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** 行内片段渲染：粗体/斜体递归配对，未闭合标记按字面输出。 */
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

/** 粗体内部只再配对斜体，不再嵌套粗体。 */
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

/** Markdown 源 → 白名单 HTML 字符串（输出只含 h1–h3/p/strong/em/ul/ol/li/hr/br 与转义文本）。 */
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

/** 命名与数字 HTML 实体解码（单遍替换，避免二次解码）。 */
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

/**
 * 受限 HTML → Markdown 源（历史 HTML 卡升级用）。
 * 白名单外标签剥离但保留文本；script/style 整体丢弃；嵌套列表压平；行内格式压平为前后缀。
 */
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
      if (closing) continue; // 闭标签本身直接消费
      const closePattern = new RegExp(`^</\\s*${tag}`, "i");
      while (index < tokens.length && !closePattern.test(tokens[index] ?? "")) index += 1;
      index += 1; // 连同闭标签一并消费
      continue;
    }
    if (INLINE_BOLD_TAGS.has(tag) || INLINE_ITALIC_TAGS.has(tag)) {
      const marker = INLINE_BOLD_TAGS.has(tag) ? "**" : "*";
      // 嵌套开标记只输出自身标记（闭合在闭标签处输出），避免星号重复
      if (!closing) { inlineStack.push(marker); appendText(marker); }
      else {
        const last = inlineStack.lastIndexOf(marker);
        if (last !== -1) inlineStack.splice(last, 1);
        appendText(marker);
      }
      continue;
    }
    if (!BLOCK_TAGS.has(tag)) continue; // 白名单外：剥标签保文本

    if (tag === "br") { ensureParagraph().lines.push(""); continue; }
    if (tag === "hr") { blocks.push({ kind: "rule", lines: [] }); closeBlock(); continue; }
    if (tag === "ul" || tag === "ol") {
      if (!closing) listStack.push(tag === "ol");
      else if (listStack.length > 0) listStack.pop();
      continue;
    }
    if (closing) { closeBlock(); continue; }
    // 开块标签：h1–h3 / p / div / li（有序序号在组装层按连续段统一编号）
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

  // 组装 Markdown 源
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
      // 连续同类列表项之间用单换行
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

/** 契约 §5：统一正文读取——data.text（Markdown 源）优先，存量 data.html 升级兜底，均无为空串。 */
export function unifiedTextNodeText(data: { text?: unknown; html?: unknown }): string {
  if (typeof data.text === "string") return data.text;
  return typeof data.html === "string" ? htmlToMarkdown(data.html) : "";
}
