import { type ToolMode } from '@/custom/enums';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useEdgesState, type Edge, type Node } from '@xyflow/react';
import { type MediaDims } from '../components/MediaNode/mediaContentSize';
import { type ImageTextAttachment } from '../components/ImageDialog';
import { textAttachmentsOf as textAttachmentsOfPure, textAttachmentsForSend as textAttachmentsForSendPure } from '../textAttachments';
import { type CanvasGroup } from '../canvasGroups';
import { useCanvasGraph } from './useCanvasGraph';

export function useCanvasDocument(toolMode: ToolMode, submittingNodeId: string | null) {
  const [textNodes, setTextNodes] = useState<Node[]>([]);
  const [mediaNodes, setMediaNodes] = useState<Node[]>([]);
  const [productNodes, setProductNodes] = useState<Node[]>([]);
  const [assetNodes, setAssetNodes] = useState<Node[]>([]);
  const mediaNodesRef = useRef<Node[]>([]);
  mediaNodesRef.current = mediaNodes;
  const textNodesRef = useRef<Node[]>([]);
  textNodesRef.current = textNodes;
  const productNodesRef = useRef<Node[]>([]);
  productNodesRef.current = productNodes;
  const assetNodesRef = useRef<Node[]>([]);
  assetNodesRef.current = assetNodes;
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const edgesRef = useRef<Edge[]>([]);
  edgesRef.current = edges;
  const [groups, setGroups] = useState<CanvasGroup[]>([]);
  const groupsRef = useRef<CanvasGroup[]>([]);
  groupsRef.current = groups;
  const graph = useCanvasGraph({
    textNodesRef,
    mediaNodesRef,
    productNodesRef,
    assetNodesRef,
    setTextNodes,
    setMediaNodes,
    setProductNodes,
    setAssetNodes,
  });
  const findCanvasNode = useCallback((id: string): Node | undefined => graph.findNode(id), [graph]);
  useEffect(() => {
    graph.setAll((prev) =>
      prev.map((n) => ({ ...n, data: { ...n.data, toolMode } }))
    );
  }, [toolMode, graph]);
  const patchMediaNode = (nodeId: string, patch: Record<string, unknown>) => {
    graph.patchNode(nodeId, patch);
  };
  const isGeneratingNode = (id: string) =>
    id === submittingNodeId || mediaNodesRef.current.some(
      (n) => n.id === id && (n.data as Record<string, unknown> | undefined)?.genStatus === 'generating',
    );
  const textAttachmentsOf = (targetNodeId: string): ImageTextAttachment[] =>
    textAttachmentsOfPure(targetNodeId, edgesRef.current, textNodesRef.current);
  const textAttachmentsForSend = (targetNodeId: string): ImageTextAttachment[] =>
    textAttachmentsForSendPure(targetNodeId, edgesRef.current, textNodesRef.current);
  const handleMediaDims = (nodeId: string, dims: MediaDims) => {
    const node = mediaNodesRef.current.find((n) => n.id === nodeId);
    if (!node) return;
    const data = (node.data ?? {}) as Record<string, unknown>;
    const patch: Record<string, unknown> = {};
    if (typeof dims.width === 'number' && dims.width > 0 && data.width !== dims.width) {
      patch.width = dims.width;
    }
    if (typeof dims.height === 'number' && dims.height > 0 && data.height !== dims.height) {
      patch.height = dims.height;
    }
    if (typeof dims.duration === 'number' && dims.duration > 0 && typeof data.duration !== 'number') {
      patch.duration = dims.duration;
    }
    if (Object.keys(patch).length === 0) return;
    patchMediaNode(nodeId, patch);
  };
  return {
    textNodes, setTextNodes, textNodesRef,
    mediaNodes, setMediaNodes, mediaNodesRef,
    productNodes, setProductNodes, productNodesRef,
    assetNodes, setAssetNodes, assetNodesRef,
    edges, setEdges, onEdgesChange, edgesRef,
    groups, setGroups, groupsRef,
    graph, findCanvasNode, patchMediaNode, handleMediaDims, isGeneratingNode,
    textAttachmentsOf, textAttachmentsForSend,
  };
}
