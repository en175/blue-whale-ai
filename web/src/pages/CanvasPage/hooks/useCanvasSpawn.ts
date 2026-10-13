import { useCallback, useRef, type RefObject } from 'react';
import type { Node } from '@xyflow/react';
import { nextDraftPosition } from '../draftSpawn';
import { nodeBoxOf } from '../canvasPureNodeHelpers';

const DOCK_RESERVE_PX = 300;

export interface CanvasSpawnHost {
  textNodesRef: RefObject<Node[]>;
  mediaNodesRef: RefObject<Node[]>;
  productNodesRef: RefObject<Node[]>;
  assetNodesRef: RefObject<Node[]>;
}

export interface CanvasSpawnHandles {
  spawnPosRef: RefObject<(screenPt?: { x: number; y: number }) => { x: number; y: number }>;
  registerSpawnPosition: (fn: (screenPt?: { x: number; y: number }) => { x: number; y: number }) => void;
  spawnPosition: () => { x: number; y: number };
  spawnNearScreen: (screenPt: { x: number; y: number }) => { x: number; y: number };
  spawnDraftPosition: () => { x: number; y: number };
}

export function useCanvasSpawn(host: CanvasSpawnHost): CanvasSpawnHandles {
  const { textNodesRef, mediaNodesRef, productNodesRef, assetNodesRef } = host;
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
    const nodes = [...textNodesRef.current, ...mediaNodesRef.current, ...productNodesRef.current, ...assetNodesRef.current];
    return nextDraftPosition({ center, dockTop: center.y + 2000, nodes: nodes.map(nodeBoxOf) });
  };
  const spawnDraftPosition = () => {
    const center = spawnPosRef.current();
    const dockTop = spawnPosRef.current({ x: window.innerWidth / 2, y: window.innerHeight - DOCK_RESERVE_PX }).y;
    const nodes = [...textNodesRef.current, ...mediaNodesRef.current, ...productNodesRef.current, ...assetNodesRef.current];
    return nextDraftPosition({ center, dockTop, nodes: nodes.map(nodeBoxOf) });
  };

  return { spawnPosRef, registerSpawnPosition, spawnPosition, spawnNearScreen, spawnDraftPosition };
}
