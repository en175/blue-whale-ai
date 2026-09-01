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
import { AtSign, X } from 'lucide-react';
import { ImageMentionChip } from '../ImageMentionChip';
import { VideoMentionChip } from '../VideoMentionChip';
import styles from './index.module.css';

export type SerializedChipNode = Spread<
  { refId: string; label: string; prompt: string; imageUrl?: string; videoUrl?: string },
  SerializedLexicalNode
>;

function ChipComponent({
  nodeKey,
  label,
  imageUrl,
  videoUrl,
}: {
  nodeKey: NodeKey;
  label: string;
  imageUrl?: string;
  videoUrl?: string;
}) {
  const [editor] = useLexicalComposerContext();
  const handleRemove = () => {
    editor.update(() => {
      const node = $getNodeByKey(nodeKey);
      node?.remove();
    });
  };
  if (videoUrl) {
    return <VideoMentionChip url={videoUrl} label={label} onRemove={handleRemove} />;
  }
  if (imageUrl) {
    return <ImageMentionChip url={imageUrl} label={label} onRemove={handleRemove} />;
  }
  return (
    <span className={styles.chip} contentEditable={false}>
      <AtSign size={12} strokeWidth={2} className={styles.chipIcon} />
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
  __imageUrl: string | undefined;
  __videoUrl: string | undefined;

  static getType(): string {
    return 'chip';
  }

  static clone(node: ChipNode): ChipNode {
    return new ChipNode(node.__refId, node.__label, node.__prompt, node.__key, node.__imageUrl, node.__videoUrl);
  }

  constructor(
    refId: string,
    label: string,
    prompt: string,
    key?: NodeKey,
    imageUrl?: string,
    videoUrl?: string,
  ) {
    super(key);
    this.__refId = refId;
    this.__label = label;
    this.__prompt = prompt;
    this.__imageUrl = imageUrl;
    this.__videoUrl = videoUrl;
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

  /**
   * 胶囊在文本里就是它显示的那个短标签。
   *
   * **这里曾经返回 `__prompt`（IKAFSX）**，而 Lexical 的 `root.getTextContent()` 会遍历整棵树
   * 做拼接——于是编辑器每敲一个字，出口拿到的都是全展开的文本。字数统计因此数的是展开后的
   * 全文，触发截断，而截断走的是「用纯文本整体替换编辑器内容」，把所有胶囊一起抹掉。
   * 一个返回值，制造了整条故障链。
   *
   * 解引用现在只发生在提交那一刻，见 `composed.ts` 的 `resolveComposed`。
   */
  getTextContent(): string {
    return this.__label;
  }

  /** 供 `composed.ts` 读出结构化片段——不经过任何字符串拼接。 */
  toRef(): { id: string; label: string; prompt: string } {
    return { id: this.__refId, label: this.__label, prompt: this.__prompt };
  }

  exportJSON(): SerializedChipNode {
    return {
      ...super.exportJSON(),
      type: 'chip',
      version: 1,
      refId: this.__refId,
      label: this.__label,
      prompt: this.__prompt,
      ...(this.__imageUrl ? { imageUrl: this.__imageUrl } : {}),
      ...(this.__videoUrl ? { videoUrl: this.__videoUrl } : {}),
    };
  }

  static importJSON(serialized: SerializedChipNode): ChipNode {
    return $createChipNode(
      serialized.refId,
      serialized.label,
      serialized.prompt,
      serialized.imageUrl,
      serialized.videoUrl,
    );
  }

  decorate(): JSX.Element {
    return (
      <ChipComponent
        nodeKey={this.getKey()}
        label={this.__label}
        imageUrl={this.__imageUrl}
        videoUrl={this.__videoUrl}
      />
    );
  }
}

export function $createChipNode(
  refId: string,
  label: string,
  prompt: string,
  imageUrl?: string,
  videoUrl?: string,
): ChipNode {
  return new ChipNode(refId, label, prompt, undefined, imageUrl, videoUrl);
}

export function $isChipNode(node: LexicalNode | null | undefined): node is ChipNode {
  return node instanceof ChipNode;
}
