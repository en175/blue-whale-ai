/* ============================================
 * promptRefDoc：Lexical 节点树 ↔ PromptDoc 结构化正文（IKFA1M）
 *
 * 独立成文件（不依赖 React/CSS），让序列化/恢复/插入的等价性可用 headless
 * editor 直接测——与 readComposed.ts 的拆分理由一致。
 * 段落分隔规则逐字对齐 Lexical 的 ElementNode.getTextContent()（'\n\n'），
 * 保证「编辑器看到的」与「送给模型的」一致。
 * ============================================ */
import {
  $createParagraphNode,
  $createRangeSelection,
  $createTextNode,
  $getRoot,
  $getSelection,
  $isElementNode,
  $isRangeSelection,
  $setSelection,
  type LexicalNode,
  type NodeKey,
  type RangeSelection,
} from 'lexical';
import {
  PROMPT_DOC_VERSION,
  type PromptDoc,
  type PromptDocSegment,
} from '@/lib/prompt-doc';
import { $createAssetRefNode, $isAssetRefNode, AssetRefNode } from './AssetRefNode';

const BLOCK_SEPARATOR = '\n\n';

/** 读当前 root 为 PromptDoc。必须在 editor.update()/editorState.read() 内调用。 */
export function $readPromptDoc(): PromptDoc {
  const segments: PromptDocSegment[] = [];
  const pushText = (value: string) => {
    if (!value) return;
    const last = segments[segments.length - 1];
    if (last?.kind === 'text') last.text += value;
    else segments.push({ kind: 'text', text: value });
  };
  const walk = (node: LexicalNode) => {
    if ($isAssetRefNode(node)) {
      const seg: PromptDocSegment = {
        kind: 'asset_ref',
        asset_id: node.getAssetId(),
        ...(node.getLabel() !== undefined ? { label: node.getLabel() } : {}),
        ...(node.getInvalidLabel() !== undefined ? { invalid_label: node.getInvalidLabel() } : {}),
      };
      segments.push(seg);
      return;
    }
    if ($isElementNode(node)) {
      const children = node.getChildren();
      children.forEach((child, index) => {
        walk(child);
        if (index !== children.length - 1 && $isElementNode(child) && !child.isInline()) {
          pushText(BLOCK_SEPARATOR);
        }
      });
      return;
    }
    pushText(node.getTextContent());
  };
  walk($getRoot());
  return { version: PROMPT_DOC_VERSION, segments };
}

/** 用 PromptDoc（或纯文本兜底）初始化 root。必须在 editor.update() 内调用。 */
export function $buildFromPromptDoc(doc: PromptDoc | null | undefined, fallbackText: string): void {
  const root = $getRoot();
  root.clear();
  let paragraph = $createParagraphNode();
  root.append(paragraph);
  if (!doc) {
    if (fallbackText) paragraph.append($createTextNode(fallbackText));
    return;
  }
  for (const segment of doc.segments) {
    if (segment.kind === 'text') {
      // '\n\n' 是段落分隔：逐段恢复，保证与 $readPromptDoc 往返一致
      const chunks = segment.text.split(BLOCK_SEPARATOR);
      chunks.forEach((chunk, index) => {
        if (index > 0) {
          paragraph = $createParagraphNode();
          root.append(paragraph);
        }
        if (chunk) paragraph.append($createTextNode(chunk));
      });
      continue;
    }
    paragraph.append($createAssetRefNode(segment.asset_id, segment.label, segment.invalid_label));
  }
}

/** @ 查询匹配：光标前文本末尾的「@query」。query 允许中文等任意非空白非 @ 字符。 */
export function matchMentionQuery(textBeforeCaret: string): { query: string } | null {
  const match = /@([^\s@]{0,30})$/.exec(textBeforeCaret);
  return match ? { query: match[1] } : null;
}

/** 把 reconcile 后的 ref 片段序列写回节点（按文档顺序与节点一一对应）。调用方在 editor.update 内使用。
 *  失效标记按片段双向同步：恢复（invalid_label 清除）与失效（写入）都会写回节点。 */
export function $applyReconciledRefs(nodes: AssetRefNode[], segments: PromptDocSegment[]): void {
  const refs = segments.filter((s): s is Extract<PromptDocSegment, { kind: 'asset_ref' }> => s.kind === 'asset_ref');
  nodes.forEach((node, index) => {
    const seg = refs[index];
    if (!seg) return;
    if (node.getLabel() !== seg.label) node.setLabel(seg.label);
    if (node.getInvalidLabel() !== seg.invalid_label) node.setInvalidLabel(seg.invalid_label);
  });
}

/** 恢复「@query」的选区（原位替换/删除前定位）。锚点节点已不在树内时返回 null。 */
export function $restoreMentionSelection(anchor: { key: NodeKey; offset: number; query: string }): RangeSelection | null {
  const selection = $createRangeSelection();
  selection.anchor.set(anchor.key, anchor.offset, 'text');
  selection.focus.set(anchor.key, anchor.offset + anchor.query.length + 1, 'text');
  $setSelection(selection);
  const restored = $getSelection();
  return $isRangeSelection(restored) ? restored : null;
}
