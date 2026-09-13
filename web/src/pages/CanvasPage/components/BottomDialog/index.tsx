import PromptSyncActions from '../PromptSyncActions';
/* ============================================
 * BottomDialog 视频对话窗口：模型/时长/宽高比配置与发送
 * 统一草稿绑定模式：参考由「画布连线 + 草稿 material refs」合并推导（首帧/尾帧/普通参考）。
 * 三类来源菜单：从资产中选择（落画布节点+连线）/ 到节点选择（建线）/ 角色库（入草稿 data）。
 * IKFA1O：正文编辑接入 PromptRefEditor——图片/视频/音频以稳定身份插入正文标签，
 * 首尾帧按角色显示，普通参考按同类型编号；模式不兼容时标签失效并阻止发送。
 * ============================================ */
import { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import {
  ChevronDown,
  X,
  Image,
  Video,
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
import {
  docHasAnyRef,
  docHasInvalidRef,
  flattenPromptDocWith,
  PROMPT_DOC_VERSION,
  textRefLabelOf,
  type PromptDoc,
  type PromptRefKey,
  type StoredPromptDoc,
} from '@/lib/prompt-doc';
import PromptRefEditor, {
  type MentionState,
  type PromptRefEditorHandle,
} from '../PromptRefEditor';
import MentionMenu from '../PromptRefEditor/MentionMenu';
import ReplaceRefMenu from '../PromptRefEditor/ReplaceRefMenu';
import RefThumbnail from '../RefThumbnail';
import { refIdOf, videoLabelMapOf } from '../../videoPromptRefs';
import type { ImageTextAttachment } from '../ImageDialog';
import type { MediaGenStatus } from '../MediaNode';
import {
  canAddRefRole,
  hasAnyMediaRef,
  MAX_VIDEO_REFS,
  supportsVideoReferenceModel,
  videoRefConflict,
  type VideoMediaRef,
  type VideoMediaRefs,
  type VideoRefCapabilities,
  type VideoRefRole,
} from '../../videoMediaRefs';
import AtMentionMenu from '../AtMentionMenu';
import { type AtMentionItem } from '../../atMention';
import {
  VIDEO_FOLLOW_MODE_LABEL,
  VIDEO_FOLLOW_MODE_ORDER,
  firstEnabledVideoMode,
  type FollowDialogAnchor,
  type VideoFollowMode,
} from '../../followDialog';
import styles from './index.module.css';

/** 模式选项：自由态与跟随态同构四项（IKFC1T 文生视频置首 = 新建默认）；跟随态由 enabledModes 门控 */
const dockModeOptions = [
  { key: 'prompt', label: '文生视频' },
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
  /** 参考模式：prompt 文生视频 / all 全能参考 / keyframe 首尾帧 / text2video 图生视频（IKFC1T） */
  mode: string;
}

/** 视频草稿面板参数写回补丁（IKDMQS）：字段名对齐草稿节点 data 的持久化键 */
export interface VideoDraftParamsPatch {
  prompt?: string;
  /** IKFA1O：结构化正文与拍平镜像双写（防丢失，同生图契约） */
  promptDoc?: StoredPromptDoc;
  modelId?: string;
  size?: string;
  ratio?: string;
  duration?: number;
  mode?: string;
}

interface BottomDialogProps {
  onClose: () => void;
  /** 发送：提示词（拍平镜像）+ 参数 + 结构化正文（含素材标签时携带，IKFA1O） */
  onSend: (text: string, opts: VideoGenOptions, promptDoc?: PromptDoc | null) => void | Promise<void>;
  /** 初始自由文本（视频节点「重新编辑」带入原提示词） */
  initialText?: string;
  /** 初始结构化正文（IKFA1O 草稿恢复）：携带时优先于 initialText */
  initialDoc?: PromptDoc | null;
  /** 初始生成参数（首页 AI视频 带入：选中首页所选的模型/比例/清晰度/时长/模式） */
  initialParams?: VideoGenSeedParams;
  /** 连线文本附件（IKDLQG）：草稿绑定模式由父级按连线实时推导传入 */
  attachments?: ImageTextAttachment[];
  onRemovePlan?: (nodeId: string) => void;
  planReferenceError?: string;
  pendingPlanSyncs?: Array<{ nodeId: string; title: string }>;
  onSyncPlan?: (nodeId: string) => void;
  syncingPlan?: boolean;
  planIndices?: string;
  /** 调整文本附件顺序（IKDLQH）：回调携带重排后来源 nodeId 序列。
   *  IKFCKQ 起无 UI 消费（上移/下移随独立文本附件区块下线），排序能力由 T5 拖拽切片承接 */
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
  /** 显式改变参考角色：父级改写连线 edge.data.refRole。
   *  IKFCKQ 起无 UI 消费（角色切换入口随自绘 VideoRefThumb 下线，该 UI 在下线前也从不渲染），待 T5 拖拽切片定稿时一并处置 */
  onSetVideoRefRole?: (sourceNodeId: string, role: VideoRefRole) => void;
  /** 移除角色库 material 参考（materialId，父级从草稿 data.draftMaterialRefs 过滤） */
  onRemoveMaterialRef?: (materialId: string) => void;
  /** 改变角色库 material 参考角色（父级改写草稿 data.draftMaterialRefs 对应项 role）。
   *  IKFCKQ 起无 UI 消费（同 onSetVideoRefRole），待 T5 拖拽切片定稿时一并处置 */
  onSetMaterialRefRole?: (materialId: string, role: VideoRefRole) => void;
  /** Toast 提示（上传超限/首尾帧校验等场景，由父级注入全局 sonner，位置/样式与 ImageDialog/AudioDialog 统一） */
  onToast?: (type: 'success' | 'error' | 'warn', msg: string) => void;
  /** 画布 @ 引用候选 */
  mentionItems?: AtMentionItem[];
  /** 选中 @ 素材后写入参考区 */
  onMentionCanvas?: (item: AtMentionItem) => void;
  /** 绑定生成节点时悬浮跟随；缺省仍锚定底部 */
  followAnchor?: FollowDialogAnchor | null;
  /** 跟随节点时按已连素材给出可高亮模式；缺省不限制 */
  enabledModes?: VideoFollowMode[];
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
  /** 参考模式：prompt 文生视频 / all 全能参考 / keyframe 首尾帧 / text2video 图生视频（IKFC1T） */
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

export default function BottomDialog({ onClose, onSend, initialText, initialDoc, initialParams, attachments, onRemovePlan, pendingPlanSyncs, onSyncPlan, syncingPlan, planReferenceError, planIndices, onPickFromCanvas, onPickFromAssets, pickMode, onOpenCharacterLibrary, videoDraftBinding, videoMediaRefs, onRemoveVideoRef, onRemoveMaterialRef, onToast, mentionItems: canvasMentionItems, onMentionCanvas, followAnchor, enabledModes }: BottomDialogProps) {
  /** 结构化正文（IKFA1O）：文字与素材标签的片段序列；标签绑定稳定身份，文案按当前参考+模式派生 */
  const [promptDoc, setPromptDoc] = useState<PromptDoc>(() =>
    initialDoc ?? { version: PROMPT_DOC_VERSION, segments: initialText ? [{ kind: 'text' as const, text: initialText }] : [] },
  );
  const editorRef = useRef<PromptRefEditorHandle>(null);
  const mentionAnchorRef = useRef<HTMLDivElement>(null);
  /** @ 菜单状态（已引用 + 添加新参考） */
  const [mention, setMention] = useState<MentionState>({ open: false, query: '' });
  const [mentionIndex, setMentionIndex] = useState(0);
  /** 画布素材二级菜单（已引用之外的新素材经画布选取加入参考后插标签） */
  const [canvasMentionOpen, setCanvasMentionOpen] = useState(false);
  /** 失效标签替换菜单（IKFA1O 复用 IKFA1N 交互）：记录发起点击的标签节点 key */
  const [replaceTarget, setReplaceTarget] = useState<string | null>(null);
  const mentionMenuRef = useRef<HTMLDivElement>(null);
  const replaceMenuRef = useRef<HTMLDivElement>(null);
  /** 附件正文有效（去空白非空）时允许空提示词提交（IKDLQG 契约：附件可单独驱动生成）；
   *  全部有效文本为空时沿用「提示词必填」 */
  const hasAttachmentText = (attachments ?? []).some((a) => a.text.trim().length > 0);
  const followModeOptions = VIDEO_FOLLOW_MODE_ORDER.map((key) => ({
    key,
    label: VIDEO_FOLLOW_MODE_LABEL[key],
  }));
  const modeOptions = enabledModes ? followModeOptions : dockModeOptions;
  const [selectedMode, setSelectedMode] = useState(
    initialParams?.mode && modeOptions.some((item) => item.key === initialParams.mode)
      ? initialParams.mode
      : modeOptions[0].key,
  );
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

  useEffect(() => {
    if (!enabledModes || enabledModes.length === 0) return;
    if (enabledModes.includes(selectedMode as VideoFollowMode)) return;
    const next = firstEnabledVideoMode(enabledModes);
    setSelectedMode(next);
    syncDraftParams({ mode: next });
    onToast?.('warn', '已根据当前素材切换生成模式');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabledModes, selectedMode]);
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
  const modeConflict = selectedMode === 'prompt' && hasAnyMediaRef(videoMediaRefs)
    ? '文生视频模式不支持媒体参考，请移除参考或切换模式'
    : selectedMode === 'keyframe' && videoMediaRefs.reference.length > 0
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

  /** 参考模式（与首页底部操作同步）：文生视频(prompt) / 全能参考(all) / 首尾帧(keyframe) / 图生视频(text2video)。
   *  首尾帧模式才展示首帧/尾帧槽（同一行）；其余模式仅展示普通参考；图生视频不收视频参考；
   *  文生视频保留参考添加入口（媒体实际成为参考时由 enabledModes 自动切全能参考，IKFC1T）。 */
  const currentMode = modeOptions.find((m) => m.key === selectedMode);
  const isKeyframe = selectedMode === 'keyframe';
  const isText2Video = selectedMode === 'text2video';
  /** 已连入的视频参考数（切换到首尾帧/图生视频时不兼容，需先移除） */
  const videoRefCount = videoMediaRefs.reference.filter((r) => r.mediaType !== 'image').length;

  /** IKFA1O 标签映射（唯一口径）：附件区徽标、@ 菜单、正文标签、发送拍平共用。
   *  首尾帧按角色；普通参考按同类型编号；模式不接受的参考身份 → labelOf null（失效，C2/C5）。
   *  IKFA1P：文本附件并入同一映射（编号跟附件顺序 = 画布连入边序，与服务端 text_attachments 同源）。
   *  IKFCKQ：numberMap 为普通参考的同类型数字编号（缩略图圆钮与 label 同源派生）。 */
  const { labelOf: mediaLabelOf, refItems, numberMap: refNumberMap } = useMemo(() => videoLabelMapOf(videoMediaRefs, selectedMode), [videoMediaRefs, selectedMode]);
  const orderedTextNodeIds = useMemo(() => (attachments ?? []).map((a) => a.nodeId), [attachments]);
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
  /** 拍平镜像（IKFA1O/IKFA1P）：字数统计与发送门槛共用；失效标签 → 已失效：原N */
  const flatValue = useMemo(() => flattenPromptDocWith(promptDoc, (key) => refLabelOfStable.current(key)), [promptDoc, reconcileKey]);
  /** 失效标签存在时阻止生成（模式不兼容或参考移除；点击替换/删除后可继续） */
  const hasInvalidRef = docHasInvalidRef(promptDoc);

  /** 切换模式：目标模式与现有参考冲突时明确提示并阻止切换（保证「可见槽 = 实际参考」），否则写回草稿。
   *  IKFC1T：文生视频在存在任一媒体参考（含首尾帧）时不可选（enabledModes 门控置灰，此处兜底）。 */
  const handleModeChange = (key: string) => {
    setModeOpen(false);
    if (enabledModes && !enabledModes.includes(key as VideoFollowMode)) return;
    if (key === selectedMode) return;
    const hasFrames = !!(videoMediaRefs.first || videoMediaRefs.last);
    const hasRefs = videoMediaRefs.reference.length > 0;
    if (key === 'prompt') {
      if (hasAnyMediaRef(videoMediaRefs)) {
        onToast?.('warn', '文生视频模式不支持媒体参考，请先移除参考');
        return;
      }
    } else if (key === 'keyframe') {
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
    : hasInvalidRef ? '正文有已失效的素材标签，请点击标签替换或删除后再发送'
    : null;
  const canSend = !readOnly && !videoDraftBinding.saveFailed && !configurationError
    && (flatValue.trim().length > 0 || hasAttachmentText);

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

  // 初始自由文本（视频节点重新编辑带入原提示词）：initialDoc 优先（草稿恢复），纯文本兜底
  // （PromptRefEditor 经 initialDoc/initialText 初始化，无需命令式 setText）

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
          setSelectedMode(initialParams?.mode ?? 'prompt');
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

  /** 提交防线（发送中防重入） */
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

  /** 编辑器内容变化（IKFA1O 结构化正文）：同步拍平镜像与结构（双写防丢失），失效/文案随 reconcile 落草稿 */
  const handleDocChange = (doc: PromptDoc) => {
    setPromptDoc(doc);
    pendingNewRefInsert.current = false;
    const flat = flattenPromptDocWith(doc, (key) => refLabelOfStable.current(key));
    syncDraftParams({ prompt: flat, promptDoc: { version: PROMPT_DOC_VERSION, segments: doc.segments, flat } });
  };

  /** 发送：携带模型/宽高比/清晰度/时长与结构化正文（含素材标签时，IKFA1O）。
   *  参考由父级按连线+material refs 合并推导，组合冲突（帧/参考混用、能力不支持、
   *  失效标签）在此明确提示并阻止提交，不静默丢弃。 */
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
    }, docHasAnyRef(promptDoc) ? promptDoc : null);
  };

  /** @ 菜单：已引用项按查询过滤（名称/标签可搜索）；项 = 当前模式下有效的参考（帧+普通） */
  const mentionQueryText = mention.open ? mention.query.trim().toLowerCase() : '';
  const mentionItems = useMemo(() => {
    const out: Array<{ assetId: string; url: string; name: string; badge: string; mediaType: 'image' | 'video' | 'audio' | 'text' }> = [];
    for (const item of [videoMediaRefs.first, videoMediaRefs.last, ...videoMediaRefs.reference]) {
      if (!item) continue;
      const id = refIdOf(item);
      const badge = labelOfStable.current(id);
      if (!badge) continue; // 模式不接受或身份失效：不提供插入（不留下伪有效标签）
      out.push({ assetId: id, url: item.url, name: item.name, badge, mediaType: item.mediaType });
    }
    // IKFA1P：文本附件项（编号跟附件顺序，与服务端 text_attachments 同源）
    for (let i = 0; i < (attachments ?? []).length; i += 1) {
      const a = attachments![i]!;
      out.push({ assetId: a.nodeId, url: '', name: a.title, badge: `文本${i + 1}`, mediaType: 'text' });
    }
    return out.filter((r) => !mentionQueryText || r.name.toLowerCase().includes(mentionQueryText) || r.badge.includes(mentionQueryText));
  }, [videoMediaRefs, attachments, mentionQueryText, reconcileKey]);
  const closeMention = () => {
    editorRef.current?.dismissMention();
    setMention({ open: false, query: '' });
    setCanvasMentionOpen(false);
  };
  const pickMentionRef = (assetId: string) => {
    // IKFA1P：文本身份（来源节点 id）与媒体身份空间不重叠——按当前附件集合分派标签类型
    editorRef.current?.insertRefAtMention(refKeyOf(assetId));
    setMention({ open: false, query: '' });
  };

  /** 寻址键分派（IKFA1P 唯一口径）：文本附件来源节点 id → text_ref，其余 → asset_ref */
  const refKeyOf = (assetId: string): PromptRefKey => ({
    kind: orderedTextNodeIds.includes(assetId) ? 'text_ref' : 'asset_ref',
    id: assetId,
  });

  /** 缩略图 @ 按钮（IKFCKQ）：与手动 @ 选择同一插入机制（insertRefAtPending 记忆光标路径）——
   *  有记忆光标原位插入、无记录追加末尾，插入后编辑器聚焦 */
  const insertRefByKey = (assetId: string) => {
    editorRef.current?.insertRefAtPending(refKeyOf(assetId));
  };

  /** 添加新参考入口（IKFA1O A3/A5）：按模式给出目标槽位的细分入口；
   *  达上限或只读不提供（校验拒绝则参考集合不变、不插入标签） */
  const pendingNewRefInsert = useRef(false);
  const pickMentionNewRef = (kind: 'image' | 'video', role: VideoRefRole, source: 'assets' | 'canvas') => {
    editorRef.current?.consumeMentionForPendingInsert();
    pendingNewRefInsert.current = true;
    setMention({ open: false, query: '' });
    if (source === 'assets') onPickFromAssets?.(kind, role);
    else onPickFromCanvas?.(kind, role);
  };
  /** @ 菜单添加新参考的细分入口（按模式与类型；上限复用 dock 添加判定） */
  const mentionNewRefEntries = useMemo(() => {
    if (readOnly) return [];
    const entries: Array<{ key: string; label: string; icon: 'folder' | 'pointer'; onPick: () => void }> = [];
    const push = (kind: 'image' | 'video', role: VideoRefRole, labelPrefix: string) => {
      entries.push(
        { key: `${labelPrefix}-assets`, label: `从资产中选择${labelPrefix}`, icon: 'folder', onPick: () => pickMentionNewRef(kind, role, 'assets') },
        { key: `${labelPrefix}-canvas`, label: `到节点选择${labelPrefix}`, icon: 'pointer', onPick: () => pickMentionNewRef(kind, role, 'canvas') },
      );
    };
    if (isKeyframe) {
      if (!videoMediaRefs.first && canAddFirst) push('image', 'first', '首帧');
      if (!videoMediaRefs.last && canAddLast) push('image', 'last', '尾帧');
    } else {
      if (canAddReference) push('image', 'reference', '图片参考');
      if (canAddReference && !isText2Video) push('video', 'reference', '视频参考');
    }
    return entries;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [readOnly, isKeyframe, isText2Video, canAddFirst, canAddLast, canAddReference, videoMediaRefs.first, videoMediaRefs.last]);

  const handleMentionKey = (key: 'down' | 'up' | 'enter' | 'escape'): boolean => {
    if (!mention.open) return false;
    if (key === 'escape') {
      closeMention();
      return true;
    }
    const total = mentionItems.length + mentionNewRefEntries.length;
    if (total === 0) return false;
    if (key === 'down') setMentionIndex((i) => (i + 1) % total);
    else if (key === 'up') setMentionIndex((i) => (i - 1 + total) % total);
    else if (key === 'enter') {
      if (mentionIndex < mentionItems.length) pickMentionRef(mentionItems[mentionIndex].assetId);
      else mentionNewRefEntries[mentionIndex - mentionItems.length]?.onPick();
    }
    return true;
  };

  /** 新参考添加成功检测：有效身份集合出现新增 → 在记住的插入点落标签（A3；IKFA1P 含新文本附件连入） */
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
    // IKFA1P：画布新文本节点建连线成为附件 → 同一插入点落文本标签
    const addedText = orderedTextNodeIds.filter((id) => !prevText.includes(id));
    if (addedText.length > 0) {
      pendingNewRefInsert.current = false;
      editorRef.current?.insertRefAtPending({ kind: 'text_ref', id: addedText[addedText.length - 1] });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reconcileKey, orderedTextNodeIds]);

  useDismissOnOutside([
    { open: mention.open && !canvasMentionOpen, ref: mentionMenuRef, dismiss: () => closeMention() },
    { open: replaceTarget !== null, ref: replaceMenuRef, dismiss: () => setReplaceTarget(null) },
  ]);

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

  /** IKFCKQ 参考缩略图接入共享组件：× 走「断开引用、保留来源」既有链路
   *  （连线项断开连线 / 角色库项移除草稿 material 参考），@ 复用记忆光标插入且仅对
   *  标签有效身份开放（与 @ 菜单同口径，不留下伪有效标签）；首帧/尾帧按角色徽标、
   *  普通参考按同类型编号（与正文标签同源 numberMap），三态交互与放大预览由组件承载 */
  const renderRefThumb = (item: VideoMediaRef, key?: string, badgeText?: string) => (
    <RefThumbnail
      key={key}
      data-testid="dock-video-ref"
      kind={item.mediaType}
      url={item.url}
      name={item.name}
      badgeText={badgeText}
      number={refNumberMap.get(refIdOf(item))}
      audioDuration={item.duration}
      onRemove={!readOnly
        ? () => (item.materialId != null ? onRemoveMaterialRef?.(item.materialId) : onRemoveVideoRef?.(item.nodeId))
        : undefined}
      onInsertRef={!readOnly && refLabels.has(refIdOf(item)) ? () => insertRefByKey(refIdOf(item)) : undefined}
    />
  );

  /** IKFCKQ 文本附件进参考栏：FileText 图标缩略图 + 文本N 独立编号 + 悬停 ×/@ 与正文预览；
   *  × 沿用方案附件既有移除链路（普通文本附件增删经画布连线，素材同步期间禁移除）；
   *  附件顺序仍决定生成上下文拼接顺序（拖拽换位随 T5 切片落） */
  const textThumbs = (attachments ?? []).map((a, i) => (
    <RefThumbnail
      key={a.nodeId}
      data-testid="dock-text-ref"
      kind="text"
      name={a.title}
      number={i + 1}
      textPreview={a.text}
      onRemove={
        !readOnly && !syncingPlan && a.isPromptPlan && onRemovePlan
          ? () => onRemovePlan(a.nodeId)
          : undefined
      }
      onInsertRef={!readOnly ? () => insertRefByKey(a.nodeId) : undefined}
    />
  ));

  return (
    <div
      className={`${styles.dialogWrap} ${followAnchor ? styles.dialogWrapFollow : ''}`}
      style={followAnchor ? { left: followAnchor.left, top: followAnchor.top } : undefined}
    >
      {/* @ 菜单（IKFA1O）：挂 .dialogWrap 层向上弹出（.dialog 滚动框会裁剪浮层）；
          顶部已引用（当前模式允许的图片/视频/音频），下方添加新参考细分入口，
          再下「引用画布素材」二级菜单（新素材经画布选取加参考后插标签） */}
      {mention.open && !readOnly && (
        <div className={styles.mentionDock} ref={mentionMenuRef}>
          <MentionMenu
            items={mentionItems}
            activeIndex={mentionIndex}
            newRefEntries={mentionNewRefEntries}
            onPick={pickMentionRef}
            onHoverIndex={setMentionIndex}
          />
          {onMentionCanvas && !canvasMentionOpen && (
            <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => setCanvasMentionOpen(true)}>引用画布素材</button>
          )}
          {canvasMentionOpen && onMentionCanvas && (
            <AtMentionMenu
              anchorRef={mentionMenuRef}
              items={canvasMentionItems ?? []}
              editorQuery={mention.query}
              onSelect={(item) => {
                const id = item.assetId ?? '';
                if (id && refLabels.has(id)) {
                  // 已在参考区：直接插标签（多次提及不重复添加输入）
                  pickMentionRef(id);
                } else if (item.kind === 'text' && orderedTextNodeIds.includes(item.id)) {
                  // IKFA1P：已在附件中的文本 → 直接插标签（多次提及不重复建连线）
                  pickMentionRef(item.id);
                } else {
                  // 新素材：加入参考（父级建立连线/暂存），添加成功后经 pendingInsert 落标签；
                  // IKFA1P：新文本走画布连线添加附件（pendingInsert 含文本检测）
                  editorRef.current?.consumeMentionForPendingInsert();
                  pendingNewRefInsert.current = true;
                  setMention({ open: false, query: '' });
                  onMentionCanvas(item);
                }
                setCanvasMentionOpen(false);
              }}
              onClose={() => setCanvasMentionOpen(false)}
            />
          )}
        </div>
      )}
      {/* 失效标签替换菜单（IKFA1O 复用 IKFA1N 交互）：选择后仅替换发起点击的那次提及 */}
      {replaceTarget !== null && (
        <div className={styles.mentionDock} ref={replaceMenuRef}>
          <ReplaceRefMenu
            items={mentionItems}
            onPick={(assetId) => {
              // IKFA1P：失效文本标签可替换为其他文本附件或媒体（按身份空间分派）
              editorRef.current?.replaceRefAt(replaceTarget, refKeyOf(assetId));
              setReplaceTarget(null);
            }}
          />
        </div>
      )}
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
            {/* 首帧：有图时共享缩略图（角色徽标「首帧」）；无图时占位内展示「首帧」文字 */}
            {videoMediaRefs.first ? (
              renderRefThumb(videoMediaRefs.first, undefined, '首帧')
            ) : (
              !readOnly && canAddFirst && renderSourceMenu('image', 'first', '添加首帧（从资产中选择 / 到节点选择 / 角色库）', Image, '首帧')
            )}
            {/* 尾帧（与首帧同一行）：有图时共享缩略图；无图时占位内展示「尾帧」文字 */}
            {videoMediaRefs.last ? (
              renderRefThumb(videoMediaRefs.last, undefined, '尾帧')
            ) : (
              !readOnly && canAddLast && renderSourceMenu('image', 'last', '添加尾帧（从资产中选择 / 到节点选择 / 角色库）', Image, '尾帧')
            )}
            {textThumbs}
          </div>
        ) : (
          <div className={styles.refSlot}>
            {videoMediaRefs.reference.map((r) => renderRefThumb(r, r.materialId ?? r.nodeId))}
            {textThumbs}
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

      <PromptSyncActions plans={pendingPlanSyncs} disabled={readOnly || syncingPlan} onSync={onSyncPlan} />
      {configurationError && <div className={styles.refConflictHint} role="alert">{configurationError}</div>}

      {/* 输入框（IKFA1O 结构化正文）：任意光标处输入 @ 插入已引用素材标签；标签绑定稳定身份 */}
      <div className={styles.editorWrap} ref={mentionAnchorRef}>
        <PromptRefEditor
          ref={editorRef}
          initialDoc={initialDoc ?? null}
          initialText={initialText ?? ''}
          placeholder="描述你希望生成的视频。输入 @ 可引用已选素材。"
          readOnly={readOnly}
          labelOf={(key) => refLabelOfStable.current(key)}
          reconcileKey={reconcileKey}
          labels={refLabels}
          refsMeta={refsMeta}
          onChange={handleDocChange}
          onMentionChange={(state) => {
            setMention(state);
            if (state.open) setMentionIndex(0);
          }}
          onInvalidTagClick={readOnly ? undefined : (nodeKey) => setReplaceTarget(nodeKey)}
          onMentionKey={handleMentionKey}
          className={styles.editorArea}
        />
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
                {modeOptions.map((opt) => {
                  const disabled = Boolean(enabledModes && !enabledModes.includes(opt.key as VideoFollowMode));
                  return (
                    <button
                      key={opt.key}
                      type="button"
                      disabled={disabled}
                      className={`${styles.modeOption} ${opt.key === selectedMode ? styles.modeOptionActive : ''} ${disabled ? styles.modeOptionDisabled : ''}`}
                      onClick={() => handleModeChange(opt.key)}
                    >
                      {opt.label}
                    </button>
                  );
                })}
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
          {/* 字数统计 */}
          <div className={`${styles.charCount} ${flatValue.length >= MAX_INPUT ? styles.charCountWarn : ''}`}>
            {flatValue.length}/{MAX_INPUT}
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
