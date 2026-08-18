/* ============================================
 * ChipNode：内嵌引用胶囊（原子节点） —— 显示短标签，发送时替换成完整 prompt
 * 用 DecoratorNode 而非 TextNode('token' 模式)，因为胶囊需要渲染可点击的 × 移除按钮
 * ============================================ */
import type { JSX } from 'react';
import {
  DecoratorNode,
  type LexicalNode,
  type NodeKey,
  type SerializedLexicalNode,
  type Spread,
  $getNodeByKey,
} from 'lexical';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import { Sparkles, X } from 'lucide-react';
import styles from './index.module.css';

export type SerializedChipNode = Spread<
  { refId: string; label: string; prompt: string },
  SerializedLexicalNode
>;

function ChipComponent({ nodeKey, label }: { nodeKey: NodeKey; label: string }) {
  const [editor] = useLexicalComposerContext();
  const handleRemove = () => {
    editor.update(() => {
      const node = $getNodeByKey(nodeKey);
      node?.remove();
    });
  };
  return (
    <span className={styles.chip} contentEditable={false}>
      <Sparkles size={12} strokeWidth={2} className={styles.chipIcon} />
      <span className={styles.chipLabel}>{label}</span>
      <button
        type="button"
        className={styles.chipRemove}
        onMouseDown={(e) => e.preventDefault()}
        onClick={handleRemove}
        title="移除引用"
      >
        <X size={12} strokeWidth={2} />
      </button>
    </span>
  );
}

export class ChipNode extends DecoratorNode<JSX.Element> {
  __refId: string;
  __label: string;
  __prompt: string;

  static getType(): string {
    return 'chip';
  }

  static clone(node: ChipNode): ChipNode {
    return new ChipNode(node.__refId, node.__label, node.__prompt, node.__key);
  }

  constructor(refId: string, label: string, prompt: string, key?: NodeKey) {
    super(key);
    this.__refId = refId;
    this.__label = label;
    this.__prompt = prompt;
  }

  createDOM(): HTMLElement {
    const span = document.createElement('span');
    span.style.display = 'inline-flex';
    span.style.verticalAlign = 'middle';
    return span;
  }

  updateDOM(): boolean {
    return false;
  }

  isInline(): boolean {
    return true;
  }

  /** 发送/序列化时用完整 prompt 替代显示用的短标签 */
  getTextContent(): string {
    return this.__prompt;
  }

  exportJSON(): SerializedChipNode {
    return {
      ...super.exportJSON(),
      type: 'chip',
      version: 1,
      refId: this.__refId,
      label: this.__label,
      prompt: this.__prompt,
    };
  }

  static importJSON(serialized: SerializedChipNode): ChipNode {
    return $createChipNode(serialized.refId, serialized.label, serialized.prompt);
  }

  decorate(): JSX.Element {
    return <ChipComponent nodeKey={this.getKey()} label={this.__label} />;
  }
}

export function $createChipNode(refId: string, label: string, prompt: string): ChipNode {
  return new ChipNode(refId, label, prompt);
}

export function $isChipNode(node: LexicalNode | null | undefined): node is ChipNode {
  return node instanceof ChipNode;
}
