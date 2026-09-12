/* ============================================
 * AssetRefNode：正文素材标签节点（IKFA1M）
 *
 * 与 ChipNode 的关键区别：标签不携带「展开文本」，只有稳定身份（assetId）+
 * 展示编号缓存（label）+ 失效恢复信息（invalidLabel）。编号展示由
 * PromptRefContext 按当前有效输入顺序实时派生——编号不是身份，不落节点状态。
 * ============================================ */
import type { JSX } from 'react';
import { createContext, useContext } from 'react';
import {
  DecoratorNode,
  $getNodeByKey,
  type LexicalNode,
  type NodeKey,
  type SerializedLexicalNode,
  type Spread,
} from 'lexical';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import { AlertTriangle, X } from 'lucide-react';
import styles from './index.module.css';

export type SerializedAssetRefNode = Spread<
  { assetId: string; label?: string; invalidLabel?: string },
  SerializedLexicalNode
>;

export interface AssetRefMeta {
  url: string;
  name: string;
}

/** 编号与素材元信息：装饰组件按当前有效输入实时渲染（编号重派生不触发节点变更） */
export const PromptRefContext = createContext<{
  numbering: ReadonlyMap<string, number>;
  meta: ReadonlyMap<string, AssetRefMeta>;
  readOnly: boolean;
}>({ numbering: new Map(), meta: new Map(), readOnly: false });

function AssetRefChipComponent({
  nodeKey,
  assetId,
  invalidLabel,
}: {
  nodeKey: NodeKey;
  assetId: string;
  invalidLabel?: string;
}) {
  const { numbering, meta, readOnly } = useContext(PromptRefContext);
  const [editor] = useLexicalComposerContext();
  const handleRemove = () => {
    if (!editor.isEditable()) return;
    editor.update(() => {
      $getNodeByKey(nodeKey)?.remove();
    });
  };
  const info = meta.get(assetId);
  // 失效：显示原编号，身份保留不转向；有效：按当前输入派生编号
  if (invalidLabel !== undefined) {
    return (
      <span
        className={`${styles.refChip} ${styles.refChipInvalid}`}
        contentEditable={false}
        title={`${info?.name ?? assetId}：原参考已移除，删除该标签后可继续生成`}
        data-testid="asset-ref-invalid"
      >
        <AlertTriangle size={12} strokeWidth={2} className={styles.refChipIcon} />
        <span className={styles.refChipLabel}>已失效：原{invalidLabel}</span>
        {!readOnly && (
          <button
            type="button"
            className={styles.refChipRemove}
            onMouseDown={(e) => e.preventDefault()}
            onClick={handleRemove}
            title="删除该提及（附件保留）"
          >
            <X size={12} strokeWidth={2} />
          </button>
        )}
      </span>
    );
  }
  const n = numbering.get(assetId);
  return (
    <span
      className={styles.refChip}
      contentEditable={false}
      title={info?.name ?? assetId}
      data-testid="asset-ref-valid"
    >
      {info?.url ? <img className={styles.refChipThumb} src={info.url} alt="" /> : null}
      <span className={styles.refChipLabel}>图片{n ?? '?'}</span>
      {!readOnly && (
        <button
          type="button"
          className={styles.refChipRemove}
          onMouseDown={(e) => e.preventDefault()}
          onClick={handleRemove}
          title="删除该提及（附件保留）"
        >
          <X size={12} strokeWidth={2} />
        </button>
      )}
    </span>
  );
}

export class AssetRefNode extends DecoratorNode<JSX.Element> {
  __assetId: string;
  __label: string | undefined;
  __invalidLabel: string | undefined;

  static getType(): string {
    return 'asset-ref';
  }

  static clone(node: AssetRefNode): AssetRefNode {
    return new AssetRefNode(node.__assetId, node.__label, node.__invalidLabel, node.__key);
  }

  constructor(assetId: string, label?: string, invalidLabel?: string, key?: NodeKey) {
    super(key);
    this.__assetId = assetId;
    this.__label = label;
    this.__invalidLabel = invalidLabel;
  }

  getAssetId(): string {
    return this.getLatest().__assetId;
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

  /** 纯文本投影：与拍平镜像同形（失效 → 已失效：原图片N；有效 → 展示编号缓存） */
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
    };
  }

  static importJSON(serialized: SerializedAssetRefNode): AssetRefNode {
    return $createAssetRefNode(serialized.assetId, serialized.label, serialized.invalidLabel);
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
): AssetRefNode {
  return new AssetRefNode(assetId, label, invalidLabel);
}

export function $isAssetRefNode(node: LexicalNode | null | undefined): node is AssetRefNode {
  return node instanceof AssetRefNode;
}
