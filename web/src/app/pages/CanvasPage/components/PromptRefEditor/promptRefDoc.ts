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
} from '@/app/utils/prompt-doc';
import { $createAssetRefNode, $isAssetRefNode, AssetRefNode } from './AssetRefNode';

const BLOCK_SEPARATOR = '\n\n';

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
      const seg: PromptDocSegment = node.getRefKind() === 'text'
        ? {
            kind: 'text_ref',
            node_id: node.getAssetId(),
            ...(node.getLabel() !== undefined ? { label: node.getLabel() } : {}),
            ...(node.getInvalidLabel() !== undefined ? { invalid_label: node.getInvalidLabel() } : {}),
          }
        : {
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
    paragraph.append(
      $createAssetRefNode(
        segment.kind === 'text_ref' ? segment.node_id : segment.asset_id,
        segment.label,
        segment.invalid_label,
        segment.kind === 'text_ref' ? 'text' : 'asset',
      ),
    );
  }
}

export function matchMentionQuery(textBeforeCaret: string): { query: string } | null {
  const match = /@([^\s@]{0,30})$/.exec(textBeforeCaret);
  return match ? { query: match[1] } : null;
}

export function $applyReconciledRefs(nodes: AssetRefNode[], segments: PromptDocSegment[]): void {
  const refs = segments.filter((s): s is Exclude<PromptDocSegment, { kind: 'text' }> => s.kind !== 'text');
  nodes.forEach((node, index) => {
    const seg = refs[index];
    if (!seg) return;
    if (node.getLabel() !== seg.label) node.setLabel(seg.label);
    if (node.getInvalidLabel() !== seg.invalid_label) node.setInvalidLabel(seg.invalid_label);
  });
}

export function $restoreMentionSelection(anchor: { key: NodeKey; offset: number; query: string }): RangeSelection | null {
  const selection = $createRangeSelection();
  selection.anchor.set(anchor.key, anchor.offset, 'text');
  selection.focus.set(anchor.key, anchor.offset + anchor.query.length + 1, 'text');
  $setSelection(selection);
  const restored = $getSelection();
  return $isRangeSelection(restored) ? restored : null;
}
