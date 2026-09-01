import { useEffect, useState } from 'react';
import { fetchAllAssets } from '@/api/assets';
import type { SessionContentBlock } from '@/api/agentSessions';
import { ImageMentionChip } from '../ImageMentionChip';
import { VideoMentionChip } from '../VideoMentionChip';
import { isCanvasNodeVideo, isSidebarUploadedVideo } from './composerImagePreview';
import styles from './index.module.css';

/**
 * 用户消息里素材引用的**临时**渲染（IKAL46）。
 *
 * 这是过渡实现，整份文件都是一次性的：胶囊组件由专门的前端同学交付，到位后直接删掉这个文件
 * 并在 AgentPanel 里换成胶囊即可，不会有散落各处的残留。
 *
 * 为什么需要它：消息气泡只渲染文本，`asset_ref` 部件在气泡里什么都不显示——用户上传时看得见
 * chip，一发送图就"消失"了。侧边栏上传的视频现在同样走缩略图胶囊（IKCJFQ）。
 *
 * URL 从哪来：`asset_ref` 按契约只携带身份（asset_id / media_type / display_label），**不含**
 * 签名 URL 或对象键——访问材料不进消息。所以这里按 id 反查素材库拿可展示的永久 URL。上传时
 * 顺手把 URL 塞进缓存（`rememberAssetUrl`），于是刚发出的那张图不用等一次网络往返就能显示。
 */
const urlCache = new Map<string, string>();
let listPromise: Promise<void> | null = null;
const urlCacheListeners = new Set<() => void>();

function cacheKey(assetId: string): string {
  return String(assetId);
}

function notifyUrlCache(): void {
  urlCacheListeners.forEach((listener) => listener());
}

/** 上传拿到 URL 时登记，省掉刚发出那张图的反查。 */
export function rememberAssetUrl(assetId: string, url: string): void {
  urlCache.set(cacheKey(assetId), url);
  notifyUrlCache();
}

export function lookupAssetUrl(assetId: string | undefined): string | undefined {
  if (!assetId) return undefined;
  return urlCache.get(cacheKey(assetId));
}

/**
 * 素材 URL 缓存更新后让父组件重绘。
 *
 * 刷新后 `urlCache` 是空的：气泡里的 `MessageAssetPreview` 会自己 `forceRender`，
 * 但 AgentPanel 用来藏 `@ [视频]` 的 `isInlineMediaThumbnail` 不会跟着变。
 * 订阅后，反查填进缓存，文字胶囊才会让位给缩略图。
 */
export function useAssetUrlCache(): void {
  const [, bump] = useState(0);
  useEffect(() => {
    const onChange = () => bump((n) => n + 1);
    urlCacheListeners.add(onChange);
    return () => {
      urlCacheListeners.delete(onChange);
    };
  }, []);
}

/**
 * 用户气泡里已经（或即将）用缩略图胶囊呈现的块：图片、画布独立视频、
 * 以及带可播 URL 的侧边栏上传视频。商品卡 / 图集 / 普通 @ 视频仍走文字胶囊。
 */
export function isInlineMediaThumbnail(block: SessionContentBlock): boolean {
  const isImage = block.media_type === 'image' || block.type === 'image';
  const isVideo = block.media_type === 'video' || block.type === 'video';
  if (isImage) return Boolean(block.url || block.asset_id);
  if (!isVideo) return false;
  if (isCanvasNodeVideo(block) && Boolean(block.url || block.asset_id)) return true;
  if (isSidebarUploadedVideo(block) && Boolean(block.url || lookupAssetUrl(block.asset_id))) return true;
  return false;
}

/** 反查一次素材库并把 id → url 填进缓存；并发调用共用同一个请求。 */
function ensureAssetUrls(): Promise<void> {
  if (!listPromise) {
    listPromise = fetchAllAssets('')
      .then((records) => {
        for (const record of records) if (record.url) urlCache.set(cacheKey(String(record.id)), record.url);
        notifyUrlCache();
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
    const nodeVideo = mediaType === 'video' && isCanvasNodeVideo(block);
    const sidebarUpload = mediaType === 'video' && isSidebarUploadedVideo(block);
    const assetId = block.asset_id;
    const url = block.url || lookupAssetUrl(assetId);
    // 普通 @ / 商品卡 / 图集视频已有文字胶囊时不再额外渲染。
    // 侧边栏上传在回执/历史里也会被 chipsFromContent 补一颗 `@ [视频]`；刷新后内存缓存是空的，
    // 签名 URL 又不进消息——必须带着 asset_id 进入 refs，才能跑 ensureAssetUrls（IKCJFQ）。
    if (mediaType === 'video' && !nodeVideo && !sidebarUpload && chips?.some((chip) => mentionIds.includes(chip.id))) return [];
    if (mediaType === 'image' && !url && !assetId) return [];
    if (nodeVideo && !url && !assetId) return [];
    return [{
      key: assetId || block.resource_id || block.node_id || `image-${index}`,
      assetId,
      url,
      mediaType,
      nodeVideo,
      sidebarUpload,
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
          if (ref.url && (ref.nodeVideo || ref.sidebarUpload)) {
            return <VideoMentionChip key={ref.key} url={ref.url} label={ref.label} />;
          }
          if (ref.nodeVideo) {
            return (
              <span key={ref.key} className={styles.messageAssetFallback} title={ref.label}>
                视频：{ref.label}
              </span>
            );
          }
          // 还在反查、或本就该走 chips 行的 `@ [视频]`：不要叠两份。
          return null;
        }
        if (ref.url) {
          return <ImageMentionChip key={ref.key} url={ref.url} label={ref.label} />;
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
