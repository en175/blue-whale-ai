import { type AssetCardKind } from '@/custom/enums';
import { type RefObject, useRef, useState } from 'react';
import type { Node } from '@xyflow/react';
import { unifiedTextNodeText } from '@lib/contracts/text-node-markdown';
import { fetchAllAssets, fetchAssetDetail, type AssetRecord } from '@/custom/api/assets';
import { isApiError } from '@/shared/api/http';
import { saveSharedAsset, type SaveSharedAssetRequest } from '@/custom/api/sharedAssets';

import { fetchRemoteMedia } from '../../media/fetchRemoteMedia';
import { downloadFileNameOf, resolveDownloadMime } from '../../components/cardName';
import { blobToUint8Array, buildStoreZip, sniffMediaMime, uniqueDownloadName } from '../../assets/groupDownloadZip';
import { extractTextNodeText } from '../../agent/quoteConversation';

export interface CanvasAssetActionsHost {
  mediaNodesRef: RefObject<Node[]>;
  textNodesRef: RefObject<Node[]>;
  productNodesRef: RefObject<Node[]>;
  assetNodesRef: RefObject<Node[]>;
  showToast: (type: 'success' | 'error' | 'warn', msg: string) => void;
}

const triggerFileDownload = (href: string, filename: string, revokeObjectUrl = false) => {
  const a = document.createElement('a');
  a.href = href;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  if (revokeObjectUrl) window.setTimeout(() => URL.revokeObjectURL(href), 1000);
};

const fetchAssetBlob = async (src: string): Promise<Blob | null> => {
  try {
    const res = await fetchRemoteMedia(src);
    if (!res.ok) return null;
    return await res.blob();
  } catch {
    return null;
  }
};

type GroupDownloadItem = { filename: string; blob: Blob };

export function useCanvasAssetActions(host: CanvasAssetActionsHost) {
  const { mediaNodesRef, textNodesRef, productNodesRef, assetNodesRef, showToast } = host;

  const downloadMediaById = async (id: string, notifyMissing: boolean): Promise<boolean> => {
    const node = mediaNodesRef.current?.find((n) => n.id === id);
    if (node?.data?.assetMissing) {
      if (notifyMissing) showToast('warn', '素材已被删除');
      return false;
    }
    const src = node?.data?.src as string | undefined;
    if (!src) return false;
    const name = (node?.data?.fileName as string) || id;
    const nodeMime = node?.data?.mime as string | undefined;
    const mediaType = node?.data?.mediaType as string | undefined;
    const blob = await fetchAssetBlob(src);
    if (blob) {
      const sniffed = await sniffMediaMime(blob, mediaType);
      const type = resolveDownloadMime({
        sniffed,
        blobType: blob.type,
        nodeMime,
        src,
        fileName: name,
        mediaType,
      });
      triggerFileDownload(URL.createObjectURL(blob), downloadFileNameOf(name, type, src), true);
      return true;
    }
    window.open(src, '_blank', 'noopener');
    return true;
  };

  const collectGroupDownloadItems = async (ids: string[]): Promise<GroupDownloadItem[]> => {
    const items: GroupDownloadItem[] = [];
    const usedNames = new Set<string>();
    for (const id of ids) {
      const media = mediaNodesRef.current?.find((n) => n.id === id);
      const src = media?.data?.src as string | undefined;
      if (media && !media.data?.assetMissing && src) {
        const blob = await fetchAssetBlob(src);
        if (blob) {
          const cardName = (media.data?.fileName as string) || id;
          const mediaType = media.data?.mediaType as string | undefined;
          const sniffed = await sniffMediaMime(blob, mediaType);
          const mime = resolveDownloadMime({
            sniffed,
            blobType: blob.type,
            nodeMime: media.data?.mime as string | undefined,
            src,
            fileName: cardName,
            mediaType,
          });
          items.push({
            filename: uniqueDownloadName(downloadFileNameOf(cardName, mime, src), usedNames),
            blob,
          });
        }
        continue;
      }
      const textNode = textNodesRef.current?.find((n) => n.id === id);
      if (textNode) {
        const text = extractTextNodeText(textNode.data);
        if (!text.trim()) continue;
        const title =
          typeof textNode.data.title === 'string' && textNode.data.title.trim()
            ? (textNode.data.title as string)
            : '文本';
        items.push({
          filename: uniqueDownloadName(`${title}.txt`, usedNames),
          blob: new Blob([text], { type: 'text/plain;charset=utf-8' }),
        });
      }
    }
    return items;
  };

  const handleDownloadGroupNodes = async (ids: string[]) => {
    const items = await collectGroupDownloadItems(ids);
    if (items.length === 0) {
      showToast('warn', '组内没有可下载的素材');
      return;
    }
    const zipParts = await Promise.all(
      items.map(async (item) => ({ name: item.filename, data: await blobToUint8Array(item.blob) })),
    );
    const zipBlob = await buildStoreZip(zipParts);
    triggerFileDownload(URL.createObjectURL(zipBlob), '组素材.zip', true);
  };

  const handleNodeDownload = async (id: string) => {
    await downloadMediaById(id, true);
  };

  const [assetDetailTarget, setAssetDetailTarget] = useState<AssetRecord | null>(null);
  const [assetDetailLoading, setAssetDetailLoading] = useState(false);
  const assetDetailRequestIdRef = useRef(0);

  const handleNodeShowDetails = (id: string) => {
    const node = mediaNodesRef.current?.find((n) => n.id === id);
    const data = (node?.data ?? {}) as Record<string, unknown>;
    if (node?.data?.assetMissing) {
      showToast('warn', '素材已被删除');
      return;
    }
    const type = data.mediaType;
    const url = data.src;
    if (!node || (type !== 'image' && type !== 'video' && type !== 'audio') || typeof url !== 'string') {
      showToast('warn', '当前媒体暂无可展示的详情');
      return;
    }

    const assetId = data.assetId ?? data.asset_id ?? data.assetID;
    const fallbackAsset: AssetRecord = {
      id: typeof assetId === 'string' || typeof assetId === 'number' ? assetId : node.id,
      type,
      url,
      width: typeof data.width === 'number' ? data.width : null,
      height: typeof data.height === 'number' ? data.height : null,
      duration: typeof data.duration === 'number' ? data.duration : null,
      size: typeof data.size === 'number' ? data.size : null,
      source: null,
      model: null,
      created_at: null,
    };

    setAssetDetailTarget(fallbackAsset);
    const requestId = ++assetDetailRequestIdRef.current;
    if (typeof assetId !== 'string' && typeof assetId !== 'number') {
      setAssetDetailLoading(false);
      return;
    }
    setAssetDetailLoading(true);

    void fetchAssetDetail(assetId)
      .then((asset) => {
        if (requestId !== assetDetailRequestIdRef.current) return;
        setAssetDetailTarget((current) =>
          current && String(current.id) === String(fallbackAsset.id) ? asset : current,
        );
        setAssetDetailLoading(false);
      })
      .catch(() => {
        if (requestId === assetDetailRequestIdRef.current) setAssetDetailLoading(false);
      });
  };

  const handleCloseAssetDetail = () => {
    assetDetailRequestIdRef.current += 1;
    setAssetDetailTarget(null);
    setAssetDetailLoading(false);
  };

  const doSaveSharedAsset = async (req: SaveSharedAssetRequest, successMsg: string) => {
    console.log('[SaveAssets] doSaveSharedAsset 请求', req);
    try {
      const result = await saveSharedAsset(req);
      console.log('[SaveAssets] 保存结果', result);
      if (result.created) {
        showToast('success', successMsg);
      } else {
        showToast('warn', '该内容已在共享资产中，未重复创建；如需更新请先删除旧条目');
      }
      return result;
    } catch (e) {
      console.warn('[SaveAssets] 保存失败', e);
      if (!isApiError(e)) showToast('error', '保存失败，请重试');
      return null;
    }
  };

  const handleSaveMediaToAssets = async (nodeId: string) => {
    const node = mediaNodesRef.current?.find((n) => n.id === nodeId);
    if (!node) {
      console.warn('[SaveAssets] 未找到媒体节点', nodeId);
      showToast('error', '节点不存在');
      return;
    }
    const nd = node.data as Record<string, unknown>;
    const mediaType = (nd.mediaType || nd.type) as 'image' | 'video' | 'audio' | undefined;
    const assetId = nd.assetId ?? nd.asset_id ?? nd.assetID;
    const fileName = (nd.fileName || nd.name) as string | undefined;
    const src = nd.src as string | undefined;
    console.log('[SaveAssets] handleSaveMediaToAssets', { nodeId, assetId, mediaType, src });
    if (!mediaType) {
      console.warn('[SaveAssets] 无 mediaType，无法保存', { nodeId, data: nd });
      showToast('error', '节点类型异常，无法保存');
      return;
    }
    let sourceAssetId = assetId ? String(assetId) : '';
    if (!sourceAssetId && src) {
      try {
        const records = await fetchAllAssets(mediaType);
        const hit = records.find((r) => r.url === src);
        if (hit) sourceAssetId = String(hit.id);
      } catch (err) {
        console.warn('[SaveAssets] 按 URL 反查资产失败', err);
      }
    }
    if (!sourceAssetId) {
      console.warn('[SaveAssets] 无 assetId，无法保存', { nodeId, data: nd });
      showToast('error', '请先上传素材后再保存');
      return;
    }
    const name = fileName || `媒体-${mediaType}`;
    await doSaveSharedAsset(
      {
        assetType: 'media',
        kind: mediaType,
        sourceAssetId,
        name,
      },
      `已保存「${name}」到共享资产`,
    );
  };

  const handleSaveTextToAssets = async (nodeId: string) => {
    const node = textNodesRef.current?.find((n) => n.id === nodeId);
    if (!node) return;
    const text = unifiedTextNodeText(node.data ?? {});
    if (!text) {
      showToast('error', '文本内容为空，无法保存');
      return;
    }
    await doSaveSharedAsset(
      { assetType: 'text', snapshot: { text } },
      '已保存文本到共享资产',
    );
  };

  const handleSaveCardToAssets = async (nodeId: string) => {
    const node = assetNodesRef.current?.find((n) => n.id === nodeId);
    if (!node) return;
    const data = node.data as {
      kind: AssetCardKind;
      initialRefs?: Array<{ id: string; src: string }>;
      initialDesc?: string;
      voice?: { name: string; src: string };
    };
    if (data.kind === 'generation' || !data.kind) {
      showToast('error', '生成卡暂不支持保存到共享资产');
      return;
    }
    const refs = data.initialRefs ?? [];
    const desc = data.initialDesc ?? '';
    if (refs.length === 0 && !desc) {
      showToast('error', '请先为卡片补充参考图或描述');
      return;
    }
    await doSaveSharedAsset(
      {
        assetType: 'card',
        kind: data.kind as 'style' | 'character' | 'object' | 'environment' | 'custom',
        snapshot: {
          referenceImages: refs,
          description: desc,
          ...(data.kind === 'character' && data.voice ? { voice: data.voice } : {}),
        },
      },
      `已保存「${({ style: '风格卡', character: '角色卡', object: '物体卡', environment: '环境卡', custom: '自定义卡' } as const)[data.kind]}」到共享资产`,
    );
  };

  const handleSaveGoodsToAssets = async (nodeId: string) => {
    const node = productNodesRef.current?.find((n) => n.id === nodeId);
    if (!node) return;
    const data = node.data as { name?: string; detail?: string; images?: Array<{ id: string; src: string; enabled: boolean }> };
    const name = data.name || '商品';
    await doSaveSharedAsset(
      {
        assetType: 'goods',
        snapshot: {
          name,
          detail: data.detail || '',
          images: (data.images || []).map((img) => ({ id: img.id, src: img.src, enabled: img.enabled })),
        },
      },
      `已保存「${name}」到共享资产`,
    );
  };

  return {
    assetDetailTarget,
    assetDetailLoading,
    handleCloseAssetDetail,
    handleNodeShowDetails,
    handleNodeDownload,
    handleDownloadGroupNodes,
    handleSaveMediaToAssets,
    handleSaveTextToAssets,
    handleSaveCardToAssets,
    handleSaveGoodsToAssets,
  };
}
