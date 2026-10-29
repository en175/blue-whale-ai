import type { Dispatch, RefObject, SetStateAction } from 'react';
import type { Node } from '@xyflow/react';
import type { MediaMention } from '@lib/contracts/text-node-media';
import { newNodeId } from '../../graph/nodeId';
import type { DraftCardActions } from '../tools/useCanvasDraftCardCreators';

export interface CanvasTextNodeFactoriesHost {
  toolMode: string;
  textNodesRef: RefObject<Node[]>;
  mediaNodesRef: RefObject<Node[]>;
  pendingNodeIdsRef: RefObject<Set<string>>;
  historyRef: RefObject<{ pushAddNodes: (ids: string[]) => void } | null>;
  getActions: () => DraftCardActions;
  spawnPosition: () => { x: number; y: number };
  findCanvasNode: (id: string) => Node | undefined;
  removeCanvasNodes: (ids: string[]) => void;
  handleDraftError: (id: string, error: string) => void;
  handleMediaIndexChange: (id: string, mediaMentions: MediaMention[], mediaRefs: import('@lib/contracts/text-node-media').MediaRef[], delta: { added: string[]; removed: string[] }) => void;
  syncTextIndexEdges: (textId: string, delta: { added: string[]; removed: string[] }) => void;
  showToast: (type: 'success' | 'error' | 'warn', msg: string) => void;
  setTextNodes: Dispatch<SetStateAction<Node[]>>;
  setMediaNodes: Dispatch<SetStateAction<Node[]>>;
}

export interface CanvasTextNodeFactoriesHandles {
  handleAddTextNode: (position?: { x: number; y: number }, text?: string) => string;
  handleDuplicateNode: (id: string) => void;
  renameCard: (id: string, name: string) => void;
}

export function useCanvasTextNodeFactories(host: CanvasTextNodeFactoriesHost): CanvasTextNodeFactoriesHandles {
  const {
    toolMode,
    textNodesRef,
    mediaNodesRef,
    pendingNodeIdsRef,
    historyRef,
    getActions,
    spawnPosition,
    findCanvasNode,
    removeCanvasNodes,
    handleDraftError,
    handleMediaIndexChange,
    syncTextIndexEdges,
    showToast,
    setTextNodes,
    setMediaNodes,
  } = host;

  const handleAddTextNode = (position?: { x: number; y: number }, text?: string): string => {
    const newNode: Node = {
      id: newNodeId('text'),
      type: 'textNode',
      position: position ?? spawnPosition(),
      data: {
        text: text ?? '',
        onDraftError: handleDraftError,
        toolMode,
        onDelete: (id: string) => removeCanvasNodes([id]),
        onTextChange: (id: string, text: string) => {
          setTextNodes((prev) =>
            prev.map((n) => (n.id === id ? { ...n, data: { ...n.data, text } } : n))
          );
        },
        onMediaIndexChange: handleMediaIndexChange,
        onDuplicate: (id: string) => getActions().duplicate(id),
        onTitleChange: (id: string, name: string) => getActions().renameCard(id, name),
        onAddToChat: (id: string) => getActions().addToChat(id),
        onPaste: (id: string) => getActions().pasteAtNode(id),
        onToast: (type: 'success' | 'error' | 'warn', msg: string) => showToast(type, msg),
      },
    };
    pendingNodeIdsRef.current.add(newNode.id);
    historyRef.current?.pushAddNodes([newNode.id]);
    setTextNodes((prev) => [...prev, newNode]);
    return newNode.id;
  };
  const handleDuplicateNode = (id: string) => {
    const t = textNodesRef.current.find((n) => n.id === id);
    if (t) {
      const copy: Node = { ...t, id: newNodeId('text'), position: { x: t.position.x + 40, y: t.position.y + 40 }, data: { ...t.data } };
      delete copy.data.promptSource;
      delete copy.data.promptMaterials;
      delete copy.data.promptMentions;
      delete copy.data.promptOriginalTitle;
      pendingNodeIdsRef.current.add(copy.id);
      historyRef.current?.pushAddNodes([copy.id]);
      setTextNodes((prev) => [...prev, copy]);
      const mentionedSources = [...new Set(((copy.data.mediaMentions ?? []) as MediaMention[]).map(mention => mention.nodeId))]
        .filter(source => findCanvasNode(source));
      if (mentionedSources.length > 0) syncTextIndexEdges(copy.id, { added: mentionedSources, removed: [] });
      return;
    }
    const m = mediaNodesRef.current.find((n) => n.id === id);
    if (m) {
      const copy: Node = { ...m, id: newNodeId('media'), position: { x: m.position.x + 40, y: m.position.y + 40 }, data: { ...m.data } };
      delete (copy.data as Record<string, unknown>).generationRecovery;
      pendingNodeIdsRef.current.add(copy.id);
      historyRef.current?.pushAddNodes([copy.id]);
      setMediaNodes((prev) => [...prev, copy]);
    }
  };
  const renameCard = (id: string, name: string) => {
    if (textNodesRef.current.some((n) => n.id === id)) {
      setTextNodes((prev) => prev.map((n) => (n.id === id ? { ...n, data: { ...n.data, title: name, customName: true } } : n)));
      return;
    }
    if (mediaNodesRef.current.some((n) => n.id === id)) {
      setMediaNodes((prev) => prev.map((n) => (n.id === id ? { ...n, data: { ...n.data, fileName: name, customName: true } } : n)));
    }
  };

  return { handleAddTextNode, handleDuplicateNode, renameCard };
}
