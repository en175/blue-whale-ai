"use client";

import { useEffect } from "react";

import type { CanvasNode } from "../model";

type LoadedCanvasDoc = {
  nodes: CanvasNode[];
  edges: unknown[];
  viewport: { x: number; y: number; zoom: number };
};

export type CanvasProjectHydrationDeps = {
  projectId: string;
  loadDoc(projectId: string): Promise<LoadedCanvasDoc>;
  hydrate(nodes: CanvasNode[]): Promise<void>;
};

export function useCanvasProjectHydration({
  projectId,
  loadDoc,
  hydrate,
}: CanvasProjectHydrationDeps): void {
  useEffect(() => {
    if (!projectId) return;
    let cancelled = false;

    void (async () => {
      try {
        const doc = await loadDoc(projectId);
        if (cancelled) return;
        await hydrate(doc.nodes);
      } catch (error) {
        if (!cancelled) console.warn("[canvas] project hydration failed", error);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [hydrate, loadDoc, projectId]);
}
