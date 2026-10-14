import { useCallback, useRef, type RefObject } from 'react';
import type { Node, OnSelectionChangeParams } from '@xyflow/react';
import type { DockSelection } from '../generationDockCoordinator';

type DraftEntry = { hidden: boolean; visible: boolean; open(): void };

export interface CanvasSelectionBridgeHost {
  mediaNodesRef: RefObject<Node[]>;
  pickMode: string | null;
  pickTarget: string | null;
  onSelectionChange: (selection: { soloId: string | null; multiSelect: boolean }) => boolean;
  editSessionActive: boolean;
  draftOfNode: (node: Node) => DraftEntry | null;
  hasGenerationRecord: (node: Node) => boolean;
  showImageDialog: boolean;
  showBottomDialog: boolean;
  showAudioDialog: boolean;
  imageDraftId: string | null;
  videoDraftId: string | null;
  audioDraftId: string | null;
  openMediaDraftDialog: (nodeId: string, mediaType: unknown, intent?: 'selection') => boolean | void;
  setSoloSelectedNodeId: (nodeId: string | null) => void;
  selection: (input: DockSelection) => void;
  submittingNodeId: string | null;
}

export interface CanvasSelectionBridgeHandles {
  handleSelectionChangeStable: (params: OnSelectionChangeParams) => void;
}

export function useCanvasSelectionBridge(host: CanvasSelectionBridgeHost): CanvasSelectionBridgeHandles {
  const {
    mediaNodesRef,
    pickMode,
    pickTarget,
    onSelectionChange,
    editSessionActive,
    draftOfNode,
    hasGenerationRecord,
    showImageDialog,
    showBottomDialog,
    showAudioDialog,
    imageDraftId,
    videoDraftId,
    audioDraftId,
    openMediaDraftDialog,
    setSoloSelectedNodeId,
    selection,
    submittingNodeId,
  } = host;

  const handleSelectionChange = ({ nodes }: OnSelectionChangeParams) => {
    const candidates = nodes.filter((n) => {
      const m = mediaNodesRef.current.find((x) => x.id === n.id);
      if (!m || m.selected !== false) return true;
      return !nodes.some((other) => mediaNodesRef.current.find((x) => x.id === other.id)?.selected === true);
    });
    const soloId = candidates.length === 1 ? candidates[0]!.id : null;
    setSoloSelectedNodeId(soloId);
    if (pickMode || pickTarget) return;
    if (onSelectionChange({ soloId, multiSelect: candidates.length > 1 })) return;
    if (soloId && !editSessionActive) {
      const mediaNode = mediaNodesRef.current.find((n) => n.id === soloId);
      const mediaData = (mediaNode?.data ?? {}) as Record<string, unknown>;
      const toolDraft = mediaNode && draftOfNode(mediaNode);
      if (mediaNode && !mediaData.audioVideoMux && (
        mediaData.draft === true
        || hasGenerationRecord(mediaNode)
        || Boolean(toolDraft)
      )) {
        const mediaType = mediaData.mediaType;
        const panelHidden = toolDraft ? toolDraft.hidden : false;
        const alreadyOpen = toolDraft ? toolDraft.visible
          : mediaType === 'video' ? showBottomDialog && videoDraftId === soloId
          : mediaType === 'audio' ? showAudioDialog && audioDraftId === soloId : showImageDialog && imageDraftId === soloId;
        if (!alreadyOpen && !panelHidden) {
          if (openMediaDraftDialog(soloId, mediaType, 'selection') !== false) return;
        }
      }
    }
    selection({ soloId, multiSelect: candidates.length > 1, editing: editSessionActive, submittingNodeId });
  };

  const handleSelectionChangeRef = useRef(handleSelectionChange);
  handleSelectionChangeRef.current = handleSelectionChange;

  const handleSelectionChangeStable = useCallback(
    (params: OnSelectionChangeParams) => handleSelectionChangeRef.current(params),
    [],
  );

  return { handleSelectionChangeStable };
}
