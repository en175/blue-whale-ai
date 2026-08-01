/**
 * canvas assets 缓存（**业务/接口数据**）。节点只存 assetId 引用，渲染查 assets[id].src。
 * canvas 文档（nodes/viewport/save/load）由 useCanvasDoc hook 管（React state，不走 zustand）。
 */
import { create } from "zustand";
import { getAsset } from "../../../lib/api/endpoints";
import type { Asset } from "./model";

export interface CanvasState {
  assets: Record<string, Asset>;
  addAsset(a: Asset): void;
  setAssetSrc(id: string, src: string): void;
  ensureAsset(assetId: string): Promise<void>;
}

export const useCanvasStore = create<CanvasState>((set, get) => ({
  assets: {},

  addAsset: (a) => set((s) => ({ assets: { ...s.assets, [a.id]: a } })),

  setAssetSrc: (id, src) =>
    set((s) =>
      s.assets[id]
        ? { assets: { ...s.assets, [id]: { ...s.assets[id], src } } }
        : s,
    ),

  ensureAsset: async (assetId) => {
    // mimeType marks an authoritative API hydration. Locally inserted assets only
    // carry id/src, so the first info-panel open still fetches complete metadata.
    if (get().assets[assetId]?.mimeType) return;
    const r = await getAsset(assetId);
    // AssetResponse 用 asset_id（非 id）；type 为 image|video，转 Asset.kind（MediaKind 含 text/audio 兜底）
    const a: Asset = {
      id: String(r.asset_id),
      kind: r.type as Asset["kind"],
      src: r.url,
      width: r.width ?? undefined,
      height: r.height ?? undefined,
      duration: r.duration ?? undefined,
      mimeType: r.mime,
    };
    set((s) => ({ assets: { ...s.assets, [a.id]: a } }));
  },
}));
