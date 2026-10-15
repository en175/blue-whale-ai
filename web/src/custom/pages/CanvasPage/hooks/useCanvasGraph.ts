import { useMemo, type Dispatch, type RefObject, type SetStateAction } from 'react';
import type { Node } from '@xyflow/react';

export type CanvasNodeKind = 'text' | 'media' | 'product' | 'asset';

type NodeUpdater = Dispatch<SetStateAction<Node[]>>;
type NodeTransform = (prev: Node[]) => Node[];

export interface CanvasGraph {
  findNode(id: string): Node | undefined;
  allNodes(): Node[];
  nodesByType(type: CanvasNodeKind): Node[];
  patchNode(id: string, patch: Record<string, unknown>): void;
  setAll(transform: NodeTransform): void;
}

export interface CanvasGraphHost {
  textNodesRef: RefObject<Node[]>;
  mediaNodesRef: RefObject<Node[]>;
  productNodesRef: RefObject<Node[]>;
  assetNodesRef: RefObject<Node[]>;
  setTextNodes: NodeUpdater;
  setMediaNodes: NodeUpdater;
  setProductNodes: NodeUpdater;
  setAssetNodes: NodeUpdater;
}

export function createCanvasGraph(host: CanvasGraphHost): CanvasGraph {
  const {
    textNodesRef,
    mediaNodesRef,
    productNodesRef,
    assetNodesRef,
    setTextNodes,
    setMediaNodes,
    setProductNodes,
    setAssetNodes,
  } = host;
  const nodesByType = (type: CanvasNodeKind): Node[] => {
    switch (type) {
      case 'text':
        return textNodesRef.current;
      case 'media':
        return mediaNodesRef.current;
      case 'product':
        return productNodesRef.current;
      case 'asset':
        return assetNodesRef.current;
    }
  };
  const findNode = (id: string): Node | undefined =>
    mediaNodesRef.current.find((n) => n.id === id) ??
    textNodesRef.current.find((n) => n.id === id) ??
    productNodesRef.current.find((n) => n.id === id) ??
    assetNodesRef.current.find((n) => n.id === id);
  const patchNode = (id: string, patch: Record<string, unknown>): void => {
    const apply = (prev: Node[]): Node[] => {
      let touched = false;
      const next = prev.map((n) => {
        if (n.id !== id) return n;
        touched = true;
        return { ...n, data: { ...n.data, ...patch } };
      });
      return touched ? next : prev;
    };
    setMediaNodes(apply);
    setTextNodes(apply);
    setProductNodes(apply);
    setAssetNodes(apply);
  };
  const allNodes = (): Node[] => [
    ...textNodesRef.current,
    ...mediaNodesRef.current,
    ...productNodesRef.current,
    ...assetNodesRef.current,
  ];
  const setAll = (transform: NodeTransform): void => {
    setTextNodes(transform);
    setMediaNodes(transform);
    setProductNodes(transform);
    setAssetNodes(transform);
  };
  return { findNode, allNodes, nodesByType, patchNode, setAll };
}

export function useCanvasGraph(host: CanvasGraphHost): CanvasGraph {
  const {
    textNodesRef,
    mediaNodesRef,
    productNodesRef,
    assetNodesRef,
    setTextNodes,
    setMediaNodes,
    setProductNodes,
    setAssetNodes,
  } = host;
  return useMemo(
    () =>
      createCanvasGraph({
        textNodesRef,
        mediaNodesRef,
        productNodesRef,
        assetNodesRef,
        setTextNodes,
        setMediaNodes,
        setProductNodes,
        setAssetNodes,
      }),
    [
      textNodesRef,
      mediaNodesRef,
      productNodesRef,
      assetNodesRef,
      setTextNodes,
      setMediaNodes,
      setProductNodes,
      setAssetNodes,
    ],
  );
}
