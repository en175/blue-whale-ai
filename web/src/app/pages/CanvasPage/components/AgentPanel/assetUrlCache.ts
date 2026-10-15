import { useEffect, useState } from 'react';
import { fetchAssetDetail } from '@/app/api/assets';
import type { SessionContentBlock } from '@/app/api/agentSessions';
import { isCanvasNodeVideo, isSidebarUploadedVideo } from './composerImagePreview';

const urlCache = new Map<string, string>();

const missingIds = new Set<string>();
const inflightById = new Map<string, Promise<void>>();
const urlCacheListeners = new Set<() => void>();

const DETAIL_CONCURRENCY = 6;

function cacheKey(assetId: string): string {
  return String(assetId);
}

function notifyUrlCache(): void {
  urlCacheListeners.forEach((listener) => listener());
}

export function rememberAssetUrl(assetId: string, url: string): void {
  const id = cacheKey(assetId);
  urlCache.set(id, url);
  missingIds.delete(id);
  notifyUrlCache();
}

export function lookupAssetUrl(assetId: string | undefined): string | undefined {
  if (!assetId) return undefined;
  return urlCache.get(cacheKey(assetId));
}

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

export function isInlineMediaThumbnail(block: SessionContentBlock): boolean {
  const isImage = block.media_type === 'image' || block.type === 'image';
  const isVideo = block.media_type === 'video' || block.type === 'video';
  if (isImage) return Boolean(block.url || block.asset_id);
  if (!isVideo) return false;
  if (isCanvasNodeVideo(block) && Boolean(block.url || block.asset_id)) return true;
  if (isSidebarUploadedVideo(block) && Boolean(block.url || lookupAssetUrl(block.asset_id))) return true;
  return false;
}

function resolveOneAssetUrl(assetId: string): Promise<void> {
  const id = cacheKey(assetId);
  if (!id || urlCache.has(id) || missingIds.has(id)) return Promise.resolve();
  const pending = inflightById.get(id);
  if (pending) return pending;
  const request = fetchAssetDetail(id, { silent: true })
    .then((record) => {
      if (record.url) urlCache.set(id, record.url);
      else missingIds.add(id);
    })
    .catch(() => {

      missingIds.add(id);
    })
    .finally(() => {
      inflightById.delete(id);
    });
  inflightById.set(id, request);
  return request;
}

export function ensureAssetUrls(assetIds: readonly string[]): Promise<void> {
  const needed = [...new Set(assetIds.map(cacheKey).filter(Boolean))].filter(
    (id) => !urlCache.has(id) && !missingIds.has(id),
  );
  if (needed.length === 0) return Promise.resolve();

  return (async () => {
    let cursor = 0;
    async function worker() {
      while (cursor < needed.length) {
        const index = cursor++;
        await resolveOneAssetUrl(needed[index]);
      }
    }
    await Promise.all(
      Array.from({ length: Math.min(DETAIL_CONCURRENCY, needed.length) }, () => worker()),
    );
    notifyUrlCache();
  })();
}
