import { useEffect, useState } from 'react';
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

export function MessageAssetPreview({ blocks }: { blocks: SessionContentBlock[] | undefined }) {
  const refs = (blocks ?? []).filter((block) => block.type === 'asset_ref' && block.asset_id);
  const [, forceRender] = useState(0);

  useEffect(() => {
    if (refs.length === 0) return;
    if (refs.every((ref) => urlCache.has(ref.asset_id!))) return;
    let alive = true;
    void ensureAssetUrls().then(() => {
      if (alive) forceRender((n) => n + 1);
    });
    return () => {
      alive = false;
    };
    // 依赖是这条消息引用的素材集合，不是数组本身（每次渲染都是新数组）。
  }, [refs.map((ref) => ref.asset_id).join(',')]);

  if (refs.length === 0) return null;

  return (
    <div className={styles.messageAssets}>
      {refs.map((ref) => {
        const url = urlCache.get(ref.asset_id!);
        const label = ref.display_label || (ref.media_type === 'video' ? '视频' : '图片');
        if (ref.media_type === 'image' && url) {
          return <img key={ref.asset_id} className={styles.messageAssetThumb} src={url} alt={label} title={label} />;
        }
        return (
          <span key={ref.asset_id} className={styles.messageAssetFallback} title={label}>
            {ref.media_type === 'video' ? '视频' : '图片'}：{label}
          </span>
        );
      })}
    </div>
  );
}
