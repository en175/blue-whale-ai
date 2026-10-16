import { useCallback, useRef, useState } from 'react';
import { persistSnapAlignmentEnabled, readSnapAlignmentEnabled } from '../graph/snapPreference';

import { type ToolMode, type CardFilter } from '@/custom/enums';

export function useCanvasWorkbenchChrome() {
  const [showMiniMap, setShowMiniMap] = useState(false);
  const [toolMode, setToolMode] = useState<ToolMode>('select');
  const [paneMenu, setPaneMenu] = useState<{ x: number; y: number } | null>(null);
  const [connectMenu, setConnectMenu] = useState<{ sourceIds: string[]; x: number; y: number } | null>(null);
  const closeConnectMenu = useCallback(() => setConnectMenu(null), []);
  const connectingSourceRef = useRef<string | null>(null);
  const paneUploadRef = useRef<HTMLInputElement>(null);
  const paneUploadPosRef = useRef<{ x: number; y: number } | null>(null);
  const [anchoredOverlayHiddenIds, setAnchoredOverlayHiddenIds] = useState<Set<string> | null>(null);
  const isAnchoredOverlayDragHidden = (id: string | null | undefined) =>
    id != null && (anchoredOverlayHiddenIds?.has(id) ?? false);
  const [soloSelectedNodeId, setSoloSelectedNodeId] = useState<string | null>(null);
  const [showCharacterLibrary, setShowCharacterLibrary] = useState(false);
  const [characterLibraryTarget, setCharacterLibraryTarget] = useState<'image' | 'asset' | null>(null);
  const [showAssetsModal, setShowAssetsModal] = useState(false);
  const [assetsModalDefaultTab, setAssetsModalDefaultTab] = useState<string | undefined>(undefined);
  const [assetsModalDefaultFilter, setAssetsModalDefaultFilter] = useState<CardFilter | undefined>(undefined);
  const [showEdges, setShowEdges] = useState(true);
  const [snapAlignmentOn, setSnapAlignmentOn] = useState(readSnapAlignmentEnabled);
  const [pendingDeleteGroup, setPendingDeleteGroup] = useState<{ id: string; count: number } | null>(null);
  const [submittingNodeId, setSubmittingNodeId] = useState<string | null>(null);
  const editingTargetRef = useRef<string | null>(null);
  const [selectRequest, setSelectRequest] = useState<{ id: string; ts: number } | null>(null);
  const [selectManyRequest, setSelectManyRequest] = useState<{ ids: string[]; ts: number } | null>(null);
  const [showLegacyHistory, setShowLegacyHistory] = useState(false);
  const persistSnap = (enabled: boolean) => persistSnapAlignmentEnabled(enabled);
  return {
    showMiniMap, setShowMiniMap,
    toolMode, setToolMode,
    paneMenu, setPaneMenu,
    connectMenu, setConnectMenu, closeConnectMenu, connectingSourceRef,
    paneUploadRef, paneUploadPosRef,
    anchoredOverlayHiddenIds, setAnchoredOverlayHiddenIds, isAnchoredOverlayDragHidden,
    soloSelectedNodeId, setSoloSelectedNodeId,
    showCharacterLibrary, setShowCharacterLibrary, characterLibraryTarget, setCharacterLibraryTarget,
    showAssetsModal, setShowAssetsModal, assetsModalDefaultTab, setAssetsModalDefaultTab,
    assetsModalDefaultFilter, setAssetsModalDefaultFilter,
    showEdges, setShowEdges, snapAlignmentOn, setSnapAlignmentOn, persistSnap,
    pendingDeleteGroup, setPendingDeleteGroup,
    submittingNodeId, setSubmittingNodeId,
    editingTargetRef, selectRequest, setSelectRequest, selectManyRequest, setSelectManyRequest,
    showLegacyHistory, setShowLegacyHistory,
  };
}
