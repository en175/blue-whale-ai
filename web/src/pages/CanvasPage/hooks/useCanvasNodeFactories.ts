import { type Dispatch, type RefObject, type SetStateAction } from 'react';
import type { Node } from '@xyflow/react';
import { unifiedTextNodeText } from '@lib/contracts/text-node-markdown';
import { type MediaMention, type MediaRef } from '@lib/contracts/text-node-media';
import { type SharedAssetView } from '@/api/sharedAssets';
import type { AssetCardKind } from '../components/AssetCardNode';
import type { CanvasGalleryRef } from '../collectMediaBlocks';
import type { MediaDims } from '../components/MediaNode/mediaContentSize';

type PickChannel = 'image' | 'video' | 'audio' | 'product' | 'asset';

type ProductChangePatch = { images?: Array<{ id: string; src: string; enabled: boolean; type?: 'image' | 'video'; assetId?: string }>; detail?: string };
type CardChangePatch = { refs?: CanvasGalleryRef[]; desc?: string; voice?: { name: string; src: string } | null };

export interface CanvasNodeActions {
  addToChat: (id: string) => void;
  removeMediaNode: (id: string) => void;
  duplicate: (id: string) => void;
  renameCard: (id: string, name: string) => void;
  pasteAtNode: (id: string) => void;
  copyImage: (id: string) => void;
  complianceCheck: (id: string) => void;
  fillEmptyShell: (id: string, file: File) => void;
  download: (id: string) => void;
  openImageDialog: () => void;
  showDetails: (id: string) => void;
}

export interface CanvasNodeFactoriesHost {
  newNodeId: (kind: string) => string;
  spawnPosition: () => { x: number; y: number };
  toolMode: 'drag' | 'select';
  currentId: string | undefined;
  productSeq: RefObject<number>;
  pendingNodeIdsRef: RefObject<Set<string>>;
  actionsRef: RefObject<CanvasNodeActions>;
  setTextNodes: Dispatch<SetStateAction<Node[]>>;
  setMediaNodes: Dispatch<SetStateAction<Node[]>>;
  setProductNodes: Dispatch<SetStateAction<Node[]>>;
  setAssetNodes: Dispatch<SetStateAction<Node[]>>;
  removeCanvasNodes: (ids: string[]) => void;
  handleMediaIndexChange: (id: string, mediaMentions: MediaMention[], mediaRefs: MediaRef[], delta: { added: string[]; removed: string[] }) => void;
  handleMediaDims: (id: string, dims: MediaDims) => void;
  handleAssetHoverChange: (id: string, hovered: boolean) => void;
  handleSaveMediaToAssets: (id: string) => void;
  handleSaveTextToAssets: (id: string) => void;
  handleSaveCardToAssets: (id: string) => void;
  handleSaveGoodsToAssets: (id: string) => void;
  dockToolCallbacks: Record<string, unknown>;
  showToast: (type: 'success' | 'error' | 'warn', msg: string) => void;
  pickers: {
    setPickMode: (mode: PickChannel | null) => void;
    setPickTarget: (target: PickChannel | null) => void;
    setPickProductId: (id: string) => void;
    setPickAssetId: (id: string) => void;
  };
}

export function useCanvasNodeFactories(host: CanvasNodeFactoriesHost) {
  const {
    newNodeId, spawnPosition, toolMode, currentId, productSeq, pendingNodeIdsRef,
    actionsRef, setTextNodes, setMediaNodes, setProductNodes, setAssetNodes,
    removeCanvasNodes, handleMediaIndexChange, handleMediaDims, handleAssetHoverChange,
    handleSaveMediaToAssets, handleSaveTextToAssets, handleSaveCardToAssets, handleSaveGoodsToAssets,
    dockToolCallbacks, showToast, pickers,
  } = host;

  const handleProductChange = (
    nodeId: string,
    patch: ProductChangePatch,
  ) => {
    setProductNodes((prev) =>
      prev.map((n) =>
        n.id === nodeId
          ? {
              ...n,
              data: {
                ...n.data,
                ...(patch.images !== undefined ? { images: patch.images } : {}),
                ...(patch.detail !== undefined ? { detail: patch.detail } : {}),
              },
            }
          : n,
      ),
    );
  };

  const handleCardChange = (
    nodeId: string,
    patch: CardChangePatch,
  ) => {
    setAssetNodes((prev) =>
      prev.map((n) =>
        n.id === nodeId
          ? {
              ...n,
              data: {
                ...n.data,
                ...(patch.refs !== undefined ? { initialRefs: patch.refs } : {}),
                ...(patch.desc !== undefined ? { initialDesc: patch.desc } : {}),
                ...(patch.voice !== undefined ? { voice: patch.voice } : {}),
              },
            }
          : n,
      ),
    );
  };

  const handleCreateProduct = () => {
    productSeq.current += 1;
    const node: Node = {
      id: newNodeId('product'),
      type: 'productNode',
      position: spawnPosition(),
      data: {
        name: `商品 ${productSeq.current}`,
        detail: '',
        images: [],
        toolMode,
        projectId: currentId,
        onDelete: (id: string) => {
          setProductNodes((prev) => prev.filter((n) => n.id !== id));
        },
        onAddToChat: (id: string) => actionsRef.current.addToChat(id),
        onSaveToAssets: (id: string) => handleSaveGoodsToAssets(id),
        onProductChange: (id: string, patch: ProductChangePatch) => handleProductChange(id, patch),
        onPickFromCanvas: (id: string) => {
          pickers.setPickMode('product');
          pickers.setPickTarget('product');
          pickers.setPickProductId(id);
        },
        onToast: (type: 'success' | 'error' | 'warn', msg: string) => showToast(type, msg),
      },
    };
    pendingNodeIdsRef.current.add(node.id);
    setProductNodes((prev) => [...prev, node]);
  };

  const handleCreateAssetCard = (kind: AssetCardKind) => {
    const node: Node = {
      id: newNodeId(`asset-${kind}`),
      type: 'assetNode',
      position: spawnPosition(),
      data: {
        kind,
        toolMode,
        projectId: currentId,
        onHoverChange: handleAssetHoverChange,
        onDelete: (id: string) => {
          setAssetNodes((prev) => prev.filter((n) => n.id !== id));
        },
        onAddToChat: (id: string) => actionsRef.current.addToChat(id),
        onGenerateImage: () => actionsRef.current.openImageDialog(),
        onSaveToAssets: (id: string) => handleSaveCardToAssets(id),
        onCardChange: (id: string, patch: CardChangePatch) => handleCardChange(id, patch),
        onPickFromCanvas: (id: string) => {
          pickers.setPickMode('asset');
          pickers.setPickTarget('asset');
          pickers.setPickAssetId(id);
        },
        onToast: (type: 'success' | 'error' | 'warn', msg: string) => showToast(type, msg),
      },
    };
    pendingNodeIdsRef.current.add(node.id);
    setAssetNodes((prev) => [...prev, node]);
  };

  const handleAddSharedAsset = async (item: SharedAssetView): Promise<boolean> => {
    if (!currentId) return false;
    try {
      switch (item.assetType) {
        case 'media': {
          const snapshot = item.snapshot as { url: string };
          const kind = item.kind as 'image' | 'video' | 'audio';
          const mediaType = kind === 'video' ? 'video' : kind === 'audio' ? 'audio' : 'image';
          const node: Node = {
            id: newNodeId('media'),
            type: 'mediaNode',
            position: spawnPosition(),
            data: {
              src: snapshot.url,
              fileName: item.name || `资产-${Date.now()}`,
              mediaType,
              toolMode,
              onDelete: (id: string) => actionsRef.current.removeMediaNode(id),
              onDuplicate: (id: string) => actionsRef.current.duplicate(id),
              onTitleChange: (id: string, name: string) => actionsRef.current.renameCard(id, name),
              onAddToChat: (id: string) => actionsRef.current.addToChat(id),
              onPaste: (id: string) => actionsRef.current.pasteAtNode(id),
              onCopyImage: (id: string) => actionsRef.current.copyImage(id),
              onComplianceCheck: (id: string) => actionsRef.current.complianceCheck(id),
              onFillEmptyShell: (id: string, file: File) => actionsRef.current.fillEmptyShell(id, file),
              onDownload: (id: string) => actionsRef.current.download(id),
              ...dockToolCallbacks,
              onShowDetails: (id: string) => actionsRef.current.showDetails(id),
              onSaveToAssets: (id: string) => handleSaveMediaToAssets(id),
              onMediaDims: handleMediaDims,
            },
          };
          pendingNodeIdsRef.current.add(node.id);
          setMediaNodes((prev) => [...prev, node]);
          return true;
        }
        case 'card': {
          const snapshot = item.snapshot as {
            referenceImages: Array<{ id: string; src: string }>;
            description?: string;
            voice?: { name: string; src: string };
          };
          const kind = item.kind as AssetCardKind;
          const node: Node = {
            id: newNodeId('asset'),
            type: 'assetNode',
            position: spawnPosition(),
            data: {
              kind,
              initialRefs: snapshot.referenceImages,
              initialDesc: snapshot.description,
              toolMode,
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
              onToast: (type: 'success' | 'error' | 'warn', msg: string) => showToast(type, msg),
            },
          };
          if (snapshot.voice) {
            (node.data as Record<string, unknown>).voice = snapshot.voice;
          }
          pendingNodeIdsRef.current.add(node.id);
          setAssetNodes((prev) => [...prev, node]);
          return true;
        }
        case 'goods': {
          const snapshot = item.snapshot as {
            name: string;
            detail?: string;
            images: Array<{ id: string; src: string; enabled?: boolean }>;
          };
          const node: Node = {
            id: newNodeId('product'),
            type: 'productNode',
            position: spawnPosition(),
            data: {
              name: snapshot.name,
              detail: snapshot.detail || '',
              images: snapshot.images.map((img) => ({ ...img, enabled: img.enabled ?? true })),
              toolMode,
              projectId: currentId,
              onDelete: (id: string) => {
                setProductNodes((prev) => prev.filter((n) => n.id !== id));
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
              onToast: (type: 'success' | 'error' | 'warn', msg: string) => showToast(type, msg),
            },
          };
          pendingNodeIdsRef.current.add(node.id);
          setProductNodes((prev) => [...prev, node]);
          return true;
        }
        case 'text': {
          const snapshot = item.snapshot as { html?: string; text?: string };
          const node: Node = {
            id: newNodeId('text'),
            type: 'textNode',
            position: spawnPosition(),
            data: {
              text: unifiedTextNodeText(snapshot),
              toolMode,
              onDelete: (id: string) => removeCanvasNodes([id]),
              onTextChange: (id: string, text: string) => {
                setTextNodes((prev) =>
                  prev.map((n) => (n.id === id ? { ...n, data: { ...n.data, text } } : n))
                );
              },
              onMediaIndexChange: handleMediaIndexChange,
              onDuplicate: (id: string) => actionsRef.current.duplicate(id),
              onTitleChange: (id: string, name: string) => actionsRef.current.renameCard(id, name),
              onAddToChat: (id: string) => actionsRef.current.addToChat(id),
              onPaste: (id: string) => actionsRef.current.pasteAtNode(id),
              onCopyImage: (id: string) => actionsRef.current.copyImage(id),
              onComplianceCheck: (id: string) => actionsRef.current.complianceCheck(id),
              onFillEmptyShell: (id: string, file: File) => actionsRef.current.fillEmptyShell(id, file),
              onSaveToAssets: (id: string) => handleSaveTextToAssets(id),
              onToast: (type: 'success' | 'error' | 'warn', msg: string) => showToast(type, msg),
            },
          };
          pendingNodeIdsRef.current.add(node.id);
          setTextNodes((prev) => [...prev, node]);
          return true;
        }
        case 'scene': {
          showToast('warn', '场景卡需通过场景卡面板添加');
          return false;
        }
        default:
          return false;
      }
    } catch (e) {
      console.warn('添加共享资产到画布失败:', e);
      return false;
    }
  };

  return {
    handleCreateProduct,
    handleCreateAssetCard,
    handleProductChange,
    handleCardChange,
    handleAddSharedAsset,
  };
}
