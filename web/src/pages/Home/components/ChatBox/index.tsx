/* ============================================
 * ChatBox 首页对话输入框：模型/技能/附件配置与发送
 * ============================================ */
import { useState, useRef, useEffect, useCallback, useSyncExternalStore } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, ChevronUp, ChevronDown, Music, Sparkles, BookOpen, X } from 'lucide-react';
import SkillModal from '../SkillModal';
import LoginModal from '@/components/LoginModal';
import { getCurrentUser, subscribe } from '@/utils/auth';
import styles from './index.module.css';
import { fetchGenerationModels, type GenerationModel } from '@/api/generation';
import { type SkillRecord } from '@/api/skills';
import { setGenHandoff } from '@/utils/gen-handoff';

/** 选项卡定义 */
const tabItems = [
  { key: 'agent', label: '视频智能体' },
  { key: 'video', label: 'AI 视频' },
  { key: 'image', label: 'AI 图片' },
];

/** 创作模型选项 */
const creationModels = [
  { key: 'seedance', label: 'Seedance 2.0' },
  { key: 'anime', label: '动漫模型' },
  { key: 'realistic', label: '写实模型' },
];

/** 推理模型选项 */
const reasoningModels = [
  { key: 'minimax', label: 'MiniMax-M3' },
  { key: 'gpt4', label: 'GPT-4o' },
  { key: 'claude', label: 'Claude-3.5' },
];

/** AI视频 - 模型选项 */
const videoModels = [
  { key: 'seedance2', label: 'Seedance 2.0' },
  { key: 'seedance1', label: 'Seedance 1.0' },
];

/** AI视频 - 模式选项 */
const videoModes = [
  { key: 'omni', label: '全能参考' },
  { key: 'firstlast', label: '首尾帧' },
  { key: 'text2video', label: '图生视频' },
];

/** AI视频 - 宽高比选项 */
const aspectRatios = [
  { key: '16:9', label: '16:9' },
  { key: '4:3', label: '4:3' },
  { key: '1:1', label: '1:1' },
  { key: '3:4', label: '3:4' },
  { key: '9:16', label: '9:16' },
  { key: '21:9', label: '21:9' },
];

/** AI视频 - 分辨率选项 */
const resolutions = [
  { key: '480p', label: '480p' },
  { key: '720p', label: '720p' },
  { key: '1080p', label: '1080p' },
  { key: '2160p', label: '2160p' },
];

/** AI图片 - 模型选项 */
const imageModels = [
  { key: 'seedream5lite', label: 'Seedream 5.0 Lite' },
  { key: 'seedream5pro', label: 'Seedream 5.0 Pro' },
  { key: 'seedream45', label: 'Seedream 4.5' },
  { key: 'gptimage2', label: 'gpt-image-2' },
];

/** AI图片 - 宽高比选项 */
const imageAspectRatios = [
  { key: '9:16', label: '9:16' },
  { key: '3:4', label: '3:4' },
  { key: '1:1', label: '1:1' },
  { key: '4:3', label: '4:3' },
  { key: '16:9', label: '16:9' },
  { key: '2:3', label: '2:3' },
  { key: '3:2', label: '3:2' },
  { key: '21:9', label: '21:9' },
];

/** AI图片 - 分辨率选项 */
const imageResolutions = [
  { key: '2K', label: '2K' },
  { key: '3K', label: '3K' },
  { key: '4K', label: '4K' },
];

/** 视频最大上传数量（接口未下发该字段，前端统一 3） */
const MAX_VIDEOS = 3;

/** 输入框字数上限（与画布对话框一致） */
const MAX_INPUT = 1000;

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

export default function ChatBox({ draft }: { draft?: { text: string; ts: number } | null }) {
  const [activeTab, setActiveTab] = useState('agent');
  const [inputValue, setInputValue] = useState('');
  const navigate = useNavigate();
  const user = useSyncExternalStore(subscribe, getCurrentUser);
  /** 未登录点击发送时弹登录框 */
  const [showLogin, setShowLogin] = useState(false);
  /** 登录成功后需带入画布的草稿 */
  const pendingText = useRef('');
  /** 登录成功后需填入对话框的「直接使用」技能（IKA64P） */
  const pendingSkill = useRef<SkillRecord | null>(null);
  /** IKA64P：「直接使用」武装的技能气泡（发送时随消息作为强制技能生效） */
  const [armedSkill, setArmedSkill] = useState<{ id: string; name: string } | null>(null);

  /** 外部注入草稿（画廊卡片点击）：仅 ts 变化时覆盖输入框 */
  useEffect(() => {
    if (draft?.ts) setInputValue(draft.text.slice(0, MAX_INPUT));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft?.ts]);
  const [showUpload, setShowUpload] = useState(false);
  /** 智能体 tab 附件（+ 上传 图片/视频/音频） */
  const [agentFiles, setAgentFiles] = useState<
    { id: string; url: string; kind: 'image' | 'video' | 'audio'; name: string }[]
  >([]);
  const agentFileInputRef = useRef<HTMLInputElement>(null);
  const [showSkillModal, setShowSkillModal] = useState(false);
  const [creationModel, setCreationModel] = useState('seedance');
  const [reasoningModel, setReasoningModel] = useState('minimax');
  const [showCreationDropdown, setShowCreationDropdown] = useState(false);
  const [showReasoningDropdown, setShowReasoningDropdown] = useState(false);
  const [underlineStyle, setUnderlineStyle] = useState<React.CSSProperties>({});

  // AI视频专属状态
  const [videoModel, setVideoModel] = useState('seedance2');
  const [videoMode, setVideoMode] = useState('omni');
  const [aspectRatio, setAspectRatio] = useState('16:9');
  const [resolution, setResolution] = useState('480p');
  const [duration, setDuration] = useState(15);
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

  // AI图片专属状态
  const [imageModel, setImageModel] = useState('seedream5lite');
  const [imageAspectRatio, setImageAspectRatio] = useState('16:9');
  const [imageResolution, setImageResolution] = useState('2K');
  const [imageStrength] = useState(0.8);
  const [showImgModelDrop, setShowImgModelDrop] = useState(false);
  const [showImgRatioDrop, setShowImgRatioDrop] = useState(false);
  const [showImgResDrop, setShowImgResDrop] = useState(false);
  const [imageRefFiles, setImageRefFiles] = useState<{ file: File; preview: string }[]>([]);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const uploadRef = useRef<HTMLDivElement>(null);
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
      if (uploadRef.current && !uploadRef.current.contains(e.target as Node)) {
        setShowUpload(false);
      }
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

  /** 跳转画布页并携带草稿（经 location.state 注入 Agent 弹框）与武装技能 */
  const goCanvasWithText = (text: string, skillId?: string) => {
    setInputValue('');
    if (skillId) setArmedSkill(null); // 携带后清除气泡
    navigate('/canvas', { state: { agentText: text, skillId: skillId ?? '' } });
  };

  /** 按当前 tab 分发：智能体→Agent 对话；AI视频/AI图片→画布直接生成节点并唤起对应对话框 */
  const dispatchByTab = (text: string) => {
    if (activeTab === 'video') {
      setGenHandoff({
        kind: 'video',
        text,
        modelId: videoModel,
        aspectRatio,
        resolution,
        duration,
        refs: refFiles.map((r) => ({
          preview: r.preview,
          type: r.file.type.startsWith('video/') ? ('video' as const) : ('image' as const),
          file: r.file,
        })),
      });
      setInputValue('');
      setRefFiles([]);
      navigate('/canvas', { state: { genKind: 'video' } });
      return;
    }
    if (activeTab === 'image') {
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
      navigate('/canvas', { state: { genKind: 'image' } });
      return;
    }
    goCanvasWithText(text, armedSkill?.id);
  };

  /** IKA64P：「直接使用」= 关闭弹窗并武装技能气泡（不再填全文；发送时随消息作为强制技能生效） */
  const handleUseSkill = (skill: SkillRecord) => {
    setShowSkillModal(false);
    if (!user) {
      pendingSkill.current = skill;
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
      pendingText.current = text;
      setShowLogin(true);
      return;
    }
    dispatchByTab(text);
  };

  /** 关闭登录框：登录成功则携带原草稿按当前 tab /技能填入对话框 */
  const handleLoginClose = () => {
    setShowLogin(false);
    const text = pendingText.current;
    pendingText.current = '';
    const skill = pendingSkill.current;
    pendingSkill.current = null;
    if (skill && getCurrentUser()) {
      handleUseSkill(skill);
      return;
    }
    if (text && getCurrentUser()) dispatchByTab(text);
  };

  /** + 上传：点击直接选取图片/视频/音频（上限 9 个），按文件类型归类 */
  const handleAgentFilePick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    const items = files.slice(0, Math.max(0, 9 - agentFiles.length)).map((file) => ({
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      url: URL.createObjectURL(file),
      kind: file.type.startsWith('image/')
        ? ('image' as const)
        : file.type.startsWith('video/')
          ? ('video' as const)
          : ('audio' as const),
      name: file.name,
    }));
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

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  // 模型下拉选项：接口数据优先，失败回退本地选项
  const agentModelOptions = textModels.length
    ? textModels.map((m) => ({ key: m.model_id, label: m.model_label }))
    : reasoningModels;
  const videoModelOptions = videoModelList.length
    ? videoModelList.map((m) => ({ key: m.model_id, label: m.model_label }))
    : videoModels;
  const imageModelOptions = imageModelList.length
    ? imageModelList.map((m) => ({ key: m.model_id, label: m.model_label }))
    : imageModels;
  // 智能体 tab 创作模型下拉：与 AI视频 模型同源（video capability），失败回退本地选项
  const creationModelOptions = videoModelList.length
    ? videoModelList.map((m) => ({ key: m.model_id, label: m.model_label }))
    : creationModels;

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

  // AI图片 比例/清晰度选项：取自所选模型能力，接口无数据时回退本地选项
  const selectedImageModel = imageModelList.find((m) => m.model_id === imageModel);
  const imageRatioKeys = selectedImageModel?.supported_aspect_ratios.length
    ? selectedImageModel.supported_aspect_ratios
    : imageAspectRatios.map((r) => r.key);
  const imageSizeItems = selectedImageModel?.supported_sizes.length
    ? selectedImageModel.supported_sizes.map((s) => ({ key: s.id, label: s.label }))
    : imageResolutions;
  const currentImageResolution =
    imageSizeItems.find((s) => s.key === imageResolution)?.label ?? imageResolution;

  // 上传上限（与画布弹窗同规则）：图片数走接口 max_reference_images（首尾帧固定 2），视频最多 3
  const selectedVideoModel = videoModelList.find((m) => m.model_id === videoModel);
  const videoRefImageCount = refFiles.filter((r) => r.file.type.startsWith('image/')).length;
  const videoRefVideoCount = refFiles.filter((r) => r.file.type.startsWith('video/')).length;
  const videoMaxImages =
    videoMode === 'firstlast'
      ? 2
      : (selectedVideoModel?.features?.max_reference_images ?? 10);
  const videoImagesFull = videoRefImageCount >= videoMaxImages;
  const videoVideosFull = videoRefVideoCount >= MAX_VIDEOS;
  /** 首尾帧模式必须恰好 2 张图片（不多不少、不含视频），否则禁止发送 */
  const firstlastInvalid =
    videoMode === 'firstlast' &&
    !(refFiles.length === 2 && refFiles.every((r) => r.file.type.startsWith('image/')));
  const imageMaxImages = selectedImageModel?.features?.max_reference_images ?? 10;

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

  // 处理AI图片参考文件上传（按接口上限截断）
  const handleImageRefFiles = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    const remaining = Math.max(0, imageMaxImages - imageRefFiles.length);
    const newFiles = files.slice(0, remaining).map((file) => ({
      file,
      preview: URL.createObjectURL(file),
    }));
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
                {!(videoImagesFull && videoVideosFull) && (
                  <div
                    className={styles.refCard}
                    onClick={() => fileInputRef.current?.click()}
                  >
                    <Plus size={16} strokeWidth={2} />
                    <span>参考</span>
                  </div>
                )}
              </div>
              {/* 提示词输入框：与智能体 tab 共享草稿状态，画廊卡片按当前选中 tab 带入；说明文字仅作空态 placeholder */}
              <textarea
                className={styles.textarea}
                placeholder={`通过直接控制提示词快速生成单段片段。\n上传参考：图片最多 ${videoMaxImages} 张 / 视频最多 ${MAX_VIDEOS} 个；首尾帧模式可上传首帧与尾帧参考。`}
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value.slice(0, MAX_INPUT))}
                maxLength={MAX_INPUT}
                onKeyDown={handleKeyDown}
                rows={2}
              />
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
                      {aspectRatios.map((r) => (
                        <button
                          key={r.key}
                          className={`${styles.dropdownItem} ${aspectRatio === r.key ? styles.dropdownItemActive : ''}`}
                          onClick={() => { setAspectRatio(r.key); setShowRatioDrop(false); }}
                        >
                          <RatioIcon ratio={r.key} />
                          <span>{r.label}</span>
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
                      {resolutions.map((r) => (
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
                  {showDurationDrop && (
                    <div className={`${styles.dropdownMenuDown} ${styles.durationDropdown}`}>
                      <div className={styles.durationValue}>{duration}s</div>
                      <input
                        type="range"
                        min={4}
                        max={15}
                        value={duration}
                        onChange={(e) => setDuration(Number(e.target.value))}
                        className={styles.durationSlider}
                      />
                      <div className={styles.durationLabels}>
                        <span>4s</span>
                        <span>15s</span>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              <div className={styles.videoParamsRight}>
                <span className={styles.tryUnlimited}>或尝试无限</span>
                <div className={styles.tokenBadge}>
                  <Sparkles size={14} color="#a0a0a0" strokeWidth={2} />
                  <span className={styles.tokenCount}>9</span>
                </div>
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
                {imageRefFiles.length < imageMaxImages && (
                  <div
                    className={styles.refCard}
                    onClick={() => imageFileInputRef.current?.click()}
                  >
                    <Plus size={16} strokeWidth={2} />
                    <span>图片</span>
                  </div>
                )}
              </div>
              {/* 提示词输入框：与智能体 tab 共享草稿状态，画廊卡片按当前选中 tab 带入；说明文字仅作空态 placeholder */}
              <textarea
                className={styles.textarea}
                placeholder={'从文字与参考图生成 AI 图片。\n描述你想生成的图片，已上传的参考将引导风格与细节。'}
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value.slice(0, MAX_INPUT))}
                maxLength={MAX_INPUT}
                onKeyDown={handleKeyDown}
                rows={2}
              />
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
                <div className={styles.imageStrengthBadge}>
                  <Sparkles size={14} strokeWidth={2} />
                  <span>+ {imageStrength}</span>
                </div>
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
          /* ========== 视频智能体 原有布局 ========== */
          <>
            {/* IKA64P：直接使用武装的技能气泡（发送时随消息作为强制技能生效） */}
            {armedSkill && (
              <div className={styles.armedSkill}>
                <Sparkles size={12} strokeWidth={2} />
                <span>技能「{armedSkill.name}」已就绪，发送后生效</span>
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

            {/* 输入框 */}
            <textarea
              className={styles.textarea}
              placeholder="描述你想制作的视频，微电影、产品广告、社媒视频等都可支持。适合 1-5 分钟视频。"
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value.slice(0, MAX_INPUT))}
              maxLength={MAX_INPUT}
              onKeyDown={handleKeyDown}
              rows={3}
            />

            {/* 附件预览（+ 上传后展示） */}
            {agentFiles.length > 0 && (
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
              </div>
            )}

            {/* 底部工具栏 */}
            <div className={styles.toolbar}>
              {/* 左侧工具 */}
              <div className={styles.toolbarLeft}>
                {/* + 按钮：悬停显示小提示，点击直接选取图片/视频/音频文件上传 */}
                <div className={styles.uploadWrap} ref={uploadRef}>
                  <button
                    className={styles.iconBtn}
                    onClick={() => agentFileInputRef.current?.click()}
                    onMouseEnter={() => setShowUpload(true)}
                    onMouseLeave={() => setShowUpload(false)}
                  >
                    <Plus size={18} strokeWidth={2} />
                  </button>
                  {showUpload && (
                    <div className={styles.uploadPopup}>
                      <span className={styles.uploadHint}>可上传视频、图片或音频</span>
                    </div>
                  )}
                </div>

                {/* 隐藏文件输入（+ 上传：图片/视频/音频） */}
                <input
                  ref={agentFileInputRef}
                  type="file"
                  accept="image/*,video/*,audio/*"
                  multiple
                  style={{ display: 'none' }}
                  onChange={handleAgentFilePick}
                />

                {/* Skill 按钮 */}
                <button
                  className={styles.skillBtn}
                  onClick={() => setShowSkillModal(true)}
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

                {/* Token 用量 */}
                <div className={styles.tokenBadge}>
                  <Sparkles size={14} color="#a0a0a0" strokeWidth={2} />
                  <span className={styles.tokenCount}>9</span>
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
