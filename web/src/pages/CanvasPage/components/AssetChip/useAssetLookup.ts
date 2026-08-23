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
/**
 * 上一次**尝试**取数的时刻——成功与失败都记。
 *
 * 此前只有 `cache.loadedAt`，而它只在成功时才写。首次取数失败 → `cache` 恒为 null →
 * 补拉守卫 `if (cache && …)` 永远进不去 → **重试永远触发不了**，已渲染的每个胶囊
 * 永久降级成纯文字，直到组件重挂载（审查 W·A24）。
 *
 * 失败也记时刻，节流才对失败同样生效；否则失败之后每次 render 都会再拉一遍全量资产库。
 */
let lastAttemptAt = 0;

/** 订阅者：缓存刷新后要让挂着的胶囊重新查一次，否则它们会一直停在「查不到」。 */
const subscribers = new Set<() => void>();

async function loadAssetLookup(force: boolean): Promise<AssetLookupCache | null> {
  if (!force && cache) return cache;
  if (inFlight) return inFlight;
  lastAttemptAt = Date.now();
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
  let loaded: AssetLookupCache | null = null;
  try {
    loaded = await inFlight;
  } catch (e) {
    // 取数失败不是异常情况，是这个模块要处理的常态之一：胶囊降级成纯文字，
    // 下一次落空时按节流再试。此前这里没有 catch，两个 `void loadAssetLookup(...)`
    // 调用点因此每次失败都留下一个 unhandled promise rejection。
    console.warn('[AssetChip] 资产索引取数失败，胶囊暂时降级为纯文字:', e);
  }
  // 失败也要通知：订阅者据此重新走一遍查询，把「加载中」落定成「查不到」。
  subscribers.forEach((notify) => notify());
  return loaded;
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
    // 节流看的是**上一次尝试**，不是上一次成功——否则首次失败之后 cache 恒为 null，
    // 这个守卫永远进不去，胶囊就永久停在「查不到」（审查 W·A24）。
    if (Date.now() - lastAttemptAt > STALE_AFTER_MS) void loadAssetLookup(true);
    return undefined;
  }, []);
}
