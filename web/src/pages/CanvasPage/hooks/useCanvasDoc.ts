/* ============================================
 * useCanvasDoc 钩子：画布水合 —— GET /api/projects/:id/snapshot
 * 一次拉取项目快照，提取画布（节点 + 视口 + 版本号）与资产字典；
 * 加载失败静默降级为空画布，不阻断画布操作
 * ============================================ */
import { useCallback, useEffect, useState } from 'react';
import type { Edge, Node, Viewport } from '@xyflow/react';
import { fetchProjectSnapshot, type SnapshotAsset } from '@/api/projects';
import { fetchCanvasDoc, type CanvasDoc, type LegacyMigrationReport } from '@/api/canvas';

/** 空画布文档（无记录/加载失败时使用） */
const EMPTY_DOC: CanvasDoc = {
  id: null,
  version: null,
  viewport: { x: 0, y: 0, zoom: 1.1 },
  nodes: [],
  edges: [],
};

/** 安全解析 JSON：兼容后端直接返回已解析对象/数组的情况，失败返回 fallback */
function safeParse<T>(raw: unknown, fallback: T): T {
  if (raw == null || raw === '') return fallback;
  if (typeof raw === 'object') return raw as T;
  if (typeof raw !== 'string') return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

/** 原始 nodes/viewport 字段 → 画布文档字段（兼容字符串与已解析结构） */
function parseNodes(raw: unknown): Node[] {
  return safeParse<Node[]>(raw, []).map((n) => ({
    ...n,
    position: n.position ?? { x: 0, y: 0 },
    data: n.data ?? {},
  }));
}

/**
 * 水合指定项目的画布
 * - projectId 变化时重新拉取快照；切换期间先清空（避免旧节点残留）
 * - 无画布记录或请求失败均返回空文档
 */
export function useCanvasDoc(projectId: string) {
  const [doc, setDoc] = useState<CanvasDoc | null>(null);
  /** 快照资产字典（key 为 assetId），供节点还原资产 URL */
  const [assets, setAssets] = useState<Record<string, SnapshotAsset>>({});
  const [loading, setLoading] = useState(false);
  /** 旧生成卡迁移报告（IKDLQK）：随本次打开响应透传，无迁移为 null */
  const [legacyMigration, setLegacyMigration] = useState<LegacyMigrationReport | null>(null);

  /** 拉取快照并水合；手动刷新时保留现有画布，避免节点短暂清空。返回本次读到的节点，供调用方在 React 提交前判断注入结果。 */
  const load = useCallback((preserveCurrent = false): Promise<Node[]> => {
    if (!projectId) {
      setDoc(null);
      setAssets({});
      setLegacyMigration(null);
      return Promise.resolve([]);
    }
    if (!preserveCurrent) setDoc(null);
    setLoading(true);
    return fetchProjectSnapshot(projectId)
      .then(async (snap) => {
        setAssets(snap.assets ?? {});
        const canvas = snap.canvas;
        setLegacyMigration(snap.legacy_migration ?? null);
        if (import.meta.env.DEV) {
          console.info('[canvas] snapshot canvas 字段形态:', {
            exists: !!canvas,
            version: canvas?.version ?? null,
            nodesType: canvas ? typeof canvas.nodes : 'none',
            nodesHead:
              canvas && typeof canvas.nodes === 'string'
                ? canvas.nodes.slice(0, 120)
                : canvas?.nodes ?? null,
          });
        }
        // 快照未携带节点内容（仅版本号等元数据）：回退独立画布接口拉完整节点，
        // 否则版本号缺失还会导致保存永远 412
        if (!canvas || canvas.nodes == null) {
          try {
            const rec = await fetchCanvasDoc(projectId);
            if (import.meta.env.DEV) {
              console.info('[canvas] canvases 回退结果:', { version: rec.version, nodeCount: rec.nodes.length });
            }
            setLegacyMigration(rec.legacyMigration ?? null);
            setDoc(rec);
            return rec.nodes;
          } catch {
            if (!preserveCurrent) setDoc(EMPTY_DOC);
            return [];
          }
        }
        const nodes = parseNodes(canvas.nodes);
        setDoc({
          id: null,
          version: canvas.version ?? null,
          viewport: safeParse<Viewport>(canvas.viewport, EMPTY_DOC.viewport),
          nodes,
          edges: safeParse<Edge[]>(canvas.edges, []),
        });
        return nodes;
      })
      .catch(() => {
        if (!preserveCurrent) setDoc(EMPTY_DOC);
        return [];
      })
      .finally(() => {
        setLoading(false);
      });
  }, [projectId]);

  // projectId 变化时重新水合（StrictMode 双挂载由快照在途去重兜底）
  useEffect(() => {
    load();
  }, [load]);

  const refetch = useCallback(() => load(true), [load]);

  /** 回写快照资产上的 material_id / material_status，二次校验只读这份字典 */
  const patchAsset = useCallback((assetId: string, patch: Partial<SnapshotAsset>) => {
    if (!assetId) return;
    setAssets((prev) => {
      const current = prev[assetId];
      if (!current) return prev;
      return { ...prev, [assetId]: { ...current, ...patch } };
    });
  }, []);

  return { doc, assets, loading, refetch, acceptDoc: setDoc, legacyMigration, patchAsset };
}
