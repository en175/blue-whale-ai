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
    set((s) => (s.assets[id] ? { assets: { ...s.assets, [id]: { ...s.assets[id], src } } } : s)),

  ensureAsset: async (assetId) => {
    if (get().assets[assetId]) return;
    const r = await getAsset(assetId);
    const a: Asset = {
      id: String(r.id),
      kind: r.type as Asset["kind"],
      src: r.url,
      width: r.width ?? undefined,
      height: r.height ?? undefined,
      duration: r.duration ?? undefined,
    };
    set((s) => ({ assets: { ...s.assets, [a.id]: a } }));
  },
}));
