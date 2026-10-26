import type { Dispatch, RefObject, SetStateAction } from 'react';
import type { Node } from '@xyflow/react';
import { unifiedTextNodeText } from '@lib/contracts/text-node-markdown';
import type { MediaMention, MediaRef } from '@lib/contracts/text-node-media';
import type { CanvasGalleryRef } from '../../media/collectMediaBlocks';
import type { MediaDims } from '../../components/MediaNode/mediaContentSize';
import type { DraftCardActions } from '../tools/useCanvasDraftCardCreators';

type PickChannel = 'image' | 'video' | 'audio' | 'product' | 'asset';

type ProductChangePatch = { images?: Array<{ id: string; src: string; enabled: boolean; type?: 'image' | 'video'; assetId?: string }>; detail?: string };
type CardChangePatch = { refs?: CanvasGalleryRef[]; desc?: string; voice?: { name: string; src: string } | null };

export interface CanvasNodeAttachCallbacksHost {
  toolMode: string;
  currentId: string;
  actionsRef: RefObject<DraftCardActions>;
  removeCanvasNodes: (ids: string[]) => void;
  handleDraftError: (id: string, error: string) => void;
  setTextNodes: Dispatch<SetStateAction<Node[]>>;
  setAssetNodes: Dispatch<SetStateAction<Node[]>>;
  syncPlanEdgeBindingsOnShrink: (planNodeId: string, mentions: import('@lib/contracts/prompt-preview').PromptMention[]) => void;
  handleMediaIndexChange: (
    id: string,
    mediaMentions: MediaMention[],
    mediaRefs: MediaRef[],
    delta: { added: string[]; removed: string[] },
  ) => void;
  handleMediaDims: (id: string, dims: MediaDims) => void;
  handleAssetHoverChange: (id: string, hovered: boolean) => void;
  handleSaveMediaToAssets: (id: string) => void;
  handleSaveTextToAssets: (id: string) => void;
  handleSaveCardToAssets: (id: string) => void;
  handleSaveGoodsToAssets: (id: string) => void;
  handleProductChange: (id: string, patch: ProductChangePatch) => void;
  handleCardChange: (id: string, patch: CardChangePatch) => void;
  generationDock: { writeSelf: (kind: 'text') => void };
  dockToolCallbacks: Record<string, unknown>;
  locateTextSource: (nodeId: string) => void;
  showToast: (type: 'success' | 'error' | 'warn', msg: string) => void;
  pickers: {
    setPickMode: (mode: PickChannel | null) => void;
    setPickTarget: (target: PickChannel | null) => void;
    setPickProductId: (id: string) => void;
    setPickAssetId: (id: string) => void;
  };
}

export interface CanvasNodeAttachCallbacksHandles {
  attachCallbacks: (node: Node) => Node;
}

export function useCanvasNodeAttachCallbacks(host: CanvasNodeAttachCallbacksHost): CanvasNodeAttachCallbacksHandles {
  const {
    toolMode,
    currentId,
    actionsRef,
    removeCanvasNodes,
    handleDraftError,
    setTextNodes,
    setAssetNodes,
    syncPlanEdgeBindingsOnShrink,
    handleMediaIndexChange,
    handleMediaDims,
    handleAssetHoverChange,
    handleSaveMediaToAssets,
    handleSaveTextToAssets,
    handleSaveCardToAssets,
    handleSaveGoodsToAssets,
    handleProductChange,
    handleCardChange,
    generationDock,
    dockToolCallbacks,
    locateTextSource,
    showToast,
    pickers,
  } = host;

  const attachCallbacks = (node: Node): Node => {
    const base: Node = { ...node, position: node.position ?? { x: 0, y: 0 }, data: { ...node.data, toolMode } };
    switch (node.type) {
      case 'textNode': {
        if (typeof base.data.html === 'string') {
          base.data.text = unifiedTextNodeText(base.data);
          delete base.data.html;
        }
        base.data = {
          ...base.data,
          onDelete: (id: string) => removeCanvasNodes([id]),
          onTitleChange: (id: string, title: string) => actionsRef.current.renameCard(id, title),
          onDraftError: handleDraftError,
          onTextChange: (id: string, text: string) => setTextNodes(prev => prev.map(n => n.id === id ? { ...n, data: { ...n.data, text } } : n)),
          onPromptChange: (id: string, text: string, promptMentions: import('@lib/contracts/prompt-preview').PromptMention[], promptMaterials?: Array<import('@lib/contracts/prompt-preview').PromptMaterial & { url: string }>) => {
            setTextNodes(prev => prev.map(n => n.id === id ? { ...n, data: { ...n.data, text, promptMentions, ...(promptMaterials ? { promptMaterials } : {}) } } : n));
            syncPlanEdgeBindingsOnShrink(id, promptMentions);
          },
          onMediaIndexChange: handleMediaIndexChange,
          onToast: (type: 'success' | 'error' | 'warn', msg: string) => showToast(type, msg),
          onDuplicate: (id: string) => actionsRef.current.duplicate(id),
          onAddToChat: (id: string) => actionsRef.current.addToChat(id),
          onPaste: (id: string) => actionsRef.current.pasteAtNode(id),
          onCopyImage: (id: string) => actionsRef.current.copyImage(id),
          onComplianceCheck: (id: string) => actionsRef.current.complianceCheck(id),
          onFillEmptyShell: (id: string, file: File) => actionsRef.current.fillEmptyShell(id, file),
          onSaveToAssets: (id: string) => handleSaveTextToAssets(id),
          onWriteSelf: () => {
            generationDock.writeSelf('text');
          },
        };
        break;
      }
      case 'mediaNode':
        base.data = {
          ...base.data,
          onDelete: (id: string) => actionsRef.current.removeMediaNode(id),
          onDuplicate: (id: string) => actionsRef.current.duplicate(id),
          onTitleChange: (id: string, name: string) => actionsRef.current.renameCard(id, name),
          onAddToChat: (id: string) => actionsRef.current.addToChat(id),
          onPaste: (id: string) => actionsRef.current.pasteAtNode(id),
          onCopyImage: (id: string) => actionsRef.current.copyImage(id),
          onComplianceCheck: (id: string) => actionsRef.current.complianceCheck(id),
          onFillEmptyShell: (id: string, file: File) => actionsRef.current.fillEmptyShell(id, file),
          onCancelJob: (id: string) => actionsRef.current.cancelJob(id),
          onRetryJob: (id: string) => actionsRef.current.retryJob(id),
          onFixFollowVideo: (id: string) => actionsRef.current.fixFollowVideo(id),
          onDownload: (id: string) => actionsRef.current.download(id),
          ...dockToolCallbacks,
          onShowDetails: (id: string) => actionsRef.current.showDetails(id),
          onSaveToAssets: (id: string) => handleSaveMediaToAssets(id),
          onMediaDims: handleMediaDims,
          onLocateInputSource: (sourceNodeId: string) => locateTextSource(sourceNodeId),
        };
        break;
      case 'productNode':
        base.data = {
          ...base.data,
          projectId: currentId,
          onDelete: (id: string) => {
            removeCanvasNodes([id]);
          },
          onAddToChat: (id: string) => actionsRef.current.addToChat(id),
          onPaste: (id: string) => actionsRef.current.pasteAtNode(id),
          onCopyImage: (id: string) => actionsRef.current.copyImage(id),
          onComplianceCheck: (id: string) => actionsRef.current.complianceCheck(id),
          onFillEmptyShell: (id: string, file: File) => actionsRef.current.fillEmptyShell(id, file),
          onSaveToAssets: (id: string) => handleSaveGoodsToAssets(id),
          onProductChange: (id: string, patch: ProductChangePatch) => handleProductChange(id, patch),
          onPickFromCanvas: (id: string) => {
            pickers.setPickMode('product');
            pickers.setPickTarget('product');
            pickers.setPickProductId(id);
          },
        };
        break;
      case 'assetNode':
        base.data = {
          ...base.data,
          projectId: currentId,
          onHoverChange: handleAssetHoverChange,
          onDelete: (id: string) => {
            setAssetNodes((prev) => prev.filter((n) => n.id !== id));
          },
          onAddToChat: (id: string) => actionsRef.current.addToChat(id),
          onPaste: (id: string) => actionsRef.current.pasteAtNode(id),
          onCopyImage: (id: string) => actionsRef.current.copyImage(id),
          onComplianceCheck: (id: string) => actionsRef.current.complianceCheck(id),
          onFillEmptyShell: (id: string, file: File) => actionsRef.current.fillEmptyShell(id, file),
          onGenerateImage: () => actionsRef.current.openImageDialog(),
          onSaveToAssets: (id: string) => handleSaveCardToAssets(id),
          onCardChange: (id: string, patch: CardChangePatch) => handleCardChange(id, patch),
          onPickFromCanvas: (id: string) => {
            pickers.setPickMode('asset');
            pickers.setPickTarget('asset');
            pickers.setPickAssetId(id);
          },
        };
        break;
      default:
        break;
    }
    return base;
  };

  return { attachCallbacks };
}
