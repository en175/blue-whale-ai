import { useCallback, useRef, type RefObject } from 'react';
import { nextDraftPosition } from '../graph/draftSpawn';
import { nodeBoxOf } from '../graph/canvasPureNodeHelpers';
import type { CanvasGraph } from './useCanvasGraph';

const DOCK_RESERVE_PX = 300;

export interface CanvasSpawnHost {
  graph: CanvasGraph;
}

export interface CanvasSpawnHandles {
  spawnPosRef: RefObject<(screenPt?: { x: number; y: number }) => { x: number; y: number }>;
  registerSpawnPosition: (fn: (screenPt?: { x: number; y: number }) => { x: number; y: number }) => void;
  spawnPosition: () => { x: number; y: number };
  spawnNearScreen: (screenPt: { x: number; y: number }) => { x: number; y: number };
  spawnDraftPosition: () => { x: number; y: number };
}

export function useCanvasSpawn(host: CanvasSpawnHost): CanvasSpawnHandles {
  const { graph } = host;
  const spawnPosRef = useRef<(screenPt?: { x: number; y: number }) => { x: number; y: number }>(
    () => ({ x: 300, y: 200 }),
  );
  const registerSpawnPosition = useCallback(
    (fn: (screenPt?: { x: number; y: number }) => { x: number; y: number }) => {
      spawnPosRef.current = fn;
    },
    [],
  );
  const spawnPosition = () => {
    const c = spawnPosRef.current();
    return {
      x: Math.round(c.x + (Math.random() * 160 - 80)),
      y: Math.round(c.y + (Math.random() * 160 - 80)),
    };
  };
  const spawnNearScreen = (screenPt: { x: number; y: number }) => {
    const center = spawnPosRef.current(screenPt);
    const nodes = graph.allNodes();
    return nextDraftPosition({ center, dockTop: center.y + 2000, nodes: nodes.map(nodeBoxOf) });
  };
  const spawnDraftPosition = () => {
    const center = spawnPosRef.current();
    const dockTop = spawnPosRef.current({ x: window.innerWidth / 2, y: window.innerHeight - DOCK_RESERVE_PX }).y;
    const nodes = graph.allNodes();
    return nextDraftPosition({ center, dockTop, nodes: nodes.map(nodeBoxOf) });
  };

  return { spawnPosRef, registerSpawnPosition, spawnPosition, spawnNearScreen, spawnDraftPosition };
}
