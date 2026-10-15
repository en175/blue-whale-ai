import type { ReactNode } from 'react';
import type { Edge, Node } from '@xyflow/react';
import { restorePromptDoc } from '@/custom/utils/prompt-doc';
import { draftSeedEquals, type VideoDraftSeed } from './draftSeed';
import { hasGenerationRecord } from './mediaReEdit';
import { mediaDockSelectionVisibility, holdGenerationDockSubmission, reportGenerationDockSubmissionError, runSynchronousGenerationDockSubmission, type DockSelection, type GenerationDockSubmissionHost } from './generationDockCoordinator';
import type { PromptDoc } from '@/custom/utils/prompt-doc';
import type { GenerationRefItem, VideoJobParameters } from '@/custom/api/jobs';
import { composedPromptLimitError } from '@/custom/utils/prompt-max-length';
import { composeImageSendPrompt } from './components/ImageDialog/composeImageSendPrompt';
import { orderRefStripItems, videoRefStripKey } from './components/RefThumbnail/strip-dnd';
import { buildVideoJobReferences } from './videoJobReferences';
import type { VideoGenSeedParams, VideoDraftParamsPatch, VideoGenOptions } from './components/BottomDialog';
import type { MediaGenStatus } from './components/MediaNode';
import { checkAddVideoRef, freshVideoCanvasRefs, videoRefConflict, type VideoMediaRef, type VideoMediaRefs, type VideoRefRole } from './videoMediaRefs';
import { mergedVideoRefsWithTextIndex, videoTextIndexSendError } from './textIndexSync';
import { draftVideoModeOf, videoModeAfterRefAdd } from './videoModes';

export interface VideoDockEntry { nodeId?: string; preset?: VideoGenSeedParams; intent?: 'manual' | 'selection' }
export interface VideoDockPatch extends VideoDraftParamsPatch {
  targetNodeId?: string;
  attachments?: { targetNodeId?: string; removeNodeId?: string; orderedNodeIds?: string[] };
  freeReference?:
    | { operation: 'add'; item: VideoMediaRef; role: VideoRefRole }
    | { operation: 'replace'; item: VideoMediaRef; role: 'first' | 'last' }
    | { operation: 'remove'; key: string }
    | { operation: 'reorder'; keys: string[] }
    | { operation: 'assign'; assignments: Array<{ nodeId: string; role: VideoRefRole }> };
}
export interface VideoDockSend { text: string; options: VideoGenOptions; promptDoc?: PromptDoc | null }
export interface VideoDockTask { parameters: VideoJobParameters; references: GenerationRefItem[]; targetNodeId?: string; options: VideoGenOptions; promptDoc?: PromptDoc | null }
export interface VideoGenerationDockHost extends GenerationDockSubmissionHost {
  promptMaxLength(modelId: string): Promise<number | null>;
  save(projectId: string): Promise<boolean>;
  refUnsupported(modelId: string, refs: VideoMediaRefs): string | null;
  startTask(input: VideoDockTask): boolean;
  getNodes(): Node[];
  getEdges(): Edge[];
  attachmentsOf(id: string): NonNullable<VideoDraftSeed['attachments']>;
  canOpen(id?: string): boolean;
  beginEdit(id?: string): void;
  endPicking(): void;
  resetAssetPicking(): void;
  warnStaleRefs(id: string): void;
  patchNode(id: string, patch: Record<string, unknown>): void;
  getAvailability(): { submittingNodeId: string | null; saveFailed: boolean };
  toast(type: 'warn' | 'error', message: string): void;
  render?(): ReactNode;
}

export function createVideoGenerationDock(getHost: () => VideoGenerationDockHost) {
  let state: { visible: boolean; boundId: string | null; seed: VideoDraftSeed | null; selectionExempt: boolean; freeRefs: VideoMediaRefs } = {
    visible: false, boundId: null, seed: null, selectionExempt: false, freeRefs: { reference: [] },
  };
  const listeners = new Set<() => void>();
  let version = 0;
  const change = (patch: Partial<typeof state>, notifyAfterQueuedWork = false) => {
    if (Object.entries(patch).every(([key, value]) => state[key as keyof typeof state] === value)) return;
    state = { ...state, ...patch }; version += 1;
    const notify = () => listeners.forEach(listener => listener());
    if (notifyAfterQueuedWork) queueMicrotask(notify);
    else notify();
  };
  const close = () => {
    change({ visible: false, selectionExempt: true, freeRefs: { reference: [] } });
    getHost().endPicking(); getHost().resetAssetPicking();
  };
  let lastNodes: Node[] = [], lastTextNodes: Node[] = [], lastMediaNodes: Node[] = [], lastEdges: Edge[] | null = null;
  let lastBoundId: string | null | undefined, lastFreeRefs: VideoMediaRefs | undefined;
  let attachments: VideoDraftSeed['attachments'], boundRefs: VideoMediaRefs | undefined;
  let freeRefsView: VideoMediaRefs = state.freeRefs;
  let textIndexError: ReturnType<typeof videoTextIndexSendError> | undefined;
  const sameNodes = (a: Node[], b: Node[]) => a.length === b.length && a.every((node, index) => node === b[index]);
  return {
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    getVersion: () => version,
    view() {
      const host = getHost();
      const nodes = host?.getNodes() ?? [], edges = host?.getEdges() ?? [];
      const mediaNodes = nodes.filter(node => node.type === 'mediaNode'), textNodes = nodes.filter(node => node.type === 'textNode');
      const bindingChanged = lastBoundId !== state.boundId, edgesChanged = lastEdges !== edges, nodesChanged = !sameNodes(lastNodes, nodes);
      if (bindingChanged || edgesChanged || !sameNodes(lastTextNodes, textNodes)) attachments = state.boundId ? host.attachmentsOf(state.boundId) : undefined;
      if (bindingChanged || edgesChanged || nodesChanged) {
        boundRefs = state.boundId ? mergedVideoRefsWithTextIndex(state.boundId, edges, mediaNodes, textNodes) : undefined;
        textIndexError = state.boundId ? videoTextIndexSendError(state.boundId, edges, mediaNodes, textNodes) : undefined;
      }
      if (lastFreeRefs !== state.freeRefs || !sameNodes(lastMediaNodes, mediaNodes)) freeRefsView = freshVideoCanvasRefs(state.freeRefs, mediaNodes);
      lastNodes = nodes; lastTextNodes = textNodes; lastMediaNodes = mediaNodes; lastEdges = edges; lastBoundId = state.boundId; lastFreeRefs = state.freeRefs;
      const availability = host?.getAvailability();
      const node = nodes.find(node => node.id === state.boundId);
      return {
        visible: state.visible, boundId: state.boundId, seed: state.seed, freeRefs: state.freeRefs,
        attachments, mediaRefs: state.boundId ? boundRefs! : freeRefsView, textIndexError,
        draftBinding: {
          saveFailed: availability?.saveFailed === true,
          ...(state.boundId ? { submitting: availability?.submittingNodeId === state.boundId, restoreExisting: hasGenerationRecord(node), status: node?.data.genStatus as MediaGenStatus | undefined } : {}),
        },
      } as const;
    },
    canOpen: (input: VideoDockEntry) => (input.intent !== 'selection' || !state.selectionExempt) && getHost().canOpen(input.nodeId),
    beforeOpen(input: VideoDockEntry) { getHost().endPicking(); getHost().beginEdit(input.nodeId); },
    open(input: VideoDockEntry) {
      if (!input.nodeId) { change({ visible: true, selectionExempt: false }); return; }
      const nodes = getHost().getNodes();
      const data = nodes.find(node => node.id === input.nodeId)?.data ?? {};
      const draftRefs = mergedVideoRefsWithTextIndex(
        input.nodeId, getHost().getEdges(),
        nodes.filter(node => node.type === 'mediaNode'), nodes.filter(node => node.type === 'textNode'),
      );
      const preset = input.preset;
      const seed: VideoDraftSeed = {
        ts: Math.max(Date.now(), (state.seed?.ts ?? 0) + 1), targetNodeId: input.nodeId, text: typeof data.prompt === 'string' ? data.prompt : '',
        doc: restorePromptDoc(data.promptDoc, data.prompt), attachments: getHost().attachmentsOf(input.nodeId),
        params: {
          modelId: preset?.modelId ?? (typeof data.draftModelId === 'string' ? data.draftModelId : undefined),
          aspectRatio: preset?.aspectRatio ?? (typeof data.draftRatio === 'string' ? data.draftRatio : undefined),
          resolution: preset?.resolution ?? (typeof data.draftSize === 'string' ? data.draftSize : undefined),
          duration: preset?.duration ?? (typeof data.draftDuration === 'number' ? data.draftDuration : undefined),
          mode: preset?.mode ?? draftVideoModeOf(data, draftRefs) ?? undefined,
          generateAudio: preset?.generateAudio ?? (typeof data.draftGenerateAudio === 'boolean' ? data.draftGenerateAudio : undefined),
          sampleMode: preset?.sampleMode ?? (typeof data.draftSampleMode === 'boolean' ? data.draftSampleMode : data.videoStage === 'sample' ? true : undefined),
        },
      };
      change({ visible: true, boundId: input.nodeId, seed: draftSeedEquals(state.seed, seed) ? state.seed : seed, selectionExempt: false });
      getHost().warnStaleRefs(input.nodeId);
    },
    hide(nextPanel: string) {
      if (nextPanel === 'imageEnhance' || nextPanel === 'videoEnhance' || nextPanel === 'frameInterpolation') { close(); return; }
      change({ visible: false, ...(nextPanel === 'image' || nextPanel === 'audio' ? { boundId: null } : {}) });
    },
    close,
    referencePicked() { change({ selectionExempt: true }); },
    submitted(_nodeId: string) { change({ visible: false, selectionExempt: true }); },
    selection(input: DockSelection) {
      const visible = mediaDockSelectionVisibility(state, input);
      if (visible !== undefined) change({ visible });
    },
    updateDraft(patch: VideoDockPatch) {
      const ref = patch.freeReference;
      if (ref) {
        const previous = state.freeRefs;
        if (ref.operation === 'add') {
          const mode = videoModeAfterRefAdd(state.seed?.params?.mode, previous, ref.item!.mediaType);
          const error = checkAddVideoRef(ref.role!, ref.item!.mediaType, ref.item!.assetId, previous, undefined, [ref.item!.materialId], ref.item!.duration, mode);
          if (error) { getHost().toast('warn', error); return; }
          change({ freeRefs: ref.role === 'reference' ? { ...previous, reference: [...previous.reference, ref.item!] } : { ...previous, [ref.role!]: ref.item } });
        } else if (ref.operation === 'replace') {
          change({ freeRefs: { ...previous, reference: previous.reference.filter(item => item.assetId !== ref.item!.assetId && item.nodeId !== ref.item!.nodeId), [ref.role!]: ref.item } });
        } else if (ref.operation === 'remove') {
          change({ freeRefs: { reference: previous.reference.filter(item => item.nodeId !== ref.key), ...(previous.first?.nodeId !== ref.key ? { first: previous.first } : {}), ...(previous.last?.nodeId !== ref.key ? { last: previous.last } : {}) } });
        } else if (ref.operation === 'reorder') {
          const byKey = new Map(previous.reference.map(item => [item.materialId ?? item.nodeId, item]));
          if (ref.keys!.length === previous.reference.length && ref.keys!.every(key => byKey.has(key))) change({ freeRefs: { ...previous, reference: ref.keys!.map(key => byKey.get(key)!) } });
        } else {
          if (!ref.assignments?.length) return;
          const roles = new Map(ref.assignments.map(item => [item.nodeId, item.role]));
          const all = [...previous.reference.map(item => ({ item, role: 'reference' as VideoRefRole })), ...(previous.first ? [{ item: previous.first, role: 'first' as VideoRefRole }] : []), ...(previous.last ? [{ item: previous.last, role: 'last' as VideoRefRole }] : [])];
          const next: VideoMediaRefs = { reference: [] };
          for (const { item, role } of all) { const target = roles.get(item.nodeId) ?? role; if (target === 'reference') next.reference.push(item); else next[target] = item; }
          change({ freeRefs: next });
        }
        return;
      }
      if (patch.attachments) {
        const { targetNodeId, removeNodeId, orderedNodeIds } = patch.attachments;
        if (state.seed && (!targetNodeId || state.seed.targetNodeId === targetNodeId)) {
          const previous = state.seed.attachments, byId = new Map(previous?.map(item => [item.nodeId, item]));
          change({ seed: { ...state.seed, attachments: removeNodeId ? previous?.filter(item => item.nodeId !== removeNodeId) : previous && orderedNodeIds?.map(id => byId.get(id)!) } });
        }
        return;
      }
      const target = patch.targetNodeId ?? state.boundId;
      if (!target) return;
      const data: Record<string, unknown> = {};
      const fields = { prompt: 'prompt', promptDoc: 'promptDoc', modelId: 'draftModelId', size: 'draftSize', ratio: 'draftRatio', duration: 'draftDuration', mode: 'draftMode', generateAudio: 'draftGenerateAudio', sampleMode: 'draftSampleMode' } as const;
      for (const [field, stored] of Object.entries(fields)) if (patch[field as keyof typeof fields] !== undefined) data[stored] = patch[field as keyof typeof fields];
      if (patch.ratio !== undefined) data.targetRatio = patch.ratio;
      if (Object.keys(data).length) getHost().patchNode(target, data);
    },
    reconcile() {
      if (!state.boundId) return;
      if (state.seed?.targetNodeId !== state.boundId) { change({ boundId: null }); return; }
      const node = getHost().getNodes().find(node => node.id === state.boundId);
      if (!node || (node.data.draft !== true && !hasGenerationRecord(node))) change({ boundId: null, visible: false });
    },
    render: () => state.visible ? getHost().render?.() : null,
    async submit(input: VideoDockSend) {
      const host = getHost();
      if (host.isApplying()) return;
      const targetNodeId = state.seed?.targetNodeId, boundId = state.boundId, freeRefs = state.freeRefs;
      const composed = composeImageSendPrompt(targetNodeId ? host.attachmentsOf(targetNodeId) : undefined, input.text, input.promptDoc);
      const limitError = composedPromptLimitError(composed, await host.promptMaxLength(input.options.modelId));
      if (limitError) { host.toast('warn', limitError); return; }
      const projectId = host.getProjectId();
      if (targetNodeId && projectId) {
        const release = holdGenerationDockSubmission(host, targetNodeId);
        try {
          if (!(await host.save(projectId))) return;
        } catch (error) {
          reportGenerationDockSubmissionError(host, '保存失败，请重试', error);
          return;
        } finally { release(); }
      }
      const nodes = host.getNodes(), edges = host.getEdges();
      const mediaNodes = nodes.filter(node => node.type === 'mediaNode'), textNodes = nodes.filter(node => node.type === 'textNode');
      const sourceRefs = boundId ? mergedVideoRefsWithTextIndex(boundId, edges, mediaNodes, textNodes) : freeRefs;
      const stripOrder = boundId ? nodes.find(node => node.id === boundId)?.data.referenceStripOrder : undefined;
      const refs = { ...sourceRefs, reference: orderRefStripItems(sourceRefs.reference, videoRefStripKey, Array.isArray(stripOrder) ? stripOrder : []) };
      if (targetNodeId) {
        const error = videoTextIndexSendError(targetNodeId, edges, mediaNodes, textNodes);
        if (error) { host.toast('warn', error); return; }
      }
      const conflict = videoRefConflict(refs, { firstFrame: true, lastFrame: true, firstLastFrame: true, referenceImage: true }, input.options.mode);
      if (conflict) { host.toast('warn', conflict); return; }
      const gate = host.refUnsupported(input.options.modelId, refs);
      if (gate) { host.toast('warn', gate); return; }
      const opts = input.options;
      runSynchronousGenerationDockSubmission(host, targetNodeId, () => {
        const submitted = host.startTask({
          parameters: { prompt: input.text, model_id: opts.modelId, aspect_ratio: opts.aspectRatio, resolution: opts.resolution, duration: opts.duration, mode: opts.mode, generate_audio: opts.generateAudio, ...(opts.sampleMode ? { sample_mode: true as const } : {}) },
          references: buildVideoJobReferences(refs), targetNodeId, options: opts, promptDoc: input.promptDoc,
        });
        if (submitted) change({ visible: false, selectionExempt: true, ...(!boundId ? { freeRefs: { reference: [] } } : {}) }, true);
      });
    },
  };
}
