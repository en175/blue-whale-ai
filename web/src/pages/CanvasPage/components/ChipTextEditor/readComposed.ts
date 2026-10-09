import { $getRoot, $isElementNode, type LexicalNode } from 'lexical';
import { $isChipNode } from './ChipNode';
import { BLOCK_SEPARATOR, EMPTY_COMPOSED, type ComposedSegment, type ComposedValue } from './composed';

export function readComposed(): ComposedValue {
  const segments: ComposedSegment[] = [];
  const pushText = (value: string) => {
    if (!value) return;
    const last = segments[segments.length - 1];
    if (last?.kind === 'text') last.value += value;
    else segments.push({ kind: 'text', value });
  };
  const walk = (node: LexicalNode) => {
    if ($isChipNode(node)) {
      if (!node.isPending()) segments.push({ kind: 'ref', ref: node.toRef() });
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
  return segments.length > 0 ? { segments } : EMPTY_COMPOSED;
}
