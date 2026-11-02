import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  BackgroundVariant,
  MiniMap,
  SelectionMode,
  useReactFlow,
  useViewport,
  type Node,
  type Edge,
  useNodesState,
  type Connection,
  type EdgeChange,
  type NodeTypes,
  type EdgeTypes,
  type NodeMouseHandler,
  type Viewport,
  type OnSelectionChangeParams,
  type NodeChange,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { useCallback, useEffect, useRef, useMemo, useState, type ReactNode } from 'react';
import ZoomControl from '../ZoomControl';
import TextNode from '../TextNode';
import MediaNode from '../MediaNode';
import { mediaInputStale, firstTextSourceOf } from '../../graph/textIndexSync';
import ProductNode from '../ProductNode';
import AssetCardNode from '../AssetCardNode';
import CustomEdge from '../CustomEdge';
import GroupOverlay from '../GroupOverlay';
import GroupFrameNode from '../GroupFrameNode';
import CropFrame, { type CropFrameProps } from '../CropFrame';
import { canvasDeleteKeyAction, deleteSelectedCanvasNodes, isEditableKeyboardTarget } from './keyboardDelete';
import { canvasClipboardKeyAction, copyableSelectedCanvasNodes } from './keyboardClipboard';
import { isMentionMenuOpen } from './canvasKeyboard';
import { useCanvasPan } from './useCanvasPan';
import {
  canvasChromeAtPoint,
  chromeSelectionLockIds,
  lockChromeSelection,
  rememberIdleSelection,
  shouldSuppressCanvasSelection,
  swallowStolenCanvasChromeHit,
  trackChromePointer,
} from './chromeHitGuard';
import ConnectionPreview from './ConnectionPreview';
import SnapGuides from './SnapGuides';
import OutpaintFrame from '../OutpaintFrame';
import type { ExpandSides, SourceRect } from '../../tools/image/imageOutpaint';
import { EMPTY_SNAP_GUIDES, isPositionChangeWithPosition, snapDragChanges } from '../../graph/snapDragChanges';
import type { SnapGuide, SnapNodeLike } from '../../graph/snapAlignment';
import {
  MIN_GROUP_MEMBERS,
  exclusiveMembersInGroup,
  groupFrameZ,
  groupMemberZ,
  type CanvasGroup,
  type GroupFrameDragResult,
} from '../../graph/canvasGroups';

import styles from './index.module.css';

const initialNodes: Node[] = [];

interface FlowCanvasProps {
  showMiniMap: boolean;
  toolMode: 'drag' | 'select';
  extraNodes: Node[];
  textNodes: Node[];
  mediaNodes: Node[];
  productNodes: Node[];
  assetNodes: Node[];
  showEdges: boolean;
  edges: Edge[];
  onEdgesChange: (changes: EdgeChange[]) => void;
  onConnect: (connection: Connection) => void;
  onConnectStart?: (nodeId: string | null) => void;
  onConnectEnd?: (event: MouseEvent | TouchEvent, state: { fromNode?: Node | null; toNode?: Node | null; isValid?: boolean | null; toHandle?: { nodeId?: string | null } | null }) => void;
  isValidConnection?: (connection: Connection | { source: string | null; target: string | null }) => boolean;
  viewport?: Viewport;
  onViewportChange?: (v: Viewport) => void;
  onViewportLive?: (v: Viewport) => void;
  onNodeDragStop?: (node: Node, draggedNodes: Node[]) => void;
  onDeleteNode: (ids: string[]) => void;
  onNodeClick?: (node: Node) => void;
  onPaneClick?: () => void;
  onSelectionChange?: (params: OnSelectionChangeParams) => void;
  selectRequest?: { id: string; ts: number } | null;
  hideZoomControl?: boolean;
  registerSpawnPosition?: (fn: (screenPt?: { x: number; y: number }) => { x: number; y: number }) => void;
  productPickResult?: { ts: number; productId: string; image: { id: string; src: string; enabled: boolean; type?: 'image' | 'video'; assetId?: string } } | null;
  assetPickResult?: { ts: number; assetId: string; ref: { id: string; src: string; type?: 'image' | 'video'; assetId?: string } } | null;
  onDuplicateSelected?: (ids: string[]) => void;
  onCopySelected?: (ids: string[]) => void;
  onPasteClipboard?: () => void;
  selectManyRequest?: { ids: string[]; ts: number } | null;
  groups?: CanvasGroup[];
  onCreateGroup?: (nodes: Node[], canvasNodes: Node[]) => void;
  onNodesMeasured?: (nodes: Node[]) => void;
  onUngroupGroup?: (groupId: string) => void;
  onDeleteGroup?: (groupId: string) => void;
  onDownloadGroup?: (nodeIds: string[]) => void;
  onGroupFrameDragStop?: (res: GroupFrameDragResult) => void;
  onBringGroupToFront?: (groupId: string) => void;
  onConnectGroupToTarget?: (memberIds: string[], targetId: string) => void;
  onConnectGroupDrop?: (memberIds: string[], targetId: string | null, client: { x: number; y: number }) => void;
  onConnectSourceToGroup?: (sourceId: string, memberIds: string[]) => void;
  onPaneContextMenu?: (pt: { clientX: number; clientY: number }) => void;
  onDropFiles?: (files: File[], flowPoint: { x: number; y: number }) => void;
  refPickActive?: boolean;
  outpaintFrame?: {
    rect: SourceRect;
    expands: ExpandSides;
    onExpandChange: (expands: ExpandSides) => void;
    dragHidden?: boolean;
  } | null;
  refPickMarkedIds?: string[];
  refPickBlockedIds?: string[];
  snapAlignmentEnabled?: boolean;
  cropFrame?: CropFrameProps | null;
  followToolbarLayer?: ReactNode;
  onAnchoredOverlayDragHideChange?: (ids: Set<string> | null) => void;
  onUpdateGenerate?: (nodeId: string) => void;
}

function FlowCanvasInner({ showMiniMap, toolMode, extraNodes, textNodes, mediaNodes, productNodes, assetNodes, showEdges, edges, onEdgesChange, onConnect, onConnectStart, onConnectEnd, isValidConnection, viewport, onViewportChange, onViewportLive, onNodeDragStop, onDeleteNode, onNodeClick, onPaneClick, onSelectionChange, registerSpawnPosition, hideZoomControl, productPickResult, assetPickResult, selectRequest, selectManyRequest, onDuplicateSelected, onCopySelected, onPasteClipboard, groups, onCreateGroup, onNodesMeasured, onUngroupGroup, onDeleteGroup, onDownloadGroup, onGroupFrameDragStop, onBringGroupToFront, onConnectGroupToTarget, onConnectGroupDrop, onConnectSourceToGroup, onPaneContextMenu, onDropFiles, refPickActive, outpaintFrame, refPickMarkedIds, refPickBlockedIds, snapAlignmentEnabled, cropFrame, followToolbarLayer, onAnchoredOverlayDragHideChange, onUpdateGenerate }: FlowCanvasProps) {
  const onDropFilesRef = useRef(onDropFiles);
  onDropFilesRef.current = onDropFiles;
  const { isPanning: isDrag, onMouseDownCapture, onClickCapture } = useCanvasPan(toolMode);
  const nodesRef = useRef<Node[]>([]);
  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  nodesRef.current = nodes;

  const isChromeGestureActive = () => shouldSuppressCanvasSelection();

  useEffect(() => {
    const revertLockedSelection = () => {
      const locked = chromeSelectionLockIds();
      if (!locked) return;
      setNodes((prev) => {
        let changed = false;
        const next = prev.map((node) => {
          const shouldSelect = locked.has(node.id);
          if (Boolean(node.selected) === shouldSelect) return node;
          changed = true;
          return { ...node, selected: shouldSelect };
        });
        return changed ? next : prev;
      });
    };

    const onPointerDown = (event: Event) => {
      if (!('clientX' in event) || !('clientY' in event)) return;
      const { clientX, clientY } = event as PointerEvent;
      const target = event.target;
      const onChrome = trackChromePointer(clientX, clientY)
        || (target instanceof Element && Boolean(target.closest('[data-canvas-chrome], .react-flow__minimap')));
      if (onChrome) {
        const fromTerritory = target instanceof Element && Boolean(target.closest('[data-gen-panel-territory]'));
        lockChromeSelection(
          nodesRef.current.filter((node) => node.selected).map((node) => node.id),
          fromTerritory ? 'territory' : 'chrome',
        );
        document.documentElement.classList.add('canvas-chrome-lock');
        [0, 16, 32, 80, 160, 320, 500].forEach((ms) => window.setTimeout(revertLockedSelection, ms));
      }
      swallowStolenCanvasChromeHit(event);
    };
    const onClick = (event: Event) => {
      swallowStolenCanvasChromeHit(event);
      revertLockedSelection();
    };
    const onPointerUp = () => {
      window.setTimeout(() => document.documentElement.classList.remove('canvas-chrome-lock'), 400);
    };
    const onPointerMove = (event: PointerEvent) => {
      const overChrome = trackChromePointer(event.clientX, event.clientY);
      if (overChrome || chromeSelectionLockIds()) return;
      rememberIdleSelection(nodesRef.current.filter((node) => node.selected).map((node) => node.id));
    };

    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('mousedown', onPointerDown, true);
    document.addEventListener('click', onClick, true);
    document.addEventListener('pointerup', onPointerUp, true);
    document.addEventListener('pointermove', onPointerMove, { passive: true });
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('mousedown', onPointerDown, true);
      document.removeEventListener('click', onClick, true);
      document.removeEventListener('pointerup', onPointerUp, true);
      document.removeEventListener('pointermove', onPointerMove);
      document.documentElement.classList.remove('canvas-chrome-lock');
    };
  }, [setNodes]);
  const extraIdsRef = useRef<Set<string>>(new Set());
  const textIdsRef = useRef<Set<string>>(new Set());
  const textParentPosRef = useRef(new Map<string, { x: number; y: number }>());
  const mediaIdsRef = useRef<Set<string>>(new Set());
  const productIdsRef = useRef<Set<string>>(new Set());
  const assetIdsRef = useRef<Set<string>>(new Set());

  const selectReqTsRef = useRef(0);
  useEffect(() => {
    if (!selectRequest || selectRequest.ts === selectReqTsRef.current) return;
    if (chromeSelectionLockIds()) return;
    selectReqTsRef.current = selectRequest.ts;
    setNodes((prev) => {
      let changed = false;
      const next = prev.map((n) => {
        const shouldSelect = n.id === selectRequest.id;
        if (Boolean(n.selected) === shouldSelect) return n;
        changed = true;
        return { ...n, selected: shouldSelect };
      });
      return changed ? next : prev;
    });
  }, [selectRequest, setNodes]);

  const selectManyReqTsRef = useRef(0);
  useEffect(() => {
    if (!selectManyRequest || selectManyRequest.ts === selectManyReqTsRef.current) return;
    selectManyReqTsRef.current = selectManyRequest.ts;
    const ids = new Set(selectManyRequest.ids);
    setNodes((prev) => prev.map((n) => ({ ...n, selected: ids.has(n.id) })));
  }, [selectManyRequest, setNodes]);

  const nodeTypes: NodeTypes = useMemo(
    () => ({
      textNode: TextNode,
      mediaNode: MediaNode,
      productNode: ProductNode,
      assetNode: AssetCardNode,
      groupFrame: GroupFrameNode,
    }),
    [],
  );
  const edgeTypes: EdgeTypes = useMemo(() => ({ custom: CustomEdge }), []);
  const { setCenter, setViewport, screenToFlowPosition, getNodes } = useReactFlow();
  const onNodesMeasuredRef = useRef(onNodesMeasured);
  onNodesMeasuredRef.current = onNodesMeasured;
  useEffect(() => {
    const contentNodes = getNodes().filter((node) => node.type !== 'groupFrame');
    if (contentNodes.length > 0 && contentNodes.every((node) => node.measured?.width != null && node.measured.height != null)) {
      onNodesMeasuredRef.current?.(contentNodes);
    }
  }, [nodes, getNodes]);
  const onViewportChangeRef = useRef(onViewportChange);
  onViewportChangeRef.current = onViewportChange;
  const onViewportLiveRef = useRef(onViewportLive);
  onViewportLiveRef.current = onViewportLive;
  const onSelectionChangeRef = useRef(onSelectionChange);
  onSelectionChangeRef.current = onSelectionChange;
  const handleFlowSelectionChange = useCallback((params: OnSelectionChangeParams) => {
    if (isChromeGestureActive()) return;
    onSelectionChangeRef.current?.(params);
  }, []);

  const { zoom } = useViewport();
  const dotSize = Math.max(0.4, Math.min(4, 1 / zoom));

  useEffect(() => {
    registerSpawnPosition?.((screenPt) =>
      screenToFlowPosition(screenPt ?? { x: window.innerWidth / 2, y: window.innerHeight / 2 }),
    );
  }, [registerSpawnPosition, screenToFlowPosition]);

  useEffect(() => {
    if (viewport) setViewport(viewport);
  }, [viewport, setViewport]);

  const onNodeDoubleClick: NodeMouseHandler = useCallback(
    (_event, node) => {
      const x = node.position.x + (node.measured?.width ?? 200) / 2;
      const y = node.position.y + (node.measured?.height ?? 100) / 2;
      setCenter(x, y, { zoom: 2, duration: 400 });
    },
    [setCenter],
  );

  useEffect(() => {
    const newIds = new Set(extraNodes.map((n) => n.id));
    const currentExtraIds = extraIdsRef.current;

    const added = extraNodes.filter((n) => !currentExtraIds.has(n.id));

    const updated = extraNodes.filter((n) => currentExtraIds.has(n.id));

    if (added.length > 0 || updated.length > 0) {
      setNodes((prev) => {
        let result = prev.map((node) => {
          const updatedNode = updated.find((u) => u.id === node.id);
          return updatedNode ?? node;
        });

        result = [...result, ...added];
        return result;
      });
    }

    extraIdsRef.current = newIds;
  }, [extraNodes, setNodes]);

  useEffect(() => {
    const newIds = new Set(textNodes.map((n) => n.id));
    const currentIds = textIdsRef.current;
    const added = textNodes.filter((n) => !currentIds.has(n.id));
    const updated = textNodes.filter((n) => currentIds.has(n.id));
    const removed = [...currentIds].filter((id) => !newIds.has(id));

    if (added.length > 0 || updated.length > 0 || removed.length > 0) {
      setNodes((prev) => {
        let result = removed.length > 0 ? prev.filter((n) => !removed.includes(n.id)) : prev;
        if (updated.length > 0) {
          result = result.map((node) => {
            const update = updated.find((u) => u.id === node.id);
            if (!update) return node;
            const prevPos = textParentPosRef.current.get(node.id);
            const parentMoved = !prevPos
              || prevPos.x !== update.position.x
              || prevPos.y !== update.position.y;
            return {
              ...node,
              ...update,
              position: node.dragging ? node.position : parentMoved ? update.position : node.position,
              selected: node.selected,
              dragging: node.dragging,
              measured: node.measured,
            };
          });
        }
        if (added.length > 0) result = [...result, ...added];
        return result;
      });
    }
    textIdsRef.current = newIds;
    textParentPosRef.current = new Map(textNodes.map((n) => [n.id, { x: n.position.x, y: n.position.y }]));
  }, [textNodes, setNodes]);

  useEffect(() => {
    const newIds = new Set(mediaNodes.map((n) => n.id));
    const currentIds = mediaIdsRef.current;
    const added = mediaNodes.filter((n) => !currentIds.has(n.id));
    const updated = mediaNodes.filter((n) => currentIds.has(n.id));
    const removed = [...currentIds].filter((id) => !newIds.has(id));

    if (added.length > 0 || updated.length > 0 || removed.length > 0) {
      setNodes((prev) => {
        let result = removed.length > 0 ? prev.filter((n) => !removed.includes(n.id)) : prev;
        if (updated.length > 0) {
          result = result.map((node) => {
            const update = updated.find((u) => u.id === node.id);
            if (!update) return node;
            return {
              ...node,
              ...update,
              position: node.dragging ? node.position : update.position,
              selected: node.selected,
              dragging: node.dragging,
              measured: node.measured,
            };
          });
        }
        if (added.length > 0) result = [...result, ...added];
        return result;
      });
    }

    mediaIdsRef.current = newIds;
  }, [mediaNodes, setNodes]);

  useEffect(() => {
    const newIds = new Set(productNodes.map((n) => n.id));
    const currentIds = productIdsRef.current;
    const added = productNodes.filter((n) => !currentIds.has(n.id));
    const removed = [...currentIds].filter((id) => !newIds.has(id));

    if (added.length > 0 || removed.length > 0) {
      setNodes((prev) => {
        let result = removed.length > 0 ? prev.filter((n) => !removed.includes(n.id)) : prev;
        if (added.length > 0) result = [...result, ...added];
        return result;
      });
    }

    productIdsRef.current = newIds;
  }, [productNodes, setNodes]);

  useEffect(() => {
    if (!productPickResult) return;
    const { productId, ts, image } = productPickResult;
    setNodes((prev) =>
      prev.map((node) => {
        if (node.type !== 'productNode' || node.id !== productId) return node;
        return {
          ...node,
          data: { ...node.data, productPickResult: { ts, productId, image } },
        };
      }),
    );
  }, [productPickResult, setNodes]);

  useEffect(() => {
    if (!assetPickResult) return;
    const { assetId, ts, ref } = assetPickResult;
    setNodes((prev) =>
      prev.map((node) => {
        if (node.type !== 'assetNode' || node.id !== assetId) return node;
        return {
          ...node,
          data: { ...node.data, assetPickResult: { ts, assetId, ref } },
        };
      }),
    );
  }, [assetPickResult, setNodes]);

  useEffect(() => {
    const newIds = new Set(assetNodes.map((n) => n.id));
    const currentIds = assetIdsRef.current;
    const added = assetNodes.filter((n) => !currentIds.has(n.id));
    const removed = [...currentIds].filter((id) => !newIds.has(id));

    if (added.length > 0 || removed.length > 0) {
      setNodes((prev) => {
        let result = removed.length > 0 ? prev.filter((n) => !removed.includes(n.id)) : prev;
        if (added.length > 0) result = [...result, ...added];
        return result;
      });
    }

    assetIdsRef.current = newIds;
  }, [assetNodes, setNodes]);

  useEffect(() => {
    setNodes((prev) => {
      if (prev.length === 0) return prev;
      let changed = false;
      const result = prev.map((node, index) => {
        const isFirst = index === 0;
        const needUpdate =
          !!node.data.isFirst !== isFirst || node.data.toolMode !== toolMode;
        if (needUpdate) {
          changed = true;
          return { ...node, data: { ...node.data, isFirst, toolMode } };
        }
        return node;
      });
      return changed ? result : prev;
    });
  }, [nodes, toolMode, setNodes]);

  const parentNodeIdsRef = useRef<Set<string>>(new Set());
  parentNodeIdsRef.current = new Set([
    ...extraNodes.map((n) => n.id),
    ...textNodes.map((n) => n.id),
    ...mediaNodes.map((n) => n.id),
    ...productNodes.map((n) => n.id),
    ...assetNodes.map((n) => n.id),
  ]);
  const canvasEdgesRef = useRef(edges);
  canvasEdgesRef.current = edges;
  const onEdgesChangeRef = useRef(onEdgesChange);
  onEdgesChangeRef.current = onEdgesChange;
  const onDeleteNodeRef = useRef(onDeleteNode);
  onDeleteNodeRef.current = onDeleteNode;
  const onDuplicateSelectedRef = useRef(onDuplicateSelected);
  onDuplicateSelectedRef.current = onDuplicateSelected;
  const onCopySelectedRef = useRef(onCopySelected);
  onCopySelectedRef.current = onCopySelected;
  const onPasteClipboardRef = useRef(onPasteClipboard);
  onPasteClipboardRef.current = onPasteClipboard;
  const groupsRef = useRef<CanvasGroup[]>(groups ?? []);
  groupsRef.current = groups ?? [];
  const onCreateGroupRef = useRef(onCreateGroup);
  onCreateGroupRef.current = onCreateGroup;
  const onNodeDragStopRef = useRef(onNodeDragStop);
  onNodeDragStopRef.current = onNodeDragStop;
  const onGroupFrameDragStopRef = useRef(onGroupFrameDragStop);
  onGroupFrameDragStopRef.current = onGroupFrameDragStop;

  const [frameDragMemberIds, setFrameDragMemberIds] = useState<Set<string>>(new Set());
  const [frameDragOffset, setFrameDragOffset] = useState<{ id: string; x: number; y: number } | null>(null);
  const frameDraggingRef = useRef(false);
  const dragHideIdsRef = useRef<Set<string> | null>(null);
  const frameDragIdsRef = useRef<Set<string>>(new Set());
  const onAnchoredOverlayDragHideChangeRef = useRef(onAnchoredOverlayDragHideChange);
  onAnchoredOverlayDragHideChangeRef.current = onAnchoredOverlayDragHideChange;
  const emitDragHide = useCallback((ids: Set<string> | null) => {
    if (dragHideIdsRef.current === ids) return;
    dragHideIdsRef.current = ids;
    onAnchoredOverlayDragHideChangeRef.current?.(ids);
  }, []);
  const handleFrameDragMembersChange = useCallback((ids: Set<string>) => {
    frameDraggingRef.current = ids.size > 0;
    frameDragIdsRef.current = ids;
    setFrameDragMemberIds(ids);
    if (ids.size === 0) emitDragHide(null);
  }, [emitDragHide]);
  const handleFrameDragOffsetChange = useCallback((offset: { id: string; x: number; y: number } | null) => {
    setFrameDragOffset(offset);
    if (offset && (offset.x !== 0 || offset.y !== 0)) emitDragHide(frameDragIdsRef.current);
  }, [emitDragHide]);
  const snapDragRef = useRef<{ primaryId: string; draggingIds: Set<string> } | null>(null);
  const [snapGuides, setSnapGuides] = useState<SnapGuide[]>(EMPTY_SNAP_GUIDES);
  const altKeyRef = useRef(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Alt') altKeyRef.current = e.type === 'keydown';
      else altKeyRef.current = e.altKey;
    };
    const onBlur = () => { altKeyRef.current = false; };
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('keyup', onKey, true);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('keyup', onKey, true);
      window.removeEventListener('blur', onBlur);
    };
  }, []);
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;
  const snapEnabledRef = useRef(snapAlignmentEnabled !== false);
  snapEnabledRef.current = snapAlignmentEnabled !== false;
  const handleNodesChange = useCallback(
    (changes: NodeChange[]) => {
      if (isChromeGestureActive()) {
        const next = changes.filter((c) => c.type !== 'select');
        if (next.length === 0) return;
        onNodesChange(next);
        return;
      }
      if (frameDraggingRef.current) {
        const next = changes.filter((c) => c.type !== 'select');
        if (next.length === 0) return;
        onNodesChange(next);
        return;
      }
      const drag = snapDragRef.current;
      if (drag) {
        if (changes.some(isPositionChangeWithPosition)) emitDragHide(drag.draggingIds);
        const groupFrames: SnapNodeLike[] = groupsRef.current.map((g) => ({
          id: g.id,
          type: 'groupFrame',
          position: { x: g.box.x, y: g.box.y },
          width: g.box.w,
          height: g.box.h,
        }));
        const { changes: next, guides } = snapDragChanges(
          changes,
          nodesRef.current,
          groupFrames,
          drag.primaryId,
          drag.draggingIds,
          { enabled: snapEnabledRef.current, altDisabled: altKeyRef.current, zoom: zoomRef.current },
        );
        setSnapGuides(guides);
        onNodesChange(next);
        return;
      }
      onNodesChange(changes);
    },
    [onNodesChange, emitDragHide],
  );
  const handleEdgesChange = useCallback((changes: EdgeChange[]) => {
    const parentIds = parentNodeIdsRef.current;
    const internalIds = new Set(nodesRef.current.map((n) => n.id));
    const forwarded = changes.filter((change) => {
      if (change.type !== 'remove') return true;
      const edge = canvasEdgesRef.current.find((item) => item.id === change.id);
      if (!edge) return true;
      const parentHasBoth = parentIds.has(edge.source) && parentIds.has(edge.target);
      const internalHasBoth = internalIds.has(edge.source) && internalIds.has(edge.target);
      return !(parentHasBoth && !internalHasBoth);
    });
    if (forwarded.length > 0) onEdgesChangeRef.current(forwarded);
  }, []);
  const [isDraggingNode, setIsDraggingNode] = useState(false);
  const [editGroupId, setEditGroupId] = useState<string | null>(null);
  const [pendingGroupPick, setPendingGroupPick] = useState<{ id: string; screen: { x: number; y: number } } | null>(null);
  const pendingGroupPickTimerRef = useRef(0);
  const enterGroupEdit = useCallback((groupId: string) => {
    const g = groupsRef.current.find((x) => x.id === groupId);
    if (!g) return;
    const memberIds = new Set(exclusiveMembersInGroup(nodesRef.current, g, groupsRef.current).map((n) => n.id));
    if (memberIds.size === 0) return;
    setNodes((prev) => prev.map((n) => ({ ...n, selected: memberIds.has(n.id) })));
    setEditGroupId(groupId);
  }, [setNodes]);
  const onGroupClick = useCallback((groupId: string, screen: { x: number; y: number }) => {
    if (pendingGroupPick?.id === groupId) {
      window.clearTimeout(pendingGroupPickTimerRef.current);
      pendingGroupPickTimerRef.current = 0;
      setPendingGroupPick(null);
      enterGroupEdit(groupId);
      return;
    }
    setPendingGroupPick({ id: groupId, screen });
    pendingGroupPickTimerRef.current = window.setTimeout(() => {
      pendingGroupPickTimerRef.current = 0;
      setPendingGroupPick(null);
    }, 350);
  }, [pendingGroupPick, enterGroupEdit]);
  const onGroupClickSuppress = useCallback(() => {
    if (pendingGroupPickTimerRef.current) {
      window.clearTimeout(pendingGroupPickTimerRef.current);
      pendingGroupPickTimerRef.current = 0;
    }
    setPendingGroupPick(null);
  }, []);
  const exitGroupEdit = useCallback(() => {
    setEditGroupId(null);
  }, []);
  const memberStackById = useMemo(() => {
    const stack = new Map<string, number>();
    groups?.forEach((g, i) => {
      exclusiveMembersInGroup(nodes, g, groups).forEach((n) => stack.set(n.id, i));
    });
    return stack;
  }, [groups, nodes]);
  const nodesForFlow = useMemo(() => {
    const list = groups ?? [];
    const topStack = Math.max(0, list.length - 1);
    const pickMarked = new Set(refPickMarkedIds ?? []);
    const pickBlocked = new Set(refPickBlockedIds ?? []);
    const withPickNoPan = (node: Node): Node => {
      if (!refPickActive) return node;
      const className = [node.className, 'nopan'].filter(Boolean).join(' ');
      return { ...node, className };
    };
    const content = nodes
      .filter((n) => n.type !== 'groupFrame')
      .map((n) => {
        if (frameDragMemberIds.has(n.id)) {
          return withPickNoPan({ ...n, zIndex: groupMemberZ(topStack) + 20 });
        }
        const stack = memberStackById.get(n.id);
        const zIndex = stack == null ? 0 : groupMemberZ(stack);
        const staleMediaType = n.type === 'mediaNode'
          ? (n.data as Record<string, unknown> | undefined)?.mediaType
          : undefined;
        const stale = n.type === 'mediaNode'
          && (staleMediaType === 'image' || staleMediaType === 'video' || staleMediaType === 'audio')
          && mediaInputStale(n.id, edges, nodes, staleMediaType);
        const marked = pickMarked.size > 0 && pickMarked.has(n.id);
        const blocked = pickBlocked.size > 0 && pickBlocked.has(n.id);
        if (!stale && !marked && !blocked) return withPickNoPan({ ...n, zIndex });
        return withPickNoPan({
          ...n,
          zIndex,
          data: {
            ...n.data,
            ...(stale ? { inputStale: true, inputSourceNodeId: firstTextSourceOf(n.id, edges, nodes), onUpdateGenerate } : {}),
            ...(marked ? { pickMarked: true } : {}),
            ...(blocked ? { pickBlocked: true } : {}),
          },
        });
      });
    const frames: Node[] = list.map((g, i) => {
      const box =
        frameDragOffset?.id === g.id
          ? { ...g.box, x: g.box.x + frameDragOffset.x, y: g.box.y + frameDragOffset.y }
          : g.box;
      return {
        id: g.id,
        type: 'groupFrame',
        position: { x: box.x, y: box.y },
        width: box.w,
        height: box.h,
        style: { width: box.w, height: box.h, pointerEvents: 'none' },
        zIndex: groupFrameZ(i),
        draggable: false,
        selectable: false,
        connectable: false,
        focusable: false,
        deletable: false,
        data: {},
      };
    });
    return [...frames, ...content];
  }, [nodes, groups, memberStackById, frameDragMemberIds, frameDragOffset, edges, refPickMarkedIds, refPickBlockedIds, refPickActive, onUpdateGenerate]);

  const onNodeDragStart = useCallback((_e: MouseEvent | TouchEvent, node: Node, draggedNodes: Node[]) => {
    setIsDraggingNode(true);
    snapDragRef.current = {
      primaryId: node.id,
      draggingIds: new Set(draggedNodes.map((n) => n.id)),
    };
  }, []);

  const handleNodeDragStopInternal = useCallback(
    (_e: MouseEvent | TouchEvent, node: Node, draggedNodes: Node[]) => {
      setIsDraggingNode(false);
      snapDragRef.current = null;
      setSnapGuides(EMPTY_SNAP_GUIDES);
      emitDragHide(null);
      const finalById = new Map(nodesRef.current.map((n) => [n.id, n]));
      const withSnappedPosition = (n: Node): Node => {
        const current = finalById.get(n.id);
        return current ? { ...n, position: current.position } : n;
      };
      onNodeDragStopRef.current?.(withSnappedPosition(node), draggedNodes.map(withSnappedPosition));
    },
    [emitDragHide],
  );

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey) {
        const key = e.key.toLowerCase();
        if (key === 'c' || key === 'v') {
          const clipboardAction = canvasClipboardKeyAction({
            key: e.key,
            metaKey: e.metaKey,
            ctrlKey: e.ctrlKey,
            shiftKey: e.shiftKey,
            target: e.target,
            mentionMenuOpen: isMentionMenuOpen(),
          });
          if (clipboardAction === 'ignore') return;
          e.preventDefault();
          e.stopPropagation();
          if (clipboardAction === 'copy') {
            const ids = copyableSelectedCanvasNodes(nodesRef.current);
            if (ids.length > 0) onCopySelectedRef.current?.(ids);
            return;
          }
          onPasteClipboardRef.current?.();
          return;
        }
        if (key === 'd' && !isEditableKeyboardTarget(e.target)) {
          e.preventDefault();
          e.stopPropagation();
          const ids = nodesRef.current.filter((n) => n.selected).map((n) => n.id);
          if (ids.length > 0) onDuplicateSelectedRef.current?.(ids);
          return;
        }
        if (key === 'g' && !isEditableKeyboardTarget(e.target)) {
          e.preventDefault();
          e.stopPropagation();
          const selected = nodesRef.current.filter((n) => n.selected);
          if (selected.length >= MIN_GROUP_MEMBERS) onCreateGroupRef.current?.(selected, getNodes());
          return;
        }
        if (key === 'a' && !isEditableKeyboardTarget(e.target)) {
          e.preventDefault();
          e.stopPropagation();
          setNodes((prev) => prev.map((n) => ({ ...n, selected: true })));
          return;
        }
        return;
      }
      const action = canvasDeleteKeyAction(e.key, e.target);
      if (action === 'ignore') return;
      e.preventDefault();
      e.stopPropagation();
      if (action !== 'delete-selected') return;

      deleteSelectedCanvasNodes(nodesRef.current, onDeleteNodeRef.current);
    };
    document.addEventListener('keydown', handler, true);
    return () => document.removeEventListener('keydown', handler, true);
  }, [setNodes]);

  useEffect(() => {
    if (!editGroupId) return;
    const onPaneDown = (e: PointerEvent) => {
      const target = e.target instanceof Element ? e.target : null;
      if (target && (target.closest('.react-flow__node') || target.closest('.react-flow__edge') || target.closest('.react-flow__panel'))) return;
      const g = groupsRef.current.find((x) => x.id === editGroupId);
      if (!g) {
        exitGroupEdit();
        return;
      }
      const p = screenToFlowPosition({ x: e.clientX, y: e.clientY });
      const inBox = p.x >= g.box.x && p.x <= g.box.x + g.box.w && p.y >= g.box.y && p.y <= g.box.y + g.box.h;
      if (!inBox) exitGroupEdit();
    };
    window.addEventListener('pointerdown', onPaneDown, true);
    return () => window.removeEventListener('pointerdown', onPaneDown, true);
  }, [editGroupId, exitGroupEdit, screenToFlowPosition]);

  useEffect(() => () => {
    if (pendingGroupPickTimerRef.current) window.clearTimeout(pendingGroupPickTimerRef.current);
  }, []);

  return (
    <div
      className={`${styles.canvasContainer} ${isDrag ? styles.dragMode : ''}`}
      onMouseDownCapture={onMouseDownCapture}
      onClickCapture={onClickCapture}
      onDoubleClickCapture={onClickCapture}
      onDragOver={(e) => {
        if (e.dataTransfer.files?.length) e.preventDefault();
      }}
      onDrop={(e) => {
        if (!e.dataTransfer.files?.length) return;
        if (e.target instanceof Element && e.target.closest('.react-flow__node')) return;
        e.preventDefault();
        onDropFilesRef.current?.(Array.from(e.dataTransfer.files), screenToFlowPosition({ x: e.clientX, y: e.clientY }));
      }}
    >
      <ReactFlow
        nodes={nodesForFlow}
        edges={showEdges ? edges : []}
        onNodesChange={handleNodesChange}
        onEdgesChange={handleEdgesChange}
        onConnect={onConnect}
        onConnectStart={(_e, params) => onConnectStart?.(params.nodeId ?? null)}
        onConnectEnd={onConnectEnd}
        isValidConnection={isValidConnection}
        connectionLineComponent={ConnectionPreview}
        onNodeDoubleClick={onNodeDoubleClick}
        onNodeClick={
          onNodeClick
            ? (_e, node) => {
                _e.stopPropagation();
                if (canvasChromeAtPoint(_e.clientX, _e.clientY) || chromeSelectionLockIds()) return;
                onNodeClick(node);
              }
            : undefined
        }
        onPaneClick={onPaneClick}
        onSelectionChange={frameDragMemberIds.size > 0 ? undefined : handleFlowSelectionChange}
        onMove={(_e, v) => onViewportLiveRef.current?.(v)}
        onMoveEnd={(_e, v) => onViewportChangeRef.current?.(v)}
        onNodeDragStart={onNodeDragStart}
        onNodeDragStop={handleNodeDragStopInternal}
        onContextMenu={(e) => {
          e.preventDefault();
          if (toolMode !== 'select') return;
          const el = e.target as HTMLElement;
          if (el.closest('.react-flow__node') || el.closest('.react-flow__edge')) return;
          onPaneContextMenu?.({ clientX: e.clientX, clientY: e.clientY });
        }}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        panOnDrag={refPickActive ? [0, 1] : isDrag ? [0, 1] : [1]}
        autoPanOnNodeDrag={false}
        autoPanOnConnect={false}
        autoPanOnSelection={false}
        panOnScroll
        zoomOnScroll={false}
        panActivationKeyCode={null}
        selectionOnDrag={!refPickActive && !isDrag && frameDragMemberIds.size === 0}
        selectionMode={SelectionMode.Partial}
        zoomOnDoubleClick={!isDrag}
        nodesDraggable={!isDrag && !refPickActive}
        elementsSelectable={!isDrag && !refPickActive}
        nodesConnectable
        nodesFocusable={false}
        edgesFocusable={false}
        minZoom={0.2}
        maxZoom={8}
        connectionRadius={30}
        defaultViewport={{ x: 0, y: 0, zoom: 1.1 }}
        proOptions={{ hideAttribution: true }}
        deleteKeyCode={null}
        defaultEdgeOptions={{
          type: 'custom',
          style: { stroke: '#444' },
        }}
      >
        <Background
          variant={BackgroundVariant.Dots}
          gap={24}
          size={dotSize}
          color="#4d4d4d"
        />
        {}
        <SnapGuides guides={snapGuides} />
        {}
        {outpaintFrame && (
          <OutpaintFrame
            rect={outpaintFrame.rect}
            expands={outpaintFrame.expands}
            onExpandChange={outpaintFrame.onExpandChange}
            dragHidden={outpaintFrame.dragHidden}
          />
        )}
        {showMiniMap && (
          <MiniMap
            position="bottom-left"
            nodeColor="#9a9a9a"
            maskColor="transparent"
            maskStrokeColor="#ffffff"
            maskStrokeWidth={2}
            pannable
            zoomable
            style={{ bottom: 60 }}
          />
        )}
        {}
        {groups && (
          <GroupOverlay
            nodes={nodes}
            groups={groups}
            onCreateGroup={(selected) => onCreateGroup?.(selected, getNodes())}
            onUngroup={onUngroupGroup ?? (() => {})}
            onDeleteGroup={onDeleteGroup ?? (() => {})}
            onDownloadNodes={onDownloadGroup ?? (() => {})}
            setNodes={setNodes}
            onGroupFrameDragStop={onGroupFrameDragStopRef.current}
            onFrameDragMembersChange={handleFrameDragMembersChange}
            onFrameDragOffsetChange={handleFrameDragOffsetChange}
            onBringGroupToFront={onBringGroupToFront}
            onGroupClick={onGroupClick}
            onGroupClickSuppress={onGroupClickSuppress}
            editGroupId={editGroupId}
            onConnectGroupToTarget={onConnectGroupToTarget ?? (() => {})}
            onConnectGroupDrop={onConnectGroupDrop}
            onConnectSourceToGroup={onConnectSourceToGroup ?? (() => {})}
            isDraggingNode={isDraggingNode}
            isPanning={isDrag}
          />
        )}
        {}
        {cropFrame && (
          <CropFrame
            bounds={cropFrame.bounds}
            rect={cropFrame.rect}
            preset={cropFrame.preset}
            minSide={cropFrame.minSide}
            onRectChange={cropFrame.onRectChange}
            onDarkAreaClick={cropFrame.onDarkAreaClick}
            dragHidden={cropFrame.dragHidden}
          />
        )}
        {}
        {followToolbarLayer}
      </ReactFlow>
      {!hideZoomControl && <ZoomControl />}
    </div>
  );
}

export default function FlowCanvas({ showMiniMap, toolMode, extraNodes, textNodes, mediaNodes, productNodes, assetNodes, showEdges, edges, onEdgesChange, onConnect, onConnectStart, onConnectEnd, isValidConnection, viewport, onViewportChange, onViewportLive, onNodeDragStop, onDeleteNode, onNodeClick, onPaneClick, onSelectionChange, registerSpawnPosition, hideZoomControl, productPickResult, assetPickResult, selectRequest, selectManyRequest, onDuplicateSelected, onCopySelected, onPasteClipboard, groups, onCreateGroup, onNodesMeasured, onUngroupGroup, onDeleteGroup, onDownloadGroup, onGroupFrameDragStop, onBringGroupToFront, onConnectGroupToTarget, onConnectGroupDrop, onConnectSourceToGroup, onPaneContextMenu, onDropFiles, refPickActive, outpaintFrame, refPickMarkedIds, refPickBlockedIds, snapAlignmentEnabled, cropFrame, followToolbarLayer, onAnchoredOverlayDragHideChange, onUpdateGenerate }: FlowCanvasProps) {
  return (
    <ReactFlowProvider>
      <FlowCanvasInner
        showMiniMap={showMiniMap}
        toolMode={toolMode}
        extraNodes={extraNodes}
        textNodes={textNodes}
        mediaNodes={mediaNodes}
        productNodes={productNodes}
        assetNodes={assetNodes}
        showEdges={showEdges}
        edges={edges}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onConnectStart={onConnectStart}
        onConnectEnd={onConnectEnd}
        isValidConnection={isValidConnection}
        viewport={viewport}
        onViewportChange={onViewportChange}
        onViewportLive={onViewportLive}
        onNodeDragStop={onNodeDragStop}
        onDeleteNode={onDeleteNode}
        onNodeClick={onNodeClick}
        onPaneClick={onPaneClick}
        onSelectionChange={onSelectionChange}
        registerSpawnPosition={registerSpawnPosition}
        hideZoomControl={hideZoomControl}
        productPickResult={productPickResult}
        assetPickResult={assetPickResult}
        selectRequest={selectRequest}
        selectManyRequest={selectManyRequest}
        onDuplicateSelected={onDuplicateSelected}
        onCopySelected={onCopySelected}
        onPasteClipboard={onPasteClipboard}
        groups={groups}
        onCreateGroup={onCreateGroup}
        onNodesMeasured={onNodesMeasured}
        onUngroupGroup={onUngroupGroup}
        onDeleteGroup={onDeleteGroup}
        onDownloadGroup={onDownloadGroup}
        onGroupFrameDragStop={onGroupFrameDragStop}
        onBringGroupToFront={onBringGroupToFront}
        onConnectGroupToTarget={onConnectGroupToTarget}
        onConnectGroupDrop={onConnectGroupDrop}
        onConnectSourceToGroup={onConnectSourceToGroup}
        onPaneContextMenu={onPaneContextMenu}
        onDropFiles={onDropFiles}
        refPickActive={refPickActive}
        outpaintFrame={outpaintFrame}
        refPickMarkedIds={refPickMarkedIds}
        refPickBlockedIds={refPickBlockedIds}
        snapAlignmentEnabled={snapAlignmentEnabled}
        cropFrame={cropFrame}
        followToolbarLayer={followToolbarLayer}
        onAnchoredOverlayDragHideChange={onAnchoredOverlayDragHideChange}
        onUpdateGenerate={onUpdateGenerate}
      />
    </ReactFlowProvider>
  );
}
