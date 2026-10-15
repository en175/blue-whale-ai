import { type VideoRefRole } from '@/custom/enums';
import type { Dispatch, RefObject, SetStateAction } from 'react';
import type { Edge, Node } from '@xyflow/react';
import { readDraftMaterialRefs, type VideoMediaRef } from '../videoMediaRefs';
import type { CanvasHistoryApi } from './useCanvasHistory';

type VideoFreeRefUpdate = {
  freeReference:
    | { operation: 'add'; item: VideoMediaRef; role: VideoRefRole }
    | { operation: 'remove'; key: string }
    | { operation: 'assign'; assignments: Array<{ nodeId: string; role: VideoRefRole }> };
};

export interface CanvasDraftRefActionsHost {
  audioDraftId: string | null | undefined;
  mediaNodesRef: RefObject<Node[]>;
  edgesRef: RefObject<Edge[]>;
  historyRef: RefObject<CanvasHistoryApi | null>;
  setEdges: Dispatch<SetStateAction<Edge[]>>;
  isGeneratingNode: (id: string) => boolean;
  removeTargetInputs: (edgeIds: string[]) => void;
  patchMediaNode: (nodeId: string, patch: Record<string, unknown>) => void;
  validateAudioRefConnect: (source: string, target: string) => boolean;
  addCanvasEdge: (source: string, target: string, refRole?: VideoRefRole, marker?: Record<string, unknown>) => void;
  generationDock: { updateVideoDraft: (input: VideoFreeRefUpdate) => void };
}

export interface CanvasDraftRefActionsHandles {
  removeRefEdges: (draftId: string, sourceNodeId: string) => void;
  handleAddAudioCanvasRef: (nodeId: string) => void;
  removeDraftMaterialRef: (draftId: string, materialId: string) => void;
  assignVideoRefRoles: (draftId: string, assignments: Array<{ nodeId: string; role: VideoRefRole }>) => void;
  appendVideoFreeRef: (item: VideoMediaRef, role: VideoRefRole) => void;
  removeVideoFreeRef: (key: string) => void;
  assignVideoFreeRefRoles: (assignments: Array<{ nodeId: string; role: VideoRefRole }>) => void;
}

export function useCanvasDraftRefActions(host: CanvasDraftRefActionsHost): CanvasDraftRefActionsHandles {
  const {
    audioDraftId,
    mediaNodesRef,
    edgesRef,
    historyRef,
    setEdges,
    isGeneratingNode,
    removeTargetInputs,
    patchMediaNode,
    validateAudioRefConnect,
    addCanvasEdge,
    generationDock,
  } = host;

  const removeRefEdges = (draftId: string, sourceNodeId: string) => {
    if (isGeneratingNode(draftId)) return;
    removeTargetInputs(edgesRef.current.filter(edge => edge.source === sourceNodeId && edge.target === draftId).map(edge => edge.id));
  };
  const handleAddAudioCanvasRef = (nodeId: string) => {
    if (!audioDraftId) return;
    if (!validateAudioRefConnect(nodeId, audioDraftId)) return;
    addCanvasEdge(nodeId, audioDraftId);
  };
  const removeDraftMaterialRef = (draftId: string, materialId: string) => {
    const existing = readDraftMaterialRefs(mediaNodesRef.current.find((n) => n.id === draftId));
    patchMediaNode(draftId, {
      draftMaterialRefs: existing.filter((m) => m.materialId !== materialId),
    });
  };
  const assignVideoRefRoles = (
    draftId: string,
    assignments: Array<{ nodeId: string; role: VideoRefRole }>,
  ) => {
    if (assignments.length === 0) return;
    const roleByKey = new Map(assignments.map((a) => [a.nodeId, a.role]));
    const prevEdges = edgesRef.current;
    let edgesChanged = false;
    const nextEdges = prevEdges.map((e) => {
      if (e.target !== draftId) return e;
      const role = roleByKey.get(e.source);
      if (!role) return e;
      const currentRole = (e.data as Record<string, unknown> | undefined)?.refRole;
      if (role === 'reference') {
        if (currentRole === undefined) return e;
        edgesChanged = true;
        const { refRole: _drop, ...restData } = (e.data ?? {}) as Record<string, unknown>;
        return { ...e, data: restData };
      }
      if (currentRole === role) return e;
      edgesChanged = true;
      return { ...e, data: { ...e.data, refRole: role } };
    });
    if (edgesChanged) {
      historyRef.current?.pushReplaceEdges(prevEdges, nextEdges);
      edgesRef.current = nextEdges;
      setEdges(nextEdges);
    }
    const draftNode = mediaNodesRef.current.find((n) => n.id === draftId);
    const existing = readDraftMaterialRefs(draftNode);
    if (existing.length > 0) {
      const nextMaterials = existing.map((m) => {
        const role = roleByKey.get(m.materialId);
        return role ? { ...m, role } : m;
      });
      if (nextMaterials.some((m, i) => m.role !== existing[i]!.role)) {
        patchMediaNode(draftId, { draftMaterialRefs: nextMaterials });
      }
    }
  };
  const appendVideoFreeRef = (item: VideoMediaRef, role: VideoRefRole) => generationDock.updateVideoDraft({ freeReference: { operation: 'add', item, role } });
  const removeVideoFreeRef = (key: string) => generationDock.updateVideoDraft({ freeReference: { operation: 'remove', key } });
  const assignVideoFreeRefRoles = (assignments: Array<{ nodeId: string; role: VideoRefRole }>) => generationDock.updateVideoDraft({ freeReference: { operation: 'assign', assignments } });

  return { removeRefEdges, handleAddAudioCanvasRef, removeDraftMaterialRef, assignVideoRefRoles, appendVideoFreeRef, removeVideoFreeRef, assignVideoFreeRefRoles };
}
