import { useCallback, useEffect, useRef, useState } from 'react';
import type { Edge, Node, Viewport } from '@xyflow/react';
import { fetchProjectSnapshot, type SnapshotAsset } from '@/app/api/projects';
import { fetchCanvasDoc, type CanvasDoc, type LegacyMigrationReport } from '@/app/api/canvas';

const EMPTY_DOC: CanvasDoc = {
  id: null,
  version: null,
  viewport: { x: 0, y: 0, zoom: 1.1 },
  nodes: [],
  edges: [],
};

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

function parseNodes(raw: unknown): Node[] {
  return safeParse<Node[]>(raw, []).map((n) => ({
    ...n,
    position: n.position ?? { x: 0, y: 0 },
    data: n.data ?? {},
  }));
}

export function useCanvasDoc(projectId: string) {
  const [doc, setDoc] = useState<CanvasDoc | null>(null);
  const [docProjectId, setDocProjectId] = useState<string | null>(null);
  const [assets, setAssets] = useState<Record<string, SnapshotAsset>>({});
  const [loading, setLoading] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [legacyMigration, setLegacyMigration] = useState<LegacyMigrationReport | null>(null);
  const activeProjectRef = useRef(projectId);
  activeProjectRef.current = projectId;
  const loadSerialRef = useRef(0);

  const load = useCallback((preserveCurrent = false): Promise<Node[]> => {
    if (activeProjectRef.current !== projectId) return Promise.resolve([]);
    const serial = ++loadSerialRef.current;
    const isCurrent = () => activeProjectRef.current === projectId && loadSerialRef.current === serial;
    if (!projectId) {
      setDoc(null);
      setDocProjectId(null);
      setAssets({});
      setLegacyMigration(null);
      setLoadFailed(false);
      return Promise.resolve([]);
    }
    if (!preserveCurrent) {
      setDoc(null);
      setDocProjectId(null);
      setLoadFailed(false);
    }
    setLoading(true);
    return fetchProjectSnapshot(projectId)
      .then(async (snap) => {
        if (!isCurrent()) return [];
        setLoadFailed(false);
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
        if (!canvas || canvas.nodes == null) {
          try {
            const rec = await fetchCanvasDoc(projectId);
            if (!isCurrent()) return [];
            if (import.meta.env.DEV) {
              console.info('[canvas] canvases 回退结果:', { version: rec.version, nodeCount: rec.nodes.length });
            }
            setLegacyMigration(rec.legacyMigration ?? null);
            setLoadFailed(false);
            setDocProjectId(projectId);
            setDoc(rec);
            return rec.nodes;
          } catch {
            if (isCurrent()) {
              setLoadFailed(true);
              if (!preserveCurrent) {
                setDocProjectId(projectId);
                setDoc(EMPTY_DOC);
              }
            }
            return [];
          }
        }
        const nodes = parseNodes(canvas.nodes);
        setDocProjectId(projectId);
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
        if (isCurrent()) {
          setLoadFailed(true);
          if (!preserveCurrent) {
            setDocProjectId(projectId);
            setDoc(EMPTY_DOC);
          }
        }
        return [];
      })
      .finally(() => {
        if (isCurrent()) setLoading(false);
      });
  }, [projectId]);

  useEffect(() => {
    load();
  }, [load]);

  const refetch = useCallback(() => load(true), [load]);

  const patchAsset = useCallback((assetId: string, patch: Partial<SnapshotAsset>) => {
    if (!assetId) return;
    setAssets((prev) => {
      const current = prev[assetId];
      if (!current) return prev;
      return { ...prev, [assetId]: { ...current, ...patch } };
    });
  }, []);

  const upsertAssets = useCallback((items: SnapshotAsset[]) => {
    if (items.length === 0) return;
    setAssets((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const item of items) {
        const key = String(item.asset_id);
        const existing = next[key];
        if (!existing) {
          next[key] = item;
          changed = true;
        } else if (
          existing.access_url !== item.access_url ||
          existing.width !== item.width ||
          existing.height !== item.height ||
          existing.material_id !== item.material_id ||
          existing.material_status !== item.material_status
        ) {
          next[key] = { ...existing, ...item };
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, []);

  return { doc: docProjectId === projectId ? doc : null, assets, loading, loadFailed, refetch, acceptDoc: setDoc, legacyMigration, patchAsset, upsertAssets };
}
