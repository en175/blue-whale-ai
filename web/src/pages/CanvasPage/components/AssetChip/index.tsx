/* ============================================
 * AssetChip 素材引用胶囊：左缩略图 + 右标题，悬浮出预览
 *
 * 这是**共用**组件：卡片里的素材引用（IKAFSQ）与输入框里的引用胶囊（IKAFSX）都用它。
 * 分开写必然做出两个长得不一样的胶囊——它们在用户眼里是同一个东西。
 * ============================================ */
import { useState } from 'react';
import {
  FloatingPortal,
  autoUpdate,
  flip,
  offset,
  safePolygon,
  shift,
  useDismiss,
  useFloating,
  useHover,
  useInteractions,
} from '@floating-ui/react';
import { X } from 'lucide-react';
import { useAssetLookup } from './useAssetLookup';
import styles from './index.module.css';

export interface AssetChipProps {
  /** 素材 id。缺失或查不到时胶囊降级为纯文字，不显示破图。 */
  assetId?: string | undefined;
  /** 胶囊上显示的名称。 */
  label: string;
  /** 决定预览是图还是视频；缺省按资产库记录判断。 */
  mediaType?: 'image' | 'video' | undefined;
  /** 传了才渲染移除按钮（输入框里的胶囊要，卡片里的不要）。 */
  onRemove?: (() => void) | undefined;
  /** 卡片内引用是只读展示，不该抢焦点；输入框里的胶囊由 Lexical 自己管。 */
  className?: string | undefined;
}

/** 预览框边长上限：面板本身就窄，预览再大就把整块画布糊住了。 */
const PREVIEW_MAX = 280;

export function AssetChip({ assetId, label, mediaType, onRemove, className }: AssetChipProps) {
  const lookup = useAssetLookup();
  const asset = lookup(assetId);
  const [open, setOpen] = useState(false);

  const { refs, floatingStyles, context } = useFloating({
    open,
    onOpenChange: setOpen,
    placement: 'top-start',
    // 面板可拖动、消息列表可滚动，位置必须跟着走，否则预览会留在原地。
    whileElementsMounted: autoUpdate,
    middleware: [offset(8), flip({ padding: 8 }), shift({ padding: 8 })],
  });

  const hover = useHover(context, {
    delay: { open: 120, close: 80 },
    // 鼠标从胶囊移向预览框的那段路径上不能关掉——safePolygon 动态算出这块安全区。
    // 自己实现这条基本写不对，这也是引 @floating-ui/react 的主要理由。
    handleClose: safePolygon(),
  });
  const dismiss = useDismiss(context);
  const { getReferenceProps, getFloatingProps } = useInteractions([hover, dismiss]);

  const kind = mediaType ?? (asset?.type === 'video' ? 'video' : asset?.type === 'image' ? 'image' : undefined);
  const previewable = Boolean(asset?.url) && (kind === 'image' || kind === 'video');

  return (
    <>
      <span
        ref={refs.setReference}
        className={`${styles.chip} ${previewable ? styles.chipLinked : ''} ${className ?? ''}`}
        {...getReferenceProps()}
      >
        {asset?.url && kind === 'image' ? (
          <img className={styles.chipThumb} src={asset.url} alt="" loading="lazy" />
        ) : asset?.url && kind === 'video' ? (
          // 视频缩略图直接用首帧：preload="metadata" 只拉元数据，不下整段。
          <video className={styles.chipThumb} src={asset.url} muted playsInline preload="metadata" />
        ) : (
          <span className={styles.chipThumbFallback} aria-hidden="true" />
        )}
        <span className={styles.chipLabel}>{label}</span>
        {onRemove && (
          <button
            type="button"
            className={styles.chipRemove}
            title="移除引用"
            onMouseDown={(e) => e.preventDefault()}
            onClick={onRemove}
          >
            <X size={12} strokeWidth={2} />
          </button>
        )}
      </span>

      {/* 预览只在展开时挂载：卡片里可能有十几个胶囊，一进来就把所有视频拉下来是不可接受的。 */}
      {open && previewable && asset && (
        <FloatingPortal>
          <div
            ref={refs.setFloating}
            className={styles.preview}
            style={{ ...floatingStyles, maxWidth: PREVIEW_MAX }}
            {...getFloatingProps()}
          >
            {kind === 'video' ? (
              // 静音是硬约束不是选择：浏览器会拦截带声音的自动播放，带声音则整个自动播放失效。
              <video
                className={styles.previewMedia}
                src={asset.url}
                style={{ maxWidth: PREVIEW_MAX, maxHeight: PREVIEW_MAX }}
                autoPlay
                muted
                loop
                playsInline
              />
            ) : (
              <img
                className={styles.previewMedia}
                src={asset.url}
                style={{ maxWidth: PREVIEW_MAX, maxHeight: PREVIEW_MAX }}
                alt={label}
              />
            )}
            <span className={styles.previewCaption}>已关联素材 · {label}</span>
          </div>
        </FloatingPortal>
      )}
    </>
  );
}

export default AssetChip;
