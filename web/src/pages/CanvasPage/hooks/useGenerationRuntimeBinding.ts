import { useMemo, useRef, type Dispatch, type RefObject, type SetStateAction } from 'react';
import type { Edge, Node } from '@xyflow/react';
import type { QueryClient } from '@tanstack/react-query';
import { useAuthPromptStore } from '@/stores/authPrompt';
import { openRechargeForCreditsError } from '@/utils/creditsGate';
import { generationRecoveryPageOptions } from '@/api/canvasRecovery';
import { createGenerationRuntime, type GenerationRuntime, type GenerationRuntimeHost } from '../generationRuntime/runtime';
import { normalGenerationTask } from '../generationRuntime/normalGeneration';
import { storyboardTask } from '../generationRuntime/storyboardTasks';
import { audioMixTask, audioVideoMuxTask } from '../generationRuntime/mixMuxTasks';
import { sceneSplitTask, vocalSplitTask } from '../generationRuntime/multiOutputTasks';
import { videoToolsTask } from '../generationRuntime/videoTools';
import type { RuntimeNodeView } from '../generationRuntime/types';
import type { VideoRefRole } from '../videoMediaRefs';
import type { MediaDims } from '../components/MediaNode/mediaContentSize';

export interface GenerationRuntimeBindingInput {
  generationRuntimeHostRef: RefObject<GenerationRuntimeHost | null>;
  generationRuntimeRef: RefObject<GenerationRuntime | null>;
  activeProjectRef: RefObject<string | null>;
  docLoadEpochRef: RefObject<object>;
  mediaNodesRef: RefObject<Node[]>;
  edgesRef: RefObject<Edge[]>;
  activeJobByNodeRef: RefObject<Map<string, string>>;
  locallyRemovedGenerationNodesRef: RefObject<Set<string>>;
  pendingDeleteJobNodesRef: RefObject<Set<string>>;
  actionsRef: RefObject<{
    removeMediaNode: (id: string) => void;
    cancelJob: (id: string) => void;
    retryJob: (id: string) => void;
    fixFollowVideo: (id: string) => void;
    duplicate: (id: string) => void;
    renameCard: (id: string, name: string) => void;
    addToChat: (id: string) => void;
    download: (id: string) => void;
    showDetails: (id: string) => void;
  }>;
  setMediaNodes: Dispatch<SetStateAction<Node[]>>;
  setEdges: Dispatch<SetStateAction<Edge[]>>;
  patchMediaNode: (nodeId: string, patch: Record<string, unknown>) => void;
  attachCallbacks: (node: Node) => Node;
  handleSaveMediaToAssets: (id: string) => void;
  handleMediaDims: (id: string, dims: MediaDims) => void;
  addCanvasEdge: (source: string, target: string, refRole?: VideoRefRole, marker?: Record<string, unknown>) => void;
  applyJobTerminal: GenerationRuntimeHost['applyTerminal'];
  settleCancelledNode: GenerationRuntimeHost['settleCancelled'];
  flushCanvasSave: (projectId: string) => Promise<boolean>;
  queryClient: QueryClient;
  showToast: (kind: 'success' | 'warn' | 'error', message: string) => void;
  rememberGeneratedAsset: GenerationRuntimeHost['rememberAsset'];
  imageToolsTask: Parameters<GenerationRuntime['register']>[0];
}

export function useGenerationRuntimeBinding(input: GenerationRuntimeBindingInput): void {
  const inputRef = useRef(input);
  inputRef.current = input;
  const host = useMemo((): GenerationRuntimeHost => ({
    getProjectId: () => inputRef.current.activeProjectRef.current,
    getLoadEpoch: () => inputRef.current.docLoadEpochRef.current,
    getMediaNodes: () => inputRef.current.mediaNodesRef.current as unknown as RuntimeNodeView[],
    findNode: (nodeId) => {
      const node = inputRef.current.mediaNodesRef.current.find((n) => n.id === nodeId);
      return node ? (node as unknown as RuntimeNodeView) : null;
    },
    patchNode: (nodeId, patch) => inputRef.current.patchMediaNode(nodeId, patch),
    insertMediaNode: (node) => {
      const { attachCallbacks, actionsRef, handleSaveMediaToAssets, handleMediaDims, mediaNodesRef, setMediaNodes } = inputRef.current;
      const built = attachCallbacks({
        id: node.id,
        type: 'mediaNode',
        position: node.position,
        data: {
          ...node.data,
          onDelete: (id: string) => actionsRef.current.removeMediaNode(id),
          onCancelJob: (id: string) => actionsRef.current.cancelJob(id),
          onRetryJob: (id: string) => actionsRef.current.retryJob(id),
          onFixFollowVideo: (id: string) => actionsRef.current.fixFollowVideo(id),
          onDuplicate: (id: string) => actionsRef.current.duplicate(id),
          onTitleChange: (id: string, name: string) => actionsRef.current.renameCard(id, name),
          onAddToChat: (id: string) => actionsRef.current.addToChat(id),
          onDownload: (id: string) => actionsRef.current.download(id),
          onShowDetails: (id: string) => actionsRef.current.showDetails(id),
          onSaveToAssets: (id: string) => handleSaveMediaToAssets(id),
          onMediaDims: handleMediaDims,
        },
      } as Node);
      mediaNodesRef.current = [...mediaNodesRef.current, built];
      setMediaNodes(mediaNodesRef.current);
    },
    removeMediaNode: (nodeId) => {
      const { mediaNodesRef, setMediaNodes, edgesRef, setEdges } = inputRef.current;
      const next = mediaNodesRef.current.filter((n) => n.id !== nodeId);
      mediaNodesRef.current = next;
      setMediaNodes(next);
      const nextEdges = edgesRef.current.filter((edge) => edge.source !== nodeId && edge.target !== nodeId);
      edgesRef.current = nextEdges;
      setEdges(nextEdges);
    },
    getEdges: () => inputRef.current.edgesRef.current.map((edge) => ({ source: edge.source, target: edge.target })),
    addEdge: (source, target, role, marker) => {
      inputRef.current.addCanvasEdge(source, target, role as VideoRefRole, marker);
    },
    getActiveJob: (nodeId) => inputRef.current.activeJobByNodeRef.current.get(nodeId),
    setActiveJob: (nodeId, token) => { inputRef.current.activeJobByNodeRef.current.set(nodeId, token); },
    clearActiveJob: (nodeId) => { inputRef.current.activeJobByNodeRef.current.delete(nodeId); },
    isLocallyRemoved: (nodeId) => inputRef.current.locallyRemovedGenerationNodesRef.current.has(nodeId),
    markLocallyRemoved: (nodeId) => { inputRef.current.locallyRemovedGenerationNodesRef.current.add(nodeId); },
    registerPendingDelete: (nodeId) => { inputRef.current.pendingDeleteJobNodesRef.current.add(nodeId); },
    isPendingDelete: (nodeId) => inputRef.current.pendingDeleteJobNodesRef.current.has(nodeId),
    applyTerminal: (nodeId, jobId, detail) => inputRef.current.applyJobTerminal(nodeId, jobId, detail),
    settleCancelled: (nodeId) => inputRef.current.settleCancelledNode(nodeId),
    saveCanvas: (projectId) => inputRef.current.flushCanvasSave(projectId),
    fetchRecoveryPage: (projectId, options) => inputRef.current.queryClient.fetchQuery(generationRecoveryPageOptions(projectId, options)),
    toast: (kind, message) => inputRef.current.showToast(kind, message),
    openRechargeForCreditsError,
    addAuthResume: (fn) => { useAuthPromptStore.getState().addResume(fn); },
    rememberAsset: (asset, fallbackType) => inputRef.current.rememberGeneratedAsset(asset, fallbackType),
  }), []);

  const { generationRuntimeHostRef, generationRuntimeRef, imageToolsTask } = input;
  if (generationRuntimeHostRef.current !== host) {
    generationRuntimeHostRef.current = host;
  }
  if (generationRuntimeRef.current == null) {
    const runtime = createGenerationRuntime(host);
    runtime.register(normalGenerationTask);
    runtime.register(storyboardTask);
    runtime.register(imageToolsTask);
    runtime.register(audioMixTask);
    runtime.register(audioVideoMuxTask);
    runtime.register(sceneSplitTask);
    runtime.register(vocalSplitTask);
    runtime.register(videoToolsTask);
    generationRuntimeRef.current = runtime;
  }
}
