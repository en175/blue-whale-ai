

import { PANEL_REF_MEDIA_TYPES, VIDEO_MODE_LABEL } from '@/custom/enums';
import { useState, useRef, useEffect, useCallback, useLayoutEffect, useMemo, useSyncExternalStore } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useDismissOnOutside } from '@/custom/pages/CanvasPage/hooks/shared/useDismissOnOutside';
import { createPortal } from 'react-dom';
import { Plus, ChevronUp, Music, BookOpen, BookText, X, Upload, FolderOpen } from 'lucide-react';
import SkillModal from '../SkillModal';
import LoginModal from '@/custom/components/LoginModal';
import { useLoginDialogStore } from '@/shared/stores/loginDialog';
import RatioIcon from '@/custom/components/RatioIcon';
import Select from '@/custom/components/Select';
import AssetsPickerModal from '@/custom/pages/CanvasPage/components/AssetsPickerModal';

import {
  defaultVideoModeFor,
  enabledVideoModes,
  nextVideoModeOnRefsChange,
  resolveVideoMode,
  videoModeRefsSignature,
} from '@/custom/pages/CanvasPage/tools/video/videoModes';
import type { VideoMediaRef, VideoMediaRefs } from '@/custom/pages/CanvasPage/tools/video/videoMediaRefs';
import { allowsAutoDurationOf, configuredVideoModes, effectiveVideoParams, frameSlotCountOf, isFrameMode, lockedDurationOf, lockedRatioOf, type VideoMode } from '@/custom/utils/video-modes';
import { type AssetRecord } from '@/custom/api/assets';
import { getCurrentUser, subscribe } from '@/shared/utils/auth';
import { remoteImageCrossOrigin, resolveMediaSrc } from '@/shared/utils/remoteImageCors';
import styles from './index.module.css';
import { fetchGenerationModels, type GenerationModel } from '@/custom/api/generation';
import { aspectRatioOptions, hasAspectRatio, pickRatioForSize, ratiosForSelectedSize } from '@/custom/utils/image-size-ratios';
import { pickDefaultVideoRatio, videoRatioLabel } from '@/custom/utils/video-aspect-ratio';
import { type SkillRecord } from '@/custom/api/skills';
import { createProject } from '@/custom/api/projects';
import { setGenHandoff } from '@/custom/utils/gen-handoff';
import { setAgentHandoff } from '@/custom/utils/agent-handoff';
import { classifyRefOverflow } from '@/custom/utils/ref-overflow';
import { videoReferenceMaxOf, audioReferenceMaxOf, imageReferenceMaxOf, supportsVideoReferenceOf, UNRESOLVED_IMAGE_REFERENCE_LIMIT } from '@/custom/utils/model-reference-limits';
import { promptCharCountLabel, promptMaxLengthOf } from '@/custom/utils/prompt-max-length';
import { VIDEO_REFERENCE_NOT_APPROVED_MESSAGE, isUnapprovedVideoMaterialStatus } from '@/custom/utils/video-reference-compliance';
import { OMNI_REFERENCE_FOLLOW_HINT } from '@/custom/utils/video-reference-hints';
import { showToast as pushToast } from '@/custom/components/Toast';
import { resolveHomeLoginResume, type HomePendingAction } from './homeLoginResume';
import { limitPromptInput } from './promptInput';
import GenerationPreference, { type PreferenceField, type PreferenceToggle } from './GenerationPreference';
import ModeMenu from './ModeMenu';

const modeItems = [
  { key: 'agent', label: 'Agent' },
  { key: 'image', label: '图片' },
  { key: 'video', label: '视频' },
] as const;

const MODE_LABEL: Record<'agent' | 'image' | 'video', string> = {
  agent: 'Agent 模式',
  image: '图片生成',
  video: '视频生成',
};

type ChatMode = (typeof modeItems)[number]['key'];
type Workspace = 'create' | 'canvas';

type KeyframeRefItem = { file?: File; preview: string; type: 'image'; assetId?: string | number };

function makeProjectName(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

async function navigateToNewProject(navigate: ReturnType<typeof useNavigate>, state: unknown) {
  try {
    const created = await createProject(makeProjectName(), undefined, 'dialog');
    navigate(`/canvas?project=${created.id}`, { state });
  } catch {
    navigate('/canvas', { state });
  }
}

export default function ChatBox({
  draft,
  workspace = 'create',
}: {
  draft?: { text: string; ts: number; mediaType: 'video' | 'image' } | null;
  workspace?: Workspace;
}) {
  const showToast = (msg: string) => pushToast('warn', msg);
  const [activeTab, setActiveTab] = useState<ChatMode>('agent');
  const [inputValue, setInputValue] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const navigate = useNavigate();
  const location = useLocation();
  const user = useSyncExternalStore(subscribe, getCurrentUser);

  const visibleModes = modeItems.filter((item) => workspace === 'create' || item.key !== 'agent');

  useEffect(() => {
    if (workspace === 'canvas' && activeTab === 'agent') setActiveTab('video');
  }, [workspace, activeTab]);


  const [showLogin, setShowLogin] = useState(false);

  useEffect(() => {
    const returnTo = (location.state as { returnTo?: string } | null)?.returnTo;
    if (!returnTo || !getCurrentUser()) return;
    navigate(returnTo, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [assetsPickerTarget, setAssetsPickerTarget] = useState<'agent' | 'video' | 'image' | null>(null);

  const [refMenu, setRefMenu] = useState<'agent' | 'video' | 'image' | null>(null);

  const [refMenuPos, setRefMenuPos] = useState<{ top: number; left: number } | null>(null);
  const refMenuRef = useRef<HTMLDivElement>(null);

  const refCardRef = useRef<HTMLDivElement>(null);

  const pendingAction = useRef<HomePendingAction | null>(null);

  const [armedSkill, setArmedSkill] = useState<{ id: string; name: string } | null>(null);

  useEffect(() => {
    if (draft?.ts) {
      setInputValue(draft.text);
      setActiveTab(draft.mediaType === 'video' ? 'video' : 'image');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft?.ts]);

  useLayoutEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = 'auto';
    textarea.style.height = `${textarea.scrollHeight}px`;
  }, [activeTab, inputValue]);

  const [agentFiles, setAgentFiles] = useState<
    { id: string; url: string; kind: 'image' | 'video' | 'audio'; name: string; file?: File; assetId?: string | number }[]
  >([]);
  const agentFileInputRef = useRef<HTMLInputElement>(null);
  const [showSkillModal, setShowSkillModal] = useState(false);

  const [creationModel, setCreationModel] = useState('');

  const [videoModel, setVideoModel] = useState('');
  const [videoMode, setVideoMode] = useState<VideoMode>('text2video');
  const [aspectRatio, setAspectRatio] = useState('');
  const [resolution, setResolution] = useState('');
  const [duration, setDuration] = useState(0);

  const [generateAudio, setGenerateAudio] = useState(true);

  const [refFiles, setRefFiles] = useState<
    { file?: File; preview: string; type: 'image' | 'video'; assetId?: string | number }[]
  >([]);

  const isKeyframe = isFrameMode(videoMode);

  const [keyframeRefs, setKeyframeRefs] = useState<{
    first?: { file?: File; preview: string; type: 'image'; assetId?: string | number };
    last?: { file?: File; preview: string; type: 'image'; assetId?: string | number };
  }>({});

  const [slotTarget, setSlotTarget] = useState<'first' | 'last' | null>(null);

  const [imageModel, setImageModel] = useState('');
  const [imageAspectRatio, setImageAspectRatio] = useState('');
  const [imageResolution, setImageResolution] = useState('');

  const [imageRefFiles, setImageRefFiles] = useState<
    { file?: File; preview: string; name?: string; assetId?: string | number }[]
  >([]);

  const imageFileInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const firstSlotRef = useRef<HTMLButtonElement>(null);
  const lastSlotRef = useRef<HTMLButtonElement>(null);

  const [videoModelList, setVideoModelList] = useState<GenerationModel[]>([]);
  const [imageModelList, setImageModelList] = useState<GenerationModel[]>([]);

  const applyImageModel = (model: GenerationModel) => {
    setImageModel(model.model_id);
    const nextSize =
      model.default_size && model.supported_sizes.some((s) => s.id === model.default_size)
        ? model.default_size
        : (model.supported_sizes[0]?.id ?? '');
    if (model.supported_sizes.length) setImageResolution(nextSize);
    setImageAspectRatio(pickRatioForSize(model, nextSize, model.default_aspect_ratio));
  };

  useEffect(() => {
    if (!isKeyframe) return;
    const ok = keyframeRefs.first || keyframeRefs.last;
    if (!ok) showToast('首尾帧模式需至少上传一张图片（首帧或尾帧）');
  }, [isKeyframe, keyframeRefs]);

  useEffect(() => {
    const m = videoModelList.find((x) => x.model_id === videoModel);
    if (!m) return;
    const lockedRatio = lockedRatioOf(m.features, videoMode);
    if (lockedRatio) {
      setAspectRatio(lockedRatio);
    } else if (aspectRatioOptions(m.supported_aspect_ratios).length && !hasAspectRatio(m.supported_aspect_ratios, aspectRatio)) {
      setAspectRatio(pickDefaultVideoRatio(m.supported_aspect_ratios, m.default_aspect_ratio));
    }
    if (m.supported_sizes.length && !m.supported_sizes.some((s) => s.id === resolution)) {
      setResolution(
        m.default_size && m.supported_sizes.some((s) => s.id === m.default_size)
          ? (m.default_size as string)
          : m.supported_sizes[0].id,
      );
    }
    if (m.supported_durations) {
      const d = m.supported_durations;
      setDuration((prev) => {
        if (prev === -1 && allowsAutoDurationOf(m.features, videoMode)) return prev;
        if (prev >= d.min && prev <= d.max) return prev;
        if (typeof m.default_duration === 'number' && m.default_duration >= d.min && m.default_duration <= d.max) {
          return m.default_duration;
        }
        return Math.min(Math.max(prev, d.min), d.max);
      });
    }
    const lockedDuration = lockedDurationOf(m.features, videoMode);
    if (lockedDuration != null) {
      setDuration(lockedDuration);
    } else {
      setDuration((prev) => {
        if (prev > 0 || (prev === -1 && allowsAutoDurationOf(m.features, videoMode))) return prev;
        const d = m.supported_durations;
        if (!d) return prev;
        const base = typeof m.default_duration === 'number' ? m.default_duration : d.min;
        return Math.min(Math.max(base, d.min), d.max);
      });
    }
    if (!isFrameMode(videoMode)) {
      const enabled = enabledVideoModes(videoRefsProjection, configuredVideoModes(m.features));
      const target = resolveVideoMode(defaultVideoModeFor(videoRefsProjection), enabled);
      if (target && target !== videoMode && !enabled.includes(videoMode)) {
        setVideoMode(target);
        showToast('已根据当前素材切换生成模式');
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [videoModelList, videoModel, isKeyframe, videoMode]);

  useEffect(() => {
    fetchGenerationModels('video')
      .then((list) => {
        setVideoModelList(list);
        if (list.length) {
          setVideoModel((prev) => (list.some((m) => m.model_id === prev) ? prev : list[0].model_id));
          setCreationModel((prev) => (list.some((m) => m.model_id === prev) ? prev : list[0].model_id));
        }
      })
      .catch(() => undefined);
    fetchGenerationModels('image')
      .then((list) => {
        setImageModelList(list);
        if (list.length) applyImageModel(list[0]);
      })
      .catch(() => undefined);
  }, []);

  useDismissOnOutside([
    { open: refMenu !== null, ref: [refMenuRef, refCardRef], dismiss: () => setRefMenu(null) },
  ]);

  const goCanvasWithText = (text: string, skillId?: string, skillName?: string, allowCreate = true) => {
    setInputValue('');
    if (skillId) setArmedSkill(null);

    if (agentFiles.length > 0) {
      const media = agentFiles.filter((f) => f.kind !== 'audio');
      const audioCount = agentFiles.length - media.length;
      if (audioCount > 0) showToast('音频附件暂不支持带入画布，已忽略');
      if (media.length > 0) {
        setAgentHandoff(
          media.map((f) => ({
            file: f.file,
            preview: f.url,
            name: f.name,
            kind: f.kind as 'image' | 'video',
            assetId: f.assetId,
          })),
        );
      }
      setAgentFiles([]);
    }
    const state = { agentText: text, skillId: skillId ?? '', skillName: skillName ?? '' };
    if (!allowCreate) {
      navigate('/canvas', { state });
      return;
    }
    navigateToNewProject(navigate, state);
  };

  const dispatchByTab = (text: string, allowCreate = true) => {
    if (activeTab === 'video') {
      if (!selectedVideoModel) {
        showToast('视频模型能力加载中，请稍后重试');
        return;
      }
      if (videoConfiguredModes.length === 0) {
        showToast('当前模型未配置视频模式，请更换模型');
        return;
      }

      const sizeEntry = selectedVideoModel.supported_sizes.find((s) => s.id === resolution);
      const handoffParams = effectiveVideoParams(selectedVideoModel.features, videoMode, {
        aspectRatio,
        duration,
      });
      setGenHandoff({
        kind: 'video',
        text,
        modelId: videoModel,
        aspectRatio: handoffParams.aspect_ratio,
        resolution: sizeEntry?.api_value ?? sizeEntry?.id ?? resolution,
        duration: handoffParams.duration,
        mode: videoMode,

        generateAudio,
        refs: isKeyframe
          ? ([keyframeRefs.first, keyframeRefs.last].filter(Boolean) as (
              { file?: File; preview: string; type: 'image'; assetId?: string | number }
            )[]).map((r) => ({
              preview: r.preview,
              type: r.type,
              file: r.file,
              assetId: r.assetId,
            }))
          : refFiles.map((r) => ({
              preview: r.preview,
              type: r.type,
              file: r.file,
              assetId: r.assetId,
            })),
      });
      setInputValue('');
      if (isKeyframe) setKeyframeRefs({});
      else setRefFiles([]);
      if (!allowCreate) {
        navigate('/canvas', { state: { genKind: 'video' } });
        return;
      }
      navigateToNewProject(navigate, { genKind: 'video' });
      return;
    }
    if (activeTab === 'image') {
      if (!selectedImageModel) {
        showToast('图片模型能力加载中，请稍后重试');
        return;
      }
      setGenHandoff({
        kind: 'image',
        text,
        modelId: imageModel,
        size: imageResolution,
        ratio: imageAspectRatio,
        files: imageRefFiles.map((r) => ({
          id: `home-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          url: r.preview,
          type: 'image' as const,
          name: r.name ?? '参考图',
          file: r.file,
          assetId: r.assetId,
        })),
      });
      setInputValue('');
      setImageRefFiles([]);
      if (!allowCreate) {
        navigate('/canvas', { state: { genKind: 'image' } });
        return;
      }
      navigateToNewProject(navigate, { genKind: 'image' });
      return;
    }
    goCanvasWithText(text, armedSkill?.id, armedSkill?.name, allowCreate);
  };

  const handleUseSkill = (skill: SkillRecord) => {
    setShowSkillModal(false);

    if (!getCurrentUser()) {
      pendingAction.current = { kind: 'use-skill', skill };
      setShowLogin(true);
      return;
    }
    if (!skill.creative_skill_id) return;
    setArmedSkill({ id: skill.creative_skill_id, name: skill.name ?? '' });
  };

  const handleSend = () => {
    const text = inputValue.trim();
    if (!text) return;

    if (keyframeSendHint) {
      showToast(keyframeSendHint);
      return;
    }

    if (!user) {
      pendingAction.current = { kind: 'send', text };
      setShowLogin(true);
      return;
    }
    dispatchByTab(text);
  };

  const handleLoginClose = () => {
    const pending = pendingAction.current;
    pendingAction.current = null;
    setShowLogin(false);
    useLoginDialogStore.getState().closeLogin();
    if (!pending) return;
    const resume = resolveHomeLoginResume(pending, !!getCurrentUser());
    switch (resume.action) {
      case 'open-skill':
        setShowSkillModal(true);
        return;
      case 'use-skill':
        handleUseSkill(resume.skill);
        return;
      case 'send':
        dispatchByTab(resume.text, false);
        return;
      case 'launch':
        navigate('/canvas', { state: resume.state });
        return;
      case 'restore-text':
        setInputValue(resume.text);
        return;
      default:
        return;
    }
  };

  const handleAgentFilePick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    let imgRoom = Math.max(0, agentMaxImages - agentImageCount);
    let vidRoom = Math.max(0, agentMaxVideos - agentVideoCount);
    let audRoom = Math.max(0, agentMaxAudios - agentAudioCount);
    const items = files
      .filter((file) => {
        if (file.type.startsWith('image/')) {
          if (imgRoom <= 0) return false;
          imgRoom -= 1;
          return true;
        }
        if (file.type.startsWith('video/')) {
          if (vidRoom <= 0) return false;
          vidRoom -= 1;
          return true;
        }
        if (audRoom <= 0) return false;
        audRoom -= 1;
        return true;
      })
      .map((file) => ({
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        url: URL.createObjectURL(file),
        kind: file.type.startsWith('image/')
          ? ('image' as const)
          : file.type.startsWith('video/')
            ? ('video' as const)
            : ('audio' as const),
        name: file.name,
        file,
      }));
    const droppedImages =
      files.filter((f) => f.type.startsWith('image/')).length - items.filter((i) => i.kind === 'image').length;
    const droppedVideos =
      files.filter((f) => f.type.startsWith('video/')).length - items.filter((i) => i.kind === 'video').length;
    const droppedAudio =
      files.filter((f) => !f.type.startsWith('image/') && !f.type.startsWith('video/')).length -
      items.filter((i) => i.kind === 'audio').length;
    if (droppedImages > 0) showToast(`附件图片最多 ${agentMaxImages} 张`);
    else if (droppedVideos > 0) showToast(`附件视频最多 ${agentMaxVideos} 个`);
    else if (droppedAudio > 0) showToast(`附件音频最多 ${agentMaxAudios} 个`);
    setAgentFiles((prev) => [...prev, ...items]);
    e.target.value = '';
  };

  const removeAgentFile = (id: string) => {
    setAgentFiles((prev) => {
      const target = prev.find((f) => f.id === id);
      if (target?.file) URL.revokeObjectURL(target.url);
      return prev.filter((f) => f.id !== id);
    });
  };

  const composingRef = useRef(false);

  const handleKeyDown = (e: React.KeyboardEvent) => {

    if (composingRef.current || e.nativeEvent.isComposing) return;
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleInputChange = (value: string) => {
    const next = limitPromptInput(value, inputValue, activePromptCap);
    setInputValue(next.value);
    if (next.reachedLimit && activePromptCap != null) showToast(`输入内容最多 ${activePromptCap} 个字符`);
  };

  const handleCompositionStart = () => { composingRef.current = true; };
  const handleCompositionEnd = () => { composingRef.current = false; };

  const videoModelOptions = videoModelList.map((m) => ({ key: m.model_id, label: m.model_label }));
  const imageModelOptions = imageModelList.map((m) => ({ key: m.model_id, label: m.model_label }));

  const creationModelOptions = videoModelOptions;

  const isVideoTab = activeTab === 'video';
  const isImageTab = activeTab === 'image';

  const selectedImageModel = imageModelList.find((m) => m.model_id === imageModel);
  const imageRatioOptions = selectedImageModel
    ? ratiosForSelectedSize(selectedImageModel, imageResolution)
    : [];
  const imageRatioLabel =
    imageRatioOptions.find((ratio) => ratio.id === imageAspectRatio)?.label ?? imageAspectRatio;
  const imageSizeItems =
    selectedImageModel?.supported_sizes.map((s) => ({ key: s.id, label: s.label })) ?? [];

  const selectedVideoModel = videoModelList.find((m) => m.model_id === videoModel);

  const videoRefsProjection = useMemo<VideoMediaRefs>(() => {
    const asRef = (
      item: { preview: string; type: 'image' | 'video'; assetId?: string | number; file?: File },
      index: number,
      prefix: string,
    ): VideoMediaRef => ({
      nodeId: `${prefix}-${index}`,
      url: item.preview,
      name: item.file?.name ?? `${prefix}-${index}`,
      assetId: String(item.assetId ?? item.file?.name ?? `${prefix}-${index}`),
      mediaType: item.type,
    });
    return {
      reference: refFiles.map((item, index) => asRef(item, index, 'home-ref')),
      ...(keyframeRefs.first ? { first: asRef(keyframeRefs.first, 0, 'home-first') } : {}),
      ...(keyframeRefs.last ? { last: asRef(keyframeRefs.last, 1, 'home-last') } : {}),
    };
  }, [refFiles, keyframeRefs]);
  const videoConfiguredModes = configuredVideoModes(selectedVideoModel?.features);
  const videoEnabledModes = enabledVideoModes(videoRefsProjection, videoConfiguredModes);
  const videoModeOptions = videoConfiguredModes.map((key) => ({ key, label: VIDEO_MODE_LABEL[key] }));
  const videoRatioLocked = lockedRatioOf(selectedVideoModel?.features, videoMode);
  const videoDurationLocked = lockedDurationOf(selectedVideoModel?.features, videoMode);

  useEffect(() => {
    if (!selectedVideoModel) return;
    const next = nextVideoModeOnRefsChange(videoMode, videoRefsProjection, videoConfiguredModes);
    if (next) {
      setVideoMode(next);
      showToast('已根据当前素材切换生成模式');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [videoModeRefsSignature(videoRefsProjection), videoConfiguredModes.join('|'), selectedVideoModel, videoMode]);

  const videoRatioOptions = aspectRatioOptions(selectedVideoModel?.supported_aspect_ratios);
  const videoRatioText = (id: string) =>
    videoRatioLabel(videoRatioOptions.find((ratio) => ratio.id === id)?.label ?? id);
  const videoSizeItems =
    selectedVideoModel?.supported_sizes.map((s) => ({ key: s.id, label: s.label })) ?? [];
  const videoDurationRange = selectedVideoModel?.supported_durations ?? null;

  const supportsVideoAudio = selectedVideoModel?.features?.audio === true;

  const videoPreferenceSummary = [
    selectedVideoModel?.model_label ?? '视频模型',
    videoRatioLocked ? null : videoRatioText(aspectRatio),
    resolution || null,
    videoDurationLocked != null ? null : duration === -1 ? '自动' : `${duration}s`,
    supportsVideoAudio ? (generateAudio ? '带音频' : '无声') : null,
  ]
    .filter(Boolean)
    .join(' | ');

  const durationOptions = [
    ...(allowsAutoDurationOf(selectedVideoModel?.features, videoMode) ? [{ value: '-1', label: '自动' }] : []),
    ...(videoDurationRange
      ? Array.from(
          { length: Math.max(0, Math.floor((videoDurationRange.max - videoDurationRange.min) / (videoDurationRange.step || 1)) + 1) },
          (_, index) => {
            const value = videoDurationRange.min + index * (videoDurationRange.step || 1);
            return { value: String(value), label: `${value}s` };
          },
        )
      : []),
  ];

  const videoPreferenceFields: PreferenceField[] = [
    {
      key: 'model',
      label: '模型',
      value: videoModel,
      onChange: (key) => {
        setVideoModel(key);
        const full = videoModelList.find((x) => x.model_id === key);
        if (full) setAspectRatio(pickDefaultVideoRatio(full.supported_aspect_ratios, full.default_aspect_ratio));
      },
      options: videoModelOptions.map((m) => ({ value: m.key, label: m.label })),
    },
    {
      key: 'mode',
      label: '生成模式',
      value: videoMode,
      onChange: (key) => handleVideoModeChange(key as VideoMode),
      options: videoModeOptions.map((m) => ({
        value: m.key,
        label: m.label,
        disabled: !videoEnabledModes.includes(m.key),
      })),
    },
    ...(videoRatioLocked
      ? []
      : [
          {
            key: 'ratio',
            label: '画面比例',
            value: aspectRatio,
            onChange: setAspectRatio,
            options: videoRatioOptions.map((ratio) => ({ value: ratio.id, label: videoRatioLabel(ratio.label) })),
          },
        ]),
    {
      key: 'resolution',
      label: '清晰度',
      value: resolution,
      onChange: setResolution,
      options: videoSizeItems.map((r) => ({ value: r.key, label: r.label })),
    },
    ...(videoDurationLocked != null
      ? []
      : [
          {
            key: 'duration',
            label: '时长',
            value: String(duration),
            onChange: (value: string) => setDuration(Number(value)),
            options: durationOptions,
          },
        ]),
  ];

  const videoPreferenceToggles: PreferenceToggle[] = supportsVideoAudio
    ? [{ key: 'audio', label: '声音', value: generateAudio, onChange: setGenerateAudio }]
    : [];

  const imagePreferenceSummary = [
    selectedImageModel?.model_label ?? '图片模型',
    imageRatioLabel || null,
    imageResolution || null,
  ]
    .filter(Boolean)
    .join(' | ');

  const imagePreferenceFields: PreferenceField[] = [
    {
      key: 'model',
      label: '模型',
      value: imageModel,
      onChange: (key) => {
        const full = imageModelList.find((x) => x.model_id === key);
        if (full) applyImageModel(full);
        else setImageModel(key);
      },
      options: imageModelOptions.map((m) => ({ value: m.key, label: m.label })),
    },
    {
      key: 'ratio',
      label: '画面比例',
      value: imageAspectRatio,
      onChange: setImageAspectRatio,
      options: imageRatioOptions.map((ratio) => ({ value: ratio.id, label: ratio.label })),
    },
    {
      key: 'resolution',
      label: '清晰度',
      value: imageResolution,
      onChange: (key) => {
        setImageResolution(key);
        if (selectedImageModel) setImageAspectRatio(pickRatioForSize(selectedImageModel, key, imageAspectRatio));
      },
      options: imageSizeItems.map((r) => ({ value: r.key, label: r.label })),
    },
  ];

  const selectedCreationModel = videoModelList.find((m) => m.model_id === creationModel);
  const selectedPromptModel = isImageTab
    ? selectedImageModel
    : isVideoTab
      ? selectedVideoModel
      : selectedCreationModel;
  const activePromptCap = promptMaxLengthOf(selectedPromptModel?.features?.max_prompt_length);
  const imagePromptCap = promptMaxLengthOf(selectedImageModel?.features?.max_prompt_length);
  const agentMaxImages = selectedCreationModel?.features?.image_reference_max ?? 0;
  const agentMaxVideos = videoReferenceMaxOf(selectedCreationModel?.features);
  const agentMaxAudios = audioReferenceMaxOf(selectedCreationModel?.features);
  const agentImageCount = agentFiles.filter((f) => f.kind === 'image').length;
  const agentVideoCount = agentFiles.filter((f) => f.kind === 'video').length;
  const agentAudioCount = agentFiles.filter((f) => f.kind === 'audio').length;
  const agentAllFull =
    agentImageCount >= agentMaxImages &&
    agentVideoCount >= agentMaxVideos &&
    agentAudioCount >= agentMaxAudios;
  const videoRefImageCount = refFiles.filter((r) => r.type === 'image').length;
  const videoRefVideoCount = refFiles.filter((r) => r.type === 'video').length;
  const videoMaxImages =
    frameSlotCountOf(videoMode) > 0
      ? frameSlotCountOf(videoMode)

      : (selectedVideoModel?.features?.image_reference_max ?? UNRESOLVED_IMAGE_REFERENCE_LIMIT);
  const videoMaxVideos = videoReferenceMaxOf(selectedVideoModel?.features);
  const videoImagesFull = videoRefImageCount >= videoMaxImages;
  const videoVideosFull = videoRefVideoCount >= videoMaxVideos;

  const keyframeSendHint = isKeyframe
    ? !keyframeRefs.first && !keyframeRefs.last
      ? '请补充首帧/尾帧'
      : !keyframeRefs.first
        ? '请补充首帧'
        : !keyframeRefs.last
          ? '请补充尾帧'
          : ''
    : '';

  const imageMaxImages = imageReferenceMaxOf(selectedImageModel?.features);

  const showOmniFollowHint = videoMode === 'omni'
    && !!hasAspectRatio(selectedVideoModel?.supported_aspect_ratios, 'adaptive')
    && videoRefVideoCount > 0;

  const handleVideoModeChange = (key: VideoMode) => {
    if (key === videoMode) return;
    const slots = frameSlotCountOf(key);
    if (slots > 0) {
      const videos = refFiles.filter((f) => f.type === 'video');
      if (videos.length > 0) {
        showToast('首尾帧模式仅支持图片素材，请先移除视频参考');
        return;
      }
      if (refFiles.length > slots) {
        showToast(`首尾帧模式最多 ${slots} 张图片，请先减少参考`);
        return;
      }
      const images = refFiles.filter((f): f is KeyframeRefItem => f.type === 'image');
      if (images.length > 0) {
        setKeyframeRefs({ first: images[0], ...(slots === 2 && images[1] ? { last: images[1] } : {}) });
        setRefFiles([]);
      }
    } else if (isFrameMode(videoMode)) {
      const restored = [keyframeRefs.first, keyframeRefs.last].filter(Boolean) as KeyframeRefItem[];
      if (restored.length > 0) setRefFiles((prev) => [...prev, ...restored]);
      setKeyframeRefs({});
    }
    setVideoMode(key);
    const lockedRatio = lockedRatioOf(selectedVideoModel?.features, key);
    const lockedDuration = lockedDurationOf(selectedVideoModel?.features, key);
    if (lockedRatio) {
      setAspectRatio(lockedRatio);
    } else if (aspectRatio === 'adaptive' && selectedVideoModel && !hasAspectRatio(selectedVideoModel.supported_aspect_ratios, 'adaptive')) {
      setAspectRatio(pickDefaultVideoRatio(selectedVideoModel.supported_aspect_ratios, selectedVideoModel.default_aspect_ratio));
    }
    if (lockedDuration != null) {
      setDuration(lockedDuration);
    } else if (duration < 0 && !(duration === -1 && allowsAutoDurationOf(selectedVideoModel?.features, key))) {
      const range = selectedVideoModel?.supported_durations;
      const base = typeof selectedVideoModel?.default_duration === 'number'
        ? selectedVideoModel.default_duration
        : (range?.min ?? 5);
      setDuration(range ? Math.min(Math.max(base, range.min), range.max) : base);
    }
  };

  const handleRefFiles = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    if (isKeyframe) {
      const image = files.find((f) => f.type.startsWith('image/'));
      if (image && slotTarget) {
        const item = { file: image, preview: URL.createObjectURL(image), type: 'image' as const };
        setKeyframeRefs((prev) =>
          slotTarget === 'first' ? { ...prev, first: item } : { ...prev, last: item },
        );
      }
      if (fileInputRef.current) fileInputRef.current.value = '';
      return;
    }
    let imgRoom = Math.max(0, videoMaxImages - videoRefImageCount);
    let vidRoom = Math.max(0, videoMaxVideos - videoRefVideoCount);
    const videoRefUnsupported =
      files.some((f) => f.type.startsWith('video/')) && !supportsVideoReferenceOf(selectedVideoModel?.features);
    const newFiles = files
      .filter((f) => {
        if (f.type.startsWith('video/')) {
          if (videoRefUnsupported) return false;
          if (vidRoom <= 0) return false;
          vidRoom -= 1;
          return true;
        }
        if (imgRoom <= 0) return false;
        imgRoom -= 1;
        return true;
      })
      .map((file) => ({
        file,
        preview: URL.createObjectURL(file),
        type: file.type.startsWith('video/') ? ('video' as const) : ('image' as const),
      }));
    const overflow = classifyRefOverflow({
      selectedImages: files.filter((f) => f.type.startsWith('image/')).length,
      selectedVideos: files.filter((f) => f.type.startsWith('video/')).length,
      acceptedImages: newFiles.filter((f) => f.type === 'image').length,
      acceptedVideos: newFiles.filter((f) => f.type === 'video').length,
    });
    if (videoRefUnsupported && overflow === null) showToast('当前模型不支持视频素材参考，请更换模型');
    else if (overflow === 'image') showToast(`参考图最多 ${videoMaxImages} 张，请减少图片`);
    else if (overflow === 'video') showToast(`参考视频最多 ${videoMaxVideos} 个`);
    setRefFiles((prev) => [...prev, ...newFiles]);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const removeRefFile = (index: number) => {    setRefFiles((prev) => {
      const copy = [...prev];

      if (copy[index].file) URL.revokeObjectURL(copy[index].preview);
      copy.splice(index, 1);
      return copy;
    });
  };

  const handleImageRefFiles = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    const remaining = Math.max(0, imageMaxImages - imageRefFiles.length);
    const newFiles = files.slice(0, remaining).map((file) => ({
      file,
      preview: URL.createObjectURL(file),
      name: file.name,
    }));
    if (files.length > newFiles.length) showToast(`参考图最多 ${imageMaxImages} 张，请减少图片`);
    setImageRefFiles((prev) => [...prev, ...newFiles]);
    if (imageFileInputRef.current) imageFileInputRef.current.value = '';
  };

  const removeImageRefFile = (index: number) => {
    setImageRefFiles((prev) => {
      const copy = [...prev];

      if (copy[index].file) URL.revokeObjectURL(copy[index].preview);
      copy.splice(index, 1);
      return copy;
    });
  };

  const assetPickName = (asset: AssetRecord): string => {
    try {
      const last = new URL(asset.url).pathname.split('/').filter(Boolean).pop();
      return last ? decodeURIComponent(last) : `资产-${asset.id}`;
    } catch {
      return `资产-${asset.id}`;
    }
  };

  const openAssetsPicker = (target: 'agent' | 'video' | 'image') => {
    if (!user) {
      setShowLogin(true);
      return;
    }
    setAssetsPickerTarget(target);
  };

  const toggleRefMenu = (key: 'agent' | 'video' | 'image') => {
    if (refMenu === key) {
      setRefMenu(null);
      return;
    }
    const rect = refCardRef.current?.getBoundingClientRect();
    if (!rect) return;
    setRefMenuPos({ top: rect.bottom + 8, left: rect.left });
    setRefMenu(key);
  };

  const openKeyframeSlotMenu = (slot: 'first' | 'last') => {
    const el = slot === 'first' ? firstSlotRef.current : lastSlotRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    setRefMenuPos({ top: rect.bottom + 8, left: rect.left });
    setSlotTarget(slot);
    setRefMenu('video');
  };

  const removeKeyframeSlot = (slot: 'first' | 'last') => {
    setKeyframeRefs((prev) => (slot === 'first' ? { last: prev.last } : { first: prev.first }));
  };

  const handleAssetsPickerSelect = (assets: AssetRecord[]) => {
    const target = assetsPickerTarget;
    setAssetsPickerTarget(null);
    if (!target || assets.length === 0) return;

    if (target === 'agent') {
      const existing = new Set(
        agentFiles.filter((f) => f.assetId != null).map((f) => String(f.assetId)),
      );
      let imgRoom = Math.max(0, agentMaxImages - agentImageCount);
      let vidRoom = Math.max(0, agentMaxVideos - agentVideoCount);
      let audRoom = Math.max(0, agentMaxAudios - agentAudioCount);
      const eligible = assets
        .filter((a) => a.type === 'image' || a.type === 'video' || a.type === 'audio')
        .filter((a) => !existing.has(String(a.id)));
      const items = eligible
        .filter((a) => {
          if (a.type === 'image') {
            if (imgRoom <= 0) return false;
            imgRoom -= 1;
            return true;
          }
          if (a.type === 'video') {
            if (vidRoom <= 0) return false;
            vidRoom -= 1;
            return true;
          }
          if (audRoom <= 0) return false;
          audRoom -= 1;
          return true;
        })
        .map((a) => ({
          id: `asset-${a.id}`,
          url: a.url,
          kind: (a.type === 'video' ? 'video' : a.type === 'audio' ? 'audio' : 'image') as
            | 'image' | 'video' | 'audio',
          name: assetPickName(a),
          assetId: a.id,
        }));
      if (eligible.length > items.length) {
        showToast(`附件已到上限（图片 ${agentMaxImages} 张 / 视频 ${agentMaxVideos} 个 / 音频 ${agentMaxAudios} 个）`);
      }
      if (items.length === 0) return;
      setAgentFiles((prev) => [...prev, ...items]);
      return;
    }

    if (target === 'video') {
      const unapproved = assets.filter((a) => isUnapprovedVideoMaterialStatus(a.material_status));
      const approvedAssets = assets.filter((a) => !isUnapprovedVideoMaterialStatus(a.material_status));
      if (unapproved.length > 0) {
        showToast(VIDEO_REFERENCE_NOT_APPROVED_MESSAGE);
      }
      if (approvedAssets.length === 0) return;

      if (isKeyframe) {
        const image = approvedAssets.find((a) => a.type === 'image');
        if (image && slotTarget) {
          const item = { preview: image.url, type: 'image' as const, assetId: image.id };
          setKeyframeRefs((prev) =>
            slotTarget === 'first' ? { ...prev, first: item } : { ...prev, last: item },
          );
        }
        return;
      }
      const existing = new Set(
        refFiles.filter((r) => r.assetId != null).map((r) => String(r.assetId)),
      );
      let imgRoom = Math.max(0, videoMaxImages - videoRefImageCount);
      let vidRoom = Math.max(0, videoMaxVideos - videoRefVideoCount);

      const videoRefUnsupported = !supportsVideoReferenceOf(selectedVideoModel?.features);
      const eligible = approvedAssets
        .filter((a) => a.type === 'image' || a.type === 'video')
        .filter((a) => !(videoRefUnsupported && a.type === 'video'))
        .filter((a) => !existing.has(String(a.id)));
      const items = eligible
        .filter((a) => {
          if (a.type === 'image') {
            if (imgRoom <= 0) return false;
            imgRoom -= 1;
            return true;
          }
          if (vidRoom <= 0) return false;
          vidRoom -= 1;
          return true;
        })
        .map((a) => ({
          preview: a.url,
          type: (a.type === 'video' ? 'video' : 'image') as 'image' | 'video',
          assetId: a.id,
        }));
      if (videoRefUnsupported && assets.some((a) => a.type === 'video')) {
        showToast('当前模型不支持视频素材参考，已跳过视频素材');
      } else if (eligible.length > items.length) {
        showToast(`参考素材已到上限（图片 ${videoMaxImages} 张 / 视频 ${videoMaxVideos} 个）`);
      }
      if (items.length === 0) return;
      setRefFiles((prev) => [...prev, ...items]);
      return;
    }

    const existing = new Set(
      imageRefFiles.filter((r) => r.assetId != null).map((r) => String(r.assetId)),
    );
    const remaining = Math.max(0, imageMaxImages - imageRefFiles.length);
    const eligible = assets
      .filter((a) => a.type === 'image')
      .filter((a) => !existing.has(String(a.id)));
    const items = eligible
      .slice(0, remaining)
      .map((a) => ({ preview: a.url, name: assetPickName(a), assetId: a.id }));
    if (eligible.length > items.length) {
      showToast(`参考图最多 ${imageMaxImages} 张，请减少图片`);
    }
    if (items.length === 0) return;
    setImageRefFiles((prev) => [...prev, ...items]);
  };

  return (
    <>
      <div className={styles.chatBox}>
        { }

        {isVideoTab ? (

          <>
            { }
            <div className={styles.videoContent}>
              { }
              <div className={styles.refArea}>
                {isKeyframe ? (

                  <div className={styles.refSlotRow}>
                    {keyframeRefs.first ? (
                      <div className={styles.refSlot}>
                        <div className={styles.refThumb}>
                          <img src={resolveMediaSrc(keyframeRefs.first.preview)} crossOrigin={remoteImageCrossOrigin(keyframeRefs.first.preview)} alt="" className={styles.refThumbMedia} />
                          <span className={styles.refSlotBadge}>首帧</span>
                          <button
                            className={styles.refThumbRemove}
                            onClick={() => removeKeyframeSlot('first')}
                          >
                            <X size={12} strokeWidth={2} />
                          </button>
                        </div>
                      </div>
                    ) : (
                      <button
                        ref={firstSlotRef}
                        className={styles.refSlotAdd}
                        onClick={() => openKeyframeSlotMenu('first')}
                      >
                        <Plus size={16} strokeWidth={2} />
                        <span>首帧</span>
                      </button>
                    )}
                    {keyframeRefs.last ? (
                      <div className={styles.refSlot}>
                        <div className={styles.refThumb}>
                          <img src={resolveMediaSrc(keyframeRefs.last.preview)} crossOrigin={remoteImageCrossOrigin(keyframeRefs.last.preview)} alt="" className={styles.refThumbMedia} />
                          <span className={styles.refSlotBadge}>尾帧</span>
                          <button
                            className={styles.refThumbRemove}
                            onClick={() => removeKeyframeSlot('last')}
                          >
                            <X size={12} strokeWidth={2} />
                          </button>
                        </div>
                      </div>
                    ) : (
                      <button
                        ref={lastSlotRef}
                        className={styles.refSlotAdd}
                        onClick={() => openKeyframeSlotMenu('last')}
                      >
                        <Plus size={16} strokeWidth={2} />
                        <span>尾帧</span>
                      </button>
                    )}
                  </div>
                ) : (
                  <>
                {refFiles.map((item, idx) => (
                  <div key={idx} className={styles.refThumbWrap}>
                    <div className={styles.refThumb}>
                      {item.type === 'video' ? (
                        <video src={resolveMediaSrc(item.preview)} className={styles.refThumbMedia} />
                      ) : (
                        <img src={resolveMediaSrc(item.preview)} crossOrigin={remoteImageCrossOrigin(item.preview)} alt="" className={styles.refThumbMedia} />
                      )}
                      <button
                        className={styles.refThumbRemove}
                        onClick={() => removeRefFile(idx)}
                      >
                        <X size={12} strokeWidth={2} />
                      </button>
                    </div>
                    <span className={styles.refThumbLabel}>
                      {item.type === 'video' ? `Video ${idx + 1}` : `Image ${idx + 1}`}
                    </span>
                  </div>
                ))}
                <div
                  ref={refCardRef}
                  className={styles.refCard}
                  onClick={() => {
                    if (videoImagesFull && videoVideosFull) {
                      showToast(`参考素材已到上限（图片 ${videoMaxImages} 张 / 视频 ${videoMaxVideos} 个）`);
                      return;
                    }
                    setSlotTarget(null);
                    toggleRefMenu('video');
                  }}
                >
                  <Plus size={16} strokeWidth={2} />
                  <span>参考</span>
                </div>
                  </>
                )}
              </div>
              { }
              <div className={styles.textareaWrap}>
                <textarea
                  ref={textareaRef}
                  className={styles.textarea}
                  placeholder={`通过直接控制提示词快速生成单段片段。\n上传参考：图片最多 ${videoMaxImages} 张 / 视频最多 ${videoMaxVideos} 个；首尾帧模式可上传首帧与尾帧参考。`}
                  value={inputValue}
                  onChange={(e) => handleInputChange(e.target.value)}
                  onKeyDown={handleKeyDown}
                  onCompositionStart={handleCompositionStart}
                  onCompositionEnd={handleCompositionEnd}
                  rows={2}
                  maxLength={activePromptCap ?? undefined}
                />
                <span className={styles.textareaCount}>{promptCharCountLabel(inputValue.length, activePromptCap)}</span>
              </div>
            </div>

            <input
              ref={fileInputRef}
              type="file"
              accept={isKeyframe ? 'image/*' : videoImagesFull ? 'video/*' : videoVideosFull ? 'image/*' : 'image/*,video/*'}
              multiple
              style={{ display: 'none' }}
              onChange={handleRefFiles}
            />

            { }
            {showOmniFollowHint && (
              <div className={styles.followHint}>{OMNI_REFERENCE_FOLLOW_HINT}</div>
            )}

            { }
            <div className={styles.paramBar}>
              <div className={styles.paramBarLeft}>
                <ModeMenu
                  value={activeTab}
                  items={visibleModes.map((tab) => ({ key: tab.key, label: MODE_LABEL[tab.key] }))}
                  onChange={setActiveTab}
                />
                <GenerationPreference summary={videoPreferenceSummary} fields={videoPreferenceFields} toggles={videoPreferenceToggles} />
              </div>
              <div className={styles.paramBarRight}>
                <button
                  className={`${styles.sendBtn} ${inputValue.trim() ? styles.sendBtnActive : ''}`}
                  onClick={handleSend}
                  disabled={!inputValue.trim()}
                  title={keyframeSendHint || '发送'}
                >
                  <ChevronUp size={18} strokeWidth={2.5} />
                </button>
              </div>
            </div>
          </>
        ) : isImageTab ? (

          <>
            { }
            <div className={styles.videoContent}>
              { }
              <div className={styles.refArea}>
                {imageRefFiles.map((item, idx) => (
                  <div key={idx} className={styles.refThumbWrap}>
                    <div className={styles.refThumb}>
                      <img src={resolveMediaSrc(item.preview)} crossOrigin={remoteImageCrossOrigin(item.preview)} alt="" className={styles.refThumbMedia} />
                      <button
                        className={styles.refThumbRemove}
                        onClick={() => removeImageRefFile(idx)}
                      >
                        <X size={12} strokeWidth={2} />
                      </button>
                    </div>
                    <span className={styles.refThumbLabel}>
                      图片 {idx + 1}
                    </span>
                  </div>
                ))}
                <div
                  ref={refCardRef}
                  className={styles.refCard}
                  onClick={() => {
                    if (imageRefFiles.length >= imageMaxImages) {
                      showToast(`参考图已到上限（${imageMaxImages} 张）`);
                      return;
                    }
                    toggleRefMenu('image');
                  }}
                >
                  <Plus size={16} strokeWidth={2} />
                  <span>参考</span>
                </div>
              </div>
              { }
              <div className={styles.textareaWrap}>
                <textarea
                  ref={textareaRef}
                  className={styles.textarea}
                  placeholder={`从文字与参考图生成 AI 图片。\n上传参考图片最多 ${imageMaxImages} 张；描述你想生成的图片，已上传的参考将引导风格与细节。`}
                  value={inputValue}
                  onChange={(e) => handleInputChange(e.target.value)}
                  onKeyDown={handleKeyDown}
                  onCompositionStart={handleCompositionStart}
                  onCompositionEnd={handleCompositionEnd}
                  rows={2}
                  maxLength={imagePromptCap ?? undefined}
                />
                <span className={styles.textareaCount}>{promptCharCountLabel(inputValue.length, imagePromptCap)}</span>
              </div>
            </div>

            { }
            <input
              ref={imageFileInputRef}
              type="file"
              accept="image/*"
              multiple
              style={{ display: 'none' }}
              onChange={handleImageRefFiles}
            />

            { }
            <div className={styles.paramBar}>
              <div className={styles.paramBarLeft}>
                <ModeMenu
                  value={activeTab}
                  items={visibleModes.map((tab) => ({ key: tab.key, label: MODE_LABEL[tab.key] }))}
                  onChange={setActiveTab}
                />
                <GenerationPreference summary={imagePreferenceSummary} fields={imagePreferenceFields} />
              </div>
              <div className={styles.paramBarRight}>
                <button
                  className={`${styles.sendBtn} ${inputValue.trim() ? styles.sendBtnActive : ''}`}
                  onClick={handleSend}
                  disabled={!inputValue.trim()}
                >
                  <ChevronUp size={18} strokeWidth={2.5} />
                </button>
              </div>
            </div>
          </>
        ) : (

          <>
            { }
            {armedSkill && (
              <div className={styles.armedSkill}>
                <BookText size={13} strokeWidth={2} />
                <span>技能</span>
                <button
                  type="button"
                  className={styles.armedSkillClear}
                  onClick={() => setArmedSkill(null)}
                  title="取消技能"
                >
                  <X size={12} strokeWidth={2} />
                </button>
              </div>
            )}

            { }
            <div className={styles.videoContent}>
              { }
              <div className={styles.refArea}>
                {agentFiles.map((f, idx) => (
                  <div key={f.id} className={styles.refThumbWrap}>
                    <div className={styles.refThumb}>
                      {f.kind === 'image' && (
                        <img className={styles.refThumbMedia} src={resolveMediaSrc(f.url)} crossOrigin={remoteImageCrossOrigin(f.url)} alt={f.name} />
                      )}
                      {f.kind === 'video' && (
                        <video className={styles.refThumbMedia} src={resolveMediaSrc(f.url)} muted />
                      )}
                      {f.kind === 'audio' && (
                        <div className={styles.refThumbAudio}>
                          <Music size={20} strokeWidth={2} />
                        </div>
                      )}
                      <button
                        className={styles.refThumbRemove}
                        onClick={() => removeAgentFile(f.id)}
                      >
                        <X size={12} strokeWidth={2} />
                      </button>
                    </div>
                    <span className={styles.refThumbLabel}>
                      {f.kind === 'image' ? '图片' : f.kind === 'video' ? '视频' : '音频'} {idx + 1}
                    </span>
                  </div>
                ))}
                <div
                  ref={refCardRef}
                  className={styles.refCard}
                  onClick={() => {
                    if (agentAllFull) {
                      showToast(`附件已到上限（图片 ${agentMaxImages} 张 / 视频 ${agentMaxVideos} 个 / 音频 ${agentMaxAudios} 个）`);
                      return;
                    }
                    toggleRefMenu('agent');
                  }}
                >
                  <Plus size={16} strokeWidth={2} />
                  <span>参考</span>
                </div>
              </div>

              { }
              <div className={styles.textareaWrap}>
                <textarea
                  ref={textareaRef}
                  className={styles.textarea}
                  placeholder="描述你想制作的视频，微电影、产品广告、社媒视频等都可支持。适合 1-5 分钟视频。"
                  value={inputValue}
                  onChange={(e) => handleInputChange(e.target.value)}
                  onKeyDown={handleKeyDown}
                  onCompositionStart={handleCompositionStart}
                  onCompositionEnd={handleCompositionEnd}
                  rows={2}
                  maxLength={activePromptCap ?? undefined}
                />
                <span className={styles.textareaCount}>{promptCharCountLabel(inputValue.length, activePromptCap)}</span>
              </div>
            </div>

            { }
            <input
              ref={agentFileInputRef}
              type="file"
              accept="image/*,video/*,audio/*"
              multiple
              style={{ display: 'none' }}
              onChange={handleAgentFilePick}
            />

            { }
            <div className={styles.paramBar}>
              { }
              <div className={styles.paramBarLeft}>
                <ModeMenu
                  value={activeTab}
                  items={visibleModes.map((tab) => ({ key: tab.key, label: MODE_LABEL[tab.key] }))}
                  onChange={setActiveTab}
                />
                { }
                <button
                  className={styles.skillBtn}
                  onClick={() => {
                    if (!user) {
                      pendingAction.current = { kind: 'open-skill' };
                      setShowLogin(true);
                      return;
                    }
                    setShowSkillModal(true);
                  }}
                >
                  <BookOpen size={16} strokeWidth={2} />
                  <span>Skill</span>
                </button>

                { }
                <Select
                  value={creationModel}
                  onChange={setCreationModel}
                  size="sm"
                  side="top"
                  ariaLabel="选择生成模型"
                  triggerClassName={styles.modelBtn}
                  options={creationModelOptions.map((m) => ({ value: m.key, label: m.label }))}
                />
              </div>

              { }
              <div className={styles.paramBarRight}>
                { }
                <button
                  className={`${styles.sendBtn} ${inputValue.trim() ? styles.sendBtnActive : ''}`}
                  onClick={handleSend}
                  disabled={!inputValue.trim()}
                >
                  <ChevronUp size={18} strokeWidth={2.5} />
                </button>
              </div>
            </div>
          </>
        )}
      </div>

      { }
      <SkillModal
        open={showSkillModal}
        onClose={() => setShowSkillModal(false)}
        onUseSkill={(s) => handleUseSkill(s)}
      />

      { }
      {showLogin && <LoginModal onClose={handleLoginClose} onSuccess={handleLoginClose} />}
      {refMenu && refMenuPos && createPortal(
        <div ref={refMenuRef} className={styles.refMenu} style={refMenuPos}>
          <button
            className={styles.dropdownItem}
            onClick={() => {
              const input = refMenu === 'agent'
                ? agentFileInputRef
                : refMenu === 'video'
                  ? fileInputRef
                  : imageFileInputRef;
              setRefMenu(null);
              input.current?.click();
            }}
          >
            <Upload size={14} strokeWidth={2} />
            <span>{refMenu === 'video' ? '从本地上传' : '本地上传'}</span>
          </button>
          <button
            className={styles.dropdownItem}
            onClick={() => {
              const target = refMenu;
              setRefMenu(null);
              if (target) openAssetsPicker(target);
            }}
          >
            <FolderOpen size={14} strokeWidth={2} />
            <span>从资产中选择</span>
          </button>
        </div>,
        document.body,
      )}

      { }
      {assetsPickerTarget && (
        <AssetsPickerModal
          onClose={() => setAssetsPickerTarget(null)}
          onSelect={handleAssetsPickerSelect}
          mediaTypes={
            assetsPickerTarget === 'image'
              ? ['image']
              : assetsPickerTarget === 'agent'
                ? ['image', 'video', 'audio']
                : isFrameMode(videoMode) || videoMode === 'image_reference'
                  ? ['image']
                  : [...PANEL_REF_MEDIA_TYPES.videoAll.types]
          }
          confirmText="确定"
          showLivenessTab={assetsPickerTarget === 'video'}
          showCharacterTab={assetsPickerTarget === 'video'}
          rejectUnapprovedForVideo={assetsPickerTarget === 'video'}
        />
      )}
    </>
  );
}
