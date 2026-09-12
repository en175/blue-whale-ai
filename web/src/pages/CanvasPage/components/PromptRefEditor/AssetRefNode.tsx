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
  /** IKFA1O：素材媒体类型——仅图片显示缩略图（视频地址进 <img> 会裂图，音频无图） */
  mediaType?: 'image' | 'video' | 'audio';
}

/** 标签文案与素材元信息：装饰组件按当前有效输入实时渲染（文案重派生不触发节点变更）。
 *  IKFA1O 泛化：labels 直接给「图片1/视频1/首帧」等最终文案（图片=图片N，视频=角色/类型编号） */
export const PromptRefContext = createContext<{
  labels: ReadonlyMap<string, string>;
  meta: ReadonlyMap<string, AssetRefMeta>;
  readOnly: boolean;
  /** 点击失效标签：交由调用方打开「替换为其他已引用项」菜单（IKFA1N B5） */
  onInvalidTagClick?: (nodeKey: string) => void;
}>({ labels: new Map(), meta: new Map(), readOnly: false });

function AssetRefChipComponent({
  nodeKey,
  assetId,
  invalidLabel,
}: {
  nodeKey: NodeKey;
  assetId: string;
  invalidLabel?: string;
}) {
  const { labels, meta, readOnly, onInvalidTagClick } = useContext(PromptRefContext);
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
        title={`${info?.name ?? assetId}：原参考已移除。点击可替换为其他已引用素材，× 删除该提及`}
        data-testid="asset-ref-invalid"
        role={onInvalidTagClick && !readOnly ? 'button' : undefined}
        tabIndex={onInvalidTagClick && !readOnly ? 0 : undefined}
        onMouseDown={(e) => {
          // 不让点击落入编辑器选区（保持光标原位）
          if (onInvalidTagClick && !readOnly) e.preventDefault();
        }}
        onClick={() => {
          if (onInvalidTagClick && !readOnly && editor.isEditable()) onInvalidTagClick(nodeKey);
        }}
        onKeyDown={(e) => {
          if (!onInvalidTagClick || readOnly || !editor.isEditable()) return;
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onInvalidTagClick(nodeKey);
          }
        }}
      >
        <AlertTriangle size={12} strokeWidth={2} className={styles.refChipIcon} />
        <span className={styles.refChipLabel}>已失效：原{invalidLabel}</span>
        {!readOnly && (
          <button
            type="button"
            className={styles.refChipRemove}
            onMouseDown={(e) => e.preventDefault()}
            onClick={(e) => {
              e.stopPropagation();
              handleRemove();
            }}
            title="删除该提及（附件保留）"
          >
            <X size={12} strokeWidth={2} />
          </button>
        )}
      </span>
    );
  }
  const label = labels.get(assetId);
  return (
    <span
      className={styles.refChip}
      contentEditable={false}
      title={info?.name ?? assetId}
      data-testid="asset-ref-valid"
    >
      {info?.url && info.mediaType !== 'audio' && info.mediaType !== 'video' ? <img className={styles.refChipThumb} src={info.url} alt="" /> : null}
      <span className={styles.refChipLabel}>{label ?? '素材?'}</span>
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

  /** 替换该次提及的身份（IKFA1N B5）：节点原地换绑 assetId，位置与其他提及不受影响 */
  setAssetId(assetId: string): void {
    this.getWritable().__assetId = assetId;
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
