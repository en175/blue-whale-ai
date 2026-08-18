/* ============================================
 * useCanvasDoc 钩子：画布水合 —— GET /api/projects/:id/snapshot
 * 一次拉取项目快照，提取画布（节点 + 视口 + 版本号）与资产字典；
 * 加载失败静默降级为空画布，不阻断画布操作
 * ============================================ */
import { useCallback, useEffect, useState } from 'react';
import type { Node, Viewport } from '@xyflow/react';
import { fetchProjectSnapshot, type SnapshotAsset } from '@/api/projects';
import { fetchCanvasDoc, type CanvasDoc } from '@/api/canvas';

/** 空画布文档（无记录/加载失败时使用） */
const EMPTY_DOC: CanvasDoc = {
  id: null,
  version: null,
  viewport: { x: 0, y: 0, zoom: 1.1 },
  nodes: [],
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

  /** 拉取快照并水合；保存版本冲突（412）时调用方可手动重新加载 */
  const load = useCallback(() => {
    if (!projectId) {
      setDoc(null);
      setAssets({});
      return;
    }
    setDoc(null);
    setLoading(true);
    fetchProjectSnapshot(projectId)
      .then(async (snap) => {
        setAssets(snap.assets ?? {});
        const canvas = snap.canvas;
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
            setDoc(rec);
          } catch {
            setDoc(EMPTY_DOC);
          }
          return;
        }
        setDoc({
          id: null,
          version: canvas.version ?? null,
          viewport: safeParse<Viewport>(canvas.viewport, EMPTY_DOC.viewport),
          nodes: parseNodes(canvas.nodes),
        });
      })
      .catch(() => {
        setDoc(EMPTY_DOC);
      })
      .finally(() => {
        setLoading(false);
      });
  }, [projectId]);

  // projectId 变化时重新水合（StrictMode 双挂载由快照在途去重兜底）
  useEffect(() => {
    load();
  }, [load]);

  return { doc, assets, loading, refetch: load };
}
