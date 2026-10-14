import type { RefObject } from 'react';
import type { Edge, Node } from '@xyflow/react';
import { imageRefSourceError } from '../mediaRefs';
import { readRefRole, videoRefSourceError } from '../videoMediaRefs';
import type { ToolSessionDeps } from '../toolSessionCoordinator';
import type { createCanvasToolSessions } from '../canvasToolSessions';

type ShowToast = (type: 'success' | 'error' | 'warn', msg: string) => void;
type ToolRuntime = ReturnType<typeof createCanvasToolSessions>['runtime'];

export function useCanvasPaneSession(input: {
  toolRuntime: ToolRuntime;
  setSelectRequest: (request: { id: string; ts: number }) => void;
  dismissGenPanels: () => void;
  cancelAgentCandidate: () => void;
  imagePickSessionActive: boolean;
  videoPickSessionActive: boolean;
  audioPickSessionActive: boolean;
  endImagePickSession: () => void;
  endVideoPickSession: () => void;
  endAudioPickSession: () => void;
  pickMode: unknown;
  pickTarget: unknown;
  resetPickState: () => void;
  dismissAllGenPanels: () => void;
  mediaNodesRef: RefObject<Node[]>;
  edgesRef: RefObject<Edge[]>;
  showToast: ShowToast;
}) {
  const buildToolSessionDeps = (): ToolSessionDeps => ({
    dismissGenPanels: input.dismissGenPanels,
    selectNode: (nodeId: string) => input.setSelectRequest({ id: nodeId, ts: Date.now() }),
  });
  const editSessionActive = input.toolRuntime.hasEditSession();
  const exitEditSessionForGenPanel = () => {
    input.toolRuntime.beforeGenPanel();
  };
  const handleCanvasPaneClick = () => {
    input.cancelAgentCandidate();
    if (input.toolRuntime.onPaneClick() === 'consumed') return;
    if (input.imagePickSessionActive) { input.endImagePickSession(); return; }
    if (input.videoPickSessionActive) { input.endVideoPickSession(); return; }
    if (input.audioPickSessionActive) { input.endAudioPickSession(); return; }
    if (input.pickMode || input.pickTarget) {
      input.resetPickState();
      return;
    }
    input.dismissAllGenPanels();
  };
  const warnStaleMediaRefs = (targetNodeId: string, kind: 'image' | 'video') => {
    const byId = new Map(input.mediaNodesRef.current.map((n) => [n.id, n]));
    const stale = input.edgesRef.current.some((e) => {
      if (e.target !== targetNodeId) return false;
      const source = byId.get(e.source);
      if (!source || source.type !== 'mediaNode') return false;
      return kind === 'image'
        ? imageRefSourceError(source) !== null
        : videoRefSourceError(source, readRefRole(e)) !== null;
    });
    if (stale) input.showToast('warn', '部分参考素材已失效，请恢复素材或移除引用后发送');
  };
  return {
    buildToolSessionDeps,
    editSessionActive,
    exitEditSessionForGenPanel,
    handleCanvasPaneClick,
    warnStaleMediaRefs,
  };
}
