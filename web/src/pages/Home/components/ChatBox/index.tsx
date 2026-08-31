/* ============================================
 * ChatBox 首页对话输入框：模型/技能/附件配置与发送
 * ============================================ */
import { useState, useRef, useEffect, useCallback, useLayoutEffect, useSyncExternalStore } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, ChevronUp, ChevronDown, Music, BookOpen, BookText, X } from 'lucide-react';
import SkillModal from '../SkillModal';
import LoginModal from '@/components/LoginModal';
import { getCurrentUser, subscribe } from '@/utils/auth';
import styles from './index.module.css';
import { fetchGenerationModels, type GenerationModel } from '@/api/generation';
import { type SkillRecord } from '@/api/skills';
import { createProject } from '@/api/projects';
import { setGenHandoff } from '@/utils/gen-handoff';
import { setAgentHandoff } from '@/utils/agent-handoff';
import { classifyRefOverflow, REF_LIMITS } from '@/utils/ref-overflow';
import DurationSlider from './DurationSlider';
import { resolveHomeLoginResume, type HomePendingAction } from './homeLoginResume';
import { limitPromptInput, MAX_PROMPT_INPUT_LENGTH } from './promptInput';

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

/** 视频最大上传数量（接口未下发该字段，前端统一 3） */
const MAX_VIDEOS = 3;

/** 智能体 tab 附件分类型上限：视频/音频固定 3（图片随创作模型能力，见组件内 agentMaxImages） */
const MAX_AGENT_VIDEOS = 3;
const MAX_AGENT_AUDIO = 3;

/** 输入框字数上限（与画布对话框一致） */
const MAX_INPUT = MAX_PROMPT_INPUT_LENGTH;

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

/** 宽高比图标 - 根据比例渲染对应形状的 SVG 矩形 */
const ratioDims: Record<string, [number, number]> = {
  '21:9': [24, 10],
  '16:9': [22, 12],
  '4:3': [20, 15],
  '3:2': [21, 14],
  '1:1': [16, 16],
  '2:3': [14, 21],
  '3:4': [15, 20],
  '9:16': [12, 22],
};

function RatioIcon({ ratio, size = 22 }: { ratio: string; size?: number }) {
  const [w, h] = ratioDims[ratio] ?? [16, 16];
  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${w} ${h}`}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      style={{ flexShrink: 0 }}
    >
      <rect x={0.75} y={0.75} width={w - 1.5} height={h - 1.5} rx={2} />
    </svg>
  );
}

export default function ChatBox({ draft }: { draft?: { text: string; ts: number; mediaType: 'video' | 'image' } | null }) {
  const [activeTab, setActiveTab] = useState('agent');
  const [inputValue, setInputValue] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const navigate = useNavigate();
  const user = useSyncExternalStore(subscribe, getCurrentUser);
  /** 未登录点击发送时弹登录框 */
  const [showLogin, setShowLogin] = useState(false);
  /** 登录成功后续接的原动作（Skill / 发送最后一次点击为准） */
  const pendingAction = useRef<HomePendingAction | null>(null);
  /** IKA64P：「直接使用」武装的技能气泡（发送时随消息作为强制技能生效） */
  const [armedSkill, setArmedSkill] = useState<{ id: string; name: string } | null>(null);

  /** 画廊卡片点击：只填输入框并切 tab，不拦登录；真正发送时再校验。
   *  用 ts 驱动重复点击同一张卡也能注入，不把 text/mediaType 放进依赖。 */
  useEffect(() => {
    if (draft?.ts) {
      setInputValue(draft.text.slice(0, MAX_INPUT));
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
  /** 智能体 tab 附件（+ 上传 图片/视频/音频）——保留原始 File，发送时经 handoff 带入画布 */
  const [agentFiles, setAgentFiles] = useState<
    { id: string; url: string; kind: 'image' | 'video' | 'audio'; name: string; file: File }[]
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
  const [showVideoModelDrop, setShowVideoModelDrop] = useState(false);
  const [showVideoModeDrop, setShowVideoModeDrop] = useState(false);
  const [showRatioDrop, setShowRatioDrop] = useState(false);
  const [showResDrop, setShowResDrop] = useState(false);
  const [showDurationDrop, setShowDurationDrop] = useState(false);
  const [refFiles, setRefFiles] = useState<{ file: File; preview: string }[]>([]);
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
  const [imageRefFiles, setImageRefFiles] = useState<{ file: File; preview: string }[]>([]);

  const fileInputRef = useRef<HTMLInputElement>(null);

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

  // 模型能力列表（首页并发调用 text/video/image；失败保留本地兜底选项）
  const [textModels, setTextModels] = useState<GenerationModel[]>([]);
  const [videoModelList, setVideoModelList] = useState<GenerationModel[]>([]);
  const [imageModelList, setImageModelList] = useState<GenerationModel[]>([]);

  /** 选中 AI图片 模型并套用其默认比例/清晰度 */
  const applyImageModel = (model: GenerationModel) => {
    setImageModel(model.model_id);
    if (model.supported_aspect_ratios.length) {
      setImageAspectRatio(
        model.default_aspect_ratio && model.supported_aspect_ratios.includes(model.default_aspect_ratio)
          ? model.default_aspect_ratio
          : model.supported_aspect_ratios[0]
      );
    }
    if (model.supported_sizes.length) {
      setImageResolution(
        model.default_size && model.supported_sizes.some((s) => s.id === model.default_size)
          ? (model.default_size as string)
          : model.supported_sizes[0].id
      );
    }
  };

  // 首尾帧模式校验：选中该模式或参考上传变化时，要求恰好两张图片，否则弹出提示
  useEffect(() => {
    if (videoMode !== 'firstlast') return;
    const ok = refFiles.length === 2 && refFiles.every((r) => r.file.type.startsWith('image/'));
    if (!ok) showToast('首尾帧模式需上传两张图片作为首帧与尾帧参考');
  }, [videoMode, refFiles, showToast]);

  // 视频模型列表加载 / 切换模型后：当前参数若不在新模型能力内，套用该模型默认值（接口为唯一数据源）
  useEffect(() => {
    const m = videoModelList.find((x) => x.model_id === videoModel);
    if (!m) return;
    if (m.supported_aspect_ratios.length && !m.supported_aspect_ratios.includes(aspectRatio)) {
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
  }, [videoModelList, videoModel]);

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
        resolution: sizeEntry?.api_value ?? resolution,
        duration,
        // 首页模式键映射画布模式：首尾帧→keyframe；其余保留原键（omni→all、text2video→text2video）
        mode: videoMode === 'firstlast' ? 'keyframe' : (videoMode === 'text2video' ? 'text2video' : 'all'),
        refs: refFiles.map((r) => ({
          preview: r.preview,
          type: r.file.type.startsWith('video/') ? ('video' as const) : ('image' as const),
          file: r.file,
        })),
      });
      setInputValue('');
      setRefFiles([]);
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
          name: r.file.name,
          file: r.file,
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
        setInputValue(resume.text.slice(0, MAX_INPUT));
        return;
      default:
        return;
    }
  };

  /** + 上传：点击直接选取图片/视频/音频（分类型上限：图片随创作模型能力、视频/音频固定 3），超限按类型 toast */
  const handleAgentFilePick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    let imgRoom = Math.max(0, agentMaxImages - agentImageCount);
    let vidRoom = Math.max(0, MAX_AGENT_VIDEOS - agentVideoCount);
    let audRoom = Math.max(0, MAX_AGENT_AUDIO - agentAudioCount);
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
    else if (droppedVideos > 0) showToast(`附件视频最多 ${MAX_AGENT_VIDEOS} 个`);
    else if (droppedAudio > 0) showToast(`附件音频最多 ${MAX_AGENT_AUDIO} 个`);
    setAgentFiles((prev) => [...prev, ...items]);
    e.target.value = '';
  };

  /** 移除附件并释放 objectURL */
  const removeAgentFile = (id: string) => {
    setAgentFiles((prev) => {
      const target = prev.find((f) => f.id === id);
      if (target) URL.revokeObjectURL(target.url);
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
    const next = limitPromptInput(value, inputValue);
    setInputValue(next.value);
    if (next.reachedLimit) showToast(`输入内容最多 ${MAX_INPUT} 个字符`);
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
  const imageRatioKeys = selectedImageModel?.supported_aspect_ratios ?? [];
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

  // 上传上限（与画布弹窗同规则）：图片数走接口 max_reference_images（首尾帧固定 2），视频最多 3
  /** 智能体 tab 附件分类型上限：图片随所选创作模型（video capability）读接口 max_reference_images（能力未加载完时为 0）；视频/音频固定 3 */
  const selectedCreationModel = videoModelList.find((m) => m.model_id === creationModel);
  const agentMaxImages = selectedCreationModel?.features?.max_reference_images ?? 0;
  const agentImageCount = agentFiles.filter((f) => f.kind === 'image').length;
  const agentVideoCount = agentFiles.filter((f) => f.kind === 'video').length;
  const agentAudioCount = agentFiles.filter((f) => f.kind === 'audio').length;
  const agentAllFull =
    agentImageCount >= agentMaxImages &&
    agentVideoCount >= MAX_AGENT_VIDEOS &&
    agentAudioCount >= MAX_AGENT_AUDIO;
  const videoRefImageCount = refFiles.filter((r) => r.file.type.startsWith('image/')).length;
  const videoRefVideoCount = refFiles.filter((r) => r.file.type.startsWith('video/')).length;
  const videoMaxImages =
    videoMode === 'firstlast'
      ? 2
      : (selectedVideoModel?.features?.max_reference_images ?? 0);
  const videoImagesFull = videoRefImageCount >= videoMaxImages;
  const videoVideosFull = videoRefVideoCount >= MAX_VIDEOS;
  /** 首尾帧模式必须恰好 2 张图片（不多不少、不含视频），否则禁止发送 */
  const firstlastInvalid =
    videoMode === 'firstlast' &&
    !(refFiles.length === 2 && refFiles.every((r) => r.file.type.startsWith('image/')));
  /** AI 图片参考图上限：产品约定 9 张（与画布 ImageDialog REF_LIMITS.image 一致），取接口值和约定的较小值 */
  const imageMaxImages = Math.min(selectedImageModel?.features?.max_reference_images ?? 0, REF_LIMITS.image);

  // 处理参考文件上传（按类型剩余名额截断：图片走接口上限，视频最多 3）
  const handleRefFiles = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    let imgRoom = Math.max(0, videoMaxImages - videoRefImageCount);
    let vidRoom = Math.max(0, MAX_VIDEOS - videoRefVideoCount);
    const newFiles = files
      .filter((f) => {
        if (f.type.startsWith('video/')) {
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
      }));
    const overflow = classifyRefOverflow({
      selectedImages: files.filter((f) => f.type.startsWith('image/')).length,
      selectedVideos: files.filter((f) => f.type.startsWith('video/')).length,
      acceptedImages: newFiles.filter((f) => f.file.type.startsWith('image/')).length,
      acceptedVideos: newFiles.filter((f) => f.file.type.startsWith('video/')).length,
    });
    if (overflow === 'image') showToast(`参考图最多 ${videoMaxImages} 张，请减少图片`);
    else if (overflow === 'video') showToast(`参考视频最多 ${MAX_VIDEOS} 个`);
    setRefFiles((prev) => [...prev, ...newFiles]);
    // 重置 input 以便重复选择相同文件
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const removeRefFile = (index: number) => {
    setRefFiles((prev) => {
      const copy = [...prev];
      URL.revokeObjectURL(copy[index].preview);
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
    }));
    if (files.length > newFiles.length) showToast(`参考图最多 ${imageMaxImages} 张，请减少图片`);
    setImageRefFiles((prev) => [...prev, ...newFiles]);
    if (imageFileInputRef.current) imageFileInputRef.current.value = '';
  };

  const removeImageRefFile = (index: number) => {
    setImageRefFiles((prev) => {
      const copy = [...prev];
      URL.revokeObjectURL(copy[index].preview);
      copy.splice(index, 1);
      return copy;
    });
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
                {refFiles.map((item, idx) => (
                  <div key={idx} className={styles.refThumbWrap}>
                    <div className={styles.refThumb}>
                      {item.file.type.startsWith('video/') ? (
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
                      {item.file.type.startsWith('video/') ? `Video ${idx + 1}` : `Image ${idx + 1}`}
                    </span>
                  </div>
                ))}
                <div
                  className={styles.refCard}
                  onClick={() => {
                    if (videoImagesFull && videoVideosFull) {
                      showToast(`参考素材已到上限（图片 ${videoMaxImages} 张 / 视频 ${MAX_VIDEOS} 个）`);
                      return;
                    }
                    fileInputRef.current?.click();
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
                  placeholder={`通过直接控制提示词快速生成单段片段。\n上传参考：图片最多 ${videoMaxImages} 张 / 视频最多 ${MAX_VIDEOS} 个；首尾帧模式可上传首帧与尾帧参考。`}
                  value={inputValue}
                  onChange={(e) => handleInputChange(e.target.value)}
                  onKeyDown={handleKeyDown}
                  onCompositionStart={handleCompositionStart}
                  onCompositionEnd={handleCompositionEnd}
                  rows={2}
                />
                <span className={styles.textareaCount}>{inputValue.length}/{MAX_INPUT}</span>
              </div>
            </div>

            {/* 隐藏的文件输入 */}
            <input
              ref={fileInputRef}
              type="file"
              accept={videoImagesFull ? 'video/*' : videoVideosFull ? 'image/*' : 'image/*,video/*'}
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
                          onClick={() => { setVideoMode(m.key); setShowVideoModeDrop(false); }}
                        >
                          {m.label}
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                {/* 宽高比下拉 */}
                <div className={styles.dropdownWrap} ref={ratioRef}>
                  <button
                    className={styles.paramBtn}
                    onClick={() => setShowRatioDrop(!showRatioDrop)}
                  >
                    <RatioIcon ratio={aspectRatio} />
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
                          <RatioIcon ratio={key} />
                          <span>{key}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>

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
              </div>

              <div className={styles.videoParamsRight}>
                <button
                  className={`${styles.sendBtn} ${inputValue.trim() && !firstlastInvalid ? styles.sendBtnActive : ''}`}
                  onClick={handleSend}
                  disabled={!inputValue.trim() || firstlastInvalid}
                  title={firstlastInvalid ? '首尾帧模式需恰好 2 张图片' : '发送'}
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
                  className={styles.refCard}
                  onClick={() => {
                    if (imageRefFiles.length >= imageMaxImages) {
                      showToast(`参考图已到上限（${imageMaxImages} 张）`);
                      return;
                    }
                    imageFileInputRef.current?.click();
                  }}
                >
                  <Plus size={16} strokeWidth={2} />
                  <span>图片</span>
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
                />
                <span className={styles.textareaCount}>{inputValue.length}/{MAX_INPUT}</span>
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
                    <RatioIcon ratio={imageAspectRatio} />
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
                          <RatioIcon ratio={key} />
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
                          onClick={() => { setImageResolution(r.key); setShowImgResDrop(false); }}
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
                  className={styles.refCard}
                  onClick={() => {
                    if (agentAllFull) {
                      showToast(`附件已到上限（图片 ${agentMaxImages} 张 / 视频 ${MAX_AGENT_VIDEOS} 个 / 音频 ${MAX_AGENT_AUDIO} 个）`);
                      return;
                    }
                    agentFileInputRef.current?.click();
                  }}
                >
                  <Plus size={16} strokeWidth={2} />
                  <span>附件</span>
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
                />
                <span className={styles.textareaCount}>{inputValue.length}/{MAX_INPUT}</span>
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
    </>
  );
}
