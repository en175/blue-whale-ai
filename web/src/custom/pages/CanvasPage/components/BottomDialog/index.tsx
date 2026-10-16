import { type MediaGenStatus, type VideoRefRole, VIDEO_MODE_LABEL } from '@/custom/enums';
import PromptSyncActions from '../PromptSyncActions';

import { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  X,
  SlidersHorizontal,
  ArrowUp,
  Maximize2,
  Minimize2,
} from 'lucide-react';
import { fetchGenerationModels, type GenerationModel } from '@/custom/api/generation';
import { pickDefaultVideoRatio, videoRatioLabel } from '@/custom/utils/video-aspect-ratio';
import { aspectRatioOptions, hasAspectRatio } from '@/custom/utils/image-size-ratios';
import { generationQuoteOptions } from '@/custom/api/generationQuote';
import RatioGroup from '@/custom/components/RatioGroup';
import Select from '@/custom/components/Select';
import GenerationQuoteBadge from '../GenerationQuoteBadge';
import { buildVideoJobReferences } from '../../tools/video/videoJobReferences';
import { useDismissOnOutside } from '../../hooks/useDismissOnOutside';
import {
  docHasAnyRef,
  docHasInvalidRef,
  flattenPromptDocWith,
  PROMPT_DOC_VERSION,
  textRefLabelOf,
  type PromptDoc,
  type PromptRefKey,
  type StoredPromptDoc,
} from '@/custom/utils/prompt-doc';
import PromptRefEditor, {
  type MentionState,
  type PromptRefEditorHandle,
} from '../PromptRefEditor';
import ReplaceRefMenu from '../PromptRefEditor/ReplaceRefMenu';
import RefThumbnail, { INSERT_REF_APPEND_TITLE } from '../RefThumbnail';
import RefSourceMenu from '../RefSourceMenu';
import AttachmentActionBar from '../AttachmentActionBar';
import { useMixedRefStrip, orderRefStripItems, videoRefStripKey, useRefStripDrag, type RefStripOrderProps, type StripDragItemProps } from '../RefThumbnail/strip-dnd';
import { refIdOf, videoLabelMapOf } from '../../tools/video/videoPromptRefs';
import { type ImageTextAttachment } from '../ImageDialog';
import { composeImageSendPrompt } from '../ImageDialog/composeImageSendPrompt';
import {
  composedPromptLimitError,
  promptCharCountLabel,
  promptMaxLengthOf,
} from '@/custom/utils/prompt-max-length';

import { canAddRefRole, hasAnyMediaRef, videoRefConflict, isLibraryOnlyVideoRef, type VideoMediaRef, type VideoMediaRefs, type VideoRefCapabilities } from '../../tools/video/videoMediaRefs';
import {
  audioReferenceMaxOf,
  videoReferenceMaxOf,
  imageReferenceMaxOf,
  supportsAudioReferenceOf,
  supportsVideoReferenceOf,
  checkReferenceLimits,
} from '@/custom/utils/model-reference-limits';
import { OMNI_REFERENCE_FOLLOW_HINT } from '@/custom/utils/video-reference-hints';
import AtMentionMenu from '../AtMentionMenu';
import { type AtMentionItem } from '../../atMention';
import { anchoredOverlayStyle, type FollowDialogAnchor } from '../../followDialog';
import {
  defaultVideoModeFor,
  enabledVideoModes,
  hasVideoReference,
  nextVideoModeOnRefsChange,
  normalizeStoredVideoMode,
  resolveVideoMode,
  videoModeRefsSignature,
} from '../../tools/video/videoModes';
import { configuredVideoModes, effectiveVideoParams, frameSlotCountOf, isFrameMode, isVideoMode, lockedDurationOf, lockedRatioOf, normalizeVideoMode, type VideoMode } from '@/custom/utils/video-modes';
import styles from './index.module.css';

export interface VideoGenOptions {

  modelId: string;
  aspectRatio: string;

  resolution: string;

  duration: number;
  mode: string;

  generateAudio: boolean;

  sampleMode: boolean;

  expectedCredits?: number;
  quoteRevision?: string;
}

export interface VideoDraftParamsPatch {
  prompt?: string;

  promptDoc?: StoredPromptDoc;
  modelId?: string;
  size?: string;
  ratio?: string;
  duration?: number;
  mode?: string;

  generateAudio?: boolean;

  sampleMode?: boolean;
}

interface BottomDialogProps extends RefStripOrderProps {
  onClose: () => void;

  projectId?: string;

  onSend: (text: string, opts: VideoGenOptions, promptDoc?: PromptDoc | null) => void | Promise<void>;

  initialText?: string;

  initialDoc?: PromptDoc | null;

  initialParams?: VideoGenSeedParams;

  attachments?: ImageTextAttachment[];

  onRemoveAttachment?: (nodeId: string) => void;
  planReferenceError?: string;
  pendingPlanSyncs?: Array<{ nodeId: string; title: string }>;
  onSyncPlan?: (nodeId: string) => void;
  syncingPlan?: boolean;
  planIndices?: string;

  onReorderAttachments?: (orderedNodeIds: string[]) => void;

  onPickFromCanvas?: (kind: 'image' | 'video', role?: VideoRefRole) => void;

  onPickFromAssets?: (kind: 'image' | 'video', role?: VideoRefRole) => void;

  pickMode?: 'image' | 'video' | null;

  pickLocked?: boolean;

  videoDraftBinding: {
    status?: MediaGenStatus;
    restoreExisting?: boolean;
    submitting?: boolean;
    saveFailed?: boolean;
    onParamsChange: (patch: VideoDraftParamsPatch) => void;
  };

  videoMediaRefs: VideoMediaRefs;

  onLocateTextSource?: (textNodeId: string) => void;

  textIndexError?: string;

  onRemoveVideoRef?: (sourceNodeId: string) => void;

  onAssignRefRoles?: (assignments: Array<{ nodeId: string; role: VideoRefRole }>) => void;

  onRemoveMaterialRef?: (materialId: string) => void;

  onReorderMediaRefs?: (orderedKeys: string[]) => void;

  onToast?: (type: 'success' | 'error' | 'warn', msg: string) => void;

  targetNodeId?: string;

  mentionItems?: AtMentionItem[];

  onMentionCanvas?: (item: AtMentionItem) => void;

  followAnchor?: FollowDialogAnchor | null;

  dragHidden?: boolean;
}

export interface VideoGenSeedParams {

  modelId?: string;

  aspectRatio?: string;

  resolution?: string;

  duration?: number;
  mode?: string;

  generateAudio?: boolean;

  sampleMode?: boolean;
}

export default function BottomDialog({ projectId, onClose, onSend, initialText, initialDoc, initialParams, attachments, onRemoveAttachment, pendingPlanSyncs, onSyncPlan, syncingPlan, planReferenceError, planIndices, textIndexError, onLocateTextSource, onPickFromCanvas, onPickFromAssets, pickMode, pickLocked, videoDraftBinding, videoMediaRefs, onRemoveVideoRef, onAssignRefRoles, onRemoveMaterialRef, onReorderMediaRefs, onReorderAttachments, stripOrder, onStripOrderChange, onToast, mentionItems: canvasMentionItems, onMentionCanvas, followAnchor, dragHidden, targetNodeId }: BottomDialogProps) {

  const [promptDoc, setPromptDoc] = useState<PromptDoc>(() =>
    initialDoc ?? { version: PROMPT_DOC_VERSION, segments: initialText ? [{ kind: 'text' as const, text: initialText }] : [] },
  );
  const editorRef = useRef<PromptRefEditorHandle>(null);
  const mentionAnchorRef = useRef<HTMLDivElement>(null);

  const [mention, setMention] = useState<MentionState>({ open: false, query: '' });

  const [replaceTarget, setReplaceTarget] = useState<string | null>(null);
  const mentionMenuRef = useRef<HTMLDivElement>(null);
  const replaceMenuRef = useRef<HTMLDivElement>(null);

  const hasAttachmentText = (attachments ?? []).some((a) => a.text.trim().length > 0);
  const [selectedMode, setSelectedMode] = useState<VideoMode>(
    () => normalizeVideoMode(initialParams?.mode) ?? 'text2video',
  );
  const [showConfig, setShowConfig] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [modelList, setModelList] = useState<GenerationModel[]>([]);
  const [modelsLoaded, setModelsLoaded] = useState(false);
  const [sending, setSending] = useState(false);
  const sendingRef = useRef(false);
  const [selectedModel, setSelectedModel] = useState('');
  const [selectedSize, setSelectedSize] = useState('');

  const [selectedRatio, setSelectedRatio] = useState('');
  const [duration, setDuration] = useState(0);

  const [generateAudio, setGenerateAudio] = useState(initialParams?.generateAudio ?? true);

  const [sampleMode, setSampleMode] = useState(initialParams?.sampleMode === true);

  const normalSizeRef = useRef<string>('');
  const configPanelRef = useRef<HTMLDivElement>(null);

  useDismissOnOutside([
    { open: showConfig, ref: configPanelRef, dismiss: () => setShowConfig(false) },
  ]);

  const currentModel = modelList.find((m) => m.model_id === selectedModel) ?? null;
  const maxInput = promptMaxLengthOf(currentModel?.features?.max_prompt_length);

  const supportsAudio = currentModel?.features?.audio === true;

  const sampleSize480 = currentModel?.supported_sizes.find((s) => (s.api_value ?? s.id) === '480p');
  const supportsSampleMode = currentModel?.features?.sample_mode === true && sampleSize480 != null;
  const modelOptions = modelList.map((m) => ({ key: m.model_id, label: m.model_label }));

  const sizeOptions = currentModel?.supported_sizes?.length
    ? currentModel.supported_sizes.map((s) => ({ key: s.id, label: s.label }))
    : [];
  const ratioOptions = aspectRatioOptions(currentModel?.supported_aspect_ratios);
  const durationRange = currentModel?.supported_durations ?? null;
  const currentSizeLabel =
    sizeOptions.find((s) => s.key === selectedSize)?.label ?? selectedSize;

  const quoteResolution = sampleMode
    ? '480p'
    : (() => {
        const size = currentModel?.supported_sizes.find((s) => s.id === selectedSize);
        return size ? (size.api_value ?? size.id) : undefined;
      })();

  const [quotePrompt, setQuotePrompt] = useState('');
  const wireParams = effectiveVideoParams(currentModel?.features, selectedMode, {
    aspectRatio: selectedRatio,
    duration,
  });

  const quoteParameters = useMemo(() => ({
    model_id: currentModel?.model_id ?? '',
    ...(quoteResolution ? { resolution: quoteResolution } : {}),
    ...(wireParams.aspect_ratio ? { aspect_ratio: wireParams.aspect_ratio } : {}),
    ...(wireParams.duration ? { duration: wireParams.duration } : {}),
    generate_audio: generateAudio,
    ...(sampleMode ? { sample_mode: true as const } : {}),

    ...(quotePrompt ? { prompt: quotePrompt } : {}),
    mode: selectedMode,
  }), [currentModel?.model_id, quoteResolution, wireParams.aspect_ratio, wireParams.duration, generateAudio, sampleMode, quotePrompt, selectedMode]);

  const readOnly = sending || videoDraftBinding.submitting || videoDraftBinding.status === 'generating';

  const syncDraftParams = (patch: VideoDraftParamsPatch) => {
    videoDraftBinding.onParamsChange(patch);
  };

  const configuredModes = useMemo(
    () => configuredVideoModes(currentModel?.features),
    [currentModel],
  );
  const enabledModes = useMemo(
    () => enabledVideoModes(videoMediaRefs, configuredModes),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [videoModeRefsSignature(videoMediaRefs), configuredModes],
  );
  const modeOptions = configuredModes.map((key) => ({ key, label: VIDEO_MODE_LABEL[key] }));

  useEffect(() => {
    if (!modelsLoaded || !currentModel) return;
    const next = nextVideoModeOnRefsChange(selectedMode, videoMediaRefs, configuredModes);
    if (!next || next === selectedMode) return;
    setSelectedMode(next);
    syncDraftParams({ mode: next });
    onToast?.('warn', '已根据当前素材切换生成模式');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [videoModeRefsSignature(videoMediaRefs), configuredModes, selectedMode, modelsLoaded, currentModel]);

  const caps: VideoRefCapabilities | null = currentModel
    ? {
        firstFrame: currentModel.features.first_frame,
        lastFrame: currentModel.features.last_frame,
        firstLastFrame: currentModel.features.first_last_frame,
        referenceImage: currentModel.features.reference_image,
        videoReference: supportsVideoReferenceOf(currentModel.features),
        audioReference: supportsAudioReferenceOf(currentModel.features),
        videoReferenceMax: videoReferenceMaxOf(currentModel.features),
        audioReferenceMax: audioReferenceMaxOf(currentModel.features),
        imageMax: imageReferenceMaxOf(currentModel.features),
      }
    : null;

  const referenceConflict = textIndexError ?? planReferenceError ?? (caps
    ? (checkReferenceLimits(
        currentModel?.features,
        videoMediaRefs.reference.map((r) => ({ type: r.mediaType, duration: r.duration })),
        'video',
      ) ?? videoRefConflict(videoMediaRefs, caps, selectedMode))
    : null);
  const modeConflict = (() => {
    const ordinary = videoMediaRefs.reference;
    const hasFrames = Boolean(videoMediaRefs.first || videoMediaRefs.last);
    if (selectedMode === 'text2video' && hasAnyMediaRef(videoMediaRefs)) {
      return '文生视频模式不支持媒体参考，请移除参考或切换模式';
    }
    if (isFrameMode(selectedMode)) {
      return ordinary.length > 0 ? '首尾帧模式不支持普通参考，请调整模式或引用' : null;
    }
    if (hasFrames) return '当前模式不支持首尾帧，请调整模式或引用';
    if (selectedMode === 'image_reference' && ordinary.some((r) => r.mediaType !== 'image')) {
      return '图片参考模式不支持视频或音频参考';
    }
    if (selectedMode === 'edit' || selectedMode === 'extend') {
      return hasVideoReference(videoMediaRefs)
        ? null
        : `${VIDEO_MODE_LABEL[selectedMode]}模式至少需要 1 段参考视频`;
    }
    return null;
  })();
  const inputConflict = referenceConflict ?? modeConflict;

  const conflict = inputConflict && planIndices && !inputConflict.startsWith('方案索引')
    ? `方案索引 ${planIndices}：${inputConflict}`
    : inputConflict;
  const canAddFirst = !!(caps && canAddRefRole('first', videoMediaRefs, caps));

  const canAddLast = !videoMediaRefs.last;
  const canAddReference = !!caps?.referenceImage;

  const isKeyframe = isFrameMode(selectedMode);
  const supportsAdaptiveRatio = !!hasAspectRatio(currentModel?.supported_aspect_ratios, 'adaptive');
  const ratioLocked = lockedRatioOf(currentModel?.features, selectedMode);
  const durationLocked = lockedDurationOf(currentModel?.features, selectedMode);

  const fallbackDurationOf = (model: GenerationModel | null | undefined): number => {
    const range = model?.supported_durations;
    if (!range) return 5;
    const base = typeof model?.default_duration === 'number' ? model.default_duration : range.min;
    return Math.min(Math.max(base, range.min), range.max);
  };

  useEffect(() => {
    if (ratioLocked && selectedRatio !== ratioLocked) setSelectedRatio(ratioLocked);
    if (durationLocked != null) {
      if (duration !== durationLocked) setDuration(durationLocked);
      return;
    }
    if (duration < 0) {
      const next = fallbackDurationOf(currentModel);
      setDuration(next);
      syncDraftParams({ duration: next });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ratioLocked, durationLocked, selectedRatio, duration, currentModel]);
  const isImageReference = selectedMode === 'image_reference';
  const showOmniFollowHint = selectedMode === 'omni'
    && supportsAdaptiveRatio
    && videoMediaRefs.reference.some((r) => r.mediaType === 'video');

  const readOnlyReason = sending || videoDraftBinding.submitting
    ? '正在保存并提交，参数与连线只读'
    : '生成中，参数与连线只读；可在画布卡片上取消生成';

  const referenceMaxTotal = caps ? (caps.imageMax ?? 9) + (caps.videoReferenceMax ?? 3) : 12;

  const referencesFull = videoMediaRefs.reference.length >= referenceMaxTotal;
  const actionBarKind: 'image' | 'video' = isKeyframe || isImageReference ? 'image' : 'video';

  const actionBarDisabledReason = readOnly ? readOnlyReason
    : isKeyframe
      ? (videoMediaRefs.first && (selectedMode === 'first_frame' || videoMediaRefs.last)
        ? '首帧已指定，请先移除后再添加'
        : null)
      : !canAddReference ? '当前模型不支持参考'
      : referencesFull ? `普通参考最多 ${referenceMaxTotal} 条，已达上限`
      : null;

  const stripHasItems = videoMediaRefs.reference.length > 0 || (attachments?.length ?? 0) > 0;

  const quoteReferences = useMemo(() => buildVideoJobReferences(videoMediaRefs), [videoMediaRefs]);

  const sampleQuoteQuery = useQuery({
    ...generationQuoteOptions(projectId ?? '', {
      type: 'video',
      parameters: quoteParameters,
      expected_output_count: 1,
      ...(quoteReferences.length > 0 ? { references: quoteReferences } : {}),

      ...(targetNodeId ? { target_node_id: targetNodeId } : {}),
    }),
    enabled: sampleMode && !!projectId && quoteParameters.model_id !== '',
  });

  const sampleQuoteReady = !sampleMode
    || (sampleQuoteQuery.data != null
      && sampleQuoteQuery.data.credits != null
      && sampleQuoteQuery.data.quote_revision != null);

  const mixedStrip = useMixedRefStrip(
    isKeyframe ? [] : videoMediaRefs.reference.map(r => videoRefStripKey(r).slice(6)),
    (attachments ?? []).map(a => a.nodeId), { stripOrder, onStripOrderChange },
  );
  const orderedVideoMediaRefs = useMemo(() => ({
    ...videoMediaRefs,
    reference: orderRefStripItems(videoMediaRefs.reference, videoRefStripKey, mixedStrip.order),
  }), [videoMediaRefs, mixedStrip.order]);

  const { labelOf: mediaLabelOf, refItems, numberMap: refNumberMap } = useMemo(() => videoLabelMapOf(orderedVideoMediaRefs, selectedMode), [orderedVideoMediaRefs, selectedMode]);
  const orderedTextNodeIds = useMemo(() => mixedStrip.order.filter(key => key.startsWith('text:')).map(key => key.slice(5)), [mixedStrip.order]);
  const refLabelOf = useCallback((key: PromptRefKey): string | null =>
    key.kind === 'text_ref'
      ? textRefLabelOf(key.id, orderedTextNodeIds)
      : mediaLabelOf(key.id), [mediaLabelOf, orderedTextNodeIds]);
  const refLabelOfStable = useRef(refLabelOf);
  refLabelOfStable.current = refLabelOf;
  const refLabels = useMemo(
    () => new Map<string, string>([
      ...refItems.flatMap((item) => {
        const label = mediaLabelOf(item.id);
        return label ? [[item.id, label] as const] : [];
      }),
      ...orderedTextNodeIds.map((id, i) => [id, `文本${i + 1}`] as const),
    ]),
    [refItems, mediaLabelOf, orderedTextNodeIds],
  );
  const refsMeta = useMemo(() => {
    const m = new Map<string, { url: string; name: string; mediaType: 'image' | 'video' | 'audio' | 'text' }>();
    for (const item of [videoMediaRefs.first, videoMediaRefs.last, ...videoMediaRefs.reference]) {
      if (!item) continue;
      m.set(refIdOf(item), { url: item.url, name: item.name, mediaType: item.mediaType });
    }
    for (const a of attachments ?? []) {
      m.set(a.nodeId, { url: '', name: a.title, mediaType: 'text' });
    }
    return m;
  }, [videoMediaRefs, attachments]);
  const labelOfStable = useRef(mediaLabelOf);
  labelOfStable.current = mediaLabelOf;
  const reconcileKey = useMemo(
    () => `${selectedMode}|${refItems.map((item) => `${item.id}:${item.role}:${item.type}`).join(',')}|${orderedTextNodeIds.join(',')}`,
    [selectedMode, refItems, orderedTextNodeIds],
  );

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const flatValue = useMemo(() => flattenPromptDocWith(promptDoc, (key) => refLabelOfStable.current(key)), [promptDoc, reconcileKey]);

  useEffect(() => {
    const timer = window.setTimeout(() => setQuotePrompt(flatValue), 600);
    return () => window.clearTimeout(timer);
  }, [flatValue]);

  const hasInvalidRef = docHasInvalidRef(promptDoc);

  const handleModeChange = (key: string) => {
    if (!isVideoMode(key) || !enabledModes.includes(key)) return;
    if (key === selectedMode) return;
    const hasFrames = !!(videoMediaRefs.first || videoMediaRefs.last);
    const slots = frameSlotCountOf(key);
    if (slots > 0) {

      if (key === 'first_frame' && videoMediaRefs.last) {
        onToast?.('warn', '图生视频只使用首帧，请先移除尾帧');
        return;
      }
      const imageRefs = videoMediaRefs.reference.filter((r) => r.mediaType === 'image');
      if (imageRefs.length > slots) {
        onToast?.('warn', `${VIDEO_MODE_LABEL[key]}模式最多 ${slots} 张图片，请先减少参考`);
        return;
      }
      if (imageRefs.length > 0) {
        onAssignRefRoles?.(
          imageRefs.slice(0, slots).map((r, i) => ({ nodeId: r.nodeId, role: i === 0 ? 'first' : 'last' })),
        );
      }
    } else if (hasFrames) {
      const frames = [videoMediaRefs.first, videoMediaRefs.last].filter(
        (f): f is VideoMediaRef => !!f,
      );
      onAssignRefRoles?.(frames.map((f) => ({ nodeId: f.nodeId, role: 'reference' })));
    }
    setSelectedMode(key);
    const lockedRatio = lockedRatioOf(currentModel?.features, key);
    const lockedDuration = lockedDurationOf(currentModel?.features, key);
    const patch: VideoDraftParamsPatch = { mode: key };
    if (lockedRatio) {
      setSelectedRatio(lockedRatio);
      patch.ratio = lockedRatio;
    } else if (selectedRatio === 'adaptive' && currentModel && !hasAspectRatio(currentModel.supported_aspect_ratios, 'adaptive')) {
      const fallbackRatio = pickDefaultVideoRatio(currentModel.supported_aspect_ratios, currentModel.default_aspect_ratio);
      setSelectedRatio(fallbackRatio);
      patch.ratio = fallbackRatio;
    }
    if (lockedDuration != null) {
      setDuration(lockedDuration);
      patch.duration = lockedDuration;
    } else if (duration < 0) {
      const nextDuration = fallbackDurationOf(currentModel);
      setDuration(nextDuration);
      patch.duration = nextDuration;
    }
    syncDraftParams(patch);
  };

  const syncModeToModel = (model: GenerationModel) => {
    if (isFrameMode(selectedMode)) return;
    const enabled = enabledVideoModes(videoMediaRefs, configuredVideoModes(model.features));
    const target = resolveVideoMode(defaultVideoModeFor(videoMediaRefs), enabled);
    if (!target || target === selectedMode) return;
    setSelectedMode(target);
    syncDraftParams({ mode: target });
    onToast?.('warn', '已根据当前素材切换生成模式');
  };

  const configurationError = !modelsLoaded ? '正在加载模型配置'
    : !currentModel ? '原生成模型不可用，请重新选择模型'
    : configuredModes.length === 0 ? '当前模型未配置视频模式，请重新选择模型'
    : !sizeOptions.some(option => option.key === selectedSize) ? '原分辨率不可用，请重新选择分辨率'

    : !ratioLocked && !ratioOptions.some(option => option.id === selectedRatio) ? '原比例不兼容，请重新选择比例'
    : !durationLocked && durationRange && (duration < durationRange.min || duration > durationRange.max
      || (duration - durationRange.min) % durationRange.step !== 0)
      ? '原时长不兼容，请重新选择时长'
    : hasInvalidRef ? '正文有已失效的素材标签，请点击标签替换或删除后再发送'

    : !sampleQuoteReady ? '样片价格确认中，稍候再提交'
    : null;
  const canSend = !readOnly && !pickLocked && !videoDraftBinding.saveFailed && !configurationError
    && sampleQuoteReady
    && (flatValue.trim().length > 0 || hasAttachmentText);

  const ticks: number[] = [];
  if (durationRange) {
    for (let v = durationRange.min; v <= durationRange.max; v += durationRange.step) ticks.push(v);
  }

  const applyModelDefaults = (m: GenerationModel) => {
    setSelectedModel(m.model_id);
    setSampleMode(false);
    let nextRatio = selectedRatio;
    if (aspectRatioOptions(m.supported_aspect_ratios).length) {
      nextRatio = pickDefaultVideoRatio(m.supported_aspect_ratios, m.default_aspect_ratio);
      setSelectedRatio(nextRatio);
    }
    let nextSize = selectedSize;
    if (m.supported_sizes.length) {
      nextSize =
        m.default_size && m.supported_sizes.some((s) => s.id === m.default_size)
          ? (m.default_size as string)
          : m.supported_sizes[0].id;
      setSelectedSize(nextSize);
    }
    let nextDuration = duration;
    if (m.supported_durations) {
      const clamp = (v: number) =>
        Math.min(Math.max(v, m.supported_durations!.min), m.supported_durations!.max);
      nextDuration = typeof m.default_duration === 'number' ? clamp(m.default_duration) : m.supported_durations.min;
      setDuration(nextDuration);
    }
    return { modelId: m.model_id, ratio: nextRatio, size: nextSize, duration: nextDuration, sampleMode: false };
  };

  useEffect(() => {
    let active = true;
    fetchGenerationModels('video')
      .then((list) => {
        if (!active) return;
        setModelList(list);
        setModelsLoaded(true);

        if (videoDraftBinding.restoreExisting || initialParams?.modelId) {
          const restoredMode = normalizeStoredVideoMode(initialParams?.mode, videoMediaRefs) ?? 'text2video';
          setSelectedModel(initialParams?.modelId ?? '');
          const model = list.find(m => m.model_id === initialParams?.modelId);

          const restoredSampleMode = initialParams?.sampleMode === true
            && model?.features?.sample_mode === true
            && model?.supported_sizes.some((s) => (s.api_value ?? s.id) === '480p');
          setSampleMode(restoredSampleMode);
          const size = model?.supported_sizes.find(s => s.id === initialParams?.resolution || s.api_value === initialParams?.resolution);
          const size480 = model?.supported_sizes.find(s => (s.api_value ?? s.id) === '480p');
          setSelectedSize(restoredSampleMode ? (size480?.id ?? size?.id ?? initialParams?.resolution ?? '') : (size?.id ?? initialParams?.resolution ?? ''));

          normalSizeRef.current = restoredSampleMode && size?.id ? size.id : '';
          const restoredLockedRatio = lockedRatioOf(model?.features, restoredMode);
          setSelectedRatio(restoredLockedRatio ?? (initialParams?.aspectRatio ?? ''));
          setDuration(initialParams?.duration ?? 0);
          setSelectedMode(restoredMode);

          setGenerateAudio(initialParams?.generateAudio ?? true);
          return;
        }
        if (!list.length) return;

        if (initialParams?.modelId && !list.some((m) => m.model_id === initialParams.modelId)) {
          onToast?.('warn', '原生成模型已不可用，已回退默认模型，请确认后发送');
        }
        const target =
          (initialParams?.modelId && list.find((m) => m.model_id === initialParams.modelId)) ||
          list[0];
        const applied = applyModelDefaults(target);

        const patch: VideoDraftParamsPatch = { ...applied };

        patch.generateAudio = generateAudio;
        if (initialParams) {
          if (initialParams.aspectRatio && hasAspectRatio(target.supported_aspect_ratios, initialParams.aspectRatio)) {
            setSelectedRatio(initialParams.aspectRatio);
            patch.ratio = initialParams.aspectRatio;
          }
          if (initialParams.resolution) {
            const size = target.supported_sizes.find(
              (s) => s.api_value === initialParams.resolution || s.id === initialParams.resolution,
            );
            if (size) {
              setSelectedSize(size.id);
              patch.size = size.id;
            }
          }
          if (typeof initialParams.duration === 'number' && target.supported_durations) {
            const d = target.supported_durations;
            const clamped = Math.min(Math.max(initialParams.duration, d.min), d.max);
            setDuration(clamped);
            patch.duration = clamped;
          }
          const incomingMode = normalizeVideoMode(initialParams.mode);
          if (incomingMode && modeOptions.some((o) => o.key === incomingMode)) {
            setSelectedMode(incomingMode);
            const incomingLockedRatio = lockedRatioOf(target.features, incomingMode);
            if (incomingLockedRatio) {
              setSelectedRatio(incomingLockedRatio);
              patch.ratio = incomingLockedRatio;
            }
          }
        }

        syncDraftParams(patch);
      })
      .catch(() => { if (active) setModelsLoaded(true); });
    return () => { active = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const submit = async (text: string, options: VideoGenOptions, promptDocToSend: PromptDoc | null) => {
    if (sendingRef.current) return;
    sendingRef.current = true;
    setSending(true);
    try {
      await onSend(text, options, promptDocToSend);
    } finally {
      sendingRef.current = false;
      setSending(false);
    }
  };

  const handleDocChange = (doc: PromptDoc) => {
    setPromptDoc(doc);
    pendingNewRefInsert.current = false;
    const flat = flattenPromptDocWith(doc, (key) => refLabelOfStable.current(key));
    syncDraftParams({ prompt: flat, promptDoc: { version: PROMPT_DOC_VERSION, segments: doc.segments, flat } });
  };

  const handleSend = () => {
    if (!canSend) return;
    if (readOnly) return;
    const text = flatValue.trim();
    if (!text && !hasAttachmentText) return;
    if (!currentModel) {
      console.warn('视频模型能力加载中，请稍后重试');
      return;
    }
    if (conflict) {
      onToast?.('warn', conflict);
      return;
    }
    const composedOverLimit = composedPromptLimitError(
      composeImageSendPrompt(attachments, flatValue, promptDoc),
      maxInput,
    );
    if (composedOverLimit) {
      onToast?.('warn', composedOverLimit);
      return;
    }
    const size = currentModel.supported_sizes.find((s) => s.id === selectedSize);
    if (!size) {
      console.warn('视频模型清晰度能力缺失，请稍后重试');
      return;
    }

    const sampleQuoteData = sampleMode ? sampleQuoteQuery.data : undefined;
    if (sampleMode && (sampleQuoteData?.credits == null || sampleQuoteData?.quote_revision == null)) {
      onToast?.('warn', '样片价格已变化，请确认新报价后再提交');
      return;
    }
    void submit(text, {
      modelId: currentModel.model_id,
      aspectRatio: wireParams.aspect_ratio,
      resolution: sampleMode ? '480p' : (size.api_value ?? size.id),
      duration: wireParams.duration,
      mode: selectedMode,
      generateAudio,
      sampleMode,
      ...(sampleMode && sampleQuoteData
        ? { expectedCredits: sampleQuoteData.credits ?? undefined, quoteRevision: sampleQuoteData.quote_revision ?? undefined }
        : {}),
    }, docHasAnyRef(promptDoc) ? promptDoc : null);
  };

  const mentionItems = useMemo(() => {
    const out: Array<{ assetId: string; url: string; name: string; badge: string; mediaType: 'image' | 'video' | 'audio' | 'text'; searchText?: string }> = [];
    for (const item of [videoMediaRefs.first, videoMediaRefs.last, ...videoMediaRefs.reference]) {
      if (!item) continue;
      const id = refIdOf(item);
      const badge = labelOfStable.current(id);
      if (!badge) continue;
      out.push({ assetId: id, url: item.url, name: item.name, badge, mediaType: item.mediaType });
    }

    for (let i = 0; i < (attachments ?? []).length; i += 1) {
      const a = attachments![i]!;
      out.push({ assetId: a.nodeId, url: '', name: a.title, badge: `文本${i + 1}`, mediaType: 'text', searchText: a.text });
    }
    return out;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [videoMediaRefs, attachments, reconcileKey]);

  const closeMention = (restoreFocus = false) => {
    editorRef.current?.dismissMention(restoreFocus);
    setMention({ open: false, query: '' });
  };
  const pickMentionRef = (assetId: string) => {

    editorRef.current?.insertRefAtMention(refKeyOf(assetId));
    setMention({ open: false, query: '' });
  };

  const refKeyOf = (assetId: string): PromptRefKey => ({
    kind: orderedTextNodeIds.includes(assetId) ? 'text_ref' : 'asset_ref',
    id: assetId,
  });

  const insertRefByKey = (assetId: string) => {
    editorRef.current?.insertRefAtPending(refKeyOf(assetId), true);
  };

  const pendingNewRefInsert = useRef(false);

  const prevRefIdsRef = useRef<Array<string>>([]);
  const prevTextNodeIdsRef = useRef<Array<string>>([]);
  useEffect(() => {
    const ids = refItems.filter((item) => labelOfStable.current(item.id) !== null).map((item) => item.id);
    const prev = prevRefIdsRef.current;
    prevRefIdsRef.current = ids;
    const prevText = prevTextNodeIdsRef.current;
    prevTextNodeIdsRef.current = orderedTextNodeIds;
    if (!pendingNewRefInsert.current) return;
    const added = ids.filter((id) => !prev.includes(id));
    if (added.length > 0) {
      pendingNewRefInsert.current = false;
      editorRef.current?.insertRefAtPending({ kind: 'asset_ref', id: added[added.length - 1] });
      return;
    }

    const addedText = orderedTextNodeIds.filter((id) => !prevText.includes(id));
    if (addedText.length > 0) {
      pendingNewRefInsert.current = false;
      editorRef.current?.insertRefAtPending({ kind: 'text_ref', id: addedText[addedText.length - 1] });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reconcileKey, orderedTextNodeIds]);

  useDismissOnOutside([
    { open: replaceTarget !== null, ref: replaceMenuRef, dismiss: () => setReplaceTarget(null) },
  ]);

  const renderSourceMenu = (kind: 'image' | 'video', role: VideoRefRole, label?: string) => (
    <RefSourceMenu
      onPickFromAssets={() => onPickFromAssets?.(kind, role)}
      onPickFromCanvas={() => onPickFromCanvas?.(kind, role)}
      pickMode={pickMode === kind}
      label={label}
      entryTitle={label ? `添加${label}（从资产中选择 / 从节点添加素材）` : undefined}
    />
  );

  const renderRefThumb = (item: VideoMediaRef, key?: string, badgeText?: string, dragProps?: StripDragItemProps) => (
    <RefThumbnail
      key={key}
      data-testid="dock-video-ref"
      kind={item.mediaType}
      url={item.url}
      name={item.name}
      badgeText={badgeText}
      number={refNumberMap.get(refIdOf(item))}
      audioDuration={item.duration}
      locked={item.textNodeId != null}
      onLocate={item.textNodeId != null && onLocateTextSource ? () => onLocateTextSource(item.textNodeId!) : undefined}
      onRemove={!readOnly && item.textNodeId == null
        ? () => (isLibraryOnlyVideoRef(item) ? onRemoveMaterialRef?.(item.materialId) : onRemoveVideoRef?.(item.nodeId))
        : undefined}
      onInsertRef={!readOnly && refLabels.has(refIdOf(item)) ? () => insertRefByKey(refIdOf(item)) : undefined}
      insertTitle={INSERT_REF_APPEND_TITLE}
      dragProps={dragProps}
    />
  );

  const handleStripReorder = (from: number, to: number) => {
    const { nextMedia, nextText, mediaChanged, textChanged } = mixedStrip.reorder(from, to);
    if (mediaChanged) onReorderMediaRefs?.(nextMedia.map(key => key.slice(key.indexOf(':') + 1)));
    if (textChanged) onReorderAttachments?.(nextText);
  };
  const stripDrag = useRefStripDrag({ disabled: readOnly, onReorder: handleStripReorder });

  const renderTextThumb = (a: ImageTextAttachment, stripIndex: number) => (
    <RefThumbnail
      key={a.nodeId}
      data-testid="dock-text-ref"
      kind="text"
      name={a.title}
      number={orderedTextNodeIds.indexOf(a.nodeId) + 1}
      textPreview={a.text}
      onRemove={
        !readOnly && (!a.isPromptPlan || !syncingPlan) && onRemoveAttachment
          ? () => onRemoveAttachment(a.nodeId)
          : undefined
      }
      onInsertRef={!readOnly ? () => insertRefByKey(a.nodeId) : undefined}
      insertTitle={INSERT_REF_APPEND_TITLE}
      dragProps={stripDrag.itemProps(mixedStrip.index(stripIndex))}
    />
  );
  const textThumbsAt = (base: number) => (attachments ?? []).map((a, i) => renderTextThumb(a, base + i));

  const onDurationSliderKeyDown = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Escape') return;
    e.preventDefault();
    e.stopPropagation();
    onClose();
  };

  return (
    <div
      className={`${styles.dialogWrap} ${followAnchor ? styles.dialogWrapFollow : ''}`}
      style={anchoredOverlayStyle(followAnchor ?? null, dragHidden)}
      data-gen-panel-territory
    >
      {
}
      {mention.open && !readOnly && (
        <div className={styles.mentionDock} ref={mentionMenuRef}>
          <AtMentionMenu
            renderInline
            anchorRef={mentionMenuRef}
            items={canvasMentionItems ?? []}
            editorQuery={mention.query}
            referencedItems={mentionItems.map(r => ({
              id: r.assetId, assetId: r.assetId, name: r.name, thumbUrl: r.url,
              kind: r.mediaType, badge: r.badge, searchText: r.searchText,
            }))}
            onSelectReferenced={(item) => pickMentionRef(item.id)}
            onSelect={(item) => {
              const id = item.assetId ?? '';
              if (id && refLabels.has(id)) {

                pickMentionRef(id);
              } else if (item.kind === 'text' && orderedTextNodeIds.includes(item.id)) {

                pickMentionRef(item.id);
              } else {

                editorRef.current?.consumeMentionForPendingInsert();
                pendingNewRefInsert.current = true;
                setMention({ open: false, query: '' });
                onMentionCanvas?.(item);
              }
            }}
            onClose={closeMention}
            onEscapeClose={() => closeMention(true)}
          />
        </div>
      )}
      { }
      {replaceTarget !== null && (
        <div className={styles.mentionDock} ref={replaceMenuRef}>
          <ReplaceRefMenu
            items={mentionItems}
            onPick={(assetId) => {

              editorRef.current?.replaceRefAt(replaceTarget, refKeyOf(assetId));
              setReplaceTarget(null);
            }}
          />
        </div>
      )}
      {
}
      {showConfig && (
        <div className={styles.configPanel} ref={configPanelRef}>
          { }
          <button
            className={styles.configCloseBtn}
            onClick={() => setShowConfig(false)}
            title="关闭"
          >
            <X size={14} strokeWidth={2} />
          </button>
          { }
          <span className={styles.configLabel}>模型与质量</span>
          <div className={styles.configRow}>
            <Select
              value={selectedModel}
              onChange={(key) => {
                const gen = modelList.find((x) => x.model_id === key);
                if (gen) {
                  syncDraftParams(applyModelDefaults(gen));
                  syncModeToModel(gen);
                }
              }}
              disabled={readOnly}
              side="top"
              placeholder="选择模型"
              ariaLabel="选择模型"
              options={modelOptions.map((m) => ({ value: m.key, label: m.label }))}
            />

            <Select
              value={selectedSize}
              onChange={(key) => {
                setSelectedSize(key);
                syncDraftParams({ size: key });
              }}
              disabled={readOnly || sampleMode}
              side="top"
              triggerTitle={sampleMode ? '样片模式固定 480p，关闭样片后可调整清晰度' : undefined}
              ariaLabel="选择分辨率"
              options={sizeOptions.map((s) => ({ value: s.key, label: s.label }))}
            />
          </div>

          {
}
          {supportsSampleMode && (
            <div className={styles.audioRow}>
              <span className={styles.audioHint}>样片模式 · 先生成 480p 样片，成片另收费</span>
              <button
                type="button"
                className={`${styles.audioSwitch} ${sampleMode ? styles.audioSwitchOn : ''}`}
                role="switch"
                aria-checked={sampleMode}
                aria-label="样片模式"
                data-testid="sample-mode-switch"
                disabled={readOnly}
                onClick={() => {
                  const next = !sampleMode;
                  setSampleMode(next);
                  if (next) {

                    normalSizeRef.current = selectedSize;
                    if (sampleSize480) {
                      setSelectedSize(sampleSize480.id);
                      syncDraftParams({ sampleMode: true, size: sampleSize480.id });
                      return;
                    }
                    syncDraftParams({ sampleMode: true });
                    return;
                  }
                  const restore = normalSizeRef.current
                    && currentModel?.supported_sizes.some((s) => s.id === normalSizeRef.current)
                    ? normalSizeRef.current
                    : undefined;
                  if (restore) {
                    setSelectedSize(restore);
                    syncDraftParams({ sampleMode: false, size: restore });
                    return;
                  }
                  syncDraftParams({ sampleMode: false });
                }}
              >
                <span className={styles.audioSwitchKnob} />
              </button>
            </div>
          )}
          { }
          {sampleMode && (
            <p className={styles.sampleTerm} data-testid="sample-mode-term">
              样片创建后最长 7 天内可发起成片生成，请以样片卡显示的实际截止时间为准；成片另行计费。
            </p>
          )}

          {durationLocked ? (
            <>
              <span className={styles.configLabel}>时长</span>
              <div className={styles.durationRange}>
                <span>跟随原视频</span>
              </div>
            </>
          ) : durationRange && (
            <>
              <div className={styles.durationHead}>
                <span className={styles.configLabel}>时长</span>
                <span className={styles.durationValue}>{duration}s</span>
              </div>
              <input
                type="range"
                className={styles.durationSlider}
                min={durationRange.min}
                max={durationRange.max}
                step={durationRange.step}
                value={duration}
                disabled={readOnly}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  setDuration(v);
                  syncDraftParams({ duration: v });
                }}
                onKeyDown={onDurationSliderKeyDown}
              />
              <div className={styles.durationTicks}>
                {ticks.map((v) => (
                  <span key={v} className={`${styles.tick} ${v === duration ? styles.tickActive : ''}`} />
                ))}
              </div>
              <div className={styles.durationRange}>
                <span>{durationRange.min}s</span>
                <span>{durationRange.max}s</span>
              </div>
            </>
          )}

          {!ratioLocked && (
            <>
              <span className={styles.configLabel}>宽高比</span>
              <RatioGroup
                className={styles.ratioGroup}
                variant="tiles"
                value={selectedRatio}
                disabled={readOnly}
                ariaLabel="宽高比"
                onChange={(id) => {
                  setSelectedRatio(id);
                  syncDraftParams({ ratio: id });
                }}
                options={ratioOptions.map((option) => ({
                  value: option.id,
                  label: videoRatioLabel(option.label),
                }))}
              />
            </>
          )}

          { }
          {supportsAudio && (
            <>
              <span className={styles.configLabel}>音频</span>
              <div className={styles.audioRow}>
                <span className={styles.audioHint}>生成的视频是否带声音</span>
                <button
                  type="button"
                  className={`${styles.audioSwitch} ${generateAudio ? styles.audioSwitchOn : ''}`}
                  role="switch"
                  aria-checked={generateAudio}
                  aria-label="生成的视频带音频"
                  disabled={readOnly}
                  onClick={() => {
                    const next = !generateAudio;
                    setGenerateAudio(next);

                    syncDraftParams({ generateAudio: next });
                  }}
                >
                  <span className={styles.audioSwitchKnob} />
                </button>
              </div>
            </>
          )}
        </div>
      )}

      <div className={`${styles.dialog} ${expanded ? styles.dialogExpanded : ''}`}>
      {

}
      <div className={styles.actionBarRow}>
        <AttachmentActionBar
          kind={actionBarKind}
          role={isKeyframe
            ? (selectedMode === 'first_frame' || !videoMediaRefs.first ? 'first' : 'last')
            : 'reference'}

          onPickFromCanvas={(kind, role) => { if (kind !== 'audio') onPickFromCanvas?.(kind, role); }}
          onPickFromAssets={(kind, role) => { if (kind !== 'audio') onPickFromAssets?.(kind, role); }}
          pickMode={pickMode === actionBarKind}
          disabledReason={actionBarDisabledReason}
          trailing={(
            <>
              <button
                className={styles.iconBtn}
                onClick={() => setExpanded((v) => !v)}
                title={expanded ? '收起' : '展开'}
              >
                {expanded ? <Minimize2 size={14} strokeWidth={2} /> : <Maximize2 size={14} strokeWidth={2} />}
              </button>
              <button className={styles.iconBtn} onClick={onClose} title="关闭">
                <X size={16} strokeWidth={2} />
              </button>
            </>
          )}
        />
      </div>

      {

}
      {(isKeyframe || stripHasItems || (videoMediaRefs.invalid?.length ?? 0) > 0 || !!conflict || readOnly) && (
      <div className={styles.refRoleArea}>
        {isKeyframe ? (
          <div className={styles.refSlot}>
            { }
            {videoMediaRefs.first ? (
              renderRefThumb(videoMediaRefs.first, undefined, '首帧')
            ) : (
              !readOnly && canAddFirst && renderSourceMenu('image', 'first', '首帧')
            )}
            { }
            {selectedMode === 'first_last_frame' && (videoMediaRefs.last ? (
              renderRefThumb(videoMediaRefs.last, undefined, '尾帧')
            ) : (
              !readOnly && canAddLast && renderSourceMenu('image', 'last', '尾帧')
            ))}
            {mixedStrip.render([], textThumbsAt(0))}
          </div>
        ) : (
          stripHasItems && (
            <div className={styles.refSlot}>
              {mixedStrip.render(
                videoMediaRefs.reference.map((r, i) => renderRefThumb(r, r.materialId != null ? `material:${r.materialId}` : `node:${r.nodeId}`, undefined, stripDrag.itemProps(mixedStrip.index(i)))),
                textThumbsAt(videoMediaRefs.reference.length),
              )}
              { }
              {videoMediaRefs.reference.length > 0 && (
                <span className={styles.fileCount}>
                  {videoMediaRefs.reference.length}/{caps ? (caps.imageMax ?? 9) + (caps.videoReferenceMax ?? 3) : 12}
                </span>
              )}
            </div>
          )
        )}
        {videoMediaRefs.invalid?.map((ref) => (
          <div key={ref.nodeId} className={styles.refConflictHint} role="alert">
            {ref.role === 'first' ? '首帧' : ref.role === 'last' ? '尾帧' : '普通参考'}：{ref.name} — {ref.reason}
            <button
              type="button"
              disabled={readOnly}
              aria-label={`移除失效引用 ${ref.name}`}
              onClick={() => (isLibraryOnlyVideoRef(ref) ? onRemoveMaterialRef?.(ref.materialId) : onRemoveVideoRef?.(ref.nodeId))}
            >移除引用</button>
          </div>
        ))}
        { }
        {conflict && <div className={styles.refConflictHint} role="alert">{conflict}</div>}
        {readOnly && <div className={styles.readOnlyHint}>{readOnlyReason}</div>}
        { }
        {showOmniFollowHint && <div className={styles.followHint}>{OMNI_REFERENCE_FOLLOW_HINT}</div>}
      </div>
      )}

      <PromptSyncActions plans={pendingPlanSyncs} disabled={readOnly || syncingPlan} onSync={onSyncPlan} />
      {configurationError && <div className={styles.refConflictHint} role="alert">{configurationError}</div>}

      { }
      <div className={styles.editorWrap} ref={mentionAnchorRef}>
        <PromptRefEditor
          ref={editorRef}
          initialDoc={initialDoc ?? null}
          initialText={initialText ?? ''}
          placeholder="描述你希望生成的视频。输入 @ 可引用已选素材。"
          readOnly={readOnly || pickLocked}
          labelOf={(key) => refLabelOfStable.current(key)}
          reconcileKey={reconcileKey}
          labels={refLabels}
          refsMeta={refsMeta}
          onChange={handleDocChange}
          onMentionChange={(state) => {
            setMention(state);
          }}
          onInvalidTagClick={readOnly ? undefined : (nodeKey) => setReplaceTarget(nodeKey)}
          className={styles.editorArea}
        />
      </div>

      { }
      <div className={styles.bottomBar}>
        { }
        <div className={styles.barLeft}>
          { }
          <div className={styles.modeWrap}>
            <Select
              value={selectedMode}
              onChange={handleModeChange}
              size="sm"
              side="top"
              disabled={readOnly || pickLocked}
              triggerTitle={pickLocked ? '选取进行中，完成选取后再切换模式' : undefined}
              ariaLabel="选择生成模式"
              placeholder="选择模式"
              options={modeOptions.map((opt) => ({
                value: opt.key,
                label: opt.label,
                disabled: !enabledModes.includes(opt.key),
              }))}
            />
          </div>

          { }
          <button
            className={styles.configBtn}
            disabled={pickLocked}
            title={pickLocked ? '选取进行中，完成选取后再调整模型配置' : undefined}
            onClick={() => setShowConfig(!showConfig)}
          >
            <SlidersHorizontal size={14} strokeWidth={2} />
            <span>{currentModel?.model_label ?? '选择模型'}</span>
            {!ratioLocked && (
              <>
                <span className={styles.barDivider}>|</span>
                { }
                <span>{videoRatioLabel(selectedRatio)}</span>
              </>
            )}
            <span className={styles.barDivider}>|</span>
            <span>{currentSizeLabel}</span>
            <span className={styles.barDivider}>|</span>
            <span>{durationLocked ? '跟随原视频' : `${duration}s`}</span>
          </button>
        </div>

        { }
        <div className={styles.barRight}>
          {

}
          {projectId ? (
            <GenerationQuoteBadge
              projectId={projectId}
              type="video"
              parameters={quoteParameters}
              references={quoteReferences}
              targetNodeId={targetNodeId}
            />
          ) : null}
          { }
          <div className={`${styles.charCount} ${maxInput != null && flatValue.length >= maxInput ? styles.charCountWarn : ''}`}>
            {promptCharCountLabel(flatValue.length, maxInput)}
          </div>
          <button
            data-testid="video-send"
            className={`${styles.sendBtn} ${canSend && !readOnly && !conflict ? styles.sendBtnActive : ''}`}
            onClick={handleSend}
            disabled={!canSend || readOnly || !!conflict}
            title={conflict ?? (readOnly ? '生成中，输入只读' : '发送')}
          >
            <ArrowUp size={12.8} fill="currentColor" strokeWidth={0} />
          </button>
        </div>
      </div>
      </div>
    </div>
  );
}
