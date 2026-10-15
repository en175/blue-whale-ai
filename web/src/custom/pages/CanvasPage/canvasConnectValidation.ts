import { type VideoRefRole } from '@/custom/enums';
import type { Edge, Node } from '@xyflow/react';
import type { GenerationModel } from '@/custom/api/generation';
import { imageMediaRefsOf, imageRefSourceError, isImageDraftNode, readAssetId } from './mediaRefs';
import { mergedVideoMediaRefsOf, videoRefSourceError, checkAddVideoRef, isVideoDraftNode, type VideoMediaRefs, type VideoRefCapabilities } from './videoMediaRefs';
import { videoRefCapsOfModel } from './modelCaps';
import { draftVideoModeOf, videoModeAfterRefAdd } from './videoModes';
import { imageReferenceMaxOf, supportsAudioReferenceOf, supportsVideoReferenceOf } from '@/custom/utils/model-reference-limits';
import {
  audioRefMediaTypeOf,
  audioRefSourceError,
  audioMergedRefsError,
  checkAddAudioRef,
  isAudioDraftNode,
} from './audioMediaRefs';
import { mergedAudioRefsWithTextIndex } from './textIndexSync';
import { refOverflowToast } from '@/custom/utils/ref-overflow';

export interface ConnectValidatorHost {
  getMediaNodes: () => Node[];
  getTextNodes: () => Node[];
  getEdges: () => Edge[];
  getVideoModels: () => GenerationModel[];
  getImageModels: () => GenerationModel[];
  findCanvasNode: (id: string) => Node | undefined;
  isGeneratingNode: (id: string) => boolean;
  showToast: (type: 'success' | 'error' | 'warn', msg: string) => void;
}

export function createConnectValidators(host: ConnectValidatorHost) {
  const draftModelOf = (nodeId: string | null | undefined, kind: 'video' | 'image'): GenerationModel | undefined => {
    const data = (host.getMediaNodes().find((n) => n.id === nodeId)?.data ?? {}) as Record<string, unknown>;
    const modelId = typeof data.draftModelId === 'string' ? data.draftModelId : '';
    if (!modelId) return undefined;
    return (kind === 'video' ? host.getVideoModels() : host.getImageModels()).find((m) => m.model_id === modelId);
  };
  const videoCapsOfDraft = (nodeId: string | null | undefined): VideoRefCapabilities | null =>
    videoRefCapsOfModel(draftModelOf(nodeId, 'video'));
  const imageRefMaxOfDraft = (nodeId: string): number =>
    imageReferenceMaxOf(draftModelOf(nodeId, 'image')?.features);
  const videoRefUnsupportedByModel = (modelId: string, refs: VideoMediaRefs): string | null => {
    const model = host.getVideoModels().find((m) => m.model_id === modelId);
    if (!model) return null;
    const f = model.features;
    const unsupported = refs.reference.some((r) =>
      r.mediaType === 'video' ? !supportsVideoReferenceOf(f)
        : r.mediaType === 'audio' ? !supportsAudioReferenceOf(f)
          : false,
    );
    return unsupported ? '当前模型不支持视频或音频参考，请更换模型或调整引用' : null;
  };
  const validateImageRefConnect = (sourceId: string, targetId: string): boolean => {
    const target = host.getMediaNodes().find((n) => n.id === targetId);
    if (!isImageDraftNode(target)) return true;
    const source = host.getMediaNodes().find((n) => n.id === sourceId);
    if (!source) return true;
    const err = imageRefSourceError(source);
    if (err) {
      host.showToast('warn', err);
      return false;
    }
    const refs = imageMediaRefsOf(targetId, host.getEdges(), host.getMediaNodes());
    const assetId = readAssetId((source.data ?? {}) as Record<string, unknown>)!;
    if (refs.some((r) => r.assetId === assetId)) {
      const planEdge = host.getEdges().find(e => e.target === targetId && readAssetId((host.findCanvasNode(e.source)?.data ?? {}) as Record<string, unknown>) === assetId);
      if ((planEdge?.data?.inputSources as { manual?: boolean } | undefined)?.manual === false) return true;
      host.showToast('warn', '该素材已连入当前草稿');
      return false;
    }
    const imageMax = imageRefMaxOfDraft(targetId);
    if (refs.length >= imageMax) {
      host.showToast('warn', refOverflowToast(['image'], { image: imageMax }));
      return false;
    }
    return true;
  };
  const validateVideoRefConnect = (sourceId: string, targetId: string, role: VideoRefRole = 'reference'): boolean => {
    const target = host.getMediaNodes().find((n) => n.id === targetId);
    if (!isVideoDraftNode(target)) return true;
    const source = host.getMediaNodes().find((n) => n.id === sourceId);
    if (!source) return true;
    const err = videoRefSourceError(source, role);
    if (err) {
      host.showToast('warn', err);
      return false;
    }
    const refs = mergedVideoMediaRefsOf(targetId, host.getEdges(), host.getMediaNodes());
    const sourceData = (source.data ?? {}) as Record<string, unknown>;
    const assetId = readAssetId(sourceData);
    const mediaType = sourceData.mediaType as 'image' | 'video' | 'audio';
    const materialId = typeof sourceData.materialId === 'string' && sourceData.materialId
      ? sourceData.materialId
      : undefined;
    const duration = typeof sourceData.duration === 'number' && sourceData.duration > 0 ? sourceData.duration : undefined;
    const mode = videoModeAfterRefAdd(draftVideoModeOf(target?.data, refs), refs, mediaType);
    const msg = checkAddVideoRef(role, mediaType, assetId, refs, videoCapsOfDraft(targetId), [materialId], duration, mode);
    if (msg) {
      host.showToast('warn', msg);
      return false;
    }
    return true;
  };
  const validateAudioRefConnect = (sourceId: string, targetId: string): boolean => {
    const target = host.getMediaNodes().find((n) => n.id === targetId);
    if (!isAudioDraftNode(target)) return true;
    if (host.isGeneratingNode(targetId)) {
      host.showToast('warn', '生成中，输入连线只读');
      return false;
    }
    const source = host.getMediaNodes().find((n) => n.id === sourceId);
    if (!source) return true;
    const err = audioRefSourceError(source);
    if (err) {
      host.showToast('warn', err);
      return false;
    }
    const sourceData = (source.data ?? {}) as Record<string, unknown>;
    const incomingType = audioRefMediaTypeOf(sourceData) ?? 'audio';
    const refs = mergedAudioRefsWithTextIndex(
      targetId,
      host.getEdges(),
      host.getMediaNodes(),
      host.getTextNodes(),
    ).refs;
    const assetId = readAssetId(sourceData);
    const msg = checkAddAudioRef(assetId, refs, 0, incomingType);
    if (msg) {
      host.showToast('warn', msg);
      return false;
    }
    return true;
  };
  const validateAudioTextConnect = (textNodeId: string, targetId: string): boolean => {
    const target = host.getMediaNodes().find((n) => n.id === targetId);
    if (!isAudioDraftNode(target)) return true;
    if (host.isGeneratingNode(targetId)) {
      host.showToast('warn', '生成中，输入连线只读');
      return false;
    }
    const alreadyLinked = host.getEdges().some((e) => e.source === textNodeId && e.target === targetId);
    const hypoEdges = alreadyLinked
      ? host.getEdges()
      : [...host.getEdges(), { id: `hypo-audio-text-${textNodeId}`, source: textNodeId, target: targetId }];
    const msg = audioMergedRefsError(
      mergedAudioRefsWithTextIndex(
        targetId,
        hypoEdges,
        host.getMediaNodes(),
        host.getTextNodes(),
      ).refs,
    );
    if (msg) {
      host.showToast('warn', msg);
      return false;
    }
    return true;
  };
  return {
    draftModelOf,
    videoCapsOfDraft,
    imageRefMaxOfDraft,
    videoRefUnsupportedByModel,
    validateImageRefConnect,
    validateVideoRefConnect,
    validateAudioRefConnect,
    validateAudioTextConnect,
  };
}
