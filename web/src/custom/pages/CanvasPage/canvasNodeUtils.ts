import type { Node } from '@xyflow/react';
import type { PromptBinding } from '@lib/contracts/prompt-target';
import type { SnapshotAsset } from '@/custom/api/projects';
import type { AssetCardKind } from './components/AssetCardNode';
import { resolveCharacterLibraryMaterialId } from './characterLibraryDeposit';
import { isMaterialLibraryId, readAssetId } from './mediaRefs';

export function draftFileNameOf(type: unknown): string {
  return type === 'video' ? '视频草稿' : type === 'audio' ? '音频草稿' : '图片草稿';
}

export function hasCustomName(node: Node | undefined): boolean {
  return ((node?.data ?? {}) as Record<string, unknown>).customName === true;
}

export function planBindingsCoveredBy(current: PromptBinding[], confirmed: PromptBinding[]): boolean {
  const confirmedKeys = new Set(confirmed.map(binding => `${binding.index}\0${binding.assetId}`));
  return current.every(binding => confirmedKeys.has(`${binding.index}\0${binding.assetId}`));
}

export function readNodeAssetId(data: Record<string, unknown>): string | number | undefined {
  return (data.assetId ?? data.asset_id ?? data.assetID) as string | number | undefined;
}

export function resolveAssetRef(
  node: Node,
  snapshotAssets: Record<string, SnapshotAsset>,
): { url: string; type: string; assetId?: string } | null {
  const data = (node.data ?? {}) as Record<string, unknown>;
  const raw = node as unknown as Record<string, unknown>;
  const candidates: unknown[] = [
    data.asset_id,
    raw.asset_id,
    data.assetId,
    raw.assetId,
    data.assetID,
    raw.assetID,
    data.sourceAssetId,
    raw.sourceAssetId,
    Array.isArray(data.reference_asset_ids) ? data.reference_asset_ids[0] : undefined,
    Array.isArray(raw.reference_asset_ids) ? raw.reference_asset_ids[0] : undefined,
  ];
  for (const c of candidates) {
    if (c == null || c === '') continue;
    const asset = snapshotAssets[String(c)];
    if (asset?.access_url) return { url: asset.access_url, type: asset.type, assetId: String(c) };
  }
  return null;
}

export function readRefLookupId(r: unknown): string | undefined {
  if (typeof r === 'number' || typeof r === 'string') return r === '' ? undefined : String(r);
  if (r != null && typeof r === 'object') {
    const o = r as Record<string, unknown>;
    const aid = o.asset_id ?? o.assetId ?? o.id;
    if (aid != null && aid !== '') return String(aid);
  }
  return undefined;
}

export function resolveRefType(r: unknown): 'image' | 'video' {
  if (r != null && typeof r === 'object') {
    const o = r as Record<string, unknown>;
    const t = (o.type ?? o.media_type) as string | undefined;
    if (t === 'video') return 'video';
    const mime = o.mime as string | undefined;
    if (mime?.startsWith('video/')) return 'video';
  }
  return 'image';
}

export function mapBackendNode(
  node: Node,
  snapshotAssets: Record<string, SnapshotAsset>,
): Node | null {
  const raw = node as unknown as Record<string, unknown>;
  const data = (node.data ?? {}) as Record<string, unknown>;
  const position = node.position ?? { x: 0, y: 0 };

  if (node.type === 'reference') {
    const cardType = typeof raw.cardType === 'string' ? raw.cardType : 'custom';
    const kind: AssetCardKind = (
      ['style', 'character', 'object', 'environment', 'custom'] as AssetCardKind[]
    ).includes(cardType as AssetCardKind)
      ? (cardType as AssetCardKind)
      : 'custom';
    const refsRaw = Array.isArray(raw.references) ? raw.references : [];
    const initialRefs = refsRaw.map((r, i) => {
      const type = resolveRefType(r);
      const lookupAid = readRefLookupId(r);
      const url = lookupAid != null ? snapshotAssets[lookupAid]?.access_url : undefined;
      const base = { id: `ref-hydra-${node.id}-${i}`, type };
      return url
        ? { ...base, src: url, assetId: lookupAid }
        : { ...base, src: '', missing: true, ...(lookupAid ? { assetId: lookupAid } : {}) };
    });
    const desc = (data.content ?? data.desc ?? raw.content) as unknown;
    return {
      id: node.id,
      type: 'assetNode',
      position,
      data: {
        kind,
        initialRefs,
        initialDesc: typeof desc === 'string' ? desc : '',
      },
    };
  }

  if (node.type === 'text') {
    const html = (data.html ?? data.content ?? data.text ?? raw.content ?? raw.text ?? '') as unknown;
    return {
      id: node.id,
      type: 'textNode',
      position,
      data: { html: typeof html === 'string' ? html : '' },
    };
  }

  const ref = resolveAssetRef(node, snapshotAssets);
  const prompt = (data.prompt ?? raw.prompt) as unknown;
  if (!ref) {
    return {
      id: node.id,
      type: 'mediaNode',
      position,
      data: {
        src: '',
        mediaType: 'image',
        fileName: `参考 ${node.id}`,
        prompt: typeof prompt === 'string' ? prompt : undefined,
        assetMissing: true,
      },
    };
  }
  return {
    id: node.id,
    type: 'mediaNode',
    position,
    data: {
      src: ref.url,
      mediaType: ref.type === 'video' ? 'video' : 'image',
      fileName: `参考 ${node.id}`,
      prompt: typeof prompt === 'string' ? prompt : undefined,
      assetId: ref.assetId,
    },
  };
}

export function characterLibraryVerifiedPatch(
  data: Record<string, unknown>,
  snapshotMaterialId?: string | null,
  snapshotMaterialStatus?: string | null,
  fromHistory = false,
): Record<string, unknown> {
  if (data.mediaType === 'audio') return {};
  const verifiedId = resolveCharacterLibraryMaterialId({
    mediaType: data.mediaType,
    snapshotMaterialId,
  });
  const patch: Record<string, unknown> = {};
  if (verifiedId) {
    if (data.materialId !== verifiedId) patch.materialId = verifiedId;
  } else if (data.materialId) {
    patch.materialId = undefined;
  }
  const passed = snapshotMaterialStatus === 'Active';
  if (!fromHistory) {
    if (passed) {
      if (data.complianceBusy) patch.complianceBusy = undefined;
      if (data.compliancePassed !== true) patch.compliancePassed = true;
      if (data.complianceFailed) patch.complianceFailed = undefined;
    }
    return patch;
  }
  if (data.complianceBusy) patch.complianceBusy = undefined;
  if (data.compliancePassed !== passed) patch.compliancePassed = passed;
  if (data.complianceFailed) patch.complianceFailed = undefined;
  return patch;
}

export function resolveNodeAssets(
  node: Node,
  snapshotAssets: Record<string, SnapshotAsset>,
  fromHistory = false,
): Node {
  const data = (node.data ?? {}) as Record<string, unknown>;
  if (node.type === 'mediaNode') {
    if (data.genStatus && readAssetId(data) === undefined) return node;
    if (typeof data.src === 'string' && (data.src as string).startsWith('blob:')) return node;
    const aid = (data.assetId ?? data.asset_id ?? data.assetID) as string | number | undefined;
    if (isMaterialLibraryId(aid == null ? undefined : String(aid))) {
      const src = typeof data.src === 'string' ? data.src : '';
      if (src && !src.startsWith('blob:')) {
        const patch: Record<string, unknown> = {};
        if (data.assetMissing) patch.assetMissing = undefined;
        if (fromHistory && data.complianceBusy) patch.complianceBusy = undefined;
        return Object.keys(patch).length === 0 ? node : { ...node, data: { ...data, ...patch } };
      }
    }
    const asset = aid != null && aid !== '' ? snapshotAssets[String(aid)] : undefined;
    const url = asset?.access_url;
    if (url) {
      const fill: Record<string, number> = {};
      if (typeof data.width !== 'number' && typeof asset?.width === 'number') fill.width = asset.width;
      if (typeof data.height !== 'number' && typeof asset?.height === 'number') fill.height = asset.height;
      const verified = characterLibraryVerifiedPatch(data, asset.material_id, asset.material_status ?? null, fromHistory);
      return data.src === url && !data.assetMissing && Object.keys(fill).length === 0 && Object.keys(verified).length === 0
        ? node
        : { ...node, data: { ...data, ...fill, ...verified, src: url, assetMissing: undefined } };
    }
    if (fromHistory) {
      if (data.assetMissing && !data.complianceBusy) return node;
      return { ...node, data: { ...data, assetMissing: true, complianceBusy: undefined } };
    }
    const existingSrc = typeof data.src === 'string' ? data.src : '';
    if (existingSrc !== '' && !existingSrc.startsWith('blob:')) {
      return data.assetMissing ? { ...node, data: { ...data, assetMissing: undefined } } : node;
    }
    return data.assetMissing ? node : { ...node, data: { ...data, assetMissing: true } };
  }
  if (node.type === 'productNode') {
    const images = data.images;
    if (!Array.isArray(images)) return node;
    let changed = false;
    const next = images.map((img) => {
      const item = (img ?? {}) as Record<string, unknown>;
      if (typeof item.src === 'string' && item.src.startsWith('blob:')) return img;
      const aid = (item.assetId ?? item.asset_id) as string | number | undefined;
      const url = aid != null && aid !== '' ? snapshotAssets[String(aid)]?.access_url : undefined;
      if (url) {
        if (item.src === url && !item.missing) return img;
        changed = true;
        return { ...item, src: url, missing: undefined };
      }
      if (item.missing) return img;
      changed = true;
      return { ...item, src: '', missing: true };
    });
    return changed ? { ...node, data: { ...data, images: next } } : node;
  }
  if (node.type === 'assetNode') {
    const refs = data.initialRefs;
    if (!Array.isArray(refs)) return node;
    let changed = false;
    const next = refs.map((r) => {
      const ref = (r ?? {}) as Record<string, unknown>;
      if (typeof ref.src === 'string' && ref.src.startsWith('blob:')) return r;
      const aid = (ref.assetId ?? ref.asset_id) as string | number | undefined;
      const url = aid != null && aid !== '' ? snapshotAssets[String(aid)]?.access_url : undefined;
      if (url) {
        if (ref.src === url && !ref.missing) return r;
        changed = true;
        return { ...ref, src: url, missing: undefined };
      }
      if (ref.missing) return r;
      changed = true;
      return { ...ref, src: '', missing: true };
    });
    return changed ? { ...node, data: { ...data, initialRefs: next } } : node;
  }
  return node;
}
