import PromptSyncActions from '../PromptSyncActions';
/* ============================================
 * BottomDialog 视频对话窗口：模型/时长/宽高比配置与发送
 * 统一草稿绑定模式：参考由「画布连线 + 草稿 material refs」合并推导（首帧/尾帧/普通参考）。
 * 三类来源菜单：从资产中选择（落画布节点+连线）/ 到节点选择（建线）/ 角色库（入草稿 data）。
 * ============================================ */
import { useState, useRef, useEffect } from 'react';
import {
  ChevronDown,
  ChevronUp,
  X,
  Image,
  Video,
  AudioLines,
  SlidersHorizontal,
  ArrowUp,
  MousePointerClick,
  FolderOpen,
  Maximize2,
  Minimize2,
  User,
} from 'lucide-react';
import { fetchGenerationModels, type GenerationModel } from '@/api/generation';
import { REF_LIMITS } from '@/utils/ref-overflow';
import { useDismissOnOutside } from '../../hooks/useDismissOnOutside';
import ChipTextEditor, { type ChipTextEditorHandle } from '../ChipTextEditor';
import type { ImageTextAttachment } from '../ImageDialog';
import type { MediaGenStatus } from '../MediaNode';
import {
  canAddRefRole,
  MAX_VIDEO_REFS,
  supportsVideoReferenceModel,
  videoRefConflict,
  type VideoMediaRef,
  type VideoMediaRefs,
  type VideoRefCapabilities,
  type VideoRefRole,
} from '../../videoMediaRefs';
import {
  EMPTY_COMPOSED,
  composedIsEmpty,
  composedLength,
  resolveComposed,
  type ComposedValue,
} from '../ChipTextEditor/composed';
import styles from './index.module.css';

/** 模式选项（保留默认 all 以兼容草稿参数契约 draftMode；模式选择器 UI 已随旧自由模式退役） */
const modeOptions = [
  { key: 'all', label: '全能参考' },
  { key: 'keyframe', label: '首尾帧' },
  { key: 'text2video', label: '图生视频' },
];

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

/** 视频草稿面板参数写回补丁（IKDMQS）：字段名对齐草稿节点 data 的持久化键 */
export interface VideoDraftParamsPatch {
  prompt?: string;
  modelId?: string;
  size?: string;
  ratio?: string;
  duration?: number;
  mode?: string;
}

interface BottomDialogProps {
  onClose: () => void;
  onSend: (text: string, opts: VideoGenOptions) => void | Promise<void>;
  /** 初始自由文本（视频节点「重新编辑」带入原提示词） */
  initialText?: string;
  /** 初始生成参数（首页 AI视频 带入：选中首页所选的模型/比例/清晰度/时长/模式） */
  initialParams?: VideoGenSeedParams;
  /** 连线文本附件（IKDLQG）：草稿绑定模式由父级按连线实时推导传入 */
  attachments?: ImageTextAttachment[];
  planReferenceError?: string;
  pendingPlanSyncs?: Array<{ nodeId: string; title: string }>;
  onSyncPlan?: (nodeId: string) => void;
  syncingPlan?: boolean;
  planIndices?: string;
  /** 调整文本附件顺序（IKDLQH）：回调携带重排后来源 nodeId 序列；仅多附件时展示控件，缺省不渲染排序入口 */
  onReorderAttachments?: (orderedNodeIds: string[]) => void;
  /** 到节点选择：进入画布节点选取模式（image 图片节点 / video 视频节点）；
   *  role 为视频草稿目标参考角色（首帧/尾帧显式指定，IKDMQS），缺省普通参考 */
  onPickFromCanvas?: (kind: 'image' | 'video', role?: VideoRefRole) => void;
  /** 从资产中选择：打开资产库选择弹窗（按 kind 过滤媒体类型；role 为目标槽位角色） */
  onPickFromAssets?: (kind: 'image' | 'video', role?: VideoRefRole) => void;
  /** 画布选取模式进行中（image/video，对应按钮高亮提示） */
  pickMode?: 'image' | 'video' | null;
  /** 打开角色库弹窗（role 为目标槽位角色） */
  onOpenCharacterLibrary?: (role?: VideoRefRole) => void;
  /** 视频草稿绑定（IKDMQS）：面板编辑实时写回草稿节点；status 为 generating 时参数与输入只读 */
  videoDraftBinding: {
    status?: MediaGenStatus;
    restoreExisting?: boolean;
    submitting?: boolean;
    saveFailed?: boolean;
    onParamsChange: (patch: VideoDraftParamsPatch) => void;
  };
  /** 合并推导的视频参考分组（连线 + material refs）：参考区按角色渲染 */
  videoMediaRefs: VideoMediaRefs;
  /** 移除某个视频参考：携带来源节点 id，父级断开对应连线 */
  onRemoveVideoRef?: (sourceNodeId: string) => void;
  /** 显式改变参考角色：父级改写连线 edge.data.refRole */
  onSetVideoRefRole?: (sourceNodeId: string, role: VideoRefRole) => void;
  /** 移除角色库 material 参考（materialId，父级从草稿 data.draftMaterialRefs 过滤） */
  onRemoveMaterialRef?: (materialId: string) => void;
  /** 改变角色库 material 参考角色（父级改写草稿 data.draftMaterialRefs 对应项 role） */
  onSetMaterialRefRole?: (materialId: string, role: VideoRefRole) => void;
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

/** 附件正文超过该长度默认折叠（可展开读全） */
const ATTACHMENT_COLLAPSE_LENGTH = 120;

/** 角色徽标文案（IKDMQS 显式角色：用户可见的输入用途） */
const ROLE_LABELS: Record<VideoRefRole, string> = {
  reference: '普通参考',
  first: '首帧',
  last: '尾帧',
};

/** 连线文本附件项（IKDLQG）：标题 + 正文预览，长文默认折叠可展开；与 ImageDialog 附件项同构，
 *  多附件且父级提供重排回调时展示上移/下移（IKDLQH） */
function AttachmentItem({ attachment, move }: {
  attachment: ImageTextAttachment;
  move?: { isFirst: boolean; isLast: boolean; onMove: (delta: -1 | 1) => void };
}) {
  const [expanded, setExpanded] = useState(false);
  const collapsible = attachment.text.length > ATTACHMENT_COLLAPSE_LENGTH;
  return (
    <div className={styles.attachmentItem}>
      <div className={styles.attachmentHead}>
        <span className={styles.attachmentTitle}>{attachment.title}</span>
        {move && (
          <span className={styles.attachmentMoves}>
            <button
              type="button"
              title="上移"
              className={styles.attachmentMove}
              disabled={move.isFirst}
              onClick={() => move.onMove(-1)}
            >
              <ChevronUp size={12} strokeWidth={2} />
            </button>
            <button
              type="button"
              title="下移"
              className={styles.attachmentMove}
              disabled={move.isLast}
              onClick={() => move.onMove(1)}
            >
              <ChevronDown size={12} strokeWidth={2} />
            </button>
          </span>
        )}
      </div>
      <span
        className={`${styles.attachmentText} ${collapsible && !expanded ? styles.attachmentTextCollapsed : ''}`}
      >
        {attachment.text}
      </span>
      {collapsible && (
        <button
          type="button"
          className={styles.attachmentToggle}
          onClick={() => setExpanded((v) => !v)}
        >
          {expanded ? '收起' : '展开'}
        </button>
      )}
    </div>
  );
}

/** 宽高比图标：按比例绘制小矩形 */
function RatioIcon({ ratio }: { ratio: string }) {
  const [w, h] = ratio.split(':').map(Number);
  const max = 16;
  const width = w >= h ? max : Math.round((w / h) * max);
  const height = h >= w ? max : Math.round((h / w) * max);
  return <span className={styles.ratioIcon} style={{ width, height }} />;
}

/** 草稿绑定的参考项缩略图（IKDMQS）：连线推导/角色库 material 项 + 角色徽标 + 移除；
 *  首帧/尾帧项提供「设为普通参考」，普通参考项提供「设为首帧/设为尾帧」（受能力与槽位约束，
 *  槽位不满足时入口不渲染，父级校验兜底并 toast 原因）；
 *  materialId 非空为角色库素材项：移除/改角色走 material 回调（操作草稿 data，非连线） */
function VideoRefThumb({ item, role, readOnly, onRemove, onSetRole, onRemoveMaterial, onSetMaterialRole, firstSlotOpen, lastSlotOpen }: {
  item: VideoMediaRef;
  role: VideoRefRole;
  readOnly: boolean;
  onRemove?: (nodeId: string) => void;
  onSetRole?: (nodeId: string, role: VideoRefRole) => void;
  onRemoveMaterial?: (materialId: string) => void;
  onSetMaterialRole?: (materialId: string, role: VideoRefRole) => void;
  firstSlotOpen: boolean;
  lastSlotOpen: boolean;
}) {
  const isMaterial = item.materialId != null;
  const handleRemove = () => {
    if (isMaterial) onRemoveMaterial?.(item.materialId!);
    else onRemove?.(item.nodeId);
  };
  const handleSetRole = (next: VideoRefRole) => {
    if (isMaterial) onSetMaterialRole?.(item.materialId!, next);
    else onSetRole?.(item.nodeId, next);
  };
  return (
    <div className={styles.mediaThumb} title={item.name} data-testid="dock-video-ref">
      {item.mediaType === 'audio' ? <AudioLines size={24} aria-label={item.name} /> : item.mediaType === 'video'
        ? <video src={item.url} className={styles.mediaThumbImg} muted />
        : <img src={item.url} alt={item.name} className={styles.mediaThumbImg} />}
      {/* 角色徽标：仅首帧/尾帧保留；普通参考不在图片上保留标签 */}
      {role !== 'reference' && (
        <span data-role={role} className={`${styles.refRoleBadge} ${styles.refRoleBadgeFrame}`}>
          {ROLE_LABELS[role]}
        </span>
      )}
      {!readOnly && (
        <>
          <button className={styles.mediaThumbRemove} onClick={handleRemove} title={isMaterial ? '移除' : '移除（断开连线）'}>
            <X size={10} strokeWidth={2} />
          </button>
          {(isMaterial ? onSetMaterialRole : onSetRole) && (
            <span className={styles.refRoleSwitch}>
              {role === 'reference' ? (
                <>
                  {firstSlotOpen && (
                    <button type="button" onClick={() => handleSetRole('first')}>设为首帧</button>
                  )}
                  {lastSlotOpen && (
                    <button type="button" onClick={() => handleSetRole('last')}>设为尾帧</button>
                  )}
                </>
              ) : (
                <button type="button" onClick={() => handleSetRole('reference')}>设为普通参考</button>
              )}
            </span>
          )}
        </>
      )}
    </div>
  );
}

export default function BottomDialog({ onClose, onSend, initialText, initialParams, attachments, pendingPlanSyncs, onSyncPlan, syncingPlan, planReferenceError, planIndices, onReorderAttachments, onPickFromCanvas, onPickFromAssets, pickMode, onOpenCharacterLibrary, videoDraftBinding, videoMediaRefs, onRemoveVideoRef, onSetVideoRefRole, onRemoveMaterialRef, onSetMaterialRefRole, onToast }: BottomDialogProps) {
  /** 富文本输入框（自由文本；胶囊机制保留给后续引用场景，发送时替换成完整 prompt） */
  const chipEditorRef = useRef<ChipTextEditorHandle>(null);
  /** 输入框内容的结构化形态（IKAFSX）：胶囊是指针，解引用只发生在发送那一刻。 */
  const [composed, setComposed] = useState<ComposedValue>(EMPTY_COMPOSED);
  /** 计数口径：文字按字符数，一个胶囊算 1 个单位——不按它背后那几千字算。 */
  const composedCount = composedLength(composed);
  /** 附件正文有效（去空白非空）时允许空提示词提交（IKDLQG 契约：附件可单独驱动生成）；
   *  全部有效文本为空时沿用「提示词必填」 */
  const hasAttachmentText = (attachments ?? []).some((a) => a.text.trim().length > 0);
  /** 附件排序（IKDLQH）：与相邻项交换后把新 nodeId 序列交给父级；列表仍渲染自 props（父级同步同序快照） */
  const handleAttachmentMove = (index: number, delta: -1 | 1) => {
    if (!attachments || !onReorderAttachments) return;
    const ids = attachments.map((a) => a.nodeId);
    const [moved] = ids.splice(index, 1);
    ids.splice(index + delta, 0, moved);
    onReorderAttachments(ids);
  };
  const [selectedMode, setSelectedMode] = useState(modeOptions[0].key);
  const [modeOpen, setModeOpen] = useState(false);
  const [showConfig, setShowConfig] = useState(false);
  /** 放大态：输入区高度占屏幕 2/3；收起回底部默认高度 */
  const [expanded, setExpanded] = useState(false);
  const [modelList, setModelList] = useState<GenerationModel[]>([]);
  const [modelsLoaded, setModelsLoaded] = useState(false);
  const [sending, setSending] = useState(false);
  const sendingRef = useRef(false);
  const [selectedModel, setSelectedModel] = useState('');
  const [selectedSize, setSelectedSize] = useState('');
  /** 比例/时长初始为空/0：接口加载完成后 applyModelDefaults 套用所选模型默认值 */
  const [selectedRatio, setSelectedRatio] = useState('');
  const [duration, setDuration] = useState(0);
  const [modelOpen, setModelOpen] = useState(false);
  const [sizeOpen, setSizeOpen] = useState(false);
  /** 槽位来源菜单（按 kind+role 区分，一次只弹一个）：从资产中选择 / 到节点选择 / 角色库 */
  const [sourceMenuOpen, setSourceMenuOpen] = useState<{ kind: 'image' | 'video'; role: VideoRefRole } | null>(null);
  const modelWrapRef = useRef<HTMLDivElement>(null);
  const sizeWrapRef = useRef<HTMLDivElement>(null);
  const modeWrapRef = useRef<HTMLDivElement>(null);
  const configPanelRef = useRef<HTMLDivElement>(null);
  const sourceMenuRef = useRef<HTMLDivElement>(null);

  useDismissOnOutside([
    { open: modelOpen, ref: modelWrapRef, dismiss: () => setModelOpen(false) },
    { open: sizeOpen, ref: sizeWrapRef, dismiss: () => setSizeOpen(false) },
    { open: modeOpen, ref: modeWrapRef, dismiss: () => setModeOpen(false) },
    { open: sourceMenuOpen !== null, ref: sourceMenuRef, dismiss: () => setSourceMenuOpen(null) },
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

  /** 生成中只读（IKDMQS）：任务执行期间目标参数与输入冻结，保留查看与画布上的取消入口 */
  const readOnly = sending || videoDraftBinding.submitting || videoDraftBinding.status === 'generating';
  /** 草稿绑定参数同步：面板内变更实时写回草稿节点（随画布自动保存持久化） */
  const syncDraftParams = (patch: VideoDraftParamsPatch) => {
    videoDraftBinding.onParamsChange(patch);
  };
  /** 当前模型与视频参考相关的能力位（模型未加载时为 null，约束入口按不可用处理） */
  const caps: VideoRefCapabilities | null = currentModel
    ? {
        firstFrame: currentModel.features.first_frame,
        lastFrame: currentModel.features.last_frame,
        firstLastFrame: currentModel.features.first_last_frame,
        referenceImage: currentModel.features.reference_image,
      }
    : null;
  /** 组合校验（IKDMQS）：与服务端 400 同口径 + 能力位；冲突时明确提示并禁用发送 */
  const referenceConflict = planReferenceError ?? (caps
    ? (videoMediaRefs.reference.filter(r => r.mediaType === 'image').length > (currentModel?.features.max_reference_images ?? 0)
        ? '图片参考超出当前模型上限，请调整引用或模型' : videoMediaRefs.reference.filter(r => r.mediaType === 'audio').length > 3
        ? '最多支持 3 个参考音频' : videoMediaRefs.reference.filter(r => r.mediaType === 'video').length > MAX_VIDEO_REFS
        ? '最多支持 3 个参考视频' : videoRefConflict(videoMediaRefs, caps))
      ?? (!supportsVideoReferenceModel(selectedModel) && videoMediaRefs.reference.some(ref => ref.mediaType !== 'image')
        ? '当前模型不支持视频或音频参考，请更换模型或调整引用' : null)
    : null);
  const modeConflict = selectedMode === 'keyframe' && videoMediaRefs.reference.length > 0
    ? '首尾帧模式不支持普通参考，请调整模式或引用'
    : selectedMode === 'text2video' && videoMediaRefs.reference.some(r => r.mediaType !== 'image')
      ? '图生视频模式不支持视频或音频参考'
      : selectedMode !== 'keyframe' && (videoMediaRefs.first || videoMediaRefs.last)
        ? '当前模式不支持首尾帧，请调整模式或引用' : null;
  const inputConflict = referenceConflict ?? modeConflict;
  const conflict = inputConflict && planIndices ? `方案索引 ${planIndices}：${inputConflict}` : inputConflict;
  const canAddFirst = !!(caps && canAddRefRole('first', videoMediaRefs, caps));
  /** 尾帧占位：首尾帧模式下与首帧并排常显（未填即显示），不依赖模型能力位与是否已有首帧——
   *  模型是否支持尾帧 / 首尾帧组合由 conflict（videoRefConflict）在发送时兜底提示，避免占位缺失导致无法上传尾帧。 */
  const canAddLast = !videoMediaRefs.last;
  const canAddReference = !!caps?.referenceImage;

  /** 参考模式（与首页底部操作同步）：全能参考(all) / 首尾帧(keyframe) / 图生视频(text2video)。
   *  首尾帧模式才展示首帧/尾帧槽（同一行）；其余模式仅展示普通参考；图生视频不收视频参考。 */
  const currentMode = modeOptions.find((m) => m.key === selectedMode);
  const isKeyframe = selectedMode === 'keyframe';
  const isText2Video = selectedMode === 'text2video';
  /** 已连入的视频参考数（切换到首尾帧/图生视频时不兼容，需先移除） */
  const videoRefCount = videoMediaRefs.reference.filter((r) => r.mediaType !== 'image').length;

  /** 切换模式：目标模式与现有参考冲突时明确提示并阻止切换（保证「可见槽 = 实际参考」），否则写回草稿 */
  const handleModeChange = (key: string) => {
    setModeOpen(false);
    if (key === selectedMode) return;
    const hasFrames = !!(videoMediaRefs.first || videoMediaRefs.last);
    const hasRefs = videoMediaRefs.reference.length > 0;
    if (key === 'keyframe') {
      if (hasRefs || videoRefCount > 0) {
        onToast?.('warn', '首尾帧模式仅支持首帧与尾帧，请先移除普通参考');
        return;
      }
    } else {
      if (hasFrames) {
        onToast?.('warn', `${key === 'text2video' ? '图生视频' : '全能参考'}模式不支持首尾帧，请先移除首帧/尾帧`);
        return;
      }
      if (key === 'text2video' && videoRefCount > 0) {
        onToast?.('warn', '图生视频模式不支持视频或音频参考，请先调整引用');
        return;
      }
    }
    setSelectedMode(key);
    syncDraftParams({ mode: key });
  };

  const configurationError = !modelsLoaded ? '正在加载模型配置'
    : !currentModel ? '原生成模型不可用，请重新选择模型'
    : !sizeOptions.some(option => option.key === selectedSize) ? '原分辨率不可用，请重新选择分辨率'
    : !ratioOptions.includes(selectedRatio) ? '原比例不兼容，请重新选择比例'
    : durationRange && (duration < durationRange.min || duration > durationRange.max
      || (duration - durationRange.min) % durationRange.step !== 0)
      ? '原时长不兼容，请重新选择时长'
    : null;
  const canSend = !readOnly && !videoDraftBinding.saveFailed && !configurationError
    && (!composedIsEmpty(composed) || hasAttachmentText);

  /** 时长刻度（min..max 逐 step；模型能力未加载时无刻度） */
  const ticks: number[] = [];
  if (durationRange) {
    for (let v = durationRange.min; v <= durationRange.max; v += durationRange.step) ticks.push(v);
  }

  /** 选中模型后应用其默认清晰度/宽高比/时长，返回实际应用值（供草稿参数同步） */
  const applyModelDefaults = (m: GenerationModel) => {
    setSelectedModel(m.model_id);
    let nextRatio = selectedRatio;
    if (m.supported_aspect_ratios.length) {
      nextRatio =
        m.default_aspect_ratio && m.supported_aspect_ratios.includes(m.default_aspect_ratio)
          ? m.default_aspect_ratio
          : m.supported_aspect_ratios[0];
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
    return { modelId: m.model_id, ratio: nextRatio, size: nextSize, duration: nextDuration };
  };

  // 初始自由文本（视频节点重新编辑带入原提示词）—— 先设文本，再插胶囊，避免覆盖
  useEffect(() => {
    if (initialText) {
      chipEditorRef.current?.setText(initialText);
    }
  }, [initialText]);

  // 加载视频模型能力列表：优先选中首页带入的模型，参数逐项按模型能力校验后应用
  useEffect(() => {
    let active = true;
    fetchGenerationModels('video')
      .then((list) => {
        if (!active) return;
        setModelList(list);
        setModelsLoaded(true);
        // 已有节点配置原样恢复，禁止因模型能力变化自动改写最新编辑。
        if (videoDraftBinding.restoreExisting || initialParams?.modelId) {
          setSelectedModel(initialParams?.modelId ?? '');
          const model = list.find(m => m.model_id === initialParams?.modelId);
          const size = model?.supported_sizes.find(s => s.id === initialParams?.resolution || s.api_value === initialParams?.resolution);
          setSelectedSize(size?.id ?? initialParams?.resolution ?? '');
          setSelectedRatio(initialParams?.aspectRatio ?? '');
          setDuration(initialParams?.duration ?? 0);
          setSelectedMode(initialParams?.mode ?? 'all');
          return;
        }
        if (!list.length) return;
        // IKDMQU Q3：恢复的模型已不可用时明确提示（回退默认，不静默降级），用户调整后再发送
        if (initialParams?.modelId && !list.some((m) => m.model_id === initialParams.modelId)) {
          onToast?.('warn', '原生成模型已不可用，已回退默认模型，请确认后发送');
        }
        const target =
          (initialParams?.modelId && list.find((m) => m.model_id === initialParams.modelId)) ||
          list[0];
        const applied = applyModelDefaults(target);
        // 首页带入参数覆盖默认值（逐项经模型能力校验，不合法项保持该模型默认值）
        const patch: VideoDraftParamsPatch = { ...applied };
        if (initialParams) {
          if (initialParams.aspectRatio && target.supported_aspect_ratios.includes(initialParams.aspectRatio)) {
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
          if (initialParams.mode && modeOptions.some((o) => o.key === initialParams.mode)) {
            setSelectedMode(initialParams.mode);
          }
        }
        // 草稿绑定：把实际生效的完整参数写回草稿节点（含首次默认落值）
        syncDraftParams(patch);
      })
      .catch(() => { if (active) setModelsLoaded(true); });
    return () => { active = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** 编辑器内容变化（IKDMQS 草稿绑定：提示词实时写回草稿节点） */
  const handleComposedChange = (v: ComposedValue) => {
    setComposed(v);
    syncDraftParams({ prompt: resolveComposed(v) });
  };

  /** 发送：**解引用发生在这一刻**——编辑期胶囊一直是指针，此处才换成完整 prompt
   *  （携带模型/宽高比/清晰度/时长）。参考由父级按连线+material refs 合并推导，
   *  组合冲突（帧/参考混用、能力不支持）在此明确提示并阻止提交，不静默丢弃。 */
  const submit = async (text: string, options: VideoGenOptions) => {
    if (sendingRef.current) return;
    sendingRef.current = true;
    setSending(true);
    try {
      await onSend(text, options);
    } finally {
      sendingRef.current = false;
      setSending(false);
    }
  };

  const handleSend = () => {
    if (!canSend) return;
    if (readOnly) return;
    const text = resolveComposed(composed).trim();
    if (!text && !hasAttachmentText) return;
    if (!currentModel) {
      console.warn('视频模型能力加载中，请稍后重试');
      return;
    }
    if (conflict) {
      onToast?.('warn', conflict);
      return;
    }
    const size = currentModel.supported_sizes.find((s) => s.id === selectedSize);
    if (!size) {
      console.warn('视频模型清晰度能力缺失，请稍后重试');
      return;
    }
    void submit(text, {
      modelId: currentModel.model_id,
      aspectRatio: selectedRatio,
      resolution: size.api_value ?? size.id,
      duration,
      mode: selectedMode,
    });
  };

  /** 槽位来源菜单（统一草稿绑定）：按 kind+role 区分目标槽位，一次只弹一个；
   *  三项来源：从资产中选择（落画布节点+连线）/ 到节点选择（建线）/ 角色库（入草稿 data） */
  const renderSourceMenu = (
    kind: 'image' | 'video',
    role: VideoRefRole,
    title: string,
    Icon: typeof Image,
    label?: string,
  ) => {
    const isOpen = sourceMenuOpen?.kind === kind && sourceMenuOpen.role === role;
    return (
      <div className={styles.sourceWrap} ref={isOpen ? sourceMenuRef : undefined}>
        <button
          className={`${styles.mediaBtn} ${pickMode === kind ? styles.mediaBtnPicking : ''}`}
          title={title}
          onClick={() => setSourceMenuOpen(isOpen ? null : { kind, role })}
        >
          {label ? <span className={styles.mediaBtnLabel}>{label}</span> : <Icon size={18} strokeWidth={2} />}
        </button>
        {isOpen && (
          <>
            <div className={styles.menuOverlay} onClick={() => setSourceMenuOpen(null)} />
            <div className={styles.sourceMenu}>
              <button
                className={styles.sourceMenuItem}
                onClick={() => { setSourceMenuOpen(null); onPickFromAssets?.(kind, role); }}
              >
                <FolderOpen size={14} strokeWidth={2} />
                <span>从资产中选择</span>
              </button>
              <button
                className={styles.sourceMenuItem}
                onClick={() => { setSourceMenuOpen(null); onPickFromCanvas?.(kind, role); }}
              >
                <MousePointerClick size={14} strokeWidth={2} />
                <span>到节点选择</span>
              </button>
              <button
                className={styles.sourceMenuItem}
                onClick={() => { setSourceMenuOpen(null); onOpenCharacterLibrary?.(role); }}
              >
                <User size={14} strokeWidth={2} />
                <span>角色库</span>
              </button>
            </div>
          </>
        )}
      </div>
    );
  };

  return (
    <div className={styles.dialogWrap}>
      {/* 配置面板（展开悬浮于底栏上方）：挂在不带 overflow 的定位外壳 .dialogWrap 上，
          脱出 .dialog 滚动框，避免面板顶部被滚动容器裁剪（IKEOLP） */}
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
                disabled={readOnly}
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
                        if (gen) syncDraftParams(applyModelDefaults(gen));
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
                disabled={readOnly}
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
                      onClick={() => {
                        setSelectedSize(s.key);
                        syncDraftParams({ size: s.key });
                        setSizeOpen(false);
                      }}
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
                disabled={readOnly}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  setDuration(v);
                  syncDraftParams({ duration: v });
                }}
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
                disabled={readOnly}
                onClick={() => {
                  setSelectedRatio(r);
                  syncDraftParams({ ratio: r });
                }}
              >
                <RatioIcon ratio={r} />
                <span>{r}</span>
              </button>
            ))}
          </div>
        </div>
      )}

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

      {/* 顶部媒体行（统一草稿绑定：按模式门控展示。「连线 + material」合并推导参考）
          首尾帧模式：首帧 + 尾帧同一行；全能参考/图生视频：普通参考（图生视频不收视频参考）。
          角色由「模式 + 目标槽」决定，不再提供跨模式角色切换（避免槽隐藏后参考丢失）。 */}
      <div className={styles.refRoleArea}>
        {isKeyframe ? (
          <div className={styles.refSlot}>
            {/* 首帧：有图时缩略图（含角色徽标）；无图时占位内展示「首帧」文字 */}
            {videoMediaRefs.first ? (
              <VideoRefThumb
                item={videoMediaRefs.first}
                role="first"
                readOnly={readOnly}
                onRemove={onRemoveVideoRef}
                onRemoveMaterial={onRemoveMaterialRef}
                firstSlotOpen={false}
                lastSlotOpen={false}
              />
            ) : (
              !readOnly && canAddFirst && renderSourceMenu('image', 'first', '添加首帧（从资产中选择 / 到节点选择 / 角色库）', Image, '首帧')
            )}
            {/* 尾帧（与首帧同一行）：有图时缩略图；无图时占位内展示「尾帧」文字 */}
            {videoMediaRefs.last ? (
              <VideoRefThumb
                item={videoMediaRefs.last}
                role="last"
                readOnly={readOnly}
                onRemove={onRemoveVideoRef}
                onRemoveMaterial={onRemoveMaterialRef}
                firstSlotOpen={false}
                lastSlotOpen={false}
              />
            ) : (
              !readOnly && canAddLast && renderSourceMenu('image', 'last', '添加尾帧（从资产中选择 / 到节点选择 / 角色库）', Image, '尾帧')
            )}
          </div>
        ) : (
          <div className={styles.refSlot}>
            {videoMediaRefs.reference.map((r) => (
              <VideoRefThumb
                key={r.materialId ?? r.nodeId}
                item={r}
                role="reference"
                readOnly={readOnly}
                onRemove={onRemoveVideoRef}
                onSetRole={onSetVideoRefRole}
                onRemoveMaterial={onRemoveMaterialRef}
                onSetMaterialRole={onSetMaterialRefRole}
                firstSlotOpen={false}
                lastSlotOpen={false}
              />
            ))}
            {!readOnly && canAddReference && (
              <>
                {renderSourceMenu('image', 'reference', '添加图片参考（从资产中选择 / 到节点选择 / 角色库）', Image)}
                {!isText2Video && renderSourceMenu('video', 'reference', '添加视频参考（从资产中选择 / 到节点选择 / 角色库）', Video)}
              </>
            )}
            {videoMediaRefs.reference.length > 0 && (
              <span className={styles.fileCount}>
                {videoMediaRefs.reference.length}/{REF_LIMITS.image + MAX_VIDEO_REFS}
              </span>
            )}
          </div>
        )}
        {videoMediaRefs.invalid?.map((ref) => (
          <div key={ref.nodeId} className={styles.refConflictHint} role="alert">
            {ref.role === 'first' ? '首帧' : ref.role === 'last' ? '尾帧' : '普通参考'}：{ref.name} — {ref.reason}
            <button
              type="button"
              disabled={readOnly}
              aria-label={`移除失效引用 ${ref.name}`}
              onClick={() => (ref.materialId != null ? onRemoveMaterialRef?.(ref.materialId) : onRemoveVideoRef?.(ref.nodeId))}
            >移除引用</button>
          </div>
        ))}
        {/* 组合冲突提示（IKDMQS）：明确说明不可提交的原因，不静默丢弃 */}
        {conflict && <div className={styles.refConflictHint} role="alert">{conflict}</div>}
        {readOnly && <div className={styles.readOnlyHint}>{sending || videoDraftBinding.submitting ? '正在保存并提交，参数与连线只读' : '生成中，参数与连线只读；可在画布卡片上取消生成'}</div>}
      </div>

      {/* 连线文本附件（IKDLQG）：只读展示，增删通过画布连线建立/断开进行；多附件可上移/下移排序（IKDLQH） */}
      {attachments && attachments.length > 0 && (
        <div className={styles.attachments}>
          <span className={styles.configLabel}>文本附件（{attachments.length}）</span>
          {attachments.map((a, i) => (
            <AttachmentItem
              key={a.nodeId}
              attachment={a}
              move={
                !readOnly && onReorderAttachments && attachments.length > 1
                  ? {
                      isFirst: i === 0,
                      isLast: i === attachments.length - 1,
                      onMove: (delta) => handleAttachmentMove(i, delta),
                    }
                  : undefined
              }
            />
          ))}
        </div>
      )}

      <PromptSyncActions plans={pendingPlanSyncs} disabled={readOnly || syncingPlan} onSync={onSyncPlan} />
      {configurationError && <div className={styles.refConflictHint} role="alert">{configurationError}</div>}

      {/* 输入框：胶囊跟文字同一行 */}
      <div className={styles.editorWrap}>
        <ChipTextEditor
          ref={chipEditorRef}
          placeholder="描述你希望生成的视频。参考素材从画布连入或到节点选择，首帧/尾帧需显式指定。"
          // 超限只提示、不动内容（IKAFSX）。原来这里会 `setText(truncated)`——那是「用纯文本
          // 整体替换编辑器内容」，**所有胶囊当场湮灭、正文被从中间腰斩**，丢的远不止超出的部分。
          // 而这个 1000 本身也是凭空定的：后端不校验 prompt 长度，模型能力接口里也没有这个字段。
          // 拿到模型真实上限之前，它只是个提示，不足以据此删改用户内容。
          onChange={handleComposedChange}
          readOnly={readOnly}
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
          {/* 模式选择器（与首页底部操作同步：全能参考 / 首尾帧 / 图生视频） */}
          <div className={styles.modeWrap} ref={modeWrapRef}>
            <button
              className={styles.modeBtn}
              disabled={readOnly}
              onClick={() => setModeOpen((v) => !v)}
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
                    onClick={() => handleModeChange(opt.key)}
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
            data-testid="video-send"
            className={`${styles.sendBtn} ${canSend && !readOnly && !conflict ? styles.sendBtnActive : ''}`}
            onClick={handleSend}
            disabled={!canSend || readOnly || !!conflict}
            title={conflict ?? (readOnly ? '生成中，输入只读' : '发送')}
          >
            <ArrowUp size={16} fill="currentColor" strokeWidth={0} />
          </button>
        </div>
      </div>
      </div>
    </div>
  );
}
