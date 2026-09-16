/* ============================================
 * AssetRefNode：正文素材标签节点（IKFA1M）
 *
 * 与 ChipNode 的关键区别：标签不携带「展开文本」，只有稳定身份（assetId）+
 * 展示编号缓存（label）+ 失效恢复信息（invalidLabel）。编号展示由
 * PromptRefContext 按当前有效输入顺序实时派生——编号不是身份，不落节点状态。
 * ============================================ */
import type { JSX } from 'react';
import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { FloatingPortal, autoUpdate, flip, offset, shift, useFloating } from '@floating-ui/react';
import {
  DecoratorNode,
  type LexicalNode,
  type NodeKey,
  type SerializedLexicalNode,
  type Spread,
} from 'lexical';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import { AlertTriangle, AudioLines } from 'lucide-react';
import styles from '../mediaChip.module.css';

export type SerializedAssetRefNode = Spread<
  { assetId: string; label?: string; invalidLabel?: string; refKind?: 'asset' | 'text' },
  SerializedLexicalNode
>;

export interface AssetRefMeta {
  url: string;
  name: string;
  /** IKFA1O：素材媒体类型——图片/视频显缩略图（视频经 <video preload="metadata"> 抓首帧，IKGABW 对齐
   *  文本卡）、音频显 ♫ 图标占位、文本附件（来源画布文本节点）无缩略图 */
  mediaType?: 'image' | 'video' | 'audio' | 'text';
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

/** 悬停出预览的延迟（IKGABW）：与文本卡正文 chipPreview 同值（契约 §5 约 100–200ms） */
const PREVIEW_OPEN_DELAY_MS = 150;

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
  const info = meta.get(assetId);
  // 悬停预览（IKGABW）：对齐文本卡——150ms 延迟、上方优先贴边翻转、pointer-events 穿透纯展示；
  // 浮层 portal 到 body 且不可交互，点击永不落在浮层上，不会误触发生成面板点外关闭（IKFYH6）
  const [previewOpen, setPreviewOpen] = useState(false);
  const hoverTimerRef = useRef<number | null>(null);
  const closePreview = () => {
    if (hoverTimerRef.current) { window.clearTimeout(hoverTimerRef.current); hoverTimerRef.current = null; }
    setPreviewOpen(false);
  };
  useEffect(() => () => {
    if (hoverTimerRef.current) window.clearTimeout(hoverTimerRef.current);
  }, []);
  const previewable = info !== undefined && info.mediaType !== 'text' && Boolean(info.url);
  const { refs, floatingStyles } = useFloating({
    open: previewOpen,
    onOpenChange: setPreviewOpen,
    placement: 'top-start',
    whileElementsMounted: autoUpdate,
    middleware: [offset(8), flip({ padding: 8 }), shift({ padding: 8 })],
  });
  // 失效：显示原编号，身份保留不转向；有效：按当前输入派生编号
  if (invalidLabel !== undefined) {
    return (
      <span
        className={`${styles.mediaChip} ${styles.mediaChipInvalid}`}
        contentEditable={false}
        title={`${info?.name ?? assetId}：原参考已移除。点击可替换为其他已引用素材，退格键删除该提及`}
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
        <AlertTriangle size={12} strokeWidth={2} className={styles.mediaChipIcon} />
        <span className={styles.mediaChipLabel}>已失效：原{invalidLabel}</span>
      </span>
    );
  }
  const label = labels.get(assetId);
  return (
    <span
      ref={refs.setReference}
      className={styles.mediaChip}
      contentEditable={false}
      title={info?.name ?? assetId}
      data-testid="asset-ref-valid"
      onMouseEnter={() => {
        if (!previewable) return;
        if (hoverTimerRef.current) window.clearTimeout(hoverTimerRef.current);
        hoverTimerRef.current = window.setTimeout(() => setPreviewOpen(true), PREVIEW_OPEN_DELAY_MS);
      }}
      onMouseLeave={closePreview}
    >
      {info?.url && info.mediaType === 'image' && <img className={styles.mediaChipThumb} src={info.url} alt="" />}
      {info?.url && info.mediaType === 'video' && <video className={styles.mediaChipThumb} src={info.url} muted playsInline preload="metadata" />}
      {info?.mediaType === 'audio' && <span className={styles.mediaChipAudioIcon} aria-hidden="true">♫</span>}
      <span className={styles.mediaChipLabel}>{label ?? '素材?'}</span>
      {previewOpen && info && (
        <FloatingPortal>
          <div
            ref={refs.setFloating}
            className={styles.chipPreview}
            style={floatingStyles}
            role="tooltip"
            contentEditable={false}
            data-testid="asset-ref-preview"
          >
            {info.mediaType === 'image' && <img src={info.url} alt="" />}
            {info.mediaType === 'video' && <video src={info.url} muted autoPlay loop playsInline />}
            {info.mediaType === 'audio' && <div className={styles.chipPreviewAudio}><AudioLines size={28} strokeWidth={1.5} /><span>音频</span></div>}
            <div className={styles.chipPreviewName}>{info.name}</div>
          </div>
        </FloatingPortal>
      )}
    </span>
  );
}

export class AssetRefNode extends DecoratorNode<JSX.Element> {
  __assetId: string;
  __label: string | undefined;
  __invalidLabel: string | undefined;
  /** IKFA1P：标签身份类型——asset（媒体资产）| text（来源画布文本节点）；默认 asset（旧序列化兼容） */
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

  /** 替换该次提及的身份（IKFA1N B5）：节点原地换绑 assetId，位置与其他提及不受影响 */
  setAssetId(assetId: string): void {
    this.getWritable().__assetId = assetId;
  }

  /** IKFA1P：标签身份类型（asset=媒体 / text=来源文本节点） */
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
