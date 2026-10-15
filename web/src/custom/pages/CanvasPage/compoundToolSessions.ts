import { type AudioVideoMuxSync } from '@/custom/enums';
import type { Node } from '@xyflow/react';
import { isApiError } from '@/shared/api/http';
import type { AudioMixCreate } from '@lib/contracts/audio-mix';
import { audioMixCandidate, audioMixSourceError, type AudioMixFormat, type AudioMixInputSelection } from './audioMix';
import { readAssetId, cardNameOfNode } from './mediaRefs';
import { apiErrorMessage, cloneSourceNode } from './toolSessionCapture';
import type { CreateAudioVideoMuxPayload } from '@/custom/api/jobs';
import { audioVideoMuxIdentityOf, audioVideoMuxSourceError, audioVideoMuxVideoError, isAudioVideoMuxDraftNode, type AudioVideoMuxIdentity, type AudioVideoMuxBoundVideo } from './audioVideoMux';
import type { ToolSessionDefinition, ToolSubmissionContext } from './toolSessionRuntime';

export interface AudioMixState {
  sourceNodeId: string;
  selectedInputs: AudioMixInputSelection[];
  format: AudioMixFormat;
}
export interface AudioMixSubmission {
  projectId: string;
  source: Node;
  payload: AudioMixCreate;
  libraryAssetIds: string[];
}
export interface AudioMixHost {
  getProjectId(): string | null;
  getNode(id: string): Node | undefined;
  isInFlight(): boolean;
  setInFlight(value: boolean): void;
  canApply(projectId: string): boolean;
  linkAssets(input: AudioMixSubmission): Promise<void>;
  createTask(input: AudioMixSubmission): Promise<{ job_id: string }>;
  handoff(input: AudioMixSubmission, task: { job_id: string }, context: ToolSubmissionContext): Promise<void>;
  warn(message: string): void;
  error(message: string): void;
}
export function addAudioMixInput(host: AudioMixHost, state: AudioMixState, input: AudioMixInputSelection): AudioMixState {
  const source = host.getNode(state.sourceNodeId);
  if (!source || audioMixSourceError(source) || !input.assetId) return state;
  if (input.nodeId) {
    const node = host.getNode(input.nodeId);
    if (!node || !audioMixCandidate(source, node) || readAssetId(node.data) !== input.assetId) return state;
  }
  if (state.selectedInputs.length >= 99 || input.assetId === readAssetId(source.data)
    || state.selectedInputs.some((item) => item.assetId === input.assetId)) return state;
  return { ...state, selectedInputs: [...state.selectedInputs, { ...input }] };
}
class AudioMixLinkError extends Error {}

export function createAudioMixSession(getHost: () => AudioMixHost): ToolSessionDefinition<AudioMixState, string, AudioMixSubmission> {
  return {
    kind: 'audioMix',
    initialize(sourceNodeId) {
      return audioMixSourceError(getHost().getNode(sourceNodeId)) ? null : { sourceNodeId, selectedInputs: [], format: 'mp3' };
    },
    target: (state) => state.sourceNodeId,
    capture(state) {
      const host = getHost();
      const projectId = host.getProjectId();
      if (host.isInFlight() || !projectId) return null;
      const source = host.getNode(state.sourceNodeId);
      const selected = state.selectedInputs;
      const assetIds = [readAssetId(source?.data ?? {}), ...selected.map((input) => input.assetId)];
      const canvasInputsValid = source && selected.every((input) => {
        if (!input.nodeId) return true;
        const node = host.getNode(input.nodeId);
        return node && audioMixCandidate(source, node) && readAssetId(node.data) === input.assetId;
      });
      if (!source || audioMixSourceError(source) || selected.length < 1 || selected.length > 99
        || new Set(assetIds).size !== assetIds.length || !canvasInputsValid) {
        host.warn('所选音频不可用，请重新选择'); return null;
      }
      return {
        projectId, source: cloneSourceNode(source),
        payload: {
          source_node_id: source.id,
          inputs: [{ asset_id: readAssetId(source.data)!, node_id: source.id }, ...selected.map((input) => ({ asset_id: input.assetId, ...(input.nodeId ? { node_id: input.nodeId } : {}) }))],
          output_format: state.format,
        },
        libraryAssetIds: selected.filter((input) => !input.nodeId).map((input) => input.assetId),
      };
    },
    async submit(input, context) {
      const host = getHost();
      host.setInFlight(true);
      try {
        try { await host.linkAssets(input); }
        catch (error) { throw new AudioMixLinkError(isApiError(error) ? `素材关联项目失败：${error.message}` : '素材关联项目失败，请重试'); }
        if (!host.canApply(input.projectId)) return;
        const task = await host.createTask(input);
        if (!host.canApply(input.projectId)) return;
        await host.handoff(input, task, context);
      } finally { host.setInFlight(false); }
    },
    onError(error) {
      getHost().error(apiErrorMessage(error, '音频混合任务创建失败，请重试', AudioMixLinkError));
    },
  };
}

export interface AudioVideoMuxState {
  draftId: string;
  wireDragging: boolean;
  newSource?: Node;
}
export type AudioVideoMuxEntry = { sourceNodeId: string } | { draftId: string };
export interface AudioVideoMuxSubmission {
  projectId: string;
  draftId: string;
  payload: CreateAudioVideoMuxPayload;
}
export interface AudioVideoMuxHost {
  getProjectId(): string | null;
  getNode(id: string): Node | undefined;
  createDraft(source: Node): string;
  patchIdentity(draftId: string, identity: AudioVideoMuxIdentity): void;
  removeBindEdges(draft: Node): void;
  addVideoEdge(sourceId: string, draftId: string): void;
  isInFlight(): boolean;
  setInFlight(value: boolean): void;
  canApply(projectId: string): boolean;
  createTask(input: AudioVideoMuxSubmission): Promise<{ job_id: string }>;
  handoff(input: AudioVideoMuxSubmission, task: { job_id: string }): Promise<void>;
  warn(message: string): void;
  error(message: string): void;
}

export function bindAudioVideoMuxVideo(host: AudioVideoMuxHost, draftId: string, video: AudioVideoMuxBoundVideo): void {
  const draft = host.getNode(draftId);
  const identity = audioVideoMuxIdentityOf(draft);
  if (!draft || !identity) return;
  host.removeBindEdges(draft);
  host.patchIdentity(draftId, { ...identity, video });
}
export function bindAudioVideoMuxWire(host: AudioVideoMuxHost, source: Node, target: Node): boolean {
  const identity = audioVideoMuxIdentityOf(target);
  if (!identity) return false;
  const reason = audioVideoMuxVideoError(source);
  if (reason) { host.warn(reason); return false; }
  const data = source.data ?? {};
  const assetId = readAssetId(data);
  if (assetId === undefined) return false;
  if (identity.video?.nodeId === source.id && identity.video.assetId === assetId) return true;
  bindAudioVideoMuxVideo(host, target.id, {
    assetId, nodeId: source.id, name: cardNameOfNode(source) ?? source.id,
    duration: typeof data.duration === 'number' ? data.duration : null,
    width: typeof data.width === 'number' ? data.width : null,
    height: typeof data.height === 'number' ? data.height : null,
    ...(typeof data.src === 'string' && data.src !== '' && !data.src.startsWith('blob:') ? { src: data.src } : {}),
  });
  host.addVideoEdge(source.id, target.id);
  return true;
}
export function unbindAudioVideoMux(host: AudioVideoMuxHost, draftId: string): void {
  const draft = host.getNode(draftId);
  const identity = audioVideoMuxIdentityOf(draft);
  if (!draft || !identity) return;
  host.removeBindEdges(draft);
  const next = { ...identity };
  delete next.video;
  host.patchIdentity(draftId, next);
}
export function editAudioVideoMuxParams(host: AudioVideoMuxHost, draftId: string, patch: { reserveAudio?: boolean; sync?: AudioVideoMuxSync }): void {
  const identity = audioVideoMuxIdentityOf(host.getNode(draftId));
  if (identity) host.patchIdentity(draftId, { ...identity, ...patch });
}

export function createAudioVideoMuxSession(getHost: () => AudioVideoMuxHost): ToolSessionDefinition<AudioVideoMuxState, AudioVideoMuxEntry, AudioVideoMuxSubmission> {
  return {
    kind: 'audioVideoMux',
    initialize(entry) {
      const host = getHost();
      if ('draftId' in entry) return isAudioVideoMuxDraftNode(host.getNode(entry.draftId)) ? { draftId: entry.draftId, wireDragging: false } : null;
      const node = host.getNode(entry.sourceNodeId);
      if (!node || node.type !== 'mediaNode') return null;
      const reason = audioVideoMuxSourceError(node.data);
      if (reason) { host.warn(reason); return null; }
      return { draftId: '', wireDragging: false, newSource: node };
    },
    opened(state) {
      return state.newSource ? { draftId: getHost().createDraft(state.newSource), wireDragging: false } : state;
    },
    target: (state) => state.draftId,
    capture(state) {
      const host = getHost();
      const projectId = host.getProjectId();
      if (host.isInFlight() || !projectId) return null;
      const draft = host.getNode(state.draftId);
      const identity = audioVideoMuxIdentityOf(draft);
      if (!draft || !identity) return null;
      const video = identity.video;
      if (!video) { host.warn('先选择视频'); return null; }
      if (!identity.sourceAssetId || !host.getNode(identity.sourceNodeId)) {
        host.warn('音频不可用，无法合成'); return null;
      }
      if (video.nodeId && readAssetId(host.getNode(video.nodeId)?.data ?? {}) !== video.assetId) {
        host.warn('视频不可用，请重新选择'); return null;
      }
      return {
        projectId, draftId: state.draftId,
        payload: {
          audio: { assetId: identity.sourceAssetId, nodeId: identity.sourceNodeId },
          video: { assetId: video.assetId, ...(video.nodeId ? { nodeId: video.nodeId } : {}) },
          is_audio_reserve: identity.reserveAudio, sync: identity.sync,
        },
      };
    },
    async submit(input, context) {
      const host = getHost();
      host.setInFlight(true);
      try {
        const task = await host.createTask(input);
        if (!host.canApply(input.projectId)) return;
        context.close();
        await host.handoff(input, task);
      } finally { host.setInFlight(false); }
    },
    onError(error) { getHost().error(apiErrorMessage(error, '音视频合成任务创建失败，请重试')); },
  };
}
