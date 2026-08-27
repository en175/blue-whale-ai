import { useEffect, useState } from 'react';
import {
  FloatingPortal,
  autoUpdate,
  flip,
  offset,
  safePolygon,
  shift,
  useFloating,
  useFocus,
  useHover,
  useInteractions,
} from '@floating-ui/react';
import { fetchAllAssets } from '@/api/assets';
import type { SessionContentBlock } from '@/api/agentSessions';
import styles from './index.module.css';

/**
 * 用户消息里素材引用的**临时**渲染（IKAL46）。
 *
 * 这是过渡实现，整份文件都是一次性的：胶囊组件由专门的前端同学交付，到位后直接删掉这个文件
 * 并在 AgentPanel 里换成胶囊即可，不会有散落各处的残留。
 *
 * 为什么需要它：消息气泡只渲染文本，`asset_ref` 部件在气泡里什么都不显示——用户上传时看得见
 * chip，一发送图就"消失"了。
 *
 * URL 从哪来：`asset_ref` 按契约只携带身份（asset_id / media_type / display_label），**不含**
 * 签名 URL 或对象键——访问材料不进消息。所以这里按 id 反查素材库拿可展示的永久 URL。上传时
 * 顺手把 URL 塞进缓存（`rememberAssetUrl`），于是刚发出的那张图不用等一次网络往返就能显示。
 */
const urlCache = new Map<string, string>();
let listPromise: Promise<void> | null = null;

/** 上传拿到 URL 时登记，省掉刚发出那张图的反查。 */
export function rememberAssetUrl(assetId: string, url: string): void {
  urlCache.set(assetId, url);
}

/** 反查一次素材库并把 id → url 填进缓存；并发调用共用同一个请求。 */
function ensureAssetUrls(): Promise<void> {
  if (!listPromise) {
    listPromise = fetchAllAssets('')
      .then((records) => {
        for (const record of records) if (record.url) urlCache.set(String(record.id), record.url);
      })
      .catch(() => {
        // 反查失败不该让消息渲染崩掉：退回成只有文件名的方块。
      })
      .finally(() => {
        listPromise = null;
      });
  }
  return listPromise;
}

function MessageImageAsset({ url, label }: { url: string; label: string }) {
  const [open, setOpen] = useState(false);
  const { refs, floatingStyles, context } = useFloating({
    open,
    onOpenChange: setOpen,
    placement: 'top-end',
    whileElementsMounted: autoUpdate,
    middleware: [offset(8), flip({ padding: 8 }), shift({ padding: 8 })],
  });
  const hover = useHover(context, { delay: { open: 100, close: 80 }, handleClose: safePolygon() });
  const focus = useFocus(context);
  const { getReferenceProps, getFloatingProps } = useInteractions([hover, focus]);

  return (
    <>
      <button
        ref={refs.setReference}
        type="button"
        className={styles.messageAsset}
        aria-label={`查看原图：${label}`}
        {...getReferenceProps()}
      >
        <img className={styles.messageAssetThumb} src={url} alt={label} />
        <span className={styles.messageAssetLabel} title={label}>{label}</span>
      </button>
      {open && (
        <FloatingPortal>
          <span
            ref={refs.setFloating}
            className={styles.messageAssetPreview}
            style={floatingStyles}
            role="tooltip"
            {...getFloatingProps()}
          >
            <img src={url} alt={label} />
          </span>
        </FloatingPortal>
      )}
    </>
  );
}

export function MessageAssetPreview({
  blocks,
  chips,
}: {
  blocks: SessionContentBlock[] | undefined;
  chips?: { id: string }[];
}) {
  const refs = (blocks ?? []).flatMap((block, index) => {
    const mediaType = block.media_type === 'video' || block.type === 'video' ? 'video'
      : block.media_type === 'image' || block.type === 'image' ? 'image'
      : null;
    if (!mediaType) return [];
    const mentionIds = [block.chip_id, block.asset_id, block.resource_id, block.node_id];
    // 画布提及与历史消息已有普通 @ 胶囊时，视频不再额外渲染一次。
    if (mediaType === 'video' && chips?.some((chip) => mentionIds.includes(chip.id))) return [];
    const assetId = block.asset_id;
    const url = block.url || (assetId ? urlCache.get(assetId) : undefined);
    if (mediaType === 'image' && !url && !assetId) return [];
    return [{
      key: assetId || block.resource_id || block.node_id || `image-${index}`,
      assetId,
      url,
      mediaType,
      label: block.display_label || block.name || (mediaType === 'video' ? '视频' : '图片'),
    }];
  });
  const unresolvedAssetIds = refs.filter((ref) => !ref.url && ref.assetId).map((ref) => ref.assetId!);
  const unresolvedAssetKey = unresolvedAssetIds.join(',');
  const [, forceRender] = useState(0);

  useEffect(() => {
    if (!unresolvedAssetKey) return;
    let alive = true;
    void ensureAssetUrls().then(() => {
      if (alive) forceRender((n) => n + 1);
    });
    return () => {
      alive = false;
    };
    // 依赖是这条消息引用的素材集合，不是数组本身（每次渲染都是新数组）。
  }, [unresolvedAssetKey]);

  if (refs.length === 0) return null;

  return (
    <div className={styles.messageAssets}>
      {refs.map((ref) => {
        if (ref.mediaType === 'video') {
          const label = ref.label.startsWith('[视频]') ? ref.label : `[视频] ${ref.label}`;
          return (
            <span key={ref.key} className={styles.userMediaChip}>
              <span className={styles.userMediaChipAt}>@</span>
              <span className={styles.userMediaChipLabel}>{label}</span>
            </span>
          );
        }
        if (ref.url) {
          return <MessageImageAsset key={ref.key} url={ref.url} label={ref.label} />;
        }
        return (
          <span key={ref.key} className={styles.messageAssetFallback} title={ref.label}>
            图片：{ref.label}
          </span>
        );
      })}
    </div>
  );
}
