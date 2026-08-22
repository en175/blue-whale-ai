/* ============================================
 * 素材索引：asset_id → 资产记录（缩略图 URL / 类型 / 尺寸）
 *
 * agent 产的生成卡里带的是 `asset_id`，要渲染成「左缩略图 + 右标题」的胶囊就得拿到 URL。
 * 这里不新增任何接口——资产本来就是全局的（`/api/assets`，跨项目），查一次建成 Map 即可。
 * ============================================ */
import { useCallback, useEffect, useState } from 'react';
import { fetchAllAssets, type AssetRecord } from '@/api/assets';

/** 缓存过期阈值：命中不了的时候才会用到它，见 {@link useAssetLookup}。 */
const STALE_AFTER_MS = 30_000;

interface AssetLookupCache {
  loadedAt: number;
  byId: Map<string, AssetRecord>;
}

let cache: AssetLookupCache | null = null;
let inFlight: Promise<AssetLookupCache> | null = null;

/** 订阅者：缓存刷新后要让挂着的胶囊重新查一次，否则它们会一直停在「查不到」。 */
const subscribers = new Set<() => void>();

async function loadAssetLookup(force: boolean): Promise<AssetLookupCache> {
  if (!force && cache) return cache;
  if (inFlight) return inFlight;
  inFlight = (async () => {
    try {
      const records = await fetchAllAssets('');
      cache = {
        loadedAt: Date.now(),
        byId: new Map(records.map((record) => [String(record.id), record])),
      };
      return cache;
    } finally {
      inFlight = null;
    }
  })();
  const loaded = await inFlight;
  subscribers.forEach((notify) => notify());
  return loaded;
}

/** 测试用：清空模块级缓存，免得用例之间互相串。 */
export function resetAssetLookupForTests(): void {
  cache = null;
  inFlight = null;
}

/**
 * 返回一个 `assetId → 资产记录` 的查询函数。
 *
 * 查不到时会在缓存足够旧的前提下补拉一次：用户这一轮刚上传的素材，很可能晚于首次加载，
 * 卡里引到它就必然落空。补拉有 30 秒节流，且只有真的落空才触发——不是每次渲染都去拉。
 * 补拉之后仍查不到就让胶囊降级成纯文字，不显示破图。
 */
export function useAssetLookup(): (assetId: string | undefined) => AssetRecord | undefined {
  const [, forceRender] = useState(0);

  useEffect(() => {
    const notify = () => forceRender((n) => n + 1);
    subscribers.add(notify);
    void loadAssetLookup(false);
    return () => {
      subscribers.delete(notify);
    };
  }, []);

  return useCallback((assetId: string | undefined) => {
    if (!assetId) return undefined;
    const hit = cache?.byId.get(assetId);
    if (hit) return hit;
    if (cache && Date.now() - cache.loadedAt > STALE_AFTER_MS) void loadAssetLookup(true);
    return undefined;
  }, []);
}
