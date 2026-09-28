/* ============================================
 * 素材索引：asset_id → 资产记录（缩略图 URL / 类型 / 尺寸）
 *
 * agent 产的生成卡里带的是 `asset_id`，要渲染成「左缩略图 + 右标题」的胶囊就得拿到 URL。
 * 按缺失的 id 拉详情，不要全量翻页资产库——否则画布上几个胶囊就会把整个库打一遍。
 * ============================================ */
import { useCallback, useEffect, useState } from 'react';
import { fetchAssetDetail, type AssetRecord } from '@/api/assets';

/** 同一 id 查不到时的补拉间隔：刚上传的素材可能晚于第一次 404。 */
const STALE_AFTER_MS = 30_000;

const byId = new Map<string, AssetRecord>();
const missingUntil = new Map<string, number>();
const inflight = new Map<string, Promise<AssetRecord | null>>();

/** 订阅者：单条详情回来后要让挂着的胶囊重新查一次，否则它们会一直停在「查不到」。 */
const subscribers = new Set<() => void>();

function notifyLookup(): void {
  subscribers.forEach((listener) => listener());
}

function loadAsset(assetId: string): Promise<AssetRecord | null> {
  const id = String(assetId);
  const cached = byId.get(id);
  if (cached) return Promise.resolve(cached);
  const pending = inflight.get(id);
  if (pending) return pending;

  const request = fetchAssetDetail(id, { silent: true })
    .then((record) => {
      byId.set(id, record);
      missingUntil.delete(id);
      return record;
    })
    .catch(() => {
      missingUntil.set(id, Date.now() + STALE_AFTER_MS);
      return null;
    })
    .finally(() => {
      inflight.delete(id);
      notifyLookup();
    });
  inflight.set(id, request);
  return request;
}

/**
 * 返回一个 `assetId → 资产记录` 的查询函数。
 *
 * 查不到时只补拉这一个 id：用户这一轮刚上传的素材，很可能晚于首次加载，
 * 卡里引到它就必然落空。同一 id 失败后 30 秒内不再请求——不是每次渲染都去拉，
 * 更不会把整个资产库翻页搬下来。补拉之后仍查不到就让胶囊降级成纯文字，不显示破图。
 */
export function useAssetLookup(): (assetId: string | undefined) => AssetRecord | undefined {
  const [, forceRender] = useState(0);

  useEffect(() => {
    const notify = () => forceRender((n) => n + 1);
    subscribers.add(notify);
    return () => {
      subscribers.delete(notify);
    };
  }, []);

  return useCallback((assetId: string | undefined) => {
    if (!assetId) return undefined;
    const id = String(assetId);
    const hit = byId.get(id);
    if (hit) return hit;
    if (inflight.has(id)) return undefined;
    const retryAfter = missingUntil.get(id) ?? 0;
    if (retryAfter > Date.now()) return undefined;
    void loadAsset(id);
    return undefined;
  }, []);
}
