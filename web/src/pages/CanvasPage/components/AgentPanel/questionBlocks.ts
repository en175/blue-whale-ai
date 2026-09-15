/**
 * 追问的排版（IKFLB9 定稿「排版一」）：把助手正文里的题认出来，不动一个字。
 *
 * 产品拍板追问保持文字、不点选，用户直接回话。所以这里只做排版：模型按 grilling 的格式写题——
 * 一行 `❓ **Q1 — 标题**：正文`，几行 `- **A. 选项**：说明`，一行 `➡️ **推荐 C**：理由`，题与题之间 `---`——
 * 前端认出这几种开头，把一题画成「题头 + 选项列表 + 推荐框」。认不出的照旧走 Markdown，所以模型偶尔不守格式
 * 也只是那一题退回原样，不会白屏。
 *
 * 一题的边界：从带 ❓ 的那一行起，到下一条 `---`、下一个 ❓ 或正文结束。题里 ➡️ 之后的所有段落都算推荐
 * （模型常在推荐后面再补一句「如果你想要 X，告诉我」，那也是推荐的一部分）。
 */

export interface QuestionOption {
  key: string;
  label: string;
  desc: string;
}

export type ReplySegment =
  | { kind: 'markdown'; text: string }
  | {
      kind: 'question';
      /** `Q1`；服务端写的模型题没有编号。 */
      no: string | null;
      title: string;
      /** 题头冒号后面的那半句；没有就是空串。 */
      ask: string;
      /** 题头与选项 / 推荐之间的正文（markdown）。 */
      body: string;
      options: QuestionOption[];
      /** ➡️ 之后的全部（markdown），去掉了箭头。 */
      recommendation: string;
    };

const QUESTION_LINE = /^\s*(?:\*\*)?\s*❓\s*(.*)$/;
const OPTION_LINE = /^\s*(?:[-*•]\s*)?(?:\*\*)?\s*([A-Ha-h])\s*[.．、)）]\s*(.*)$/;
const RECOMMEND_LINE = /^\s*➡️\s*(.*)$/;
const HR_LINE = /^\s*-{3,}\s*$/;

function stripBold(text: string): string {
  return text.replace(/\*\*/g, '').trim();
}

/** 「A. 港口平视：从海面方向看小镇」→ 名字 + 说明；没有冒号就整句当名字。 */
function splitLabel(text: string): { label: string; desc: string } {
  const plain = stripBold(text);
  const m = /^(.+?)\s*[：:]\s*(.*)$/s.exec(plain);
  if (!m) return { label: plain.replace(/[。.]$/, ''), desc: '' };
  return { label: m[1].trim(), desc: m[2].trim() };
}

/** 题头「**Q1 — 视角与构图**：从什么角度看这个镇？」→ 编号、标题、问句。 */
function parseHead(text: string): { no: string | null; title: string; ask: string } {
  const plain = stripBold(text);
  const colon = /^(.+?)\s*[：:]\s*(.*)$/s.exec(plain);
  const titlePart = (colon ? colon[1] : plain).trim();
  const ask = colon ? colon[2].trim() : '';
  const numbered = /^(Q\d+)\s*[—–\-:：]?\s*(.*)$/i.exec(titlePart);
  if (numbered) return { no: numbered[1].toUpperCase(), title: numbered[2].trim() || titlePart, ask };
  return { no: null, title: titlePart, ask };
}

export function splitReplySegments(text: string): ReplySegment[] {
  const lines = text.split('\n');
  const out: ReplySegment[] = [];
  let md: string[] = [];
  const flushMd = () => {
    const chunk = md.join('\n').trim();
    if (chunk) out.push({ kind: 'markdown', text: chunk });
    md = [];
  };
  let i = 0;
  while (i < lines.length) {
    const head = QUESTION_LINE.exec(lines[i]);
    if (!head) {
      md.push(lines[i]);
      i += 1;
      continue;
    }
    // 第一题前面那条 `---` 也是题的分隔线，跟着题走，不留在开场白里。
    while (md.length > 0 && (HR_LINE.test(md[md.length - 1]) || md[md.length - 1].trim() === '')) md.pop();
    flushMd();
    const { no, title, ask } = parseHead(head[1]);
    const options: QuestionOption[] = [];
    const body: string[] = [];
    const rec: string[] = [];
    let inRec = false;
    i += 1;
    while (i < lines.length && !QUESTION_LINE.test(lines[i]) && !HR_LINE.test(lines[i])) {
      const line = lines[i];
      i += 1;
      if (inRec) {
        rec.push(line);
        continue;
      }
      const r = RECOMMEND_LINE.exec(line);
      if (r) {
        inRec = true;
        rec.push(r[1]);
        continue;
      }
      const o = OPTION_LINE.exec(line);
      if (o) {
        options.push({ key: o[1].toUpperCase(), ...splitLabel(o[2]) });
        continue;
      }
      body.push(line);
    }
    // 题后面那条 `---` 是题与题之间的分隔，题已经各自成块，不再画线。
    if (i < lines.length && HR_LINE.test(lines[i])) i += 1;
    out.push({ kind: 'question', no, title, ask, body: body.join('\n').trim(), options, recommendation: rec.join('\n').trim() });
  }
  flushMd();
  return out;
}
