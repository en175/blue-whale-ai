import type { JSX } from 'react';
import { createContext } from 'react';
import AssetRefChipComponent from './AssetRefChipComponent';
import {
  DecoratorNode,
  type LexicalNode,
  type NodeKey,
  type SerializedLexicalNode,
  type Spread,
} from 'lexical';

export type SerializedAssetRefNode = Spread<
  { assetId: string; label?: string; invalidLabel?: string; refKind?: 'asset' | 'text' },
  SerializedLexicalNode
>;

export interface AssetRefMeta {
  url: string;
  name: string;
  mediaType?: 'image' | 'video' | 'audio' | 'text';
}

export const PromptRefContext = createContext<{
  labels: ReadonlyMap<string, string>;
  meta: ReadonlyMap<string, AssetRefMeta>;
  readOnly: boolean;
  onInvalidTagClick?: (nodeKey: string) => void;
}>({ labels: new Map(), meta: new Map(), readOnly: false });

export class AssetRefNode extends DecoratorNode<JSX.Element> {
  __assetId: string;
  __label: string | undefined;
  __invalidLabel: string | undefined;
  __refKind: 'asset' | 'text';

  static getType(): string {
    return 'asset-ref';
  }

  static clone(node: AssetRefNode): AssetRefNode {
    return new AssetRefNode(node.__assetId, node.__label, node.__invalidLabel, node.__refKind, node.__key);
  }

  constructor(assetId: string, label?: string, invalidLabel?: string, refKind: 'asset' | 'text' = 'asset', key?: NodeKey) {
    super(key);
    this.__assetId = assetId;
    this.__label = label;
    this.__invalidLabel = invalidLabel;
    this.__refKind = refKind;
  }

  getAssetId(): string {
    return this.getLatest().__assetId;
  }

  setAssetId(assetId: string): void {
    this.getWritable().__assetId = assetId;
  }

  getRefKind(): 'asset' | 'text' {
    return this.getLatest().__refKind;
  }

  setRefKind(refKind: 'asset' | 'text'): void {
    this.getWritable().__refKind = refKind;
  }

  getLabel(): string | undefined {
    return this.getLatest().__label;
  }

  getInvalidLabel(): string | undefined {
    return this.getLatest().__invalidLabel;
  }

  setLabel(label: string | undefined): void {
    this.getWritable().__label = label;
  }

  setInvalidLabel(invalidLabel: string | undefined): void {
    this.getWritable().__invalidLabel = invalidLabel;
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
    if (this.__invalidLabel !== undefined) return `已失效：原${this.__invalidLabel}`;
    return this.__label ?? '';
  }

  exportJSON(): SerializedAssetRefNode {
    return {
      ...super.exportJSON(),
      type: 'asset-ref',
      version: 1,
      assetId: this.__assetId,
      ...(this.__label !== undefined ? { label: this.__label } : {}),
      ...(this.__invalidLabel !== undefined ? { invalidLabel: this.__invalidLabel } : {}),
      ...(this.__refKind !== 'asset' ? { refKind: this.__refKind } : {}),
    };
  }

  static importJSON(serialized: SerializedAssetRefNode): AssetRefNode {
    return $createAssetRefNode(serialized.assetId, serialized.label, serialized.invalidLabel, serialized.refKind ?? 'asset');
  }

  decorate(): JSX.Element {
    return (
      <AssetRefChipComponent
        nodeKey={this.getKey()}
        assetId={this.__assetId}
        invalidLabel={this.__invalidLabel}
      />
    );
  }
}

export function $createAssetRefNode(
  assetId: string,
  label?: string,
  invalidLabel?: string,
  refKind: 'asset' | 'text' = 'asset',
): AssetRefNode {
  return new AssetRefNode(assetId, label, invalidLabel, refKind);
}

export function $isAssetRefNode(node: LexicalNode | null | undefined): node is AssetRefNode {
  return node instanceof AssetRefNode;
}
