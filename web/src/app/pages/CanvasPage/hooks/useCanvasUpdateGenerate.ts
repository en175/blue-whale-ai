import type { RefObject } from 'react';
import type { Node } from '@xyflow/react';
import { restorePromptDoc } from '@/app/utils/prompt-doc';
import { composeImageSendPrompt } from '../components/ImageDialog/composeImageSendPrompt';
import { composedPromptLimitError, promptMaxLengthOfModel } from '@/app/utils/prompt-max-length';
import {
  mergedImageRefsOf,
  imageTextIndexSendError,
  mergedVideoRefsWithTextIndex,
  videoTextIndexSendError,
  mergedAudioRefsWithTextIndex,
  audioTextIndexSendError,
  DEFAULT_IMAGE_REFERENCE_LIMIT,
} from '../textIndexSync';
import { orderRefStripItems, videoRefStripKey } from '../components/RefThumbnail/strip-dnd';
import { draftVideoModeOf, defaultVideoModeFor } from '../videoModes';
import { lockedDurationOf, effectiveVideoParams, type VideoModeFeatures } from '@/app/utils/video-modes';
import { videoRefConflict, type VideoMediaRefs } from '../videoMediaRefs';
import { buildImageJobReferences, buildVideoJobReferences } from '../videoJobReferences';
import type { ImageTextAttachment } from '../components/ImageDialog';
import { isTaskTypeParamConstraintCode } from '@/app/utils/video-reference-hints';
import type { CanvasGenerationSubmissionHandles } from './useCanvasGenerationSubmission';

export interface CanvasUpdateGenerateHost {
  currentId: string;
  saveBlocked: boolean;
  saveStatus: string;
  mediaNodesRef: RefObject<Node[]>;
  textNodesRef: RefObject<Node[]>;
  edgesRef: RefObject<Array<{ id: string; source: string; target: string }>>;
  applyingRef: RefObject<boolean>;
  activeProjectRef: RefObject<string>;
  imageDraftId: string | null;
  videoDraftId: string | null;
  audioDraftId: string | null;
  setSubmittingNodeId: (id: string | null) => void;
  showToast: (type: 'success' | 'error' | 'warn', msg: string) => void;
  flushCanvasSave: (projectId: string) => Promise<boolean>;
  startGenerationJob: CanvasGenerationSubmissionHandles['startGenerationJob'];
  generationDock: { submitted: (kind: 'image' | 'video' | 'audio', nodeId: string) => void };
  textAttachmentsOf: (nodeId: string) => ImageTextAttachment[];
  draftModelOf: (nodeId: string | null | undefined, kind: 'video' | 'image') => { features?: VideoModeFeatures | null } | undefined;
  videoRefUnsupportedByModel: (modelId: string, refs: VideoMediaRefs) => string | null;
  patchMediaNode: (nodeId: string, patch: Record<string, unknown>) => void;
  updateGenerateRef: RefObject<(nodeId: string) => void>;
}

export interface CanvasUpdateGenerateHandles {
  handleUpdateGenerate: (nodeId: string, opts?: { ratioOverride?: string }) => Promise<void>;
  handleFixFollowVideo: (nodeId: string) => void;
}

export function useCanvasUpdateGenerate(host: CanvasUpdateGenerateHost): CanvasUpdateGenerateHandles {
  const {
    currentId,
    saveBlocked,
    saveStatus,
    mediaNodesRef,
    textNodesRef,
    edgesRef,
    applyingRef,
    activeProjectRef,
    imageDraftId,
    videoDraftId,
    audioDraftId,
    setSubmittingNodeId,
    showToast,
    flushCanvasSave,
    startGenerationJob,
    generationDock,
    textAttachmentsOf,
    draftModelOf,
    videoRefUnsupportedByModel,
    patchMediaNode,
    updateGenerateRef,
  } = host;

  const handleUpdateGenerate = async (nodeId: string, opts?: { ratioOverride?: string }) => {
    if (applyingRef.current) return;
    if (saveBlocked || saveStatus === 'error') {
      showToast('warn', '保存失败，请重试');
      return;
    }
    const node = mediaNodesRef.current.find((item) => item.id === nodeId);
    if (!node || node.type !== 'mediaNode') return;
    const data = (node.data ?? {}) as Record<string, unknown>;
    if (data.genStatus === 'generating') {
      showToast('warn', '正在生成中');
      return;
    }
    const mediaType = data.mediaType;
    if (mediaType !== 'image' && mediaType !== 'video' && mediaType !== 'audio') return;
    const modelId = typeof data.draftModelId === 'string' ? data.draftModelId : '';
    if (!modelId) {
      showToast('warn', '缺少模型参数，请先打开面板选择模型');
      return;
    }
    const projectId = currentId;
    if (!projectId) {
      showToast('warn', '未选中项目，无法生成');
      return;
    }
    const prompt = typeof data.prompt === 'string' ? data.prompt : '';
    const promptDoc = restorePromptDoc(data.promptDoc, data.prompt);
    const composedPrompt = composeImageSendPrompt(textAttachmentsOf(nodeId), prompt, promptDoc);
    const updatePromptLimitError = composedPromptLimitError(
      composedPrompt,
      await promptMaxLengthOfModel(mediaType, modelId),
    );
    if (updatePromptLimitError) {
      showToast('warn', updatePromptLimitError);
      return;
    }
    if (mediaType === 'image') {
      const size = typeof data.draftSize === 'string' ? data.draftSize : '';
      const ratio = typeof data.draftRatio === 'string' ? data.draftRatio : '';
      if (!size || !ratio) {
        showToast('warn', '缺少分辨率或比例，请先打开面板确认参数');
        return;
      }
      const syncError = imageTextIndexSendError(
        nodeId,
        edgesRef.current,
        [...mediaNodesRef.current, ...textNodesRef.current],
        DEFAULT_IMAGE_REFERENCE_LIMIT,
      );
      if (syncError) {
        showToast('warn', syncError);
        return;
      }
      applyingRef.current = true;
      setSubmittingNodeId(nodeId);
      try {
        const inputAssetIds: string[] = [];
        for (const ref of mergedImageRefsOf(nodeId, edgesRef.current, [...mediaNodesRef.current, ...textNodesRef.current])) {
          if (!inputAssetIds.includes(ref.assetId)) inputAssetIds.push(ref.assetId);
        }
        if (!(await flushCanvasSave(projectId))) return;
        if (activeProjectRef.current !== projectId) return;
        const jobRefs = buildImageJobReferences(inputAssetIds);
        const submitted = startGenerationJob(
          'image',
          { prompt, model_id: modelId, aspect_ratio: ratio, size },
          undefined,
          jobRefs.length > 0 ? { references: jobRefs } : undefined,
          nodeId,
          undefined,
          promptDoc,
        );
        if (submitted && imageDraftId === nodeId) generationDock.submitted('image', nodeId);
      } catch (error) {
        showToast('error', '保存或提交失败，请重试');
        console.warn('更新生成失败:', error);
      } finally {
        applyingRef.current = false;
        setSubmittingNodeId(null);
      }
      return;
    }
    if (mediaType === 'video') {
      const aspectRatio = opts?.ratioOverride ?? (typeof data.draftRatio === 'string' ? data.draftRatio : '');
      const resolution = typeof data.draftSize === 'string' ? data.draftSize : '';
      const duration = typeof data.draftDuration === 'number' ? data.draftDuration : Number(data.draftDuration);
      const syncError = videoTextIndexSendError(
        nodeId,
        edgesRef.current,
        mediaNodesRef.current,
        textNodesRef.current,
      );
      if (syncError) {
        showToast('warn', syncError);
        return;
      }
      const sourceDraftRefs = mergedVideoRefsWithTextIndex(
        nodeId,
        edgesRef.current,
        mediaNodesRef.current,
        textNodesRef.current,
      );
      const savedStripOrder = data.referenceStripOrder;
      const draftRefs = {
        ...sourceDraftRefs,
        reference: orderRefStripItems(
          sourceDraftRefs.reference,
          videoRefStripKey,
          Array.isArray(savedStripOrder) ? savedStripOrder : [],
        ),
      };
      const fallbackMode = draftVideoModeOf(data, draftRefs) ?? defaultVideoModeFor(draftRefs);
      const modeFeatures = draftModelOf(nodeId, 'video')?.features;
      const lockedDuration = lockedDurationOf(modeFeatures, fallbackMode);
      const wireParams = effectiveVideoParams(modeFeatures, fallbackMode, {
        aspectRatio,
        duration,
      });
      if (
        !wireParams.aspect_ratio ||
        !resolution ||
        !Number.isFinite(wireParams.duration) ||
        (wireParams.duration <= 0 && wireParams.duration !== lockedDuration)
      ) {
        showToast('warn', '缺少视频参数，请先打开面板确认比例、分辨率和时长');
        return;
      }
      const conflict = videoRefConflict(draftRefs, {
        firstFrame: true,
        lastFrame: true,
        firstLastFrame: true,
        referenceImage: true,
      }, fallbackMode);
      if (conflict) {
        showToast('warn', conflict);
        return;
      }
      const refGate = videoRefUnsupportedByModel(modelId, draftRefs);
      if (refGate) {
        showToast('warn', refGate);
        return;
      }
      applyingRef.current = true;
      setSubmittingNodeId(nodeId);
      try {
        if (!(await flushCanvasSave(projectId))) return;
        if (activeProjectRef.current !== projectId) return;
        const jobRefs = buildVideoJobReferences(draftRefs);
        const submitted = startGenerationJob(
          'video',
          {
            prompt,
            model_id: modelId,
            aspect_ratio: wireParams.aspect_ratio,
            resolution,
            duration: wireParams.duration,
            mode: fallbackMode,
            generate_audio: typeof data.draftGenerateAudio === 'boolean' ? data.draftGenerateAudio : true,
          },
          undefined,
          jobRefs.length > 0 ? { references: jobRefs } : undefined,
          nodeId,
          { mode: fallbackMode, references: [] },
          promptDoc,
        );
        if (submitted && videoDraftId === nodeId) generationDock.submitted('video', nodeId);
      } catch (error) {
        showToast('error', '保存或提交失败，请重试');
        console.warn('更新生成失败:', error);
      } finally {
        applyingRef.current = false;
        setSubmittingNodeId(null);
      }
      return;
    }
    const syncError = audioTextIndexSendError(
      nodeId,
      edgesRef.current,
      mediaNodesRef.current,
      textNodesRef.current,
    );
    if (syncError) {
      showToast('warn', syncError);
      return;
    }
    applyingRef.current = true;
    setSubmittingNodeId(nodeId);
    try {
      const { refs } = mergedAudioRefsWithTextIndex(
        nodeId,
        edgesRef.current,
        mediaNodesRef.current,
        textNodesRef.current,
      );
      const resolved = refs.filter((ref) => ref.assetId);
      if (!(await flushCanvasSave(projectId))) return;
      if (activeProjectRef.current !== projectId) return;
      const submitted = startGenerationJob(
        'audio',
        { prompt, model_id: modelId },
        undefined,
        resolved.length
          ? { references: resolved.map((ref) => ({
              role: 'reference' as const,
              type: ref.mediaType,
              asset_id: String(ref.assetId),
            })) }
          : undefined,
        nodeId,
        undefined,
        promptDoc,
      );
      if (submitted && audioDraftId === nodeId) generationDock.submitted('audio', nodeId);
    } catch (error) {
      showToast('error', '保存或提交失败，请重试');
      console.warn('更新生成失败:', error);
    } finally {
      applyingRef.current = false;
      setSubmittingNodeId(null);
    }
  };

  const handleFixFollowVideo = (nodeId: string) => {
    const node = mediaNodesRef.current.find((item) => item.id === nodeId);
    if (!node || node.type !== 'mediaNode') return;
    const data = (node.data ?? {}) as Record<string, unknown>;
    if (data.genStatus !== 'failed' || data.mediaType !== 'video') return;
    if (!isTaskTypeParamConstraintCode(data.errorCode as number | string | undefined)) return;
    patchMediaNode(nodeId, { draftRatio: 'adaptive' });
    void handleUpdateGenerate(nodeId, { ratioOverride: 'adaptive' });
  };

  updateGenerateRef.current = (nodeId) => {
    void handleUpdateGenerate(nodeId);
  };
  return { handleUpdateGenerate, handleFixFollowVideo };
}
