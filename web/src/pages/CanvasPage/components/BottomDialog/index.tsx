/* ============================================
 * BottomDialog 视频对话窗口：模式/模型/时长/宽高比配置与发送
 * ============================================ */
import { useState, useRef, useEffect } from 'react';
import {
  Plus,
  ChevronDown,
  X,
  Image,
  Video,
  SlidersHorizontal,
  Play,
  ArrowUp,
  Upload,
  MousePointerClick,
  Maximize2,
  Minimize2,
  User,
} from 'lucide-react';
import { fetchGenerationModels, type GenerationModel } from '@/api/generation';
import { classifyRefOverflows, REF_LIMITS, refOverflowToast } from '@/utils/ref-overflow';
import { useDismissOnOutside } from '../../hooks/useDismissOnOutside';
import ChipTextEditor, { type ChipTextEditorHandle, type ChipRef } from '../ChipTextEditor';
import {
  EMPTY_COMPOSED,
  composedIsEmpty,
  composedLength,
  resolveComposed,
  type ComposedValue,
} from '../ChipTextEditor/composed';
import styles from './index.module.css';

/** 模式选项 */
const modeOptions = [
  { key: 'all', label: '全能参考' },
  { key: 'keyframe', label: '首尾帧' },
  { key: 'text2video', label: '图生视频' },
];

/** 视频最大上传数量（接口未下发该字段，前端统一 3） */
const MAX_VIDEOS = 3;

/** 输入框字数上限 */
const MAX_INPUT = 1000;

/** 视频生成参数（发送时传给画布创建生成任务） */
export interface VideoGenOptions {
  /** 模型ID（能力接口未加载时为空串，调用方需拦截） */
  modelId: string;
  aspectRatio: string;
  /** 分辨率 api_value，如 1080p */
  resolution: string;
  /** 时长（秒） */
  duration: number;
  /** 参考模式：all 全能参考 / keyframe 首尾帧 / text2video 图生视频 */
  mode: string;
}

/** 参考素材项（file 仅本地上传有值；画布带入的节点图片只有 preview URL，assetId 已有则直接复用） */
export interface BottomRefItem {
  file?: File;
  preview: string;
  type: 'image' | 'video';
  /** 已有资产 ID（画布节点带入时携带，发送时免重复上传） */
  assetId?: string | number;
}

interface BottomDialogProps {
  onClose: () => void;
  onSend: (text: string, opts: VideoGenOptions, refs: BottomRefItem[]) => void;
  /** 初始参考素材（节点「生成视频」带入被点节点图片） */
  initialRefs?: BottomRefItem[];
  /** 初始生成卡引用胶囊（Agent 生成卡「引用到 dock」带入，累计不覆盖，可多张） */
  initialCards?: ChipRef[];
  /** 初始自由文本（视频节点「重新编辑」带入原提示词） */
  initialText?: string;
  /** 初始生成参数（首页 AI视频 带入：选中首页所选的模型/比例/清晰度/时长/模式） */
  initialParams?: VideoGenSeedParams;
  /** 到节点选择：进入画布节点选取模式（image 图片节点 / video 视频节点） */
  onPickFromCanvas?: (kind: 'image' | 'video') => void;
  /** 画布选取模式进行中（image/video，对应按钮高亮提示） */
  pickMode?: 'image' | 'video' | null;
  /** 外部注入参考视频（ts 驱动；画布节点单选 / 角色库多选，items 为一批） */
  externalPick?: { ts: number; items: BottomRefItem[] } | null;
  /** 外部注入参考图片（ts 驱动；画布节点单选 / 角色库多选，items 为一批） */
  externalImagePick?: { ts: number; items: BottomRefItem[] } | null;
  /** 打开角色库弹窗 */
  onOpenCharacterLibrary?: () => void;
  /** Toast 提示（上传超限/首尾帧校验等场景，由父级注入全局 sonner，位置/样式与 ImageDialog/AudioDialog 统一） */
  onToast?: (type: 'success' | 'error' | 'warn', msg: string) => void;
}

/** 首页带入的初始生成参数（resolution 传 api_value 如 720p，模型列表加载后反查档位 id；
 *  各字段经模型能力校验后应用，不在能力内的项回退模型默认值） */
export interface VideoGenSeedParams {
  /** 模型ID */
  modelId?: string;
  /** 宽高比（如 16:9） */
  aspectRatio?: string;
  /** 分辨率 api_value（如 720p） */
  resolution?: string;
  /** 时长（秒） */
  duration?: number;
  /** 参考模式：all 全能参考 / keyframe 首尾帧 / text2video 图生视频 */
  mode?: string;
}

/** 宽高比图标：按比例绘制小矩形 */
function RatioIcon({ ratio }: { ratio: string }) {
  const [w, h] = ratio.split(':').map(Number);
  const max = 16;
  const width = w >= h ? max : Math.round((w / h) * max);
  const height = h >= w ? max : Math.round((h / w) * max);
  return <span className={styles.ratioIcon} style={{ width, height }} />;
}

export default function BottomDialog({ onClose, onSend, initialRefs, initialCards, initialText, initialParams, onPickFromCanvas, pickMode, externalPick, externalImagePick, onOpenCharacterLibrary, onToast }: BottomDialogProps) {
  /** 富文本输入框（可多次插入生成卡引用胶囊，发送时替换成完整 prompt） */
  const chipEditorRef = useRef<ChipTextEditorHandle>(null);
  /** 输入框实时纯文本（胶囊已替换成完整 prompt），供生成按钮启用态判断 */
  /** 输入框内容的结构化形态（IKAFSX）：胶囊是指针，解引用只发生在发送那一刻。 */
  const [composed, setComposed] = useState<ComposedValue>(EMPTY_COMPOSED);
  /** 计数口径：文字按字符数，一个胶囊算 1 个单位——不按它背后那几千字算。 */
  const composedCount = composedLength(composed);
  const canSend = !composedIsEmpty(composed);
  const [refFiles, setRefFiles] = useState<BottomRefItem[]>(initialRefs ?? []);
  /** 视频文件时长（秒），key 为 refFiles 索引 */
  const [videoDurations, setVideoDurations] = useState<Record<number, number>>({});
  const [selectedMode, setSelectedMode] = useState(modeOptions[0].key);
  const [modeOpen, setModeOpen] = useState(false);
  const [showConfig, setShowConfig] = useState(false);
  /** 放大态：输入区高度占屏幕 2/3；收起回底部默认高度 */
  const [expanded, setExpanded] = useState(false);
  const [modelList, setModelList] = useState<GenerationModel[]>([]);
  const [selectedModel, setSelectedModel] = useState('');
  const [selectedSize, setSelectedSize] = useState('');
  /** 比例/时长初始为空/0：接口加载完成后 applyModelDefaults 套用所选模型默认值 */
  const [selectedRatio, setSelectedRatio] = useState('');
  const [duration, setDuration] = useState(0);
  const [modelOpen, setModelOpen] = useState(false);
  const [sizeOpen, setSizeOpen] = useState(false);
  /** 上传按钮弹菜单（image/video 各自独立，避免同时弹出）：上传 / 到节点选择 */
  const [sourceMenuOpen, setSourceMenuOpen] = useState<'image' | 'video' | null>(null);
  /** Toast 已废弃，所有提示走父级注入的 onToast（全局 sonner，位置/样式与 ImageDialog/AudioDialog 统一） */
  const imageInputRef = useRef<HTMLInputElement>(null);
  const videoInputRef = useRef<HTMLInputElement>(null);
  const anyInputRef = useRef<HTMLInputElement>(null);
  const modelWrapRef = useRef<HTMLDivElement>(null);
  const sizeWrapRef = useRef<HTMLDivElement>(null);
  const modeWrapRef = useRef<HTMLDivElement>(null);
  const imageSourceRef = useRef<HTMLDivElement>(null);
  const videoSourceRef = useRef<HTMLDivElement>(null);
  const configPanelRef = useRef<HTMLDivElement>(null);

  useDismissOnOutside([
    { open: modelOpen, ref: modelWrapRef, dismiss: () => setModelOpen(false) },
    { open: sizeOpen, ref: sizeWrapRef, dismiss: () => setSizeOpen(false) },
    { open: modeOpen, ref: modeWrapRef, dismiss: () => setModeOpen(false) },
    { open: sourceMenuOpen === 'image', ref: imageSourceRef, dismiss: () => setSourceMenuOpen(null) },
    { open: sourceMenuOpen === 'video', ref: videoSourceRef, dismiss: () => setSourceMenuOpen(null) },
    { open: showConfig, ref: configPanelRef, dismiss: () => setShowConfig(false) },
  ]);

  const currentModel = modelList.find((m) => m.model_id === selectedModel) ?? null;
  const modelOptions = modelList.map((m) => ({ key: m.model_id, label: m.model_label }));
  /** 能力选项全部取自接口（无本地写死兜底）：模型列表未加载完时为空 */
  const sizeOptions = currentModel?.supported_sizes?.length
    ? currentModel.supported_sizes.map((s) => ({ key: s.id, label: s.label }))
    : [];
  const ratioOptions = currentModel?.supported_aspect_ratios ?? [];
  const durationRange = currentModel?.supported_durations ?? null;
  const currentSizeLabel =
    sizeOptions.find((s) => s.key === selectedSize)?.label ?? selectedSize;
  const currentMode = modeOptions.find((m) => m.key === selectedMode);

  /** 首尾帧模式：仅允许上传 2 张图片（首帧+尾帧），禁止视频 */
  const isKeyframe = selectedMode === 'keyframe';
  /** 图生视频 / 首尾帧 均不支持视频参考 */
  const noVideoMode = isKeyframe || selectedMode === 'text2video';
  const imageCount = refFiles.filter((f) => f.type === 'image').length;
  const videoCount = refFiles.filter((f) => f.type === 'video').length;
  /** 首尾帧模式必须恰好 2 张图片（不多不少、不含视频），否则禁止发送 */
  const keyframeInvalid = isKeyframe && (imageCount !== 2 || videoCount > 0);
  /** 图片上限：首尾帧模式固定 2（首帧+尾帧），其余固定 9 张（产品约定，与 ImageDialog 统一，不随模型能力波动） */
  const maxImages = isKeyframe ? 2 : REF_LIMITS.image;

  /** 时长刻度（min..max 逐 step；模型能力未加载时无刻度） */
  const ticks: number[] = [];
  if (durationRange) {
    for (let v = durationRange.min; v <= durationRange.max; v += durationRange.step) ticks.push(v);
  }

  /** 选中模型后应用其默认清晰度/宽高比/时长 */
  const applyModelDefaults = (m: GenerationModel) => {
    setSelectedModel(m.model_id);
    if (m.supported_aspect_ratios.length) {
      setSelectedRatio(
        m.default_aspect_ratio && m.supported_aspect_ratios.includes(m.default_aspect_ratio)
          ? m.default_aspect_ratio
          : m.supported_aspect_ratios[0],
      );
    }
    if (m.supported_sizes.length) {
      setSelectedSize(
        m.default_size && m.supported_sizes.some((s) => s.id === m.default_size)
          ? (m.default_size as string)
          : m.supported_sizes[0].id,
      );
    }
    if (m.supported_durations) {
      const clamp = (v: number) =>
        Math.min(Math.max(v, m.supported_durations!.min), m.supported_durations!.max);
      setDuration(typeof m.default_duration === 'number' ? clamp(m.default_duration) : m.supported_durations.min);
    }
  };

  // 初始自由文本（视频节点重新编辑带入原提示词）—— 先设文本，再插胶囊，避免覆盖
  useEffect(() => {
    if (initialText) {
      chipEditorRef.current?.setText(initialText);
    }
  }, [initialText]);

  // 外部注入参考视频（画布节点选取/角色库多选；去重 + 上限保护；图生视频 / 首尾帧模式不收视频）
  useEffect(() => {
    if (!externalPick) return;
    if (noVideoMode) return;
    const items = externalPick.items;
    setRefFiles((prev) => {
      let next = prev;
      for (const item of items) {
        const vidCount = next.filter((f) => f.type === 'video').length;
        if (vidCount >= MAX_VIDEOS) break;
        if (next.some((f) => (item.assetId != null && f.assetId === item.assetId) || f.preview === item.preview)) continue;
        next = [...next, item];
      }
      return next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [externalPick]);

  // 外部注入参考图片（画布节点选取/角色库多选；去重 + 上限保护；首尾帧模式同样适用）
  useEffect(() => {
    if (!externalImagePick) return;
    const items = externalImagePick.items;
    const imgCount = refFiles.filter((f) => f.type === 'image').length;
    if (imgCount >= maxImages) {
      onToast?.('warn', refOverflowToast(['image'], { image: maxImages }));
      return;
    }
    // 超出剩余容量的部分丢弃并提示（与单张超限 toast 文案统一）
    const accepted = items.slice(0, maxImages - imgCount);
    if (accepted.length < items.length) {
      onToast?.('warn', refOverflowToast(['image'], { image: maxImages }));
    }
    setRefFiles((prev) => {
      let next = prev;
      for (const item of accepted) {
        const imgCnt = next.filter((f) => f.type === 'image').length;
        if (imgCnt >= maxImages) break;
        if (next.some((f) => (item.assetId != null && f.assetId === item.assetId) || f.preview === item.preview)) continue;
        next = [...next, item];
      }
      return next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [externalImagePick]);

  // 只插入 initialCards 里「上次还没插过」的新增部分：对话框不因追加引用而重挂载，
  // 已输入的自由文字不会被清空；ref 记录已插入数量，同时防 StrictMode 开发态 effect 双调用重复插入
  const insertedCardCountRef = useRef(0);
  useEffect(() => {
    const newCards = (initialCards ?? []).slice(insertedCardCountRef.current);
    insertedCardCountRef.current = initialCards?.length ?? 0;
    newCards.forEach((card) => chipEditorRef.current?.insertChip(card));
  }, [initialCards]);

  // 加载视频模型能力列表：优先选中首页带入的模型，参数逐项按模型能力校验后应用
  useEffect(() => {
    fetchGenerationModels('video')
      .then((list) => {
        setModelList(list);
        if (!list.length) return;
        const target =
          (initialParams?.modelId && list.find((m) => m.model_id === initialParams.modelId)) ||
          list[0];
        applyModelDefaults(target);
        // 首页带入参数覆盖默认值（逐项经模型能力校验，不合法项保持该模型默认值）
        if (initialParams) {
          if (initialParams.aspectRatio && target.supported_aspect_ratios.includes(initialParams.aspectRatio)) {
            setSelectedRatio(initialParams.aspectRatio);
          }
          if (initialParams.resolution) {
            const size = target.supported_sizes.find(
              (s) => s.api_value === initialParams.resolution || s.id === initialParams.resolution,
            );
            if (size) setSelectedSize(size.id);
          }
          if (typeof initialParams.duration === 'number' && target.supported_durations) {
            const d = target.supported_durations;
            setDuration(Math.min(Math.max(initialParams.duration, d.min), d.max));
          }
          if (initialParams.mode && modeOptions.some((o) => o.key === initialParams.mode)) {
            setSelectedMode(initialParams.mode);
          }
        }
      })
      .catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 卸载时释放本地 objectURL（首页 seed 与本地上传；画布节点带入无 file 不释放）。
  // 首页交接的 preview 也由这里负责：firePendingGen 提交任务后不再提前 revoke，
  // 否则对话框里还在显示的缩略图当场失效。
  const refFilesRef = useRef(refFiles);
  refFilesRef.current = refFiles;
  useEffect(
    () => () => {
      refFilesRef.current.forEach((f) => {
        if (f.file) URL.revokeObjectURL(f.preview);
      });
    },
    [],
  );

  /** 上传图片（首尾帧模式限 2 张；达上限 toast） */
  const handleImageClick = () => {
    if (imageCount < maxImages) imageInputRef.current?.click();
    else onToast?.('warn', refOverflowToast(['image'], { image: maxImages }));
  };

  /** 上传视频（首尾帧模式禁用；达上限 toast） */
  const handleVideoClick = () => {
    if (isKeyframe) return;
    if (videoCount < MAX_VIDEOS) videoInputRef.current?.click();
    else onToast?.('warn', refOverflowToast(['video'], { video: MAX_VIDEOS }));
  };

  /** 通用上传（底部加号；首尾帧模式仅收图片且限 2 张） */
  const handleAnyUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    addFiles(e.target.files, 'any');
    e.target.value = '';
  };

  /** 处理图片上传（按接口上限/首尾帧 2 张截断） */
  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    addFiles(e.target.files, 'image');
    if (imageInputRef.current) imageInputRef.current.value = '';
  };

  /** 处理视频上传（首尾帧模式禁用） */
  const handleVideoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (isKeyframe) return;
    addFiles(e.target.files, 'video');
    if (videoInputRef.current) videoInputRef.current.value = '';
  };

  /** 截断文件名用于 chip 展示 */
  const truncateName = (name: string, max = 14) => {
    const dot = name.lastIndexOf('.');
    const base = dot > 0 ? name.slice(0, dot) : name;
    const ext = dot > 0 ? name.slice(dot) : '';
    if (base.length <= max) return name;
    return `${base.slice(0, max)}...${ext}`;
  };

  /** 删除文件（仅本地上传的 objectURL 需要释放） */
  const removeFile = (index: number) => {
    setRefFiles((prev) => {
      const copy = [...prev];
      if (copy[index].file) URL.revokeObjectURL(copy[index].preview);
      copy.splice(index, 1);
      return copy;
    });
    setVideoDurations((prev) => {
      const next: Record<number, number> = {};
      // 删除后重新编号索引
      Object.entries(prev).forEach(([k, v]) => {
        const key = Number(k);
        if (key < index) next[key] = v;
        else if (key > index) next[key - 1] = v;
      });
      return next;
    });
  };

  /** 获取视频文件时长（秒） */
  const getVideoDuration = (file: File): Promise<number> =>
    new Promise((resolve) => {
      const video = document.createElement('video');
      video.preload = 'metadata';
      video.onloadedmetadata = () => {
        resolve(Math.round(video.duration * 10) / 10);
        URL.revokeObjectURL(video.src);
      };
      video.onerror = () => { resolve(0); URL.revokeObjectURL(video.src); };
      video.src = URL.createObjectURL(file);
    });

  /** 将文件列表转为 BottomRefItem[] 并预取视频时长 */
  const addFiles = async (files: FileList | null, acceptType?: 'image' | 'video' | 'any') => {
    if (!files || files.length === 0) return;
    const all = Array.from(files);
    const list = acceptType === 'image'
      ? all.filter((f) => f.type.startsWith('image/')).slice(0, Math.max(0, maxImages - imageCount))
      : acceptType === 'video'
        ? (isKeyframe ? [] : all.filter((f) => f.type.startsWith('video/')).slice(0, Math.max(0, MAX_VIDEOS - videoCount)))
        : (() => {
            let imgRoom = Math.max(0, maxImages - imageCount);
            let vidRoom = Math.max(0, MAX_VIDEOS - videoCount);
            return isKeyframe
              ? all.filter((f) => f.type.startsWith('image/')).slice(0, imgRoom)
              : all.filter((f) => {
                  if (f.type.startsWith('video/')) { if (vidRoom <= 0) return false; vidRoom -= 1; return true; }
                  if (f.type.startsWith('image/')) { if (imgRoom <= 0) return false; imgRoom -= 1; return true; }
                  return false;
                });
          })();
    const acceptedImgs = list.filter((f) => f.type.startsWith('image/')).length;
    const acceptedVids = list.filter((f) => f.type.startsWith('video/')).length;
    const overflows = classifyRefOverflows({
      selectedImages: all.filter((f) => f.type.startsWith('image/')).length,
      selectedVideos: all.filter((f) => f.type.startsWith('video/')).length,
      acceptedImages: acceptedImgs,
      acceptedVideos: acceptedVids,
    });
    if (overflows.length > 0) {
      onToast?.('warn', refOverflowToast(overflows, { image: maxImages, video: MAX_VIDEOS }));
    }
    if (!list.length) return;
    const startIdx = refFiles.length;
    const newItems: BottomRefItem[] = list.map((file) => ({
      file,
      preview: URL.createObjectURL(file),
      type: (file.type.startsWith('video/') ? 'video' : 'image') as 'image' | 'video',
    }));
    setRefFiles((prev) => [...prev, ...newItems]);
    // 预取视频时长
    list.forEach(async (file, i) => {
      if (file.type.startsWith('video/')) {
        const dur = await getVideoDuration(file);
        setVideoDurations((prev) => ({ ...prev, [startIdx + i]: dur }));
      }
    });
  };

  /** 发送：**解引用发生在这一刻**——编辑期胶囊一直是指针，此处才换成完整 prompt
   *  （携带模型/宽高比/清晰度/时长） */
  const handleSend = () => {
    const text = resolveComposed(composed).trim();
    if (!text) return;
    if (!currentModel) {
      console.warn('视频模型能力加载中，请稍后重试');
      return;
    }
    // 首尾帧模式校验：必须恰好 2 张图片
    if (isKeyframe) {
      if (videoCount > 0) {
        onToast?.('warn', '首尾帧模式仅支持上传首帧和尾帧两张图片，不支持视频');
        return;
      }
      if (imageCount !== 2) {
        onToast?.('warn', '首尾帧模式需要上传首帧和尾帧两张图片');
        return;
      }
    }
    const size = currentModel.supported_sizes.find((s) => s.id === selectedSize);
    if (!size) {
      console.warn('视频模型清晰度能力缺失，请稍后重试');
      return;
    }
    onSend(text, {
      modelId: currentModel.model_id,
      aspectRatio: selectedRatio,
      resolution: size.api_value,
      duration,
      mode: selectedMode,
    }, refFiles);
    chipEditorRef.current?.clear();
  };

  return (
    <div className={`${styles.dialog} ${expanded ? styles.dialogExpanded : ''}`}>
      {/* 右上角操作：放大/收起 + 关闭 */}
      <div className={styles.topActions}>
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
      </div>

      {/* 配置面板（展开悬浮于底栏上方） */}
      {showConfig && (
        <div className={styles.configPanel} ref={configPanelRef}>
          {/* 关闭按钮 */}
          <button
            className={styles.configCloseBtn}
            onClick={() => setShowConfig(false)}
            title="关闭"
          >
            <X size={14} strokeWidth={2} />
          </button>
          {/* 模型与质量 */}
          <span className={styles.configLabel}>模型与质量</span>
          <div className={styles.configRow}>
            <div className={styles.selectWrap} ref={modelWrapRef}>
              <button
                className={styles.selectBtn}
                onClick={() => { setModelOpen(!modelOpen); setSizeOpen(false); }}
              >
                <span>{currentModel?.model_label ?? '选择模型'}</span>
                <ChevronDown
                  size={14}
                  strokeWidth={2}
                  className={`${styles.configArrow} ${modelOpen ? styles.configArrowUp : ''}`}
                />
              </button>
              {modelOpen && (
                <div className={styles.selectDropdown}>
                  {modelOptions.map((m) => (
                    <button
                      key={m.key}
                      className={`${styles.selectOption} ${m.key === selectedModel ? styles.selectOptionActive : ''}`}
                      onClick={() => {
                        const gen = modelList.find((x) => x.model_id === m.key);
                        if (gen) applyModelDefaults(gen);
                        setModelOpen(false);
                      }}
                    >
                      {m.label}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className={styles.selectWrap} ref={sizeWrapRef}>
              <button
                className={styles.selectBtn}
                onClick={() => { setSizeOpen(!sizeOpen); setModelOpen(false); }}
              >
                <span>{currentSizeLabel}</span>
                <ChevronDown
                  size={14}
                  strokeWidth={2}
                  className={`${styles.configArrow} ${sizeOpen ? styles.configArrowUp : ''}`}
                />
              </button>
              {sizeOpen && (
                <div className={styles.selectDropdown}>
                  {sizeOptions.map((s) => (
                    <button
                      key={s.key}
                      className={`${styles.selectOption} ${s.key === selectedSize ? styles.selectOptionActive : ''}`}
                      onClick={() => { setSelectedSize(s.key); setSizeOpen(false); }}
                    >
                      {s.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* 时长滑杆（模型能力未加载完时不渲染） */}
          {durationRange && (
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
                onChange={(e) => setDuration(Number(e.target.value))}
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

          {/* 宽高比 */}
          <span className={styles.configLabel}>宽高比</span>
          <div className={styles.ratioGroup}>
            {ratioOptions.map((r) => (
              <button
                key={r}
                className={`${styles.ratioBtn} ${r === selectedRatio ? styles.ratioBtnActive : ''}`}
                onClick={() => setSelectedRatio(r)}
              >
                <RatioIcon ratio={r} />
                <span>{r}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* 顶部媒体行：已上传缩略图 + 上传按钮 + 计数（同一水平行） */}
      <div className={styles.mediaRow}>
        {/* 图片缩略图 */}
        {refFiles.filter((f) => f.type === 'image').map((item, i) => {
          const idx = refFiles.indexOf(item);
          return (
            <div key={`img-${i}`} className={styles.mediaThumb}>
              <img src={item.preview} alt="" className={styles.mediaThumbImg} />
              <button className={styles.mediaThumbRemove} onClick={() => removeFile(idx)} title="移除">
                <X size={10} strokeWidth={2} />
              </button>
            </div>
          );
        })}
        {/* 图片上传按钮（弹菜单：图片上传 / 到节点选择） */}
        {imageCount < maxImages && (
          <div className={styles.sourceWrap} ref={imageSourceRef}>
            <button
              className={`${styles.mediaBtn} ${pickMode === 'image' ? styles.mediaBtnPicking : ''}`}
              onClick={() => setSourceMenuOpen((v) => (v === 'image' ? null : 'image'))}
              title="图片上传 / 到节点选择"
            >
              <Image size={18} strokeWidth={2} />
            </button>
            {sourceMenuOpen === 'image' && (
              <>
                <div className={styles.menuOverlay} onClick={() => setSourceMenuOpen(null)} />
                <div className={styles.sourceMenu}>
                  <button
                    className={styles.sourceMenuItem}
                    onClick={() => { setSourceMenuOpen(null); handleImageClick(); }}
                  >
                    <Upload size={14} strokeWidth={2} />
                    <span>图片上传</span>
                  </button>
                  <button
                    className={styles.sourceMenuItem}
                    onClick={() => { setSourceMenuOpen(null); onPickFromCanvas?.('image'); }}
                  >
                    <MousePointerClick size={14} strokeWidth={2} />
                    <span>到节点选择</span>
                  </button>
                  <button
                    className={styles.sourceMenuItem}
                    onClick={() => { setSourceMenuOpen(null); onOpenCharacterLibrary?.(); }}
                  >
                    <User size={14} strokeWidth={2} />
                    <span>角色库</span>
                  </button>
                </div>
              </>
            )}
          </div>
        )}

        {/* 分隔点 */}
        {((imageCount > 0 || imageCount < maxImages) && (!noVideoMode && (videoCount < MAX_VIDEOS || videoCount > 0))) && (
          <div className={styles.mediaDot} />
        )}

        {/* 视频缩略图（仅全能参考模式） */}
        {!noVideoMode && refFiles.filter((f) => f.type === 'video').map((item, i) => {
          const idx = refFiles.indexOf(item);
          const dur = videoDurations[idx];
          return (
            <div key={`vid-${i}`} className={styles.mediaThumb}>
              <video src={item.preview} className={styles.mediaThumbImg} muted />
              <button className={styles.mediaThumbRemove} onClick={() => removeFile(idx)} title="移除">
                <X size={10} strokeWidth={2} />
              </button>
              {dur ? <span className={styles.mediaDuration}>{dur}s</span> : null}
              <div className={styles.mediaPlayIcon}><Play size={12} fill="#fff" strokeWidth={0} /></div>
            </div>
          );
        })}
        {/* 视频上传按钮（仅全能参考模式） */}
        {!noVideoMode && videoCount < MAX_VIDEOS && (
          <div className={styles.sourceWrap} ref={videoSourceRef}>
            <button
              className={`${styles.mediaBtn} ${pickMode === 'video' ? styles.mediaBtnPicking : ''}`}
              onClick={() => setSourceMenuOpen((v) => (v === 'video' ? null : 'video'))}
              title="视频上传 / 到节点选择"
            >
              <Video size={18} strokeWidth={2} />
            </button>
            {sourceMenuOpen === 'video' && (
              <>
                <div className={styles.menuOverlay} onClick={() => setSourceMenuOpen(null)} />
                <div className={styles.sourceMenu}>
                  <button
                    className={styles.sourceMenuItem}
                    onClick={() => { setSourceMenuOpen(null); handleVideoClick(); }}
                  >
                    <Upload size={14} strokeWidth={2} />
                    <span>视频上传</span>
                  </button>
                  <button
                    className={styles.sourceMenuItem}
                    onClick={() => { setSourceMenuOpen(null); onPickFromCanvas?.('video'); }}
                  >
                    <MousePointerClick size={14} strokeWidth={2} />
                    <span>到节点选择</span>
                  </button>
                  <button
                    className={styles.sourceMenuItem}
                    onClick={() => { setSourceMenuOpen(null); onOpenCharacterLibrary?.(); }}
                  >
                    <User size={14} strokeWidth={2} />
                    <span>角色库</span>
                  </button>
                </div>
              </>
            )}
          </div>
        )}

        {/* 计数 */}
        {refFiles.length > 0 && (
          <span className={styles.fileCount}>
            {isKeyframe ? `${imageCount}/2` : `${refFiles.length}/${maxImages + MAX_VIDEOS}`}
          </span>
        )}
      </div>

      {/* 文件名 chips */}
      {refFiles.length > 0 && (
        <div className={styles.fileChipRow}>
          {refFiles.map((item, idx) => (
            <div key={idx} className={styles.fileChip}>
              {item.type === 'image'
                ? <Image size={12} strokeWidth={2} />
                : <Video size={12} strokeWidth={2} />}
              <span>{item.file ? truncateName(item.file.name) : (item.type === 'image' ? '图片' : '视频')}</span>
              <button
                className={styles.fileChipRemove}
                onClick={() => removeFile(idx)}
                title="移除"
              >
                <X size={10} strokeWidth={2} />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* 隐藏的 file inputs */}
      <input
        ref={imageInputRef}
        type="file"
        accept="image/*"
        multiple
        className={styles.hiddenInput}
        onChange={handleImageUpload}
      />
      <input
        ref={videoInputRef}
        type="file"
        accept="video/*"
        multiple
        className={styles.hiddenInput}
        onChange={handleVideoUpload}
      />
      <input
        ref={anyInputRef}
        type="file"
        accept={
          noVideoMode
            ? 'image/*'
            : imageCount >= maxImages
              ? 'video/*'
              : videoCount >= MAX_VIDEOS
                ? 'image/*'
                : 'image/*,video/*'
        }
        multiple
        className={styles.hiddenInput}
        onChange={handleAnyUpload}
      />

      {/* 输入框：可多次插入生成卡引用胶囊，胶囊跟文字同一行 */}
      <div className={styles.editorWrap}>
        <ChipTextEditor
          ref={chipEditorRef}
          placeholder={
            isKeyframe
              ? '通过直接控制提示词快速生成单段片段。首尾帧模式可上传首帧与尾帧参考（图片最多 2 张）。'
              : `通过直接控制提示词快速生成单段片段。参考图最多 ${maxImages} 张 / 视频最多 ${MAX_VIDEOS} 个。`
          }
          // 超限只提示、不动内容（IKAFSX）。原来这里会 `setText(truncated)`——那是「用纯文本
          // 整体替换编辑器内容」，**所有胶囊当场湮灭、正文被从中间腰斩**，丢的远不止超出的部分。
          // 而这个 1000 本身也是凭空定的：后端不校验 prompt 长度，模型能力接口里也没有这个字段。
          // 拿到模型真实上限之前，它只是个提示，不足以据此删改用户内容。
          onChange={setComposed}
          onSend={handleSend}
          className={styles.editorArea}
        />
      </div>

      {/* 字数统计 */}
      <div className={`${styles.charCount} ${composedCount >= MAX_INPUT ? styles.charCountWarn : ''}`}>
        {composedCount}/{MAX_INPUT}
      </div>

      {/* 底部状态栏 */}
      <div className={styles.bottomBar}>
        {/* 左侧 */}
        <div className={styles.barLeft}>
          {/* 加号上传（已全部达上限时隐藏，杜绝点击后的超限提示） */}
          {(noVideoMode
            ? imageCount < maxImages
            : imageCount < maxImages || videoCount < MAX_VIDEOS) && (
            <button
              className={styles.addBtn}
              onClick={() => anyInputRef.current?.click()}
              title="添加素材"
            >
              <Plus size={14} strokeWidth={2} />
            </button>
          )}

          {/* 模式选择器 */}
          <div className={styles.modeWrap} ref={modeWrapRef}>
            <button
              className={styles.modeBtn}
              onClick={() => setModeOpen(!modeOpen)}
            >
              <span>{currentMode?.label ?? '选择模式'}</span>
              <ChevronDown
                size={12}
                strokeWidth={2}
                className={`${styles.modeArrow} ${modeOpen ? styles.modeArrowUp : ''}`}
              />
            </button>
            {modeOpen && (
              <div className={styles.modeDropdown}>
                {modeOptions.map((opt) => (
                  <button
                    key={opt.key}
                    className={`${styles.modeOption} ${opt.key === selectedMode ? styles.modeOptionActive : ''}`}
                    onClick={() => {
                      if ((opt.key === 'keyframe' || opt.key === 'text2video') && videoCount > 0) {
                        onToast?.('warn', `${opt.key === 'keyframe' ? '首尾帧' : '图生视频'}模式不支持视频参考，请先移除视频文件`);
                        setModeOpen(false);
                        return;
                      }
                      if (opt.key === 'keyframe' && imageCount > 2) {
                        onToast?.('warn', '首尾帧模式仅支持上传 2 张图片，请先移除多余图片');
                        setModeOpen(false);
                        return;
                      }
                      setSelectedMode(opt.key);
                      setModeOpen(false);
                    }}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* 配置信息（点击展开配置面板） */}
          <button className={styles.configBtn} onClick={() => setShowConfig(!showConfig)}>
            <SlidersHorizontal size={14} strokeWidth={2} />
            <span>{currentModel?.model_label ?? '选择模型'}</span>
            <span className={styles.barDivider}>|</span>
            <span>{selectedRatio}</span>
            <span className={styles.barDivider}>|</span>
            <span>{currentSizeLabel}</span>
            <span className={styles.barDivider}>|</span>
            <span>{duration}s</span>
          </button>
        </div>

        {/* 右侧：发送 */}
        <div className={styles.barRight}>
          <button
            className={`${styles.sendBtn} ${canSend && !keyframeInvalid ? styles.sendBtnActive : ''}`}
            onClick={handleSend}
            disabled={!canSend || keyframeInvalid}
            title={keyframeInvalid ? '首尾帧模式需恰好 2 张图片' : '发送'}
          >
            <ArrowUp size={16} fill="currentColor" strokeWidth={0} />
          </button>
        </div>
      </div>
    </div>
  );
}
