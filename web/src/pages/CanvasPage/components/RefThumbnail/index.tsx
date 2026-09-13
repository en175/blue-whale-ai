/* ============================================
 * RefThumbnail 参考缩略图（IKFCKK）：面板参考栏附件条的三态交互统一组件
 * 默认态 = 编号圆钮（仅数字）；悬停 = 编号淡出、× / @ 淡入（约 150ms 过渡）；
 * 悬停满 200ms = 缩略图上方居中浮出放大预览（移出立即消失，浮层鼠标穿透纯展示）。
 * 图片/视频/音频/文本四类素材形态，面板接入时派生编号并接管删除/@ 回调。
 * ============================================ */
import { useEffect, useRef, useState } from 'react';
import { FloatingPortal, autoUpdate, flip, offset, shift, useFloating } from '@floating-ui/react';
import { AtSign, AudioLines, FileText, X } from 'lucide-react';
import styles from './index.module.css';
import type { StripDragItemProps } from './strip-dnd';

export type RefThumbnailKind = 'image' | 'video' | 'audio' | 'text';

export interface RefThumbnailProps {
  kind: RefThumbnailKind;
  /** 媒体地址（image/video 的缩略图与预览共用） */
  url?: string;
  /** 素材名称：悬停提示、音频预览名称 */
  name: string;
  /** 编号圆钮数字（面板按保序引用派生，删除/换位后紧凑重派生）；缺省不显示圆钮 */
  number?: number;
  /** 角色徽标文字（IKFCKQ 视频面板首帧/尾帧：按角色标识不参与数字编号）；优先于 number 显示 */
  badgeText?: string;
  /** × 立即删除（走调用方「断开引用、保留来源」链路，无确认弹窗）；缺省不渲染 × */
  onRemove?: () => void;
  /** @ 插入提示词（调用方复用 insertRefAtPending 记忆光标路径）；缺省不渲染 @ */
  onInsertRef?: () => void;
  /** 音频预览时长（秒） */
  audioDuration?: number;
  /** 文本预览正文 */
  textPreview?: string;
  /** 拖拽排序（IKFCKT）：外层拖拽属性透传根节点（useRefStripDrag().itemProps 生成）；
   *  与三态交互正交——按钮点击（mousedown 未移动不触发 dragstart）与拖拽手势天然区分 */
  dragProps?: StripDragItemProps;
  'data-testid'?: string;
  className?: string;
}

/** 悬停满 200ms 才浮出预览；移出立即消失（close 0ms，规格不引入关闭延迟） */
const PREVIEW_OPEN_DELAY = 200;
/** 预览内容上限（沿用 AssetChip 预览常量：280×280 + contain 不裁剪） */
const PREVIEW_MAX = 280;

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

/** 悬浮放大预览浮层：上方居中 + flip/shift 视口内收敛；pointer-events 穿透纯展示，
 *  仅打开时挂载（关闭即卸载媒体节点，视频随之停播）。 */
export function RefPreviewOverlay({ kind, url, name, audioDuration, textPreview, setFloating, style }: {
  kind: RefThumbnailKind;
  url?: string;
  name: string;
  audioDuration?: number;
  textPreview?: string;
  setFloating: (el: HTMLElement | null) => void;
  style: React.CSSProperties;
}) {
  return (
    <div
      ref={setFloating}
      className={styles.preview}
      style={{ ...style, pointerEvents: 'none' }}
      role="tooltip"
      data-testid="ref-thumb-preview"
    >
      {kind === 'image' && url ? (
        <img
          className={styles.previewMedia}
          src={url}
          style={{ maxWidth: PREVIEW_MAX, maxHeight: PREVIEW_MAX }}
          alt={name}
        />
      ) : kind === 'video' && url ? (
        // 静音是自动播放的硬前提（浏览器策略），循环便于确认内容
        <video
          className={styles.previewMedia}
          src={url}
          style={{ maxWidth: PREVIEW_MAX, maxHeight: PREVIEW_MAX }}
          autoPlay
          muted
          loop
          playsInline
        />
      ) : kind === 'audio' ? (
        <div className={styles.audioCard}>
          <AudioLines size={16} strokeWidth={2} aria-hidden="true" />
          <span className={styles.previewName} title={name}>{name}</span>
          {audioDuration != null && <span className={styles.previewMeta}>{formatDuration(audioDuration)}</span>}
        </div>
      ) : (
        <div className={styles.textCard}>{textPreview}</div>
      )}
    </div>
  );
}

export function RefThumbnail({
  kind,
  url,
  name,
  number,
  badgeText,
  onRemove,
  onInsertRef,
  audioDuration,
  textPreview,
  dragProps,
  className,
  'data-testid': testId,
}: RefThumbnailProps) {
  const [hovered, setHovered] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const { refs, floatingStyles } = useFloating({
    placement: 'top',
    // 面板可拖动、参考栏可换行，预览必须跟随锚点并收敛在视口内
    whileElementsMounted: autoUpdate,
    middleware: [offset(8), flip({ padding: 8 }), shift({ padding: 8 })],
  });

  const previewable =
    kind === 'image' || kind === 'video'
      ? Boolean(url)
      : kind === 'audio'
        ? true
        : textPreview !== undefined;

  useEffect(() => () => {
    if (timerRef.current) clearTimeout(timerRef.current);
  }, []);

  const handleMouseEnter = () => {
    setHovered(true);
    if (!previewable) return;
    timerRef.current = setTimeout(() => setPreviewOpen(true), PREVIEW_OPEN_DELAY);
  };

  const handleMouseLeave = () => {
    setHovered(false);
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    setPreviewOpen(false);
  };

  return (
    <div
      ref={refs.setReference}
      className={`${styles.thumb} ${className ?? ''}`}
      data-testid={testId ?? 'ref-thumb'}
      data-hovered={hovered}
      title={name}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      {...dragProps}
    >
      {/* draggable=false：图片/视频原生拖拽会劫持手势（拖出图片 ghost 而非缩略图项），统一由根节点承载 */}
      {kind === 'image' && url ? <img src={url} alt={name} draggable={false} /> : null}
      {kind === 'video' && url ? <video src={url} muted playsInline preload="metadata" draggable={false} /> : null}
      {kind === 'audio' ? <AudioLines className={styles.kindIcon} aria-hidden="true" /> : null}
      {kind === 'text' ? <FileText className={styles.kindIcon} aria-hidden="true" /> : null}
      {(badgeText ?? number) != null && (
        <span className={styles.badge} data-testid="ref-thumb-badge">{badgeText ?? number}</span>
      )}
      {onRemove && (
        <button
          type="button"
          className={`${styles.act} ${styles.actRemove}`}
          title="移除"
          aria-label={`移除 ${name}`}
          onClick={onRemove}
        >
          <X size={10} strokeWidth={2.5} />
        </button>
      )}
      {onInsertRef && (
        <button
          type="button"
          className={`${styles.act} ${styles.actAt}`}
          title="插入引用"
          aria-label={`插入引用 ${name}`}
          // 点击 @ 不让编辑器失焦（插入后光标语义依赖编辑器保持焦点）
          onMouseDown={(event) => event.preventDefault()}
          onClick={onInsertRef}
        >
          <AtSign size={10} strokeWidth={2.5} />
        </button>
      )}
      {previewOpen && previewable && (
        <FloatingPortal>
          <RefPreviewOverlay
            kind={kind}
            url={url}
            name={name}
            audioDuration={audioDuration}
            textPreview={textPreview}
            setFloating={refs.setFloating}
            style={floatingStyles}
          />
        </FloatingPortal>
      )}
    </div>
  );
}

export default RefThumbnail;
