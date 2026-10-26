import type { JSX } from 'react';
import {
  DecoratorNode,
  type LexicalNode,
  type NodeKey,
  type SerializedLexicalNode,
  type Spread,
} from 'lexical';
import ChipComponent from './ChipComponent';
import { ImageMentionChip } from '../ImageMentionChip';
import { AudioMentionChip, VideoMentionChip } from '../VideoMentionChip';
import styles from './index.module.css';

export type SerializedChipNode = Spread<
  { refId: string; label: string; prompt: string; imageUrl?: string; videoUrl?: string; audioUrl?: string; pending?: boolean },
  SerializedLexicalNode
>;

export class ChipNode extends DecoratorNode<JSX.Element> {
  __refId: string;
  __label: string;
  __prompt: string;
  __imageUrl: string | undefined;
  __videoUrl: string | undefined;
  __pending: boolean;
  __audioUrl: string | undefined;

  static getType(): string {
    return 'chip';
  }

  static clone(node: ChipNode): ChipNode {
    return new ChipNode(node.__refId, node.__label, node.__prompt, node.__key, node.__imageUrl, node.__videoUrl, node.__pending, node.__audioUrl);
  }

  constructor(
    refId: string,
    label: string,
    prompt: string,
    key?: NodeKey,
    imageUrl?: string,
    videoUrl?: string,
    pending = false,
    audioUrl?: string,
  ) {
    super(key);
    this.__refId = refId;
    this.__label = label;
    this.__prompt = prompt;
    this.__imageUrl = imageUrl;
    this.__videoUrl = videoUrl;
    this.__pending = pending;
    this.__audioUrl = audioUrl;
  }

  isPending(): boolean {
    return this.getLatest().__pending;
  }

  confirm(ref?: { id: string; label: string; prompt: string }): void {
    const node = this.getWritable();
    node.__pending = false;
    if (ref) {
      node.__refId = ref.id;
      node.__label = ref.label;
      node.__prompt = ref.prompt;
    }
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

  getTextContent(): string {
    return this.__pending ? '' : this.__label;
  }

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
      ...(this.__audioUrl ? { audioUrl: this.__audioUrl } : {}),
      ...(this.__pending ? { pending: true } : {}),
    };
  }

  static importJSON(serialized: SerializedChipNode): ChipNode {
    return $createChipNode(
      serialized.refId,
      serialized.label,
      serialized.prompt,
      serialized.imageUrl,
      serialized.videoUrl,
      serialized.pending,
      serialized.audioUrl,
    );
  }

  decorate(): JSX.Element {
    if (this.__pending) {
      return <span className={styles.pendingChip} contentEditable={false} aria-label={`待确认引用：${this.__label}`}>
        {this.__audioUrl && <AudioMentionChip url={this.__audioUrl} label={this.__label} />}
        {this.__videoUrl && <VideoMentionChip url={this.__videoUrl} label={this.__label} />}
        {this.__imageUrl && <ImageMentionChip url={this.__imageUrl} label={this.__label} />}
        {!this.__audioUrl && !this.__videoUrl && !this.__imageUrl && <span>{this.__label}</span>}
        <span>待确认引用</span>
      </span>;
    }
    return (
      <ChipComponent
        nodeKey={this.getKey()}
        label={this.__label}
        imageUrl={this.__imageUrl}
        videoUrl={this.__videoUrl}
        audioUrl={this.__audioUrl}
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
  pending = false,
  audioUrl?: string,
): ChipNode {
  return new ChipNode(refId, label, prompt, undefined, imageUrl, videoUrl, pending, audioUrl);
}

export function $isChipNode(node: LexicalNode | null | undefined): node is ChipNode {
  return node instanceof ChipNode;
}
