/* ============================================
 * ChatBox 首页对话输入框：模型/技能/附件配置与发送
 * ============================================ */
import { useState, useRef, useEffect, useCallback, useLayoutEffect, useSyncExternalStore } from 'react';
import { useNavigate } from 'react-router-dom';
import { createPortal } from 'react-dom';
import { Plus, ChevronUp, ChevronDown, Music, BookOpen, BookText, X, Upload, FolderOpen } from 'lucide-react';
import SkillModal from '../SkillModal';
import LoginModal from '@/components/LoginModal';
import RatioIcon from '@/components/RatioIcon';
import AssetsPickerModal from '@/pages/CanvasPage/components/AssetsPickerModal';
import { PANEL_REF_MEDIA_TYPES } from '@/pages/CanvasPage/refSourceTypes';
import { type AssetRecord } from '@/api/assets';
import { getCurrentUser, subscribe } from '@/utils/auth';
import styles from './index.module.css';
import { fetchGenerationModels, type GenerationModel } from '@/api/generation';
import { pickRatioForSize, ratiosForSelectedSize } from '@/lib/image-size-ratios';
import { type SkillRecord } from '@/api/skills';
import { createProject } from '@/api/projects';
import { setGenHandoff } from '@/utils/gen-handoff';
import { setAgentHandoff } from '@/utils/agent-handoff';
import { classifyRefOverflow } from '@/utils/ref-overflow';
import { videoReferenceMaxOf, audioReferenceMaxOf, imageReferenceMaxOf, supportsVideoReferenceOf, UNRESOLVED_IMAGE_REFERENCE_LIMIT } from '@/lib/model-reference-limits';
import { promptCharCountLabel, promptMaxLengthOf } from '@/lib/prompt-max-length';
import { VIDEO_REFERENCE_NOT_APPROVED_MESSAGE, isUnapprovedVideoMaterialStatus } from '@/lib/video-reference-compliance';
import DurationSlider from './DurationSlider';
import { resolveHomeLoginResume, type HomePendingAction } from './homeLoginResume';
import { limitPromptInput } from './promptInput';

/** 选项卡定义 */
const tabItems = [
  { key: 'agent', label: '视频智能体' },
  { key: 'video', label: 'AI 视频' },
  { key: 'image', label: 'AI 图片' },
];

/** AI视频 - 模式选项（纯 UI 交互概念，非后端参数） */
const videoModes = [
  { key: 'omni', label: '全能参考' },
  { key: 'firstlast', label: '首尾帧' },
  { key: 'text2video', label: '图生视频' },
];

/** AI视频首尾帧槽位素材项（仅图片；普通参考与槽位互转时复用） */
type KeyframeRefItem = { file?: File; preview: string; type: 'image'; assetId?: string | number };

/** 生成时间戳项目名（与画布新建项目命名一致） */
function makeProjectName(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** 创建新项目并跳转画布（失败时降级为直接跳转） */
async function navigateToNewProject(navigate: ReturnType<typeof useNavigate>, state: unknown) {
  try {
    const created = await createProject(makeProjectName());
    navigate(`/canvas?project=${created.id}`, { state });
  } catch {
    navigate('/canvas', { state });
  }
}

export default function ChatBox({ draft }: { draft?: { text: string; ts: number; mediaType: 'video' | 'image' } | null }) {
  const [activeTab, setActiveTab] = useState('agent');
  const [inputValue, setInputValue] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const navigate = useNavigate();
  const user = useSyncExternalStore(subscribe, getCurrentUser);
  /** 未登录点击发送时弹登录框 */
  const [showLogin, setShowLogin] = useState(false);
  /** 从资产中选择弹窗打开来源（agent/video/image，null 关闭）：决定 mediaTypes 过滤与确认后的注入目标 */
  const [assetsPickerTarget, setAssetsPickerTarget] = useState<'agent' | 'video' | 'image' | null>(null);
  /** 参考卡上传菜单开关（本地上传 / 从资产中选择） */
  const [refMenu, setRefMenu] = useState<'agent' | 'video' | 'image' | null>(null);
  /** 菜单 fixed 定位（portal 到 body，避免被 refArea 滚动容器裁切） */
  const [refMenuPos, setRefMenuPos] = useState<{ top: number; left: number } | null>(null);
  const refMenuRef = useRef<HTMLDivElement>(null);
  /** 当前 tab 的参考/附件卡（定位锚点；三个 tab 同时只渲染一个） */
  const refCardRef = useRef<HTMLDivElement>(null);
  /** 登录成功后续接的原动作（Skill / 发送最后一次点击为准） */
  const pendingAction = useRef<HomePendingAction | null>(null);
  /** IKA64P：「直接使用」武装的技能气泡（发送时随消息作为强制技能生效） */
  const [armedSkill, setArmedSkill] = useState<{ id: string; name: string } | null>(null);

  /** 画廊卡片点击：只填输入框并切 tab，不拦登录；真正发送时再校验。
   *  用 ts 驱动重复点击同一张卡也能注入，不把 text/mediaType 放进依赖。 */
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
  /** 智能体 tab 附件（+ 上传 图片/视频/音频、从资产中选择 图片/视频）——
   *  本地上传保留原始 File，资产选择项带 assetId（发送时经 handoff 免重复上传） */
  const [agentFiles, setAgentFiles] = useState<
    { id: string; url: string; kind: 'image' | 'video' | 'audio'; name: string; file?: File; assetId?: string | number }[]
  >([]);
  const agentFileInputRef = useRef<HTMLInputElement>(null);
  const [showSkillModal, setShowSkillModal] = useState(false);
  /** 创作/推理模型初始值为空：接口加载完成后由 effect 选中第一个，不写死任何模型 id */
  const [creationModel, setCreationModel] = useState('');
  const [reasoningModel, setReasoningModel] = useState('');
  const [showCreationDropdown, setShowCreationDropdown] = useState(false);
  const [showReasoningDropdown, setShowReasoningDropdown] = useState(false);
  const [underlineStyle, setUnderlineStyle] = useState<React.CSSProperties>({});

  // AI视频专属状态（模型/比例/清晰度/时长初始均为空，接口加载完成后由校准 effect 套用模型默认值）
  const [videoModel, setVideoModel] = useState('');
  const [videoMode, setVideoMode] = useState('omni');
  const [aspectRatio, setAspectRatio] = useState('');
  const [resolution, setResolution] = useState('');
  const [duration, setDuration] = useState(0);
  /** IKG0LP：是否带音频（用户选择，缺省 true = 与上游默认及改动前行为一致） */
  const [generateAudio, setGenerateAudio] = useState(true);
  const [showVideoModelDrop, setShowVideoModelDrop] = useState(false);
  const [showVideoModeDrop, setShowVideoModeDrop] = useState(false);
  const [showRatioDrop, setShowRatioDrop] = useState(false);
  const [showResDrop, setShowResDrop] = useState(false);
  const [showDurationDrop, setShowDurationDrop] = useState(false);
  /** AI视频 参考素材：本地上传带 File，资产选择项带 assetId（type 字段区分图片/视频） */
  const [refFiles, setRefFiles] = useState<
    { file?: File; preview: string; type: 'image' | 'video'; assetId?: string | number }[]
  >([]);
  /** 当前是否首尾帧模式（对齐画布：首尾帧为两个独立槽位，各一张图片） */
  const isKeyframe = videoMode === 'firstlast';
  /** 首尾帧模式专用：首帧/尾帧各一张图片。提交按 first→last 拼进 refs，保证顺序兼容画布映射 */
  const [keyframeRefs, setKeyframeRefs] = useState<{
    first?: { file?: File; preview: string; type: 'image'; assetId?: string | number };
    last?: { file?: File; preview: string; type: 'image'; assetId?: string | number };
  }>({});
  /** 首尾帧槽位当前的添加目标（从资产中选择分流） */
  const [slotTarget, setSlotTarget] = useState<'first' | 'last' | null>(null);
  /** 校验类轻提示（顶部弹出，自动消失） */
  const [toast, setToast] = useState('');
  const toastTimer = useRef<number | null>(null);
  const showToast = useCallback((msg: string) => {
    setToast(msg);
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(''), 2600);
  }, []);
  useEffect(
    () => () => {
      if (toastTimer.current) window.clearTimeout(toastTimer.current);
    },
    [],
  );

  // AI图片专属状态（初始为空，接口加载完成后 applyImageModel 套用默认值）
  const [imageModel, setImageModel] = useState('');
  const [imageAspectRatio, setImageAspectRatio] = useState('');
  const [imageResolution, setImageResolution] = useState('');
  const [showImgModelDrop, setShowImgModelDrop] = useState(false);
  const [showImgRatioDrop, setShowImgRatioDrop] = useState(false);
  const [showImgResDrop, setShowImgResDrop] = useState(false);
  /** AI图片 参考图：本地上传带 File，资产选择项带 assetId（preview 为永久 URL，免 revoke） */
  const [imageRefFiles, setImageRefFiles] = useState<
    { file?: File; preview: string; name?: string; assetId?: string | number }[]
  >([]);

  const creationRef = useRef<HTMLDivElement>(null);
  const reasoningRef = useRef<HTMLDivElement>(null);
  const tabBarRef = useRef<HTMLDivElement>(null);
  const tabRefs = useRef<Map<string, HTMLButtonElement>>(new Map());
  const videoModelRef = useRef<HTMLDivElement>(null);
  const videoModeRef = useRef<HTMLDivElement>(null);
  const ratioRef = useRef<HTMLDivElement>(null);
  const resRef = useRef<HTMLDivElement>(null);
  const durationRef = useRef<HTMLDivElement>(null);
  const imgModelRef = useRef<HTMLDivElement>(null);
  const imgRatioRef = useRef<HTMLDivElement>(null);
  const imgResRef = useRef<HTMLDivElement>(null);
  const imageFileInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const firstSlotRef = useRef<HTMLButtonElement>(null);
  const lastSlotRef = useRef<HTMLButtonElement>(null);

  // 模型能力列表（首页并发调用 text/video/image；失败保留本地兜底选项）
  const [textModels, setTextModels] = useState<GenerationModel[]>([]);
  const [videoModelList, setVideoModelList] = useState<GenerationModel[]>([]);
  const [imageModelList, setImageModelList] = useState<GenerationModel[]>([]);

  /** 选中 AI图片 模型并套用其默认比例/清晰度 */
  const applyImageModel = (model: GenerationModel) => {
    setImageModel(model.model_id);
    const nextSize =
      model.default_size && model.supported_sizes.some((s) => s.id === model.default_size)
        ? model.default_size
        : (model.supported_sizes[0]?.id ?? '');
    if (model.supported_sizes.length) setImageResolution(nextSize);
    setImageAspectRatio(pickRatioForSize(model, nextSize, model.default_aspect_ratio));
  };

  // 首尾帧模式校验：至少上传一张图片（首帧或尾帧）即可，不再强制成对
  useEffect(() => {
    if (!isKeyframe) return;
    const ok = keyframeRefs.first || keyframeRefs.last;
    if (!ok) showToast('首尾帧模式需至少上传一张图片（首帧或尾帧）');
  }, [isKeyframe, keyframeRefs, showToast]);

  // 视频模型列表加载 / 切换模型后：当前参数若不在新模型能力内，套用该模型默认值（接口为唯一数据源）
  useEffect(() => {
    const m = videoModelList.find((x) => x.model_id === videoModel);
    if (!m) return;
    // IKFQ5S：首尾帧仅在**支持 adaptive 的模型**（2.5）内置该档；2.0 上游不接受 adaptive
    // （实测 400 unsupported ratio），走其固定比例档。
    if (isKeyframe && m.supported_aspect_ratios.includes('adaptive')) {
      setAspectRatio('adaptive');
    } else if (m.supported_aspect_ratios.length && !m.supported_aspect_ratios.includes(aspectRatio)) {
      setAspectRatio(
        m.default_aspect_ratio && m.supported_aspect_ratios.includes(m.default_aspect_ratio)
          ? m.default_aspect_ratio
          : m.supported_aspect_ratios[0],
      );
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
        if (prev >= d.min && prev <= d.max) return prev;
        if (typeof m.default_duration === 'number' && m.default_duration >= d.min && m.default_duration <= d.max) {
          return m.default_duration;
        }
        return Math.min(Math.max(prev, d.min), d.max);
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [videoModelList, videoModel, isKeyframe]);

  // 并发加载三种能力的模型列表
  useEffect(() => {
    fetchGenerationModels('text')
      .then((list) => {
        setTextModels(list);
        if (list.length) {
          setReasoningModel((prev) => (list.some((m) => m.model_id === prev) ? prev : list[0].model_id));
        }
      })
      .catch(() => undefined);
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

  // 更新下划线位置
  const updateUnderline = useCallback(() => {
    const activeEl = tabRefs.current.get(activeTab);
    const barEl = tabBarRef.current;
    if (activeEl && barEl) {
      const barRect = barEl.getBoundingClientRect();
      const tabRect = activeEl.getBoundingClientRect();
      setUnderlineStyle({
        left: tabRect.left - barRect.left,
        width: tabRect.width,
      });
    }
  }, [activeTab]);

  useEffect(() => {
    updateUnderline();
  }, [updateUnderline]);

  // 点击外部关闭弹出层
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (creationRef.current && !creationRef.current.contains(e.target as Node)) {
        setShowCreationDropdown(false);
      }
      if (reasoningRef.current && !reasoningRef.current.contains(e.target as Node)) {
        setShowReasoningDropdown(false);
      }
      if (videoModelRef.current && !videoModelRef.current.contains(e.target as Node)) {
        setShowVideoModelDrop(false);
      }
      if (videoModeRef.current && !videoModeRef.current.contains(e.target as Node)) {
        setShowVideoModeDrop(false);
      }
      if (ratioRef.current && !ratioRef.current.contains(e.target as Node)) {
        setShowRatioDrop(false);
      }
      if (resRef.current && !resRef.current.contains(e.target as Node)) {
        setShowResDrop(false);
      }
      if (durationRef.current && !durationRef.current.contains(e.target as Node)) {
        setShowDurationDrop(false);
      }
      if (imgModelRef.current && !imgModelRef.current.contains(e.target as Node)) {
        setShowImgModelDrop(false);
      }
      if (imgRatioRef.current && !imgRatioRef.current.contains(e.target as Node)) {
        setShowImgRatioDrop(false);
      }
      if (imgResRef.current && !imgResRef.current.contains(e.target as Node)) {
        setShowImgResDrop(false);
      }
      // 上传菜单：点击菜单与参考卡以外区域时关闭（参考卡由自身 click 切换开合）
      if (
        refMenuRef.current && !refMenuRef.current.contains(e.target as Node) &&
        (!refCardRef.current || !refCardRef.current.contains(e.target as Node))
      ) {
        setRefMenu(null);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  /** 跳转画布页并携带草稿（经 location.state 注入 Agent 弹框）与武装技能；
   *  附件经模块变量 handoff 带入（File 无法序列化进 navigate state） */
  const goCanvasWithText = (text: string, skillId?: string, skillName?: string) => {
    setInputValue('');
    if (skillId) setArmedSkill(null); // 携带后清除气泡
    // 附件交接：仅 image/video（画布 Agent 弹框同规则），音频 toast 提示后丢弃
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
    navigateToNewProject(navigate, { agentText: text, skillId: skillId ?? '', skillName: skillName ?? '' });
  };

  /** 按当前 tab 分发：智能体→Agent 对话；AI视频/AI图片→画布直接生成节点并唤起对应对话框 */
  const dispatchByTab = (text: string) => {
    if (activeTab === 'video') {
      if (!selectedVideoModel) {
        showToast('视频模型能力加载中，请稍后重试');
        return;
      }
      // 后端视频任务 resolution 期望 api_value（如 720p），此处由所选档位 id 换算
      const sizeEntry = selectedVideoModel.supported_sizes.find((s) => s.id === resolution);
      setGenHandoff({
        kind: 'video',
        text,
        modelId: videoModel,
        aspectRatio,
        resolution: sizeEntry?.api_value ?? sizeEntry?.id ?? resolution,
        duration,
        // 首页模式键映射画布模式：首尾帧→keyframe；其余保留原键（omni→all、text2video→text2video）
        mode: videoMode === 'firstlast' ? 'keyframe' : (videoMode === 'text2video' ? 'text2video' : 'all'),
        // IKG0LP：音频选择必须进交接结构，否则跳到画布就丢了
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
      navigateToNewProject(navigate, { genKind: 'image' });
      return;
    }
    goCanvasWithText(text, armedSkill?.id, armedSkill?.name);
  };

  /** IKA64P：「直接使用」= 关闭弹窗并武装技能气泡（不再填全文；发送时随消息作为强制技能生效） */
  const handleUseSkill = (skill: SkillRecord) => {
    setShowSkillModal(false);
    // 登录成功回调与当前渲染可能同拍，必须读 store 而不是闭包里的 user
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
    // 首尾帧模式：发送时必须首帧与尾帧齐全
    if (keyframeSendHint) {
      showToast(keyframeSendHint);
      return;
    }
    // 首页不发送：先校验登录，未登录弹登录框
    if (!user) {
      pendingAction.current = { kind: 'send', text };
      setShowLogin(true);
      return;
    }
    dispatchByTab(text);
  };

  /** 关闭登录框：登录成功则续接最后一次动作；放弃则清理（发送稿回填输入框）。 */
  const handleLoginClose = () => {
    setShowLogin(false);
    const pending = pendingAction.current;
    pendingAction.current = null;
    const resume = resolveHomeLoginResume(pending, !!getCurrentUser());
    switch (resume.action) {
      case 'open-skill':
        setShowSkillModal(true);
        return;
      case 'use-skill':
        handleUseSkill(resume.skill);
        return;
      case 'send':
        dispatchByTab(resume.text);
        return;
      case 'restore-text':
        setInputValue(resume.text);
        return;
      default:
        return;
    }
  };

  /** + 上传：点击直接选取图片/视频/音频（分类型上限：图片随创作模型能力、视频/音频固定 3），超限按类型 toast */
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

  /** 移除附件并释放 objectURL（资产选择项为永久 URL，不释放） */
  const removeAgentFile = (id: string) => {
    setAgentFiles((prev) => {
      const target = prev.find((f) => f.id === id);
      if (target?.file) URL.revokeObjectURL(target.url);
      return prev.filter((f) => f.id !== id);
    });
  };

  /** IME 输入组合状态跟踪（中文输入法回车确认不应触发发送） */
  const composingRef = useRef(false);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    // IME 组合输入中：回车仅确认候选词，不触发发送
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

  /** 三个 textarea 共用的 composition 事件处理 */
  const handleCompositionStart = () => { composingRef.current = true; };
  const handleCompositionEnd = () => { composingRef.current = false; };

  // 模型下拉选项：全部取自接口（fetchGenerationModels），无本地写死兜底
  const agentModelOptions = textModels.map((m) => ({ key: m.model_id, label: m.model_label }));
  const videoModelOptions = videoModelList.map((m) => ({ key: m.model_id, label: m.model_label }));
  const imageModelOptions = imageModelList.map((m) => ({ key: m.model_id, label: m.model_label }));
  // 智能体 tab 创作模型下拉：与 AI视频 模型同源（video capability）
  const creationModelOptions = videoModelOptions;

  const currentCreationModel =
    creationModelOptions.find((m) => m.key === creationModel)?.label ?? '';
  const currentReasoningModel =
    agentModelOptions.find((m) => m.key === reasoningModel)?.label ?? '';

  const currentVideoModel =
    videoModelOptions.find((m) => m.key === videoModel)?.label ?? '';
  const currentVideoMode =
    videoModes.find((m) => m.key === videoMode)?.label ?? '';

  const isVideoTab = activeTab === 'video';
  const isImageTab = activeTab === 'image';

  const currentImageModel =
    imageModelOptions.find((m) => m.key === imageModel)?.label ?? '';

  // AI图片 比例/清晰度选项：取自所选模型能力（接口为唯一数据源）
  const selectedImageModel = imageModelList.find((m) => m.model_id === imageModel);
  const imageRatioKeys = selectedImageModel
    ? ratiosForSelectedSize(selectedImageModel, imageResolution)
    : [];
  const imageSizeItems =
    selectedImageModel?.supported_sizes.map((s) => ({ key: s.id, label: s.label })) ?? [];
  const currentImageResolution =
    imageSizeItems.find((s) => s.key === imageResolution)?.label ?? imageResolution;

  // AI视频 比例/清晰度/时长范围：取自所选模型能力（接口为唯一数据源）
  const selectedVideoModel = videoModelList.find((m) => m.model_id === videoModel);
  const videoRatioKeys = selectedVideoModel?.supported_aspect_ratios ?? [];
  const videoSizeItems =
    selectedVideoModel?.supported_sizes.map((s) => ({ key: s.id, label: s.label })) ?? [];
  const videoDurationRange = selectedVideoModel?.supported_durations ?? null;
  /** IKG0LP：该模型是否允许生成带音频（能力位 features.audio）。不允许则不提供用户选择。 */
  const supportsVideoAudio = selectedVideoModel?.features?.audio === true;

  // 上传上限（与画布弹窗同规则）：图片/视频/音频均读能力行（ADR-0086），能力未加载完时图片为 0、视频/音频回落缺省
  /** 智能体 tab 附件分类型上限：随所选创作模型（video capability）读能力行
   *  （image_reference_max / video_reference_max / audio_reference_max） */
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
    videoMode === 'firstlast'
      ? 2
      // 能力未加载时用不阻断的宽松兜底（IKHBO 口径），而非能力缺省 1。
      : (selectedVideoModel?.features?.image_reference_max ?? UNRESOLVED_IMAGE_REFERENCE_LIMIT);
  const videoMaxVideos = videoReferenceMaxOf(selectedVideoModel?.features);
  const videoImagesFull = videoRefImageCount >= videoMaxImages;
  const videoVideosFull = videoRefVideoCount >= videoMaxVideos;
  /** 首尾帧模式发送校验：添加阶段允许先只传一个（首帧/尾帧），但发送时必须首帧与尾帧齐全。
   *  keyframeSendHint 非空表示不完整，用于发送按钮 title 与点击时的 toast 提示缺项。 */
  const keyframeSendHint = isKeyframe
    ? !keyframeRefs.first && !keyframeRefs.last
      ? '请补充首帧/尾帧'
      : !keyframeRefs.first
        ? '请补充首帧'
        : !keyframeRefs.last
          ? '请补充尾帧'
          : ''
    : '';
  /** AI 图片参考图上限（ADR-0086：读能力行 image_reference_max；缺省 10，与后端图片/视频口径一致，
   *  不再 min 到旧写死 9）。 */
  const imageMaxImages = imageReferenceMaxOf(selectedImageModel?.features);

  // 处理参考文件上传（按类型剩余名额截断：图片走接口上限，视频最多 3）
  /** 切换 AI视频模式（ADR-0086 对齐画布）：切首尾帧把普通参考里的图片转为首帧/尾帧槽，
   *  切回全能参考/图生视频把首尾帧槽转回普通参考——素材智能转换，不让用户手动搬。
   *  首尾帧只收图片：普通参考含视频时拒绝切换（明确提示，不静默丢弃）。 */
  const handleVideoModeChange = (key: string) => {
    setShowVideoModeDrop(false);
    if (key === videoMode) return;
    if (key === 'firstlast') {
      const videos = refFiles.filter((f) => f.type === 'video');
      if (videos.length > 0) {
        showToast('首尾帧模式仅支持图片素材，请先移除视频参考');
        return;
      }
      if (refFiles.length > 2) {
        showToast('首尾帧模式最多 2 张图片（首帧 + 尾帧），请先减少参考');
        return;
      }
      const images = refFiles.filter((f): f is KeyframeRefItem => f.type === 'image');
      if (images.length > 0) {
        setKeyframeRefs({ first: images[0], last: images[1] });
        setRefFiles([]);
      }
      // IKFQ5S：仅支持 adaptive 的模型才内置该档；2.0 保持用户可选固定比例。
      const km = videoModelList.find((x) => x.model_id === videoModel);
      if (km?.supported_aspect_ratios.includes('adaptive')) setAspectRatio('adaptive');
    } else if (videoMode === 'firstlast') {
      // 切离首尾帧：首帧/尾帧转回普通参考（图片），清空槽位
      const restored = [keyframeRefs.first, keyframeRefs.last].filter(Boolean) as KeyframeRefItem[];
      if (restored.length > 0) setRefFiles((prev) => [...prev, ...restored]);
      setKeyframeRefs({});
      // 离开首尾帧：adaptive 内置值若新模型比例列表不含，回落模型默认/首个比例。
      const m = videoModelList.find((x) => x.model_id === videoModel);
      if (aspectRatio === 'adaptive' && m && !m.supported_aspect_ratios.includes('adaptive')) {
        setAspectRatio(
          m.default_aspect_ratio && m.supported_aspect_ratios.includes(m.default_aspect_ratio)
            ? m.default_aspect_ratio
            : (m.supported_aspect_ratios[0] ?? ''),
        );
      }
    }
    setVideoMode(key);
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
      // 资产选择项的 preview 是永久 URL，仅释放本地上传的 objectURL
      if (copy[index].file) URL.revokeObjectURL(copy[index].preview);
      copy.splice(index, 1);
      return copy;
    });
  };

  // 处理AI图片参考文件上传（按接口上限截断，超限 toast）
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
      // 资产选择项的 preview 是永久 URL，仅释放本地上传的 objectURL
      if (copy[index].file) URL.revokeObjectURL(copy[index].preview);
      copy.splice(index, 1);
      return copy;
    });
  };

  /* ---- 从资产中选择（IKC3RY 模块D：三个 tab 的参考/附件卡 → 资产库选择弹窗） ---- */

  /** 资产 URL 兜底展示名（AssetRecord 无 name 字段） */
  const assetPickName = (asset: AssetRecord): string => {
    try {
      const last = new URL(asset.url).pathname.split('/').filter(Boolean).pop();
      return last ? decodeURIComponent(last) : `资产-${asset.id}`;
    } catch {
      return `资产-${asset.id}`;
    }
  };

  /** 打开资产选择弹窗（未登录先弹登录框，与 Skill 按钮等入口一致） */
  const openAssetsPicker = (target: 'agent' | 'video' | 'image') => {
    if (!user) {
      setShowLogin(true);
      return;
    }
    setAssetsPickerTarget(target);
  };

  /** 参考/附件卡点击：切换上传菜单（按卡片位置 fixed 定位） */
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

  /** 首尾帧槽位添加：打开来源菜单（本地上传 / 从资产中选择） */
  const openKeyframeSlotMenu = (slot: 'first' | 'last') => {
    const el = slot === 'first' ? firstSlotRef.current : lastSlotRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    setRefMenuPos({ top: rect.bottom + 8, left: rect.left });
    setSlotTarget(slot);
    setRefMenu('video');
  };

  /** 首尾帧槽位移除：只清对应槽 */
  const removeKeyframeSlot = (slot: 'first' | 'last') => {
    setKeyframeRefs((prev) => (slot === 'first' ? { last: prev.last } : { first: prev.first }));
  };

  /** 资产选择确认：按来源注入对应 tab 的参考/附件列表
   *  （assetId 直接复用免重复上传；上限与去重规则和本地上传入口一致） */
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
      // 首尾帧模式：仅取一张图片写入目标槽
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
      // ADR-0086：模型不接受视频素材参考时跳过视频（与本地上传路径同口径，不静默加入）
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

    // AI 图片 tab：仅图片，受接口/约定上限约束，重复资产去重
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
        {/* 顶部选项卡 */}
        <div className={styles.tabBar} ref={tabBarRef}>
          {tabItems.map((tab) => (
            <button
              key={tab.key}
              ref={(el) => {
                if (el) tabRefs.current.set(tab.key, el);
              }}
              className={`${styles.tabItem} ${activeTab === tab.key ? styles.tabItemActive : ''}`}
              onClick={() => setActiveTab(tab.key)}
            >
              {tab.label}
            </button>
          ))}
          <span className={styles.tabUnderline} style={underlineStyle} />
        </div>

        {isVideoTab ? (
          /* ========== AI 视频 专属布局 ========== */
          <>
            {/* 内容区域 */}
            <div className={styles.videoContent}>
              {/* 参考文件预览 + 上传（顶部行） */}
              <div className={styles.refArea}>
                {isKeyframe ? (
                  /* 首尾帧模式：首帧 + 尾帧两个独立槽位同一行（对齐画布） */
                  <div className={styles.refSlotRow}>
                    {keyframeRefs.first ? (
                      <div className={styles.refSlot}>
                        <div className={styles.refThumb}>
                          <img src={keyframeRefs.first.preview} alt="" className={styles.refThumbMedia} />
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
                          <img src={keyframeRefs.last.preview} alt="" className={styles.refThumbMedia} />
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
                        <video src={item.preview} className={styles.refThumbMedia} />
                      ) : (
                        <img src={item.preview} alt="" className={styles.refThumbMedia} />
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
              {/* 提示词输入框：与智能体 tab 共享草稿状态，画廊卡片按当前选中 tab 带入；说明文字仅作空态 placeholder */}
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

            {/* 参数按钮行 */}
            <div className={styles.videoParamBar}>
              <div className={styles.videoParamsLeft}>
                {/* 模型下拉 */}
                <div className={styles.dropdownWrap} ref={videoModelRef}>
                  <button
                    className={styles.paramBtn}
                    onClick={() => setShowVideoModelDrop(!showVideoModelDrop)}
                  >
                    <span>{currentVideoModel}</span>
                    <ChevronDown size={12} strokeWidth={2} />
                  </button>
                  {showVideoModelDrop && (
                    <div className={styles.dropdownMenuDown}>
                      {videoModelOptions.map((m) => (
                        <button
                          key={m.key}
                          className={`${styles.dropdownItem} ${videoModel === m.key ? styles.dropdownItemActive : ''}`}
                          onClick={() => { setVideoModel(m.key); setShowVideoModelDrop(false); }}
                        >
                          {m.label}
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                {/* 模式下拉 */}
                <div className={styles.dropdownWrap} ref={videoModeRef}>
                  <button
                    className={styles.paramBtn}
                    onClick={() => setShowVideoModeDrop(!showVideoModeDrop)}
                  >
                    <span>{currentVideoMode}</span>
                    <ChevronDown size={12} strokeWidth={2} />
                  </button>
                  {showVideoModeDrop && (
                    <div className={styles.dropdownMenuDown}>
                      {videoModes.map((m) => (
                        <button
                          key={m.key}
                          className={`${styles.dropdownItem} ${videoMode === m.key ? styles.dropdownItemActive : ''}`}
                          onClick={() => handleVideoModeChange(m.key)}
                        >
                          {m.label}
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                {/* 宽高比下拉（ADR-0086：首尾帧任务官方强制 adaptive、比例内置不暴露，整块不渲染） */}
                {!(isKeyframe && !!selectedVideoModel?.supported_aspect_ratios?.includes('adaptive')) && (
                  <div className={styles.dropdownWrap} ref={ratioRef}>
                    <button
                      className={styles.paramBtn}
                      onClick={() => setShowRatioDrop(!showRatioDrop)}
                    >
                      <RatioIcon ratio={aspectRatio} size={22} />
                      <span>{aspectRatio}</span>
                      <ChevronDown size={12} strokeWidth={2} />
                    </button>
                    {showRatioDrop && (
                      <div className={styles.dropdownMenuDown}>
                        {videoRatioKeys.map((key) => (
                          <button
                            key={key}
                            className={`${styles.dropdownItem} ${aspectRatio === key ? styles.dropdownItemActive : ''}`}
                            onClick={() => { setAspectRatio(key); setShowRatioDrop(false); }}
                          >
                            <RatioIcon ratio={key} size={22} />
                            <span>{key}</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {/* 分辨率下拉 */}
                <div className={styles.dropdownWrap} ref={resRef}>
                  <button
                    className={styles.paramBtn}
                    onClick={() => setShowResDrop(!showResDrop)}
                  >
                    <span>{resolution}</span>
                    <ChevronDown size={12} strokeWidth={2} />
                  </button>
                  {showResDrop && (
                    <div className={styles.dropdownMenuDown}>
                      {videoSizeItems.map((r) => (
                        <button
                          key={r.key}
                          className={`${styles.dropdownItem} ${resolution === r.key ? styles.dropdownItemActive : ''}`}
                          onClick={() => { setResolution(r.key); setShowResDrop(false); }}
                        >
                          {r.label}
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                {/* 时长下拉 */}
                <div className={styles.dropdownWrap} ref={durationRef}>
                  <button
                    className={styles.paramBtn}
                    onClick={() => setShowDurationDrop(!showDurationDrop)}
                  >
                    <span>⏱ {duration}s</span>
                    <ChevronDown size={12} strokeWidth={2} />
                  </button>
                  {showDurationDrop && videoDurationRange && (
                    <div className={`${styles.dropdownMenuDown} ${styles.durationDropdown}`}>
                      <DurationSlider
                        value={duration}
                        onChange={setDuration}
                        min={videoDurationRange.min}
                        max={videoDurationRange.max}
                        step={videoDurationRange.step}
                      />
                    </div>
                  )}
                </div>

                {/* IKG0LP：是否带音频——仅模型能力位 features.audio 允许时提供；缺省开 */}
                {supportsVideoAudio && (
                  <button
                    className={styles.paramBtn}
                    onClick={() => setGenerateAudio((v) => !v)}
                    title="生成的视频是否带声音"
                    aria-label="生成的视频带音频"
                    aria-pressed={generateAudio}
                  >
                    <span>{generateAudio ? '🔊 带音频' : '🔇 无声'}</span>
                  </button>
                )}
              </div>

              <div className={styles.videoParamsRight}>
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
          /* ========== AI 图片 专属布局 ========== */
          <>
            {/* 内容区域 */}
            <div className={styles.videoContent}>
              {/* 参考文件预览 + 上传（顶部行） */}
              <div className={styles.refArea}>
                {imageRefFiles.map((item, idx) => (
                  <div key={idx} className={styles.refThumbWrap}>
                    <div className={styles.refThumb}>
                      <img src={item.preview} alt="" className={styles.refThumbMedia} />
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
              {/* 提示词输入框：与智能体 tab 共享草稿状态，画廊卡片按当前选中 tab 带入；说明文字仅作空态 placeholder */}
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

            {/* 隐藏的文件输入 */}
            <input
              ref={imageFileInputRef}
              type="file"
              accept="image/*"
              multiple
              style={{ display: 'none' }}
              onChange={handleImageRefFiles}
            />

            {/* 参数按钮行 */}
            <div className={styles.videoParamBar}>
              <div className={styles.videoParamsLeft}>
                {/* 模型下拉 */}
                <div className={styles.dropdownWrap} ref={imgModelRef}>
                  <button
                    className={styles.paramBtn}
                    onClick={() => setShowImgModelDrop(!showImgModelDrop)}
                  >
                    <span>{currentImageModel}</span>
                    <ChevronDown size={12} strokeWidth={2} />
                  </button>
                  {showImgModelDrop && (
                    <div className={styles.dropdownMenuDown}>
                      {imageModelOptions.map((m) => (
                        <button
                          key={m.key}
                          className={`${styles.dropdownItem} ${imageModel === m.key ? styles.dropdownItemActive : ''}`}
                          onClick={() => {
                            const full = imageModelList.find((x) => x.model_id === m.key);
                            if (full) applyImageModel(full);
                            else setImageModel(m.key);
                            setShowImgModelDrop(false);
                          }}
                        >
                          {m.label}
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                {/* 宽高比下拉 */}
                <div className={styles.dropdownWrap} ref={imgRatioRef}>
                  <button
                    className={styles.paramBtn}
                    onClick={() => setShowImgRatioDrop(!showImgRatioDrop)}
                  >
                    <RatioIcon ratio={imageAspectRatio} size={22} />
                    <span>{imageAspectRatio}</span>
                    <ChevronDown size={12} strokeWidth={2} />
                  </button>
                  {showImgRatioDrop && (
                    <div className={styles.dropdownMenuDown}>
                      {imageRatioKeys.map((key) => (
                        <button
                          key={key}
                          className={`${styles.dropdownItem} ${imageAspectRatio === key ? styles.dropdownItemActive : ''}`}
                          onClick={() => { setImageAspectRatio(key); setShowImgRatioDrop(false); }}
                        >
                          <RatioIcon ratio={key} size={22} />
                          <span>{key}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                {/* 分辨率下拉 */}
                <div className={styles.dropdownWrap} ref={imgResRef}>
                  <button
                    className={styles.paramBtn}
                    onClick={() => setShowImgResDrop(!showImgResDrop)}
                  >
                    <span>{currentImageResolution}</span>
                    <ChevronDown size={12} strokeWidth={2} />
                  </button>
                  {showImgResDrop && (
                    <div className={styles.dropdownMenuDown}>
                      {imageSizeItems.map((r) => (
                        <button
                          key={r.key}
                          className={`${styles.dropdownItem} ${imageResolution === r.key ? styles.dropdownItemActive : ''}`}
                          onClick={() => {
                            setImageResolution(r.key);
                            if (selectedImageModel) {
                              setImageAspectRatio(pickRatioForSize(selectedImageModel, r.key, imageAspectRatio));
                            }
                            setShowImgResDrop(false);
                          }}
                        >
                          {r.label}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              <div className={styles.videoParamsRight}>
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
          /* ========== 视频智能体：媒体在上、文字在下，与 AI视频/AI图片 排版一致 ========== */
          <>
            {/* IKA64P：直接使用武装的技能气泡（与画布 Agent 风格一致） */}
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

            {/* 内容区域：媒体在上、文字在下 */}
            <div className={styles.videoContent}>
              {/* 附件预览 + 上传（顶部行） */}
              <div className={styles.refArea}>
                {agentFiles.map((f, idx) => (
                  <div key={f.id} className={styles.refThumbWrap}>
                    <div className={styles.refThumb}>
                      {f.kind === 'image' && (
                        <img className={styles.refThumbMedia} src={f.url} alt={f.name} />
                      )}
                      {f.kind === 'video' && (
                        <video className={styles.refThumbMedia} src={f.url} muted />
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

              {/* 提示词输入框 */}
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

            {/* 隐藏文件输入 */}
            <input
              ref={agentFileInputRef}
              type="file"
              accept="image/*,video/*,audio/*"
              multiple
              style={{ display: 'none' }}
              onChange={handleAgentFilePick}
            />

            {/* 底部工具栏 */}
            <div className={styles.toolbar}>
              {/* 左侧工具 */}
              <div className={styles.toolbarLeft}>
                {/* Skill 按钮 */}
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

                {/* 创作模型下拉 */}
                <div className={styles.dropdownWrap} ref={creationRef}>
                  <button
                    className={styles.modelBtn}
                    onClick={() => setShowCreationDropdown(!showCreationDropdown)}
                  >
                    <span>{currentCreationModel}</span>
                    <ChevronDown size={12} strokeWidth={2} />
                  </button>
                  {showCreationDropdown && (
                    <div className={styles.dropdownMenu}>
                      {creationModelOptions.map((m) => (
                        <button
                          key={m.key}
                          className={`${styles.dropdownItem} ${creationModel === m.key ? styles.dropdownItemActive : ''}`}
                          onClick={() => {
                            setCreationModel(m.key);
                            setShowCreationDropdown(false);
                          }}
                        >
                          {m.label}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {/* 右侧工具 */}
              <div className={styles.toolbarRight}>
                {/* 推理模型下拉 */}
                <div className={styles.dropdownWrap} ref={reasoningRef}>
                  <button
                    className={styles.modelBtn}
                    onClick={() => setShowReasoningDropdown(!showReasoningDropdown)}
                  >
                    <span>{currentReasoningModel}</span>
                    <ChevronDown size={12} strokeWidth={2} />
                  </button>
                  {showReasoningDropdown && (
                    <div className={styles.dropdownMenu}>
                      {agentModelOptions.map((m) => (
                        <button
                          key={m.key}
                          className={`${styles.dropdownItem} ${reasoningModel === m.key ? styles.dropdownItemActive : ''}`}
                          onClick={() => {
                            setReasoningModel(m.key);
                            setShowReasoningDropdown(false);
                          }}
                        >
                          {m.label}
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                {/* 发送按钮 */}
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

      {/* Skill 遮罩层 */}
      <SkillModal
        open={showSkillModal}
        onClose={() => setShowSkillModal(false)}
        onUseSkill={(s) => handleUseSkill(s)}
      />

      {/* 未登录拦截弹窗 */}
      {showLogin && <LoginModal onClose={handleLoginClose} />}

      {/* 校验轻提示（顶部居中弹出） */}
      {toast && (
        <div className={styles.toast} role="alert">
          {toast}
        </div>
      )}

      {/* 参考/附件卡上传菜单：本地上传 + 从资产中选择（AI 视频无角色库） */}
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

      {/* 从资产中选择：视频入口 tab/类型过滤与画布视频 dock 一致 */}
      {assetsPickerTarget && (
        <AssetsPickerModal
          onClose={() => setAssetsPickerTarget(null)}
          onSelect={handleAssetsPickerSelect}
          mediaTypes={
            assetsPickerTarget === 'image'
              ? ['image']
              : assetsPickerTarget === 'agent'
                ? ['image', 'video', 'audio']
                : isKeyframe || videoMode === 'text2video'
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
