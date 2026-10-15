import type { ReactNode } from 'react';
import type { Edge, Node } from '@xyflow/react';
import { restorePromptDoc, type StoredPromptDoc, type PromptDoc } from '@/app/utils/prompt-doc';
import { composedPromptLimitError } from '@/app/utils/prompt-max-length';
import type { UploadedFile } from './components/ImageDialog';
import { composeImageSendPrompt } from './components/ImageDialog/composeImageSendPrompt';
import type { GenerationRefItem } from '@/app/api/jobs';
import { buildImageJobReferences } from './videoJobReferences';
import { imageTextIndexSendError, mergedImageRefsOf, DEFAULT_IMAGE_REFERENCE_LIMIT } from './textIndexSync';
import { imageRefSourceError } from './mediaRefs';
import { extractTextNodeText } from './quoteConversation';
import { draftSeedEquals, type ImageDraftSeed } from './draftSeed';
import { hasGenerationRecord } from './mediaReEdit';
import { mediaDockSelectionVisibility, captureGenerationDockSubmission, runGenerationDockSubmission, type DockSelection, type GenerationDockSubmissionHost } from './generationDockCoordinator';
import type { MediaGenStatus } from './components/MediaNode';

export interface ImageDockEntry { nodeId?: string; seed?: ImageDraftSeed | null; intent?: 'manual' | 'selection' }
export interface ImageDockPatch { targetNodeId?: string; prompt?: string; promptDoc?: StoredPromptDoc; modelId?: string; size?: string; ratio?: string; attachments?: { targetNodeId?: string; removeNodeId?: string; orderedNodeIds?: string[] } }
export interface ImageDockSend { text: string; modelId: string; size: string; ratio: string; files: UploadedFile[]; promptDoc?: PromptDoc | null }
export interface ImageDockTask extends Omit<ImageDockSend, 'files'> { references: GenerationRefItem[]; targetNodeId?: string }
export interface ImageGenerationDockHost extends GenerationDockSubmissionHost {
  getNodes(): Node[];
  getEdges(): Edge[];
  attachmentsOf(nodeId: string): NonNullable<ImageDraftSeed['attachments']>;
  canOpen(nodeId?: string): boolean;
  beginEdit(nodeId?: string): void;
  endPicking(): void;
  clearPickResult(): void;
  patchNode(nodeId: string, data: Record<string, unknown>): void;
  getAvailability(): { submittingNodeId: string | null; saveFailed: boolean };
  promptMaxLength(modelId: string): Promise<number | null>;
  collectInputAssetIds(targetNodeId: string | undefined, files: UploadedFile[], useEdgeRefs: boolean): Promise<string[]>;
  save(projectId: string): Promise<boolean>;
  isProjectCurrent(projectId: string): boolean;
  startTask(input: ImageDockTask): boolean;
  render?(): ReactNode;
}

export function createImageGenerationDock(getHost: () => ImageGenerationDockHost) {
  let state: { visible: boolean; boundId: string | null; seed: ImageDraftSeed | null; selectionExempt: boolean } = {
    visible: false, boundId: null, seed: null, selectionExempt: false,
  };
  const emptyNodes: Node[] = [];
  const emptyEdges: Edge[] = [];
  let lastNodes: Node[] = [];
  let lastTextNodes: Node[] = [];
  let lastEdges: Edge[] | null = null;
  let lastBoundId: string | null | undefined;
  let lastSeed: ImageDraftSeed | null | undefined;
  let seedView: ImageDraftSeed | null = null;
  let attachments: ImageDraftSeed['attachments'];
  let mediaRefs: ReturnType<typeof mergedImageRefsOf> | undefined;
  let textIndexError: ReturnType<typeof imageTextIndexSendError> | undefined;
  let invalidMediaRefs: Array<{ nodeId: string; name: string }> = [];
  const sameNodes = (left: Node[], right: Node[]) => left.length === right.length && left.every((node, index) => node === right[index]);
  const listeners = new Set<() => void>();
  let version = 0;
  const change = (patch: Partial<typeof state>) => {
    if (Object.entries(patch).every(([key, value]) => state[key as keyof typeof state] === value)) return;
    state = { ...state, ...patch };
    version += 1;
    listeners.forEach(listener => listener());
  };
  return {
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    getVersion: () => version,
    view() {
      const host = state.boundId || state.seed ? getHost() : null;
      const nodes = host?.getNodes() ?? emptyNodes;
      const edges = host?.getEdges() ?? emptyEdges;
      const textNodes = nodes.filter(node => node.type === 'textNode');
      const boundNode = nodes.find(node => node.id === state.boundId);
      const availability = host?.getAvailability();
      const bindingChanged = lastBoundId !== state.boundId;
      const edgesChanged = lastEdges !== edges;
      const textChanged = !sameNodes(lastTextNodes, textNodes);
      if (bindingChanged || lastSeed !== state.seed || textChanged) {
        seedView = state.seed && !state.boundId ? {
          ...state.seed,
          attachments: state.seed.attachments?.map(attachment => {
            const node = nodes.find(node => node.type === 'textNode' && node.id === attachment.nodeId);
            if (!node) return attachment;
            const title = typeof node.data.title === 'string' && node.data.title ? node.data.title : '文本节点';
            const text = extractTextNodeText(node.data);
            return title === attachment.title && text === attachment.text ? attachment : { ...attachment, title, text };
          }),
        } : state.seed;
      }
      if (bindingChanged || edgesChanged || textChanged) attachments = state.boundId ? host!.attachmentsOf(state.boundId) : seedView?.attachments;
      else if (lastSeed !== state.seed && !state.boundId) attachments = seedView?.attachments;
      if (bindingChanged || edgesChanged || !sameNodes(lastNodes, nodes)) {
        mediaRefs = state.boundId ? mergedImageRefsOf(state.boundId, edges, nodes) : undefined;
        textIndexError = state.boundId ? imageTextIndexSendError(state.boundId, edges, nodes, DEFAULT_IMAGE_REFERENCE_LIMIT) : undefined;
        invalidMediaRefs = state.boundId ? edges.filter(edge => edge.target === state.boundId).flatMap(edge => {
          const source = nodes.find(node => node.id === edge.source && node.type === 'mediaNode');
          return source && imageRefSourceError(source) ? [{ nodeId: source.id, name: String(source.data.fileName || source.id) }] : [];
        }) : [];
      }
      lastNodes = nodes;
      lastTextNodes = textNodes;
      lastEdges = edges;
      lastBoundId = state.boundId;
      lastSeed = state.seed;
      return {
        visible: state.visible, boundId: state.boundId, seed: state.seed,
        draftBinding: state.boundId ? {
          submitting: availability?.submittingNodeId === state.boundId,
          saveFailed: availability?.saveFailed === true,
          restoreExisting: hasGenerationRecord(boundNode),
          status: boundNode?.data.genStatus as MediaGenStatus | undefined,
        } : undefined,
        seedView,
        attachments, mediaRefs, textIndexError, invalidMediaRefs,
      } as const;
    },
    canOpen: (input: ImageDockEntry) => (input.intent !== 'selection' || !state.selectionExempt) && getHost().canOpen(input.nodeId),
    beforeOpen(input: ImageDockEntry) { getHost().endPicking(); getHost().beginEdit(input.nodeId); },
    open(input: ImageDockEntry) {
      const host = getHost();
      let next = input.seed ?? null;
      if (input.nodeId) {
        const data = host.getNodes().find(node => node.id === input.nodeId)?.data ?? {};
        next = {
          ts: Date.now(), text: typeof data.prompt === 'string' ? data.prompt : '',
          promptDoc: restorePromptDoc(data.promptDoc, data.prompt), files: [], targetNodeId: input.nodeId,
          params: {
            modelId: typeof data.draftModelId === 'string' ? data.draftModelId : undefined,
            ratio: typeof data.draftRatio === 'string' ? data.draftRatio : undefined,
            size: typeof data.draftSize === 'string' ? data.draftSize : undefined,
          },
          attachments: host.attachmentsOf(input.nodeId),
        };
      } else host.clearPickResult();
      change({ visible: true, boundId: input.nodeId ?? null, seed: draftSeedEquals(state.seed, next) ? state.seed : next, selectionExempt: false });
    },
    hide(nextPanel: string) {
      change({ visible: false, ...(nextPanel === 'video' || nextPanel === 'audio' ? { boundId: null } : {}) });
    },
    close() {
      change({ visible: false, selectionExempt: true });
      getHost().endPicking();
      getHost().clearPickResult();
    },
    referencePicked() { change({ selectionExempt: true }); },
    submitted(_nodeId: string) { change({ visible: false, selectionExempt: true }); },
    selection(input: DockSelection) {
      const visible = mediaDockSelectionVisibility(state, input);
      if (visible !== undefined) change({ visible });
    },
    updateDraft(patch: ImageDockPatch) {
      if (patch.attachments) {
        const { targetNodeId, removeNodeId, orderedNodeIds } = patch.attachments;
        if (state.seed && (!targetNodeId || state.seed.targetNodeId === targetNodeId)) {
          const previous = state.seed.attachments;
          const byId = new Map(previous?.map(attachment => [attachment.nodeId, attachment]));
          const attachments = removeNodeId
            ? previous?.filter(attachment => attachment.nodeId !== removeNodeId)
            : previous && orderedNodeIds?.map(nodeId => byId.get(nodeId)!);
          change({ seed: { ...state.seed, attachments } });
        }
        return;
      }
      const targetNodeId = patch.targetNodeId ?? state.boundId;
      if (!targetNodeId) return;
      const data: Record<string, unknown> = {};
      if (patch.prompt !== undefined) data.prompt = patch.prompt;
      if (patch.promptDoc !== undefined) data.promptDoc = patch.promptDoc;
      if (patch.modelId !== undefined) data.draftModelId = patch.modelId;
      if (patch.size !== undefined) data.draftSize = patch.size;
      if (patch.ratio !== undefined) { data.draftRatio = patch.ratio; data.targetRatio = patch.ratio; }
      if (Object.keys(data).length) getHost().patchNode(targetNodeId, data);
    },
    reconcile() {
      if (!state.boundId) return;
      if (state.seed?.targetNodeId !== state.boundId) { change({ boundId: null }); return; }
      const node = getHost().getNodes().find(node => node.id === state.boundId);
      if (!node || (node.data.draft !== true && !hasGenerationRecord(node))) change({ boundId: null, visible: false });
    },
    render: () => state.visible ? getHost().render?.() : null,
    async submit(input: ImageDockSend) {
      const host = getHost();
      const projectId = captureGenerationDockSubmission(host);
      const targetNodeId = state.seed?.targetNodeId;
      const boundId = state.boundId;
      if (!projectId) return;
      if (targetNodeId) {
        const error = imageTextIndexSendError(targetNodeId, host.getEdges(), host.getNodes(), DEFAULT_IMAGE_REFERENCE_LIMIT);
        if (error) { host.toast('warn', error); return; }
      }
      const prompt = composeImageSendPrompt(targetNodeId ? host.attachmentsOf(targetNodeId) : undefined, input.text, input.promptDoc);
      const error = composedPromptLimitError(prompt, await host.promptMaxLength(input.modelId));
      if (error) { host.toast('warn', error); return; }
      await runGenerationDockSubmission(host, targetNodeId, async () => {
        const assets = await host.collectInputAssetIds(targetNodeId, input.files, boundId != null && boundId === targetNodeId);
        if (targetNodeId && !(await host.save(projectId))) return;
        return assets;
      }, assets => {
        if (!host.isProjectCurrent(projectId)) return;
        const submitted = host.startTask({
          text: input.text, modelId: input.modelId, size: input.size, ratio: input.ratio,
          references: buildImageJobReferences(assets), targetNodeId, promptDoc: input.promptDoc,
        });
        if (submitted) change({ visible: false, selectionExempt: true });
      }, '保存或提交失败，请重试');
    },
  };
}
