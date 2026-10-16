import { useEffect, useRef } from 'react';
import type { Dispatch, RefObject, SetStateAction } from 'react';
import type { Node } from '@xyflow/react';
import type { CanvasHistoryApi } from './useCanvasHistory';
import type { MediaMention } from '@lib/contracts/text-node-media';
import { readCanvasClipboard } from './clipboardPaste';
import { newNodeId } from '../graph/nodeId';

interface CanvasClipboardSnapshot {
  kind: 'text' | 'media';
  position: { x: number; y: number };
  data: Record<string, unknown>;
}

const CLIPBOARD_PASTE_STAIR_PX = 40;

export interface CanvasClipboardHost {
  currentId: string;
  textNodesRef: RefObject<Node[]>;
  mediaNodesRef: RefObject<Node[]>;
  setTextNodes: Dispatch<SetStateAction<Node[]>>;
  setMediaNodes: Dispatch<SetStateAction<Node[]>>;
  pendingNodeIdsRef: RefObject<Set<string>>;
  historyRef: RefObject<CanvasHistoryApi | null>;
  spawnPosRef: RefObject<(screenPt?: { x: number; y: number }) => { x: number; y: number }>;
  attachCallbacks: (node: Node) => Node;
  findCanvasNode: (id: string) => Node | undefined;
  syncTextIndexEdges: (textId: string, delta: { added: string[]; removed: string[] }) => void;
  setSelectManyRequest: Dispatch<SetStateAction<{ ids: string[]; ts: number } | null>>;
  placeFileOnCanvas: (
    file: File,
    opts?: { position?: { x: number; y: number }; replaceNodeId?: string },
  ) => Promise<{ asset_id: string; url: string; nodeId: string }>;
  handleAddTextNode: (position?: { x: number; y: number }, text?: string) => string;
}

export interface CanvasClipboardHandles {
  handleCopySelectedNodes: (ids: string[]) => void;
  handlePasteClipboard: () => void;
}

export function useCanvasClipboard(host: CanvasClipboardHost): CanvasClipboardHandles {
  const {
    currentId,
    textNodesRef,
    mediaNodesRef,
    setTextNodes,
    setMediaNodes,
    pendingNodeIdsRef,
    historyRef,
    spawnPosRef,
    attachCallbacks,
    findCanvasNode,
    syncTextIndexEdges,
    setSelectManyRequest,
    placeFileOnCanvas,
    handleAddTextNode,
  } = host;
  const clipboardSnapshotRef = useRef<CanvasClipboardSnapshot[]>([]);
  const clipboardPasteOffsetRef = useRef(0);
  const prevProjectIdRef = useRef(currentId);
  useEffect(() => {
    const prev = prevProjectIdRef.current;
    prevProjectIdRef.current = currentId;
    if (!prev || prev === currentId) return;
    clipboardSnapshotRef.current = [];
    clipboardPasteOffsetRef.current = 0;
  }, [currentId]);

  const nextPasteAnchor = (): { x: number; y: number } => {
    const stair = CLIPBOARD_PASTE_STAIR_PX * clipboardPasteOffsetRef.current;
    clipboardPasteOffsetRef.current += 1;
    const anchor = spawnPosRef.current();
    return { x: anchor.x + stair, y: anchor.y + stair };
  };

  const handleCopySelectedNodes = (ids: string[]) => {
    const idSet = new Set(ids);
    const picked: Node[] = [
      ...textNodesRef.current.filter((n) => idSet.has(n.id)),
      ...mediaNodesRef.current.filter((n) => idSet.has(n.id)),
    ];
    if (picked.length === 0) return;
    clipboardSnapshotRef.current = picked.map((n) => ({
      kind: n.type === 'mediaNode' ? ('media' as const) : ('text' as const),
      position: { ...n.position },
      data: JSON.parse(JSON.stringify(n.data ?? {})) as Record<string, unknown>,
    }));
    clipboardPasteOffsetRef.current = 0;
  };

  const handlePasteClipboard = () => {
    if (clipboardSnapshotRef.current.length === 0) {
      void pasteFromSystemClipboard();
      return;
    }
    const snapshot = clipboardSnapshotRef.current;
    const anchor = nextPasteAnchor();
    const minX = Math.min(...snapshot.map((s) => s.position.x));
    const minY = Math.min(...snapshot.map((s) => s.position.y));
    const textCopies: Node[] = [];
    const mediaCopies: Node[] = [];
    const newIds: string[] = [];
    snapshot.forEach((s) => {
      const position = {
        x: Math.round(anchor.x + (s.position.x - minX)),
        y: Math.round(anchor.y + (s.position.y - minY)),
      };
      const data = JSON.parse(JSON.stringify(s.data)) as Record<string, unknown>;
      delete data.generationRecovery;
      if (s.kind === 'text') {
        delete data.promptSource;
        delete data.promptMaterials;
        delete data.promptMentions;
        delete data.promptOriginalTitle;
        const copy = attachCallbacks({ id: newNodeId('text'), type: 'textNode', position, data });
        textCopies.push(copy);
        newIds.push(copy.id);
      } else {
        const copy = attachCallbacks({ id: newNodeId('media'), type: 'mediaNode', position, data });
        mediaCopies.push(copy);
        newIds.push(copy.id);
      }
    });
    newIds.forEach((id) => pendingNodeIdsRef.current.add(id));
    historyRef.current?.pushAddNodes(newIds);
    if (textCopies.length > 0) setTextNodes((prev) => [...prev, ...textCopies]);
    if (mediaCopies.length > 0) setMediaNodes((prev) => [...prev, ...mediaCopies]);
    textCopies.forEach((copy) => {
      const mentionedSources = [...new Set(((copy.data.mediaMentions ?? []) as MediaMention[]).map(mention => mention.nodeId))]
        .filter(source => findCanvasNode(source));
      if (mentionedSources.length > 0) syncTextIndexEdges(copy.id, { added: mentionedSources, removed: [] });
    });
    setSelectManyRequest({ ids: newIds, ts: Date.now() });
  };

  const pasteFromSystemClipboard = async () => {
    const payload = await readCanvasClipboard();
    if (!payload) return;
    const anchor = nextPasteAnchor();
    const position = { x: Math.round(anchor.x), y: Math.round(anchor.y) };
    if (payload.kind === 'image') {
      await placeFileOnCanvas(payload.file, { position })
        .then((done) => setSelectManyRequest({ ids: [done.nodeId], ts: Date.now() }))
        .catch(() => undefined);
      return;
    }
    const nodeId = handleAddTextNode(position, payload.text);
    setSelectManyRequest({ ids: [nodeId], ts: Date.now() });
  };

  return { handleCopySelectedNodes, handlePasteClipboard };
}
