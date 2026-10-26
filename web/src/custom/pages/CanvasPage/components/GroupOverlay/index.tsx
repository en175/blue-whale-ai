import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useReactFlow, useViewport, getBezierPath, Position, type Node } from '@xyflow/react';
import { Group, Ungroup, Trash2, Download, Plus } from 'lucide-react';
import {
  memberBBox,
  exclusiveMembersInGroup,
  membersInGroupBox,
  MIN_GROUP_MEMBERS,
  nodeInsideGroupBox,
  contentNodeAtFlowPoint,
  type CanvasGroup,
  type GroupBBox,
  type GroupFrameDragResult,
  type PositionRecord,
} from '../../graph/canvasGroups';
import { useOverlayWheelPassthrough } from '../Canvas/canvasWheelPassthrough';
import styles from './index.module.css';

function isPassthroughOverlayTarget(target: EventTarget | null): boolean {
  return target instanceof Element && Boolean(
    target.closest('[data-outpaint-frame]')
    || target.closest('[data-crop-frame]')
    || target.closest('[data-gen-panel-territory]')
    || target.closest('.react-flow__nodesselection-rect'),
  );
}

interface GroupOverlayProps {
  nodes: Node[];
  groups: CanvasGroup[];
  onCreateGroup: (nodes: Node[]) => void;
  onUngroup: (groupId: string) => void;
  onDeleteGroup: (groupId: string) => void;
  onDownloadNodes: (nodeIds: string[]) => void;
  setNodes: (updater: (prev: Node[]) => Node[]) => void;
  onGroupFrameDragStop?: (res: GroupFrameDragResult) => void;
  onFrameDragMembersChange?: (ids: Set<string>) => void;
  onFrameDragOffsetChange?: (offset: { id: string; x: number; y: number } | null) => void;
  onBringGroupToFront?: (groupId: string) => void;
  onGroupClick?: (groupId: string, screen: { x: number; y: number }) => void;
  onGroupClickSuppress?: () => void;
  editGroupId?: string | null;
  onConnectGroupDrop?: (memberIds: string[], targetId: string | null, client: { x: number; y: number }) => void;
  onConnectGroupToTarget?: (memberIds: string[], targetId: string) => void;
  onConnectSourceToGroup?: (sourceId: string, memberIds: string[]) => void;
  isDraggingNode?: boolean;
  isPanning?: boolean;
}

interface FrameInfo {
  id: string;
  box: GroupBBox;
  count: number;
  excludedIds: string[];
}

interface DragOffset {
  id: string;
  x: number;
  y: number;
}

export default function GroupOverlay({
  nodes,
  groups,
  onCreateGroup,
  onUngroup,
  onDeleteGroup,
  onDownloadNodes,
  setNodes,
  onGroupFrameDragStop,
  onFrameDragMembersChange,
  onFrameDragOffsetChange,
  onBringGroupToFront,
  onGroupClick,
  onGroupClickSuppress,
  editGroupId,
  onConnectGroupToTarget,
  onConnectGroupDrop,
  isDraggingNode,
  isPanning,
}: GroupOverlayProps) {
  const { flowToScreenPosition, screenToFlowPosition } = useReactFlow();
  const { zoom } = useViewport();
  const [openGroupId, setOpenGroupId] = useState<string | null>(null);
  const connectDraggingRef = useRef(false);
  const [dragOffset, setDragOffset] = useState<DragOffset | null>(null);
  const [frozenDragMembers, setFrozenDragMembers] = useState<{
    groupId: string;
    ids: Set<string>;
  } | null>(null);

  const frames = useMemo<FrameInfo[]>(
    () =>
      groups.map((g) => {
        let count: number;
        if (frozenDragMembers?.groupId === g.id) {
          count = frozenDragMembers.ids.size;
        } else if (frozenDragMembers) {
          count = exclusiveMembersInGroup(nodes, g, groups).filter(
            (n) => !frozenDragMembers.ids.has(n.id),
          ).length;
        } else {
          count = exclusiveMembersInGroup(nodes, g, groups).length;
        }
        return {
          id: g.id,
          box: g.box,
          count,
          excludedIds: g.excludedIds,
        };
      }),
    [groups, nodes, frozenDragMembers],
  );

  const selectedNodes = useMemo(() => nodes.filter((n) => n.selected && n.type !== 'groupFrame'), [nodes]);
  const selectedIds = selectedNodes.map((n) => n.id);
  const selectedGroupFrame = selectedIds.length >= MIN_GROUP_MEMBERS
    ? frames.find((group) => !selectedIds.some((id) => group.excludedIds.includes(id))
      && selectedNodes.every((node) => nodeInsideGroupBox(node, group.box)))
    : undefined;
  const allInOneGroup = !!selectedGroupFrame;
  const selectionBox = useMemo(
    () => (selectedNodes.length >= MIN_GROUP_MEMBERS ? memberBBox(selectedNodes) : null),
    [selectedNodes],
  );
  const showCreateBtn = !!selectionBox && selectedGroupFrame?.count !== selectedIds.length && !isDraggingNode;
  const showSelectionDownload = !!selectionBox && !allInOneGroup && !isDraggingNode;
  const createBtnPt = selectionBox
    ? flowToScreenPosition({ x: selectionBox.x + selectionBox.w / 2, y: selectionBox.y })
    : null;

  useEffect(() => {
    if (!openGroupId) return;
    const close = (e: MouseEvent) => {
      if (e.button !== 0 || connectDraggingRef.current) return;
      if (!(e.target instanceof Element)) return;
      if (
        e.target.closest(`.${styles.groupTools}`) ||
        e.target.closest(`.${styles.groupBadgeWrap}`) ||
        e.target.closest(`.${styles.connectHandle}`)
      )
        return;
      setOpenGroupId(null);
    };
    document.addEventListener('mousedown', close, true);
    return () => document.removeEventListener('mousedown', close, true);
  }, [openGroupId]);

  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;
  const draggingRef = useRef(false);
  const nodesRef = useRef(nodes);
  nodesRef.current = nodes;
  const groupsRef = useRef(groups);
  groupsRef.current = groups;
  const editGroupIdRef = useRef(editGroupId);
  editGroupIdRef.current = editGroupId ?? null;
  const isPanningRef = useRef(isPanning);
  isPanningRef.current = isPanning ?? false;
  const paneRef = useRef<HTMLElement | null>(null);
  const clickSuppressRef = useRef(false);
  const contentClickSuppressRef = useRef(false);
  const lastContentPressRef = useRef({ id: '', at: 0 });
  const uiLayerElRef = useRef<HTMLDivElement | null>(null);
  const uiLayerRef = useCallback((el: HTMLDivElement | null) => {
    uiLayerElRef.current = el;
    paneRef.current = el
      ? el.closest('.react-flow')?.querySelector<HTMLElement>('.react-flow__pane') ?? null
      : null;
  }, []);
  useOverlayWheelPassthrough(uiLayerElRef);
  const dragStateRef = useRef<{
    groupId: string;
    startScreen: { x: number; y: number };
    dx: number;
    dy: number;
    oldBox: GroupBBox;
    excludedBefore: string[];
    nodeOld: Map<string, { x: number; y: number }>;
    nodeNew: Map<string, { x: number; y: number }>;
  } | null>(null);

  const endFrameDrag = useCallback(() => {
    const s = dragStateRef.current;
    dragStateRef.current = null;
    setDragOffset(null);
    if (!s) return;
    if (s.dx === 0 && s.dy === 0) return;
    const nodeOld: PositionRecord[] = [...s.nodeOld.entries()].map(([id, p]) => ({ id, x: p.x, y: p.y }));
    const nodeNew: PositionRecord[] = [...s.nodeNew.entries()].map(([id, p]) => ({ id, x: p.x, y: p.y }));
    const newBox = {
      x: s.oldBox.x + s.dx,
      y: s.oldBox.y + s.dy,
      w: s.oldBox.w,
      h: s.oldBox.h,
    };
    const draggedIds = new Set(s.nodeNew.keys());
    const excludedAfter = nodesRef.current
      .filter((n) => !draggedIds.has(n.id) && nodeInsideGroupBox(n, newBox))
      .map((n) => n.id);
    onGroupFrameDragStop?.({
      groupId: s.groupId,
      oldBox: s.oldBox,
      newBox,
      nodeOld,
      nodeNew,
      excludedBefore: s.excludedBefore,
      excludedAfter,
    });
  }, [onGroupFrameDragStop]);

  const onFrameMove = useCallback(
    (e: PointerEvent) => {
      const s = dragStateRef.current;
      if (!s) return;
      const dx = (e.clientX - s.startScreen.x) / zoomRef.current;
      const dy = (e.clientY - s.startScreen.y) / zoomRef.current;
      s.dx = dx;
      s.dy = dy;
      const offset = { id: s.groupId, x: dx, y: dy };
      setDragOffset(offset);
      onFrameDragOffsetChange?.(offset);
      s.nodeNew.forEach((_, id) => {
        const start = s.nodeOld.get(id);
        if (start) s.nodeNew.set(id, { x: start.x + dx, y: start.y + dy });
      });
      setNodes((prev) =>
        prev.map((n) => {
          const p = s.nodeNew.get(n.id);
          return p ? { ...n, position: { x: p.x, y: p.y } } : n;
        }),
      );
    },
    [setNodes, onFrameDragOffsetChange],
  );

  const endDrag = useCallback(() => {
    window.removeEventListener('pointermove', onFrameMove);
    window.removeEventListener('pointerup', endDrag);
    if (!draggingRef.current) return;
    draggingRef.current = false;
    if (paneRef.current) paneRef.current.style.cursor = '';
    const s = dragStateRef.current;
    const isClick = !!s && s.dx === 0 && s.dy === 0;
    endFrameDrag();
    setFrozenDragMembers(null);
    onFrameDragMembersChange?.(new Set());
    onFrameDragOffsetChange?.(null);
    if (isClick && s) {
      onGroupClick?.(s.groupId, { x: s.startScreen.x, y: s.startScreen.y });
      setOpenGroupId((prev) => (prev === s.groupId ? null : s.groupId));
    } else if (s) {
      onGroupClickSuppress?.();
    }
    clickSuppressRef.current = true;
    window.setTimeout(() => {
      clickSuppressRef.current = false;
    }, 0);
  }, [onFrameMove, endFrameDrag, onFrameDragMembersChange, onFrameDragOffsetChange, onGroupClick, onGroupClickSuppress]);

  const startFrameDrag = useCallback(
    (clientX: number, clientY: number, g: CanvasGroup) => {
      const nodeOld = new Map<string, { x: number; y: number }>();
      exclusiveMembersInGroup(nodesRef.current, g, groupsRef.current).forEach((n) => {
        nodeOld.set(n.id, { x: n.position.x, y: n.position.y });
      });
      draggingRef.current = true;
      dragStateRef.current = {
        groupId: g.id,
        startScreen: { x: clientX, y: clientY },
        dx: 0,
        dy: 0,
        oldBox: { ...g.box },
        excludedBefore: [...g.excludedIds],
        nodeOld,
        nodeNew: new Map(nodeOld),
      };
      if (paneRef.current) paneRef.current.style.cursor = 'grabbing';
      setFrozenDragMembers({ groupId: g.id, ids: new Set(nodeOld.keys()) });
      onBringGroupToFront?.(g.id);
      onFrameDragMembersChange?.(new Set(nodeOld.keys()));
      onFrameDragOffsetChange?.({ id: g.id, x: 0, y: 0 });
      window.addEventListener('pointermove', onFrameMove);
      window.addEventListener('pointerup', endDrag);
    },
    [onFrameMove, endDrag, onFrameDragMembersChange, onFrameDragOffsetChange, onBringGroupToFront],
  );

  const hitGroupAt = useCallback(
    (clientX: number, clientY: number, target: EventTarget | null): CanvasGroup | null => {
      if (!(target instanceof Element)) return null;
      if (!target.closest('.react-flow')) return null;
      if (
        (target.closest('.react-flow__node') && !target.closest('.react-flow__node-groupFrame')) ||
        target.closest('.react-flow__edge') ||
        target.closest('.react-flow__panel') ||
        target.closest(`.${styles.groupBadgeWrap}`) ||
        target.closest(`.${styles.groupTools}`) ||
        target.closest(`.${styles.selectionBar}`) ||
        target.closest(`.${styles.connectHandle}`)
      ) {
        return null;
      }
      for (const el of document.elementsFromPoint(clientX, clientY)) {
        if (!(el instanceof Element)) continue;
        const nodeEl = el.closest('.react-flow__node');
        if (nodeEl && !nodeEl.classList.contains('react-flow__node-groupFrame')) return null;
      }
      const p = screenToFlowPosition({ x: clientX, y: clientY });
      if (contentNodeAtFlowPoint(nodesRef.current, p)) return null;
      const list = groupsRef.current;
      for (let i = list.length - 1; i >= 0; i--) {
        const g = list[i];
        if (
          p.x >= g.box.x &&
          p.x <= g.box.x + g.box.w &&
          p.y >= g.box.y &&
          p.y <= g.box.y + g.box.h
        ) {
          return g;
        }
      }
      return null;
    },
    [screenToFlowPosition],
  );

  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      if (isPanningRef.current) return;
      if (e.button !== 0 || !e.isPrimary || draggingRef.current) return;
      if (isPassthroughOverlayTarget(e.target)) return;
      const flowPoint = screenToFlowPosition({ x: e.clientX, y: e.clientY });
      const content = contentNodeAtFlowPoint(nodesRef.current, flowPoint);
      if (content) {
        const onContentNode = e.target instanceof Element
          && Boolean(e.target.closest('.react-flow__node'))
          && !e.target.closest('.react-flow__node-groupFrame');
        const now = performance.now();
        const last = lastContentPressRef.current;
        const isDouble = last.id === content.id && now - last.at >= 80 && now - last.at < 350;
        lastContentPressRef.current = { id: content.id, at: now };
        if (onContentNode) return;
        e.stopPropagation();
        setNodes((prev) => prev.map((n) => ({ ...n, selected: n.id === content.id })));
        contentClickSuppressRef.current = true;
        window.setTimeout(() => {
          contentClickSuppressRef.current = false;
        }, 0);
        if (isDouble && content.type === 'textNode') {
          const editor = document.querySelector(
            `.react-flow__node[data-id="${CSS.escape(content.id)}"] [data-placeholder="输入内容..."]`,
          );
          editor?.dispatchEvent(new Event('bw-enter-edit'));
        }
        return;
      }
      const g = hitGroupAt(e.clientX, e.clientY, e.target);
      if (!g) return;
      e.stopPropagation();
      startFrameDrag(e.clientX, e.clientY, g);
    };
    const onClick = (e: MouseEvent) => {
      if (contentClickSuppressRef.current) {
        e.stopPropagation();
        e.preventDefault();
        return;
      }
      if (!clickSuppressRef.current || editGroupIdRef.current) return;
      e.stopPropagation();
      e.preventDefault();
    };
    const onDblClick = (e: MouseEvent) => {
      if (isPanningRef.current) return;
      if (isPassthroughOverlayTarget(e.target)) return;
      const flowPoint = screenToFlowPosition({ x: e.clientX, y: e.clientY });
      const content = contentNodeAtFlowPoint(nodesRef.current, flowPoint);
      if (content) {
        const onContentNode = e.target instanceof Element
          && Boolean(e.target.closest('.react-flow__node'))
          && !e.target.closest('.react-flow__node-groupFrame');
        if (!onContentNode) {
          e.preventDefault();
          e.stopPropagation();
        }
        return;
      }
      const g = hitGroupAt(e.clientX, e.clientY, e.target);
      if (!g) return;
      e.preventDefault();
      e.stopPropagation();
    };
    window.addEventListener('pointerdown', onDown, true);
    window.addEventListener('click', onClick, true);
    window.addEventListener('dblclick', onDblClick, true);
    return () => {
      window.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('click', onClick, true);
      window.removeEventListener('dblclick', onDblClick, true);
    };
  }, [hitGroupAt, startFrameDrag, screenToFlowPosition, setNodes]);

  useEffect(
    () => () => {
      if (!draggingRef.current) return;
      window.removeEventListener('pointermove', onFrameMove);
      window.removeEventListener('pointerup', endDrag);
      draggingRef.current = false;
    },
    [onFrameMove, endDrag],
  );

  const boxFor = (f: FrameInfo): GroupBBox =>
    dragOffset && dragOffset.id === f.id
      ? { x: f.box.x + dragOffset.x, y: f.box.y + dragOffset.y, w: f.box.w, h: f.box.h }
      : f.box;

  interface ConnectDragState {
    groupId: string;
    memberIds: string[];
    sources: { x: number; y: number }[];
  }
  const connectStateRef = useRef<ConnectDragState | null>(null);
  const [connectCursor, setConnectCursor] = useState<{ x: number; y: number } | null>(null);
  const [connectDraggingGroupId, setConnectDraggingGroupId] = useState<string | null>(null);
  const onConnectGroupDropRef = useRef(onConnectGroupDrop);
  onConnectGroupDropRef.current = onConnectGroupDrop;
  const onConnectGroupToTargetRef = useRef(onConnectGroupToTarget);
  onConnectGroupToTargetRef.current = onConnectGroupToTarget;

  const targetNodeIdAt = useCallback(
    (clientX: number, clientY: number, memberIds: string[]): string | null => {
      const el = document.elementFromPoint(clientX, clientY);
      if (!(el instanceof Element)) return null;
      const nodeEl = el.closest('.react-flow__node') as HTMLElement | null;
      if (!nodeEl) return null;
      const id = nodeEl.getAttribute('data-id');
      if (!id || memberIds.includes(id) || groupsRef.current.some((g) => g.id === id)) return null;
      return id;
    },
    [],
  );
  const targetNodeIdAtRef = useRef(targetNodeIdAt);
  targetNodeIdAtRef.current = targetNodeIdAt;

  const connectDragHandlersRef = useRef({
    onMove: (_e: PointerEvent) => {},
    onEnd: (_e: PointerEvent) => {},
    onContextMenu: (_e: Event) => {},
  });
  const onConnectMoveStable = useCallback((e: PointerEvent) => {
    connectDragHandlersRef.current.onMove(e);
  }, []);
  const onConnectEndStable = useCallback((e: PointerEvent) => {
    connectDragHandlersRef.current.onEnd(e);
  }, []);
  const onConnectContextMenuStable = useCallback((e: Event) => {
    connectDragHandlersRef.current.onContextMenu(e);
  }, []);

  const detachConnectDrag = useCallback(() => {
    window.removeEventListener('pointermove', onConnectMoveStable);
    window.removeEventListener('pointerup', onConnectEndStable);
    window.removeEventListener('pointercancel', onConnectEndStable);
    window.removeEventListener('contextmenu', onConnectContextMenuStable, true);
  }, [onConnectMoveStable, onConnectEndStable, onConnectContextMenuStable]);

  const resetConnectDrag = useCallback(() => {
    detachConnectDrag();
    connectStateRef.current = null;
    connectDraggingRef.current = false;
    setConnectCursor(null);
    setConnectDraggingGroupId(null);
    if (paneRef.current) paneRef.current.style.cursor = '';
  }, [detachConnectDrag]);

  connectDragHandlersRef.current.onMove = (e: PointerEvent) => {
    setConnectCursor({ x: e.clientX, y: e.clientY });
  };
  connectDragHandlersRef.current.onEnd = (e: PointerEvent) => {
    const s = connectStateRef.current;
    const commit = e.type === 'pointerup' && e.button === 0;
    resetConnectDrag();
    if (!commit || !s) return;
    const targetId = targetNodeIdAtRef.current(e.clientX, e.clientY, s.memberIds);
    const drop = onConnectGroupDropRef.current;
    if (drop) {
      drop(s.memberIds, targetId, { x: e.clientX, y: e.clientY });
    } else if (targetId) {
      onConnectGroupToTargetRef.current?.(s.memberIds, targetId);
    }
  };
  connectDragHandlersRef.current.onContextMenu = (e: Event) => {
    if (!connectStateRef.current) return;
    e.preventDefault();
    e.stopPropagation();
    resetConnectDrag();
  };

  const startConnectDrag = useCallback(
    (groupId: string, box: GroupBBox, excludedIds: string[], clientX: number, clientY: number) => {
      const host = groupsRef.current.find((g) => g.id === groupId);
      const members = host
        ? exclusiveMembersInGroup(nodesRef.current, host, groupsRef.current)
        : membersInGroupBox(nodesRef.current, box, excludedIds);
      const sources = members.map((n) => {
        const w = n.measured?.width ?? 200;
        const h = n.measured?.height ?? 120;
        return { x: n.position.x + w, y: n.position.y + h / 2 };
      });
      connectStateRef.current = {
        groupId,
        memberIds: members.map((n) => n.id),
        sources,
      };
      connectDraggingRef.current = true;
      setConnectCursor({ x: clientX, y: clientY });
      setConnectDraggingGroupId(groupId);
      if (paneRef.current) paneRef.current.style.cursor = 'crosshair';
      window.addEventListener('pointermove', onConnectMoveStable);
      window.addEventListener('pointerup', onConnectEndStable);
      window.addEventListener('pointercancel', onConnectEndStable);
      window.addEventListener('contextmenu', onConnectContextMenuStable, true);
    },
    [onConnectMoveStable, onConnectEndStable, onConnectContextMenuStable],
  );

  useEffect(
    () => () => {
      detachConnectDrag();
      connectStateRef.current = null;
      connectDraggingRef.current = false;
    },
    [detachConnectDrag],
  );

  return (
    <>
      {}
      <div className={styles.uiLayer} ref={uiLayerRef}>
        {frames.map((f) => {
          const box = boxFor(f);
          const pt = flowToScreenPosition({ x: box.x, y: box.y });
          const open = openGroupId === f.id;
          return (
            <div key={f.id} className={styles.groupBadgeWrap} style={{ left: pt.x, top: pt.y }}>
              <button
                className={styles.groupBadge}
                title={open ? '收起' : '组操作'}
                onClick={(e) => {
                  e.stopPropagation();
                  onBringGroupToFront?.(f.id);
                  setOpenGroupId(open ? null : f.id);
                }}
              >
                <Group size={12} strokeWidth={2} />
                <span>{f.count}</span>
              </button>
              {open && (
                <div className={styles.groupTools}>
                  <button
                    className={styles.toolBtn}
                    title="解组"
                    onClick={(e) => {
                      e.stopPropagation();
                      setOpenGroupId(null);
                      onUngroup(f.id);
                    }}
                  >
                    <Ungroup size={13} strokeWidth={2} />
                    <span>解组</span>
                  </button>
                  <button
                    className={styles.toolBtn}
                    title="下载组内全部素材"
                    onClick={(e) => {
                      e.stopPropagation();
                      const host = groups.find((g) => g.id === f.id);
                      const members = host
                        ? exclusiveMembersInGroup(nodes, host, groups)
                        : membersInGroupBox(nodes, f.box, f.excludedIds);
                      onDownloadNodes(members.map((n) => n.id));
                    }}
                  >
                    <Download size={13} strokeWidth={2} />
                    <span>下载</span>
                  </button>
                  <button
                    className={styles.toolBtn}
                    title="删除组内全部节点"
                    onClick={(e) => {
                      e.stopPropagation();
                      setOpenGroupId(null);
                      onDeleteGroup(f.id);
                    }}
                  >
                    <Trash2 size={13} strokeWidth={2} />
                    <span>删除</span>
                  </button>
                </div>
              )}
            </div>
          );
        })}

        {}
        {frames.map((f) => {
          if (openGroupId !== f.id || connectDraggingGroupId === f.id) return null;
          const box = boxFor(f);
          const pt = flowToScreenPosition({ x: box.x + box.w, y: box.y + box.h / 2 });
          return (
            <button
              key={`connect-${f.id}`}
              className={styles.connectHandle}
              style={{ left: pt.x, top: pt.y }}
              title="拖动后选择生成类型"
              onPointerDown={(e) => {
                if (e.button !== 0) return;
                e.preventDefault();
                e.stopPropagation();
                startConnectDrag(f.id, f.box, f.excludedIds, e.clientX, e.clientY);
              }}
              onContextMenu={(e) => {
                e.preventDefault();
                e.stopPropagation();
              }}
            >
              <Plus size={14} strokeWidth={2} />
            </button>
          );
        })}

        {}
        {(showCreateBtn || showSelectionDownload) && createBtnPt && (
          <div className={styles.selectionBar} style={{ left: createBtnPt.x, top: createBtnPt.y }}>
            {showCreateBtn && (
              <button
                className={styles.toolBtn}
                onClick={(e) => {
                  e.stopPropagation();
                  onCreateGroup(selectedNodes);
                }}
                title="成组（Ctrl/Cmd+G）"
              >
                <Group size={12} strokeWidth={2} />
                <span>成组</span>
              </button>
            )}
            {showSelectionDownload && (
              <button
                className={styles.toolBtn}
                onClick={(e) => {
                  e.stopPropagation();
                  onDownloadNodes(selectedNodes.map((node) => node.id));
                }}
                title="下载选中全部素材"
              >
                <Download size={12} strokeWidth={2} />
                <span>下载</span>
              </button>
            )}
          </div>
        )}

        {}
        {connectCursor && connectStateRef.current && (
          <svg className={styles.connectPreview}>
            {connectStateRef.current.sources.map((src, i) => {
              const s = flowToScreenPosition(src);
              const [path] = getBezierPath({
                sourceX: s.x,
                sourceY: s.y,
                sourcePosition: Position.Right,
                targetX: connectCursor.x,
                targetY: connectCursor.y,
                targetPosition: Position.Left,
              });
              return <path key={i} d={path} />;
            })}
          </svg>
        )}
      </div>
    </>
  );
}