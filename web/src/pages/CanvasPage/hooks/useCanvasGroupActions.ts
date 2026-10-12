import { type Dispatch, type RefObject, type SetStateAction, useCallback } from 'react';
import type { Node } from '@xyflow/react';
import { newNodeId } from '../nodeId';
import type { CanvasHistoryApi } from './useCanvasHistory';
import {
  applyIndependentGroupDrag,
  bringGroupToFront,
  exclusiveMembersInGroup,
  groupFrameBBox,
  isolateNewGroupMembers,
  selectionHasUngroupableCards,
  selectionHasUngroupableGenNodes,
  MIN_GROUP_MEMBERS,
  type CanvasGroup,
  type GroupFrameDragResult,
} from '../canvasGroups';

export interface CanvasGroupActionsHost {
  setGroups: Dispatch<SetStateAction<CanvasGroup[]>>;
  groupsRef: RefObject<CanvasGroup[]>;
  setTextNodes: Dispatch<SetStateAction<Node[]>>;
  setMediaNodes: Dispatch<SetStateAction<Node[]>>;
  setProductNodes: Dispatch<SetStateAction<Node[]>>;
  setAssetNodes: Dispatch<SetStateAction<Node[]>>;
  textNodesRef: RefObject<Node[]>;
  mediaNodesRef: RefObject<Node[]>;
  productNodesRef: RefObject<Node[]>;
  assetNodesRef: RefObject<Node[]>;
  historyRef: RefObject<CanvasHistoryApi | null>;
  pendingDeleteGroup: { id: string; count: number } | null;
  setPendingDeleteGroup: Dispatch<SetStateAction<{ id: string; count: number } | null>>;
  removeCanvasNodes: (ids: string[]) => void;
  showToast: (type: 'success' | 'error' | 'warn', msg: string) => void;
}

export function useCanvasGroupActions(host: CanvasGroupActionsHost) {
  const {
    setGroups,
    groupsRef,
    setTextNodes,
    setMediaNodes,
    setProductNodes,
    setAssetNodes,
    textNodesRef,
    mediaNodesRef,
    productNodesRef,
    assetNodesRef,
    historyRef,
    pendingDeleteGroup,
    setPendingDeleteGroup,
    removeCanvasNodes,
    showToast,
  } = host;

  const handleCreateGroup = (selectedNodes: Node[]) => {
    const members = selectedNodes.filter((n) => !(n.data as { emptyShell?: boolean } | undefined)?.emptyShell);
    if (members.length < MIN_GROUP_MEMBERS) return;
    if (selectionHasUngroupableCards(members)) {
      showToast('warn', '风格卡、角色卡、物体卡、环境卡、商品卡无法成组');
      return;
    }
    if (selectionHasUngroupableGenNodes(members)) {
      showToast('warn', '待生成草稿、生成中节点无法成组');
      return;
    }
    const box = groupFrameBBox(members);
    if (!box) return;
    const memberIds = new Set(members.map((n) => n.id));
    const all = [
      ...textNodesRef.current,
      ...mediaNodesRef.current,
      ...productNodesRef.current,
      ...assetNodesRef.current,
    ];
    const group: CanvasGroup = { id: newNodeId('group'), box, excludedIds: [] };
    const before = groupsRef.current;
    const after = isolateNewGroupMembers(before, all, group, memberIds);
    setGroups(after);
    historyRef.current?.pushCreateGroup(after[after.length - 1] ?? group, before, after);
  };

  const handleGroupFrameDragStop = useCallback((res: GroupFrameDragResult) => {
    const posNew = new Map(res.nodeNew.map((p) => [p.id, { x: p.x, y: p.y }]));
    const nodesAfter = [
      ...textNodesRef.current,
      ...mediaNodesRef.current,
      ...productNodesRef.current,
      ...assetNodesRef.current,
    ].map((n) => {
      const p = posNew.get(n.id);
      return p ? { ...n, position: { x: p.x, y: p.y } } : n;
    });
    const { groups: nextGroups, peerExclusions } = applyIndependentGroupDrag(
      groupsRef.current,
      nodesAfter,
      res,
    );
    setGroups(nextGroups);
    const recorded: GroupFrameDragResult = { ...res, peerExclusions };
    if (res.nodeNew.length === 0) {
      historyRef.current?.pushGroupMove(recorded);
      return;
    }
    const applyPos = (prev: Node[]) =>
      prev.map((n) => {
        const p = posNew.get(n.id);
        return p ? { ...n, position: { x: p.x, y: p.y } } : n;
      });
    setTextNodes(applyPos);
    setMediaNodes(applyPos);
    setProductNodes(applyPos);
    setAssetNodes(applyPos);
    historyRef.current?.pushGroupMove(recorded);
  }, [setTextNodes, setMediaNodes, setProductNodes, setAssetNodes, setGroups]);

  const handleBringGroupToFront = (groupId: string) => {
    setGroups((prev) => bringGroupToFront(prev, groupId));
  };

  const handleUngroup = (groupId: string) => {
    const group = groupsRef.current.find((g) => g.id === groupId);
    if (!group) return;
    setGroups((prev) => prev.filter((g) => g.id !== groupId));
    historyRef.current?.pushUngroup(group);
  };

  const handleDeleteGroup = (groupId: string) => {
    const group = groupsRef.current.find((g) => g.id === groupId);
    if (!group) return;
    const all = [
      ...textNodesRef.current,
      ...mediaNodesRef.current,
      ...productNodesRef.current,
      ...assetNodesRef.current,
    ];
    const count = exclusiveMembersInGroup(all, group, groupsRef.current).length;
    setPendingDeleteGroup({ id: groupId, count });
  };

  const confirmDeleteGroup = () => {
    const pending = pendingDeleteGroup;
    setPendingDeleteGroup(null);
    if (!pending) return;
    const group = groupsRef.current.find((g) => g.id === pending.id);
    if (!group) return;
    const all = [
      ...textNodesRef.current,
      ...mediaNodesRef.current,
      ...productNodesRef.current,
      ...assetNodesRef.current,
    ];
    const inside = exclusiveMembersInGroup(all, group, groupsRef.current).map((n) => n.id);
    if (inside.length > 0) removeCanvasNodes(inside);
    setGroups((prev) => prev.filter((g) => g.id !== pending.id));
    historyRef.current?.pushDeleteGroup(group, all.filter((n) => inside.includes(n.id)), []);
  };

  return {
    handleCreateGroup,
    handleGroupFrameDragStop,
    handleBringGroupToFront,
    handleUngroup,
    handleDeleteGroup,
    confirmDeleteGroup,
  };
}
