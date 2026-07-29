"use client";

import { useEffect, useState } from "react";

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
  retryKey?: number;
};

export type CanvasProjectHydrationState = "loading" | "ready" | "error";

export function useCanvasProjectHydration({
  projectId,
  loadDoc,
  hydrate,
  retryKey = 0,
}: CanvasProjectHydrationDeps): CanvasProjectHydrationState {
  const [state, setState] = useState<{
    projectId: string;
    status: CanvasProjectHydrationState;
  }>({ projectId, status: "loading" });

  useEffect(() => {
    if (!projectId) return;
    let cancelled = false;
    // A project/retry transition must gate editing until both phases finish.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setState({ projectId, status: "loading" });

    void (async () => {
      try {
        const doc = await loadDoc(projectId);
        if (cancelled) return;
        await hydrate(doc.nodes);
        if (!cancelled) setState({ projectId, status: "ready" });
      } catch (error) {
        if (!cancelled) {
          console.warn("[canvas] project hydration failed", error);
          setState({ projectId, status: "error" });
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [hydrate, loadDoc, projectId, retryKey]);

  return state.projectId === projectId ? state.status : "loading";
}
