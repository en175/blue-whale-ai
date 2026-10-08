import { useCallback, useEffect, useState } from 'react';
import { fetchAssetDetail, type AssetRecord } from '@/api/assets';

const STALE_AFTER_MS = 30_000;

const byId = new Map<string, AssetRecord>();
const missingUntil = new Map<string, number>();
const inflight = new Map<string, Promise<AssetRecord | null>>();

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
