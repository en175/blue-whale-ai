import { type AssetCardKind } from '@/custom/enums';
import { type Dispatch, type RefObject, type SetStateAction } from 'react';
import type { Node } from '@xyflow/react';

import type { CanvasGalleryRef } from '../../media/collectMediaBlocks';

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
  editFailed: (id: string) => void;
  rechargeFailed: (id: string) => void;
  requoteFailed: (id: string) => void;
  requoteConfirm: (id: string) => void;
}

export interface CanvasNodeFactoriesHost {
  newNodeId: (kind: string) => string;
  spawnPosition: () => { x: number; y: number };
  toolMode: 'drag' | 'select';
  currentId: string | undefined;
  productSeq: RefObject<number>;
  pendingNodeIdsRef: RefObject<Set<string>>;
  actionsRef: RefObject<CanvasNodeActions>;
  setProductNodes: Dispatch<SetStateAction<Node[]>>;
  setAssetNodes: Dispatch<SetStateAction<Node[]>>;
  handleAssetHoverChange: (id: string, hovered: boolean) => void;
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
    actionsRef, setProductNodes, setAssetNodes,
    handleAssetHoverChange, showToast, pickers,
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

  return {
    handleCreateProduct,
    handleCreateAssetCard,
    handleProductChange,
    handleCardChange,
  };
}
