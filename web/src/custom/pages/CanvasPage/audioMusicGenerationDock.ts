import type { ReactNode } from 'react';
import type { Edge, Node } from '@xyflow/react';
import type { PromptDoc } from '@/custom/utils/prompt-doc';
import type { AudioRefItem } from './components/AudioDialog';
import type { MusicGenOptions } from './components/MusicDialog';
import { draftSeedEquals, type AudioDraftSeed } from './draftSeed';
import { restorePromptDoc } from '@/custom/utils/prompt-doc';
import { hasGenerationRecord } from './mediaReEdit';
import type { MediaGenStatus } from './components/MediaNode';
import { mergedAudioRefsWithTextIndex, audioTextIndexSendError } from './textIndexSync';
import type { DockSelection } from './generationDockCoordinator';
import { mediaDockSelectionVisibility, captureGenerationDockSubmission, holdGenerationDockSubmission, reportGenerationDockSubmissionError, type GenerationDockSubmissionHost } from './generationDockCoordinator';
import { composeImageSendPrompt } from './components/ImageDialog/composeImageSendPrompt';
import { composedPromptLimitError } from '@/custom/utils/prompt-max-length';
import { audioRefItemMediaTypeOf } from './audioMediaRefs';

export interface AudioDockEntry { nodeId?: string; intent?: 'manual' | 'selection' }
export interface AudioDockPatch { targetNodeId?: string; prompt?: string; modelId?: string; promptDoc?: PromptDoc | null }
export interface AudioDockSend { text: string; modelId: string; refs: AudioRefItem[]; promptDoc?: PromptDoc | null }
export interface AudioDockTask extends Omit<AudioDockSend, 'refs'> { targetNodeId?: string; refs: AudioRefItem[] }
export interface AudioGenerationDockHost extends GenerationDockSubmissionHost {
  getNodes(): Node[];
  getEdges(): Edge[];
  attachmentsOf(id: string): import('./components/ImageDialog').ImageTextAttachment[];
  canOpen(id: string): boolean;
  beginEdit(id?: string): void;
  endPicking(): void;
  clearPickResult(): void;
  addReferenceEdge(source: string, target: string): void;
  patchNode(id: string, patch: Record<string, unknown>): void;
  getAvailability(): { submittingNodeId: string | null; saveFailed: boolean };
  promptMaxLength(modelId: string): Promise<number | null>;
  fetchFile(src: string, name: string, mime: string): Promise<File | null>;
  upload(file: File, type: 'image' | 'audio'): Promise<{ asset_id: string | number; url: string } | null>;
  save(projectId: string): Promise<boolean>;
  startTask(input: AudioDockTask): boolean;
  render?(): ReactNode;
}
export interface MusicDockSend { text: string; model: string; options: MusicGenOptions; refs: AudioRefItem[] }
export interface MusicGenerationDockHost { beginEdit(): void; recordSend(input: MusicDockSend): void; render?(): ReactNode }
export interface MusicDockEntry { fromAudio?: boolean }

export function createAudioMusicGenerationDocks(getAudioHost: () => AudioGenerationDockHost, getMusicHost: () => MusicGenerationDockHost) {
  let state: { visible: boolean; boundId: string | null; seed: AudioDraftSeed | null; selectionExempt: boolean } = { visible: false, boundId: null, seed: null, selectionExempt: false };
  let musicVisible = false, audioVersion = 0, musicVersion = 0;
  const audioListeners = new Set<() => void>(), musicListeners = new Set<() => void>();
  const change = (patch: Partial<typeof state>, notifyAfterQueuedWork = false) => {
    if (Object.entries(patch).every(([key, value]) => state[key as keyof typeof state] === value)) return;
    state = { ...state, ...patch }; audioVersion += 1;
    const notify = () => audioListeners.forEach(listener => listener());
    if (notifyAfterQueuedWork) queueMicrotask(notify);
    else notify();
  };
  const changeMusic = (visible: boolean) => {
    if (musicVisible === visible) return;
    musicVisible = visible; musicVersion += 1; musicListeners.forEach(listener => listener());
  };
  let lastNodes: Node[] = [], lastTextNodes: Node[] = [], lastEdges: Edge[] | null = null, lastBoundId: string | null | undefined;
  let attachments: ReturnType<AudioGenerationDockHost['attachmentsOf']> | undefined;
  let mediaRefs: ReturnType<typeof mergedAudioRefsWithTextIndex> | undefined;
  let draftRefs: AudioRefItem[] | undefined, textIndexError: string | undefined;
  const sameNodes = (a: Node[], b: Node[]) => a.length === b.length && a.every((node, index) => node === b[index]);
  const close = () => { change({ visible: false, selectionExempt: true }); getAudioHost().endPicking(); };
  const updateDraft = (patch: AudioDockPatch) => {
    const target = patch.targetNodeId ?? state.boundId;
    if (!target) return;
    const data: Record<string, unknown> = {};
    if (patch.prompt !== undefined) data.prompt = patch.prompt;
    if (patch.promptDoc !== undefined) data.promptDoc = patch.promptDoc ? { ...patch.promptDoc, flat: patch.prompt ?? '' } : null;
    if (patch.modelId !== undefined) data.draftModelId = patch.modelId;
    if (Object.keys(data).length) getAudioHost().patchNode(target, data);
  };
  const audio = {
    subscribe(listener: () => void) { audioListeners.add(listener); return () => { audioListeners.delete(listener); }; },
    getVersion: () => audioVersion,
    view() {
      const host = getAudioHost();
      const nodes = host?.getNodes() ?? [], edges = host?.getEdges() ?? [], textNodes = nodes.filter(node => node.type === 'textNode');
      const bindingChanged = lastBoundId !== state.boundId, edgesChanged = lastEdges !== edges;
      if (bindingChanged || edgesChanged || !sameNodes(lastTextNodes, textNodes)) attachments = state.boundId ? host.attachmentsOf(state.boundId) : undefined;
      if (bindingChanged || edgesChanged || !sameNodes(lastNodes, nodes)) {
        mediaRefs = state.boundId ? mergedAudioRefsWithTextIndex(state.boundId, edges, nodes.filter(node => node.type === 'mediaNode'), textNodes) : undefined;
        textIndexError = state.boundId ? audioTextIndexSendError(state.boundId, edges, nodes.filter(node => node.type === 'mediaNode'), textNodes) ?? undefined : undefined;
        draftRefs = mediaRefs?.refs.map(ref => ({ id: ref.nodeId, kind: ref.mediaType, name: ref.name, src: ref.url, source: 'canvas', assetId: ref.assetId, mediaType: ref.mediaType, ...(ref.textNodeId != null ? { textNodeId: ref.textNodeId } : {}) }));
      }
      lastBoundId = state.boundId; lastEdges = edges; lastNodes = nodes; lastTextNodes = textNodes;
      const node = nodes.find(node => node.id === state.boundId), availability = host?.getAvailability();
      return {
        visible: state.visible, boundId: state.boundId, seed: state.seed, attachments, draftRefs,
        draftRefInvalid: mediaRefs?.invalid.length ? mediaRefs.invalid : undefined, textIndexError,
        draftBinding: state.boundId ? { submitting: availability?.submittingNodeId === state.boundId, saveFailed: availability?.saveFailed === true, restoreExisting: hasGenerationRecord(node), status: node?.data.genStatus as MediaGenStatus | undefined } : undefined,
      } as const;
    },
    canOpen: (input: AudioDockEntry) => (input.intent !== 'selection' || !state.selectionExempt) && (!input.nodeId || getAudioHost().canOpen(input.nodeId)),
    beforeOpen(input: AudioDockEntry) {
      if (input.nodeId) { getAudioHost().endPicking(); getAudioHost().clearPickResult(); }
      getAudioHost().beginEdit(input.nodeId);
    },
    open(input: AudioDockEntry) {
      if (!input.nodeId) { change({ visible: true }); return; }
      const host = getAudioHost(), nodes = host.getNodes(), data = nodes.find(node => node.id === input.nodeId)?.data ?? {};
      const legacyRefs = Array.isArray(data.audioRefs) ? data.audioRefs as AudioRefItem[] : [];
      if (legacyRefs.length) {
        for (const item of legacyRefs) if (item.source === 'canvas' && nodes.some(node => node.type === 'mediaNode' && node.id === item.id)) host.addReferenceEdge(item.id, input.nodeId);
        host.patchNode(input.nodeId, { audioRefs: [] });
      }
      const seed: AudioDraftSeed = { ts: Math.max(Date.now(), (state.seed?.ts ?? 0) + 1), targetNodeId: input.nodeId, text: typeof data.prompt === 'string' ? data.prompt : '', modelId: typeof data.draftModelId === 'string' ? data.draftModelId : undefined, doc: restorePromptDoc(data.promptDoc, data.prompt), refs: [] };
      change({ visible: true, boundId: input.nodeId, seed: draftSeedEquals(state.seed, seed) ? state.seed : seed, selectionExempt: false });
    },
    hide(next: string) {
      if (next === 'imageEnhance' || next === 'videoEnhance' || next === 'frameInterpolation') { close(); return; }
      change({ visible: false, ...(next === 'image' || next === 'video' ? { boundId: null } : {}) });
    },
    close, updateDraft,
    referencePicked() { change({ selectionExempt: true }); },
    submitted(_id: string) { change({ visible: false, selectionExempt: true }); },
    selection(input: DockSelection) {
      const visible = mediaDockSelectionVisibility(state, input);
      if (visible !== undefined) change({ visible });
    },
    reconcile() {
      if (!state.boundId) return;
      if (state.seed?.targetNodeId !== state.boundId) { change({ boundId: null }); return; }
      const node = getAudioHost().getNodes().find(node => node.id === state.boundId);
      if (!node || (node.data.draft !== true && !hasGenerationRecord(node))) change({ boundId: null, visible: false });
    },
    render: () => state.visible ? getAudioHost().render?.() : null,
    async submit(input: AudioDockSend) {
      const host = getAudioHost(), projectId = captureGenerationDockSubmission(host);
      if (!projectId) return;
      const targetNodeId = state.boundId && state.seed?.targetNodeId === state.boundId ? state.boundId : undefined;
      const composed = composeImageSendPrompt(targetNodeId ? host.attachmentsOf(targetNodeId) : undefined, input.text, input.promptDoc);
      const limitError = composedPromptLimitError(composed, await host.promptMaxLength(input.modelId));
      if (limitError) { host.toast('warn', limitError); return; }
      const release = holdGenerationDockSubmission(host, targetNodeId ?? null);
      try {
        if (targetNodeId) {
          const nodes = host.getNodes();
          const error = audioTextIndexSendError(targetNodeId, host.getEdges(), nodes.filter(node => node.type === 'mediaNode'), nodes.filter(node => node.type === 'textNode'));
          if (error) { host.toast('warn', error); return; }
        }
        const resolved: AudioRefItem[] = [];
        for (const ref of input.refs) {
          if (ref.assetId) { resolved.push(ref); continue; }
          const type = audioRefItemMediaTypeOf(ref);
          const file = ref.file ?? await host.fetchFile(ref.src, ref.name, type === 'image' ? 'image/png' : 'audio/mpeg');
          const uploaded = file ? await host.upload(file, type) : null;
          if (!uploaded) { host.toast('error', type === 'image' ? '参考图上传失败，请重试' : '参考音频上传失败，请重试'); return; }
          resolved.push({ ...ref, assetId: uploaded.asset_id, src: uploaded.url, file: undefined, kind: type, mediaType: type });
        }
        if (targetNodeId) {
          updateDraft({ targetNodeId, prompt: input.text, promptDoc: input.promptDoc });
          if (!(await host.save(projectId))) return;
        }
        if (host.startTask({ ...input, targetNodeId, refs: resolved })) change({ visible: false, selectionExempt: true }, true);
      } catch (error) {
        reportGenerationDockSubmissionError(host, '保存失败，请重试', error);
      } finally { release(); }
    },
  };
  const music = {
    subscribe(listener: () => void) { musicListeners.add(listener); return () => { musicListeners.delete(listener); }; },
    getVersion: () => musicVersion,
    view: () => ({ visible: musicVisible } as const),
    beforeOpen(input: MusicDockEntry) {
      if (input.fromAudio) change({ seed: { ts: Math.max(Date.now(), (state.seed?.ts ?? 0) + 1) }, boundId: null, visible: false });
      getMusicHost().beginEdit();
    },
    open(_input: MusicDockEntry) { changeMusic(true); },
    hide(_next: string) { changeMusic(false); }, close() { changeMusic(false); },
    updateDraft(_input: never) {}, submit(input: MusicDockSend) { getMusicHost().recordSend(input); },
    selection({ soloId, multiSelect }: DockSelection) { if (soloId || multiSelect) changeMusic(false); },
    render: () => musicVisible ? getMusicHost().render?.() : null,
  };
  return { audio, music };
}
