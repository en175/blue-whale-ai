import type { Node } from '@xyflow/react';
import { isApiError } from '@/api/http';
import type { AssetRecord } from '@/api/assets';
import { mediaContentBox } from './components/MediaNode/mediaContentSize';
import { readAssetId } from './mediaRefs';
import { asVideoRefMediaType, type VideoMediaRef } from './videoMediaRefs';
import { imageEnhanceDraftPosition } from './imageEnhance';
import { fetchRemoteMedia } from './fetchRemoteMedia';
import type { SpawnBox } from './draftSpawn';

export const nodeBoxOf = (n: Node): SpawnBox => {
  const d = (n.data ?? {}) as Record<string, unknown>;
  if (n.type === 'mediaNode') {
    const box = mediaContentBox({
      mediaType: d.mediaType as 'image' | 'video' | 'audio' | undefined,
      width: typeof d.width === 'number' ? d.width : undefined,
      height: typeof d.height === 'number' ? d.height : undefined,
      ratio: d.targetRatio as string | undefined,
    });
    return { x: n.position.x, y: n.position.y, width: box.width, height: box.height + 44 };
  }
  return { x: n.position.x, y: n.position.y, width: 320, height: 340 };
};

export const readRecoveryErrorReason = (e: unknown): string | null => {
  if (!isApiError(e)) return null;
  const reason = (e.data as { reason?: unknown } | null | undefined)?.reason;
  return typeof reason === 'string' ? reason : null;
};

export const videoFreeRefItemOf = (node: Node): VideoMediaRef => {
  const data = (node.data ?? {}) as Record<string, unknown>;
  return {
    nodeId: node.id,
    url: String(data.src ?? ''),
    name: typeof data.fileName === 'string' && data.fileName ? data.fileName : node.id,
    assetId: String(readAssetId(data)),
    mediaType: asVideoRefMediaType(data.mediaType),
  };
};

export const assetDisplayName = (asset: AssetRecord): string => {
  try {
    const last = new URL(asset.url).pathname.split('/').filter(Boolean).pop();
    return last ? decodeURIComponent(last) : `资产-${asset.id}`;
  } catch {
    return `资产-${asset.id}`;
  }
};

export const imageToolTargetBesideSource = (source: Node, fileName: string, targetNodeId: string) => {
  const position = imageEnhanceDraftPosition(source);
  const d = (source.data ?? {}) as Record<string, unknown>;
  const width = typeof d.width === 'number' && d.width > 0 ? Math.round(d.width) : 320;
  const height = typeof d.height === 'number' && d.height > 0 ? Math.round(d.height) : 320;
  return {
    targetNodeId,
    seedTarget: { role: 'result-placeholder' as const, x: position.x, y: position.y, width, height, name: fileName },
    seedSources: [{
      node_id: source.id,
      x: Math.round(source.position.x),
      y: Math.round(source.position.y),
      width,
      height,
      name: typeof d.fileName === 'string' ? d.fileName : '',
    }],
  };
};

export const fetchUrlAsFile = async (url: string, name: string, _type: string): Promise<File | null> => {
  try {
    const res = await fetchRemoteMedia(url);
    if (!res.ok) return null;
    const blob = await res.blob();
    const mimeType = blob.type || _type || 'image/png';
    return new File([blob], name, { type: mimeType });
  } catch {
    return null;
  }
};
