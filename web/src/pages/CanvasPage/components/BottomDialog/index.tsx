import PromptSyncActions from '../PromptSyncActions';
/* ============================================
 * BottomDialog 视频对话窗口：模型/时长/宽高比配置与发送
 * 统一草稿绑定模式：参考由「画布连线 + 草稿 material refs」合并推导（首帧/尾帧/普通参考）。
 * 附件添加入口（IKGB1X/IKGB7W）：输入框上方第一行附件操作条（共享组件 AttachmentActionBar）
 * ——「+ 参考」画布点选 /「资产库」资产弹窗，等价退役的栏尾「+」菜单两项；附件栏空态整条隐藏；
 * 能力位不支持 / 达上限 / 生成中只读时按钮常显置灰并悬停说明原因；
 * 首尾帧为具名槽位（仅图片，RefSourceMenu label 变体保留），槽位入口与空槽判断不变；
 * 首尾帧模式操作条按首空槽顺序填充（IKGB7Y：首帧优先、其后尾帧，两槽均满置灰）。
 * （角色库菜单项早已退役；存量 material 参考仍随草稿 data 展示与移除。）
 * IKFA1O：正文编辑接入 PromptRefEditor——图片/视频/音频以稳定身份插入正文标签，
 * 首尾帧按角色显示，普通参考按同类型编号；模式不兼容时标签失效并阻止发送。
 * ============================================ */
import { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent } from 'react';
import {
  ChevronDown,
  X,
  SlidersHorizontal,
  ArrowUp,
  Maximize2,
  Minimize2,
} from 'lucide-react';
import { fetchGenerationModels, type GenerationModel } from '@/api/generation';
import RatioIcon from '@/components/RatioIcon';
import GenerationQuoteBadge from '../GenerationQuoteBadge';
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
import ReplaceRefMenu from '../PromptRefEditor/ReplaceRefMenu';
import RefThumbnail from '../RefThumbnail';
import RefSourceMenu from '../RefSourceMenu';
import AttachmentActionBar from '../AttachmentActionBar';
import { useMixedRefStrip, orderRefStripItems, videoRefStripKey, useRefStripDrag, type RefStripOrderProps, type StripDragItemProps } from '../RefThumbnail/strip-dnd';
import { refIdOf, videoLabelMapOf } from '../../videoPromptRefs';
import { composeImageSendPrompt, type ImageTextAttachment } from '../ImageDialog';
import {
  composedPromptLimitError,
  promptCharCountLabel,
  promptMaxLengthOf,
} from '@/lib/prompt-max-length';
import type { MediaGenStatus } from '../MediaNode';
import {
  canAddRefRole,
  hasAnyMediaRef,
  videoRefConflict,
  isLibraryOnlyVideoRef,
  type VideoMediaRef,
  type VideoMediaRefs,
  type VideoRefCapabilities,
  type VideoRefRole,
} from '../../videoMediaRefs';
import {
  audioReferenceMaxOf,
  videoReferenceMaxOf,
  imageReferenceMaxOf,
  supportsAudioReferenceOf,
  supportsVideoReferenceOf,
  checkReferenceLimits,
} from '@/lib/model-reference-limits';
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
  /** IKG0LP：是否带音频（用户选择，缺省 true）。仅模型能力位 features.audio 为 true 时才提供该选择，
   *  后端按能力位决定是否透传给上游。契约见 docs/specs/2026-09-15-ikg0lp-video-generate-audio-contract.md */
  generateAudio: boolean;
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
  /** IKG0LP：是否带音频（随草稿持久化，重开面板恢复） */
  generateAudio?: boolean;
}

interface BottomDialogProps extends RefStripOrderProps {
  onClose: () => void;
  /** 所属项目（价格预览按项目归属校验，与创建任务同路径）。
   *  缺省 = 没有项目上下文（面板单测等），此时不显示价格。 */
  projectId?: string;
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
  /** 移除文本附件（IKFCXC）：× 仅断开当前目标连线（保留来源卡与其他目标关系，与画布断线同一结果）；
   *  方案附件沿用素材同步期间禁移除约束（与 ImageDialog 同口径） */
  onRemoveAttachment?: (nodeId: string) => void;
  planReferenceError?: string;
  pendingPlanSyncs?: Array<{ nodeId: string; title: string }>;
  onSyncPlan?: (nodeId: string) => void;
  syncingPlan?: boolean;
  planIndices?: string;
  /** 调整文本附件顺序（IKDLQH）：回调携带重排后来源 nodeId 序列；IKFCKT 拖拽换位消费
   *  （顺序即生成上下文拼接顺序；上移/下移 UI 随独立文本附件区块下线，能力由拖拽补位） */
  onReorderAttachments?: (orderedNodeIds: string[]) => void;
  /** 从节点添加素材：进入画布节点选取模式；kind 为槽位类型边界——
   *  'image' 仅图片（首尾帧槽 / 图生视频普通参考）、'video' 全能参考（图/视频/音频）；
   *  role 为视频草稿目标参考角色（首帧/尾帧显式指定，IKDMQS），缺省普通参考 */
  onPickFromCanvas?: (kind: 'image' | 'video', role?: VideoRefRole) => void;
  /** 从资产中选择：打开资产库选择弹窗（按 kind 过滤媒体类型；role 为目标槽位角色） */
  onPickFromAssets?: (kind: 'image' | 'video', role?: VideoRefRole) => void;
  /** 画布选取模式进行中（image/video，入口「+」高亮提示） */
  pickMode?: 'image' | 'video' | null;
  /** IKFR4Y 持续选取会话锁定：模式中隔离提示词编辑、模式与模型切换及生成（须先完成选取）；
   *  Dock 参考移除、来源入口与关闭不受限 */
  pickLocked?: boolean;
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
  /** IKFM3W §10：文本索引提供的锁定参考定位来源文本卡（平移居中 + 短暂高亮） */
  onLocateTextSource?: (textNodeId: string) => void;
  /** IKFM3W §10：文本索引发送校验错误（失效/帧互斥），面板持续显示并阻止发送 */
  textIndexError?: string;
  /** 移除某个视频参考：携带来源节点 id，父级断开对应连线 */
  onRemoveVideoRef?: (sourceNodeId: string) => void;
  /** IKFJJT：把普通参考批量转为首帧/尾帧角色槽（切首尾帧自动转换；nodeId 为边来源或素材库 materialId） */
  onAssignRefRoles?: (assignments: Array<{ nodeId: string; role: VideoRefRole }>) => void;
  /** 移除角色库 material 参考（materialId，父级从草稿 data.draftMaterialRefs 过滤） */
  onRemoveMaterialRef?: (materialId: string) => void;
  /** 参考栏拖拽换位（IKFCKT）：普通参考新顺序（nodeId / materialId 混合 key）；父级按子源拆分重排
   *  ——草稿模式 = 连线边序 + 草稿 material 序分别回填，自由模式 = 暂存参考数组整体重排。
   *  首帧/尾帧为角色槽（徽标不参与数字编号），不参与拖拽换位 */
  onReorderMediaRefs?: (orderedKeys: string[]) => void;
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
  /** IKG0LP：是否带音频（首页带入，缺省 true） */
  generateAudio?: boolean;
}

export default function BottomDialog({ projectId, onClose, onSend, initialText, initialDoc, initialParams, attachments, onRemoveAttachment, pendingPlanSyncs, onSyncPlan, syncingPlan, planReferenceError, planIndices, textIndexError, onLocateTextSource, onPickFromCanvas, onPickFromAssets, pickMode, pickLocked, videoDraftBinding, videoMediaRefs, onRemoveVideoRef, onAssignRefRoles, onRemoveMaterialRef, onReorderMediaRefs, onReorderAttachments, stripOrder, onStripOrderChange, onToast, mentionItems: canvasMentionItems, onMentionCanvas, followAnchor, enabledModes }: BottomDialogProps) {
  /** 结构化正文（IKFA1O）：文字与素材标签的片段序列；标签绑定稳定身份，文案按当前参考+模式派生 */
  const [promptDoc, setPromptDoc] = useState<PromptDoc>(() =>
    initialDoc ?? { version: PROMPT_DOC_VERSION, segments: initialText ? [{ kind: 'text' as const, text: initialText }] : [] },
  );
  const editorRef = useRef<PromptRefEditorHandle>(null);
  const mentionAnchorRef = useRef<HTMLDivElement>(null);
  /** @ 菜单状态（已引用 + 素材分类） */
  const [mention, setMention] = useState<MentionState>({ open: false, query: '' });
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
  /** IKG0LP：是否带音频（用户选择，缺省 true = 与上游默认及改动前行为一致） */
  const [generateAudio, setGenerateAudio] = useState(initialParams?.generateAudio ?? true);
  const [modelOpen, setModelOpen] = useState(false);
  const [sizeOpen, setSizeOpen] = useState(false);
  const modelWrapRef = useRef<HTMLDivElement>(null);
  const sizeWrapRef = useRef<HTMLDivElement>(null);
  const modeWrapRef = useRef<HTMLDivElement>(null);
  const configPanelRef = useRef<HTMLDivElement>(null);

  useDismissOnOutside([
    { open: modelOpen, ref: modelWrapRef, dismiss: () => setModelOpen(false) },
    { open: sizeOpen, ref: sizeWrapRef, dismiss: () => setSizeOpen(false) },
    { open: modeOpen, ref: modeWrapRef, dismiss: () => setModeOpen(false) },
    { open: showConfig, ref: configPanelRef, dismiss: () => setShowConfig(false) },
  ]);

  const currentModel = modelList.find((m) => m.model_id === selectedModel) ?? null;
  const maxInput = promptMaxLengthOf(currentModel?.features?.max_prompt_length);
  /** IKG0LP：该模型是否允许生成带音频（能力位 features.audio）。不允许则不提供用户选择。 */
  const supportsAudio = currentModel?.features?.audio === true;
  const modelOptions = modelList.map((m) => ({ key: m.model_id, label: m.model_label }));
  /** 能力选项全部取自接口（无本地写死兜底）：模型列表未加载完时为空 */
  const sizeOptions = currentModel?.supported_sizes?.length
    ? currentModel.supported_sizes.map((s) => ({ key: s.id, label: s.label }))
    : [];
  const ratioOptions = currentModel?.supported_aspect_ratios ?? [];
  const durationRange = currentModel?.supported_durations ?? null;
  const currentSizeLabel =
    sizeOptions.find((s) => s.key === selectedSize)?.label ?? selectedSize;
  /** 报价用的分辨率取值：与发送时**同一个**（`api_value ?? id`，见 handleSend）——
   *  两处取不同的值就是「预览一个价、实扣另一个价」。 */
  const quoteResolution = (() => {
    const size = currentModel?.supported_sizes.find((s) => s.id === selectedSize);
    return size ? (size.api_value ?? size.id) : undefined;
  })();

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
  /** 当前模型与视频参考相关的能力位 + 分类上限（ADR-0086；模型未加载时为 null，约束入口按不可用处理） */
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
  /** 组合校验（IKDMQS）：与服务端 400 同口径（ADR-0086：分类上限/素材总时长读能力行，走共享纯函数
   *  checkReferenceLimits，与 backend handle-create-generation-job 同源语义）+ 结构约束 videoRefConflict；
   *  冲突时明确提示并禁用发送。IKFM3W §10：文本索引错误（失效/帧互斥）最优先——失效素材须先修复
   *  来源文本，帧互斥文案指向改文本/调模式而非通用移除提示。 */
  const referenceConflict = textIndexError ?? planReferenceError ?? (caps
    ? (checkReferenceLimits(
        currentModel?.features,
        videoMediaRefs.reference.map((r) => ({ type: r.mediaType, duration: r.duration })),
        'video',
      ) ?? videoRefConflict(videoMediaRefs, caps))
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
  // planReferenceError 已自带「方案索引 #N …」，再套 planIndices 会变成「方案索引 #1：方案索引 #1 …」
  const conflict = inputConflict && planIndices && !inputConflict.startsWith('方案索引')
    ? `方案索引 ${planIndices}：${inputConflict}`
    : inputConflict;
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
  /** IKFQ5S：首尾帧强制 adaptive 仅对**支持该档的模型**生效（Seedance 2.5）。
   *  2.0 系列上游不接受 adaptive（实测 400 unsupported ratio），仍走用户可选的固定比例。 */
  const supportsAdaptiveRatio = !!currentModel?.supported_aspect_ratios?.includes('adaptive');
  const forceAdaptive = isKeyframe && supportsAdaptiveRatio;
  const isText2Video = selectedMode === 'text2video';
  /** 已连入的视频参考数（切换到首尾帧/图生视频时不兼容，需先移除） */
  const videoRefCount = videoMediaRefs.reference.filter((r) => r.mediaType !== 'image').length;

  /** 生成中只读原因（IKGB1X 操作条悬停原因与下方只读提示条同一文案来源） */
  const readOnlyReason = sending || videoDraftBinding.submitting
    ? '正在保存并提交，参数与连线只读'
    : '生成中，参数与连线只读；可在画布卡片上取消生成';
  /** 普通参考总数上限（与附件栏 n/N 计数分母同口径）：图上限 + 视频上限，模型未加载时按缺省 12 */
  const referenceMaxTotal = caps ? (caps.imageMax ?? 9) + (caps.videoReferenceMax ?? 3) : 12;
  /** 普通参考达上限（IKGB1X 操作条禁用原因之一；旧口径无此门控，仅计数展示） */
  const referencesFull = videoMediaRefs.reference.length >= referenceMaxTotal;
  /** 操作条分派的媒体边界（与栏尾旧「+」同口径）：图生视频仅图片，其余普通参考模式全能（图/视频/音频）；
   *  首尾帧模式按槽位边界传 'image'（契约 §4；IKGB7Y 顺序填充：role 按首空槽分派——首帧优先、其后尾帧） */
  const actionBarKind: 'image' | 'video' = isKeyframe || isText2Video ? 'image' : 'video';
  /** 附件操作条禁用原因（IKGB1X：常显置灰 + 悬停说明，替代旧「+ 不出现」口径）：
   *  生成中只读最优先；首尾帧模式两槽均满才置灰（IKGB7Y，未满按首空槽正常分派）；
   *  普通参考模式按能力位不支持 / 达上限门控（与旧「+」的隐藏门控一一对应 + 上限补齐） */
  const actionBarDisabledReason = readOnly ? readOnlyReason
    : isKeyframe
      ? (videoMediaRefs.first && videoMediaRefs.last ? '首帧与尾帧均已指定，请先移除后再添加' : null)
      : !canAddReference ? '当前模型不支持参考'
      : referencesFull ? `普通参考最多 ${referenceMaxTotal} 条，已达上限`
      : null;
  /** 附件栏空态派生（IKGB1X）：普通参考模式下无普通参考且无文本附件时整条不渲染，不引入新的持久状态；
   *  首尾帧模式槽位常显不吃空态规则（契约 §1/§4） */
  const stripHasItems = videoMediaRefs.reference.length > 0 || (attachments?.length ?? 0) > 0;

  const mixedStrip = useMixedRefStrip(
    isKeyframe ? [] : videoMediaRefs.reference.map(r => videoRefStripKey(r).slice(6)),
    (attachments ?? []).map(a => a.nodeId), { stripOrder, onStripOrderChange },
  );
  const orderedVideoMediaRefs = useMemo(() => ({
    ...videoMediaRefs,
    reference: orderRefStripItems(videoMediaRefs.reference, videoRefStripKey, mixedStrip.order),
  }), [videoMediaRefs, mixedStrip.order]);
  /** IKFA1O 标签映射（唯一口径）：附件区徽标、@ 菜单、正文标签、发送拍平共用。
   *  首尾帧按角色；普通参考按同类型编号；模式不接受的参考身份 → labelOf null（失效，C2/C5）。
   *  IKFA1P：文本附件并入同一映射（编号跟附件顺序 = 画布连入边序，与服务端 text_attachments 同源）。
   *  IKFCKQ：numberMap 为普通参考的同类型数字编号（缩略图圆钮与 label 同源派生）。 */
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
  /** 拍平镜像（IKFA1O/IKFA1P）：字数统计与发送门槛共用；失效标签 → 已失效：原N */
  const flatValue = useMemo(() => flattenPromptDocWith(promptDoc, (key) => refLabelOfStable.current(key)), [promptDoc, reconcileKey]);
  /** 失效标签存在时阻止生成（模式不兼容或参考移除；点击替换/删除后可继续） */
  const hasInvalidRef = docHasInvalidRef(promptDoc);

  /** 切换模式：目标模式与现有参考冲突时明确提示并阻止切换（保证「可见槽 = 实际参考」），否则写回草稿 */
  const handleModeChange = (key: string) => {
    setModeOpen(false);
    if (enabledModes && !enabledModes.includes(key as VideoFollowMode)) return;
    if (key === selectedMode) return;
    const hasFrames = !!(videoMediaRefs.first || videoMediaRefs.last);
    if (key === 'prompt') {
      if (hasAnyMediaRef(videoMediaRefs)) {
        onToast?.('warn', '文生视频模式不支持媒体参考，请先移除参考');
        return;
      }
    } else if (key === 'keyframe') {
      // IKFJJT：普通参考切首尾帧——已连图片自动转为首帧/尾帧槽（第 1 张首帧、第 2 张尾帧），
      // 不再要求用户先移除（旧行为「请先移除普通参考」与「图片≥2 才解锁首尾帧」互锁，永远切不进）。
      const imageRefs = videoMediaRefs.reference.filter((r) => r.mediaType === 'image');
      const nonImageRefs = videoMediaRefs.reference.filter((r) => r.mediaType !== 'image');
      if (nonImageRefs.length > 0) {
        onToast?.('warn', '首尾帧模式仅支持图片素材，请先移除视频/音频参考');
        return;
      }
      if (imageRefs.length > 2) {
        onToast?.('warn', '首尾帧模式最多 2 张图片（首帧 + 尾帧），请先减少参考');
        return;
      }
      if (imageRefs.length > 0) {
        onAssignRefRoles?.(
          imageRefs.slice(0, 2).map((r, i) => ({ nodeId: r.nodeId, role: i === 0 ? 'first' : 'last' })),
        );
      }
    } else {
      // all（全能参考）/ text2video（图生视频）：首帧/尾帧转回普通参考（IKFJJT：与切首尾帧对称）。
      // 首尾帧槽只收图片，转回后即图片普通参考，两种模式都接受。
      if (hasFrames) {
        const frames = [videoMediaRefs.first, videoMediaRefs.last].filter(
          (f): f is VideoMediaRef => !!f,
        );
        onAssignRefRoles?.(frames.map((f) => ({ nodeId: f.nodeId, role: 'reference' })));
      } else if (key === 'text2video' && videoRefCount > 0) {
        onToast?.('warn', '图生视频模式不支持视频或音频参考，请先调整引用');
        return;
      }
    }
    setSelectedMode(key);
    // IKFQ5S：仅支持 adaptive 的模型（2.5）才内置该档；2.0 保持用户可选的固定比例。
    if (key === 'keyframe' && supportsAdaptiveRatio) {
      setSelectedRatio('adaptive');
      syncDraftParams({ mode: key, ratio: 'adaptive' });
      return;
    }
    // 离开首尾帧：若当前是 adaptive（首尾帧内置值）且新模型比例列表不含 adaptive，回落到模型默认/首个比例。
    if (selectedRatio === 'adaptive' && currentModel && !currentModel.supported_aspect_ratios.includes('adaptive')) {
      const fallbackRatio =
        currentModel.default_aspect_ratio && currentModel.supported_aspect_ratios.includes(currentModel.default_aspect_ratio)
          ? currentModel.default_aspect_ratio
          : (currentModel.supported_aspect_ratios[0] ?? '');
      setSelectedRatio(fallbackRatio);
      syncDraftParams({ mode: key, ratio: fallbackRatio });
      return;
    }
    syncDraftParams({ mode: key });
  };

  const configurationError = !modelsLoaded ? '正在加载模型配置'
    : !currentModel ? '原生成模型不可用，请重新选择模型'
    : !sizeOptions.some(option => option.key === selectedSize) ? '原分辨率不可用，请重新选择分辨率'
    // ADR-0086：首尾帧比例内置 adaptive（不暴露给用户），跳过比例合法性校验，避免误报「原比例不兼容」。
    : !forceAdaptive && !ratioOptions.includes(selectedRatio) ? '原比例不兼容，请重新选择比例'
    : durationRange && (duration < durationRange.min || duration > durationRange.max
      || (duration - durationRange.min) % durationRange.step !== 0)
      ? '原时长不兼容，请重新选择时长'
    : hasInvalidRef ? '正文有已失效的素材标签，请点击标签替换或删除后再发送'
    : null;
  const canSend = !readOnly && !pickLocked && !videoDraftBinding.saveFailed && !configurationError
    && (flatValue.trim().length > 0 || hasAttachmentText);

  /** 时长刻度（min..max 逐 step；模型能力未加载时无刻度） */
  const ticks: number[] = [];
  if (durationRange) {
    for (let v = durationRange.min; v <= durationRange.max; v += durationRange.step) ticks.push(v);
  }

  /** 选中模型后应用其默认清晰度/宽高比/时长，返回实际应用值（供草稿参数同步）。
   *  IKFQ5S：首尾帧仅在模型支持 adaptive 时内置固定该档（2.5）；2.0 走其固定比例档。 */
  const applyModelDefaults = (m: GenerationModel) => {
    setSelectedModel(m.model_id);
    let nextRatio = selectedRatio;
    if (isKeyframe && m.supported_aspect_ratios.includes('adaptive')) {
      nextRatio = 'adaptive';
      setSelectedRatio(nextRatio);
    } else if (m.supported_aspect_ratios.length) {
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
          const restoredMode = initialParams?.mode ?? 'prompt';
          setSelectedModel(initialParams?.modelId ?? '');
          const model = list.find(m => m.model_id === initialParams?.modelId);
          const size = model?.supported_sizes.find(s => s.id === initialParams?.resolution || s.api_value === initialParams?.resolution);
          setSelectedSize(size?.id ?? initialParams?.resolution ?? '');
          // IKFQ5S：仅模型支持 adaptive 时才内置该档（恢复时模型可能未就绪，按 list 查）。
          const restoredSupportsAdaptive = !!model?.supported_aspect_ratios?.includes('adaptive');
          setSelectedRatio(
            restoredMode === 'keyframe' && restoredSupportsAdaptive
              ? 'adaptive'
              : (initialParams?.aspectRatio ?? ''),
          );
          setDuration(initialParams?.duration ?? 0);
          setSelectedMode(restoredMode);
          // IKG0LP：首页带入的音频选择随交接恢复（缺省 true）
          setGenerateAudio(initialParams?.generateAudio ?? true);
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
        // IKG0LP：音频选择随草稿落值（首次打开即持久化当前生效值）
        patch.generateAudio = generateAudio;
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
            // IKFQ5S：首尾帧且模型支持 adaptive 时才内置该档，覆盖首页带入的固定比例。
            if (initialParams.mode === 'keyframe' && target.supported_aspect_ratios.includes('adaptive')) {
              setSelectedRatio('adaptive');
              patch.ratio = 'adaptive';
            }
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
    void submit(text, {
      modelId: currentModel.model_id,
      aspectRatio: selectedRatio,
      resolution: size.api_value ?? size.id,
      duration,
      mode: selectedMode,
      generateAudio,
    }, docHasAnyRef(promptDoc) ? promptDoc : null);
  };

  /** 当前模式下有效的参考（帧、普通素材与文本）；过滤统一由菜单完成。 */
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
    return out;
  }, [videoMediaRefs, attachments, reconcileKey]);
  /** IKFXOR：Esc 取消（restoreFocus=true）把光标落回 @ 后并还焦编辑器；点外关闭维持现状不抢焦 */
  const closeMention = (restoreFocus = false) => {
    editorRef.current?.dismissMention(restoreFocus);
    setMention({ open: false, query: '' });
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

  /** 新画布素材添加成功后，回到原 @ 位置插入标签。 */
  const pendingNewRefInsert = useRef(false);
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
    { open: replaceTarget !== null, ref: replaceMenuRef, dismiss: () => setReplaceTarget(null) },
  ]);

  /** 首尾帧具名槽位来源入口（IKFE8U/IKGB7W）：普通参考变体已随附件操作条落地退役，
   *  仅保留「+ 首帧」「+ 尾帧」label 变体——按 kind+role 对接目标槽位，
   *  单「+」展开「从资产中选择 / 从节点添加素材」两项菜单（角色库菜单项退役）；
   *  kind 为槽位类型边界——'image' 仅图片（首尾帧槽）；pickMode 与发起槽位 kind 精确匹配时「+」高亮。 */
  const renderSourceMenu = (kind: 'image' | 'video', role: VideoRefRole, label?: string) => (
    <RefSourceMenu
      onPickFromAssets={() => onPickFromAssets?.(kind, role)}
      onPickFromCanvas={() => onPickFromCanvas?.(kind, role)}
      pickMode={pickMode === kind}
      label={label}
      entryTitle={label ? `添加${label}（从资产中选择 / 从节点添加素材）` : undefined}
    />
  );

  /** IKFCKQ 参考缩略图接入共享组件：× 走「断开引用、保留来源」既有链路
   *  （连线项断开连线 / 角色库项移除草稿 material 参考），@ 复用记忆光标插入且仅对
   *  标签有效身份开放（与 @ 菜单同口径，不留下伪有效标签）；首帧/尾帧按角色徽标、
   *  普通参考按同类型编号（与正文标签同源 numberMap），三态交互与放大预览由组件承载。
   *  IKFCKT：dragProps 由渲染处按统一序列 index 传入（首尾帧槽不传 = 固定角色不参与拖拽）。
   *  IKFM3W §10：文本带入条目锁定（不渲染 ×、渲染定位来源入口），与图片面板同构。 */
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
      dragProps={dragProps}
    />
  );

  const handleStripReorder = (from: number, to: number) => {
    const { nextMedia, nextText, mediaChanged, textChanged } = mixedStrip.reorder(from, to);
    if (mediaChanged) onReorderMediaRefs?.(nextMedia.map(key => key.slice(key.indexOf(':') + 1)));
    if (textChanged) onReorderAttachments?.(nextText);
  };
  const stripDrag = useRefStripDrag({ disabled: readOnly, onReorder: handleStripReorder });

  /** IKFCKQ 文本附件进参考栏：FileText 图标缩略图 + 文本N 独立编号 + 悬停 ×/@ 与正文预览；
   *  IKFCXC：× 统一走「断开当前目标连线、保留来源与其他目标关系」链路（与 ImageDialog 同口径，
   *  方案附件素材同步期间禁移除）；
   *  IKFCKT：dragProps 按统一序列 stripIndex 传入（base = 普通参考数；首尾帧模式无普通参考 base=0；
   *  i 为文本段内编号下标）；附件顺序仍决定生成上下文拼接顺序 */
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
      dragProps={stripDrag.itemProps(mixedStrip.index(stripIndex))}
    />
  );
  const textThumbsAt = (base: number) => (attachments ?? []).map((a, i) => renderTextThumb(a, base + i));

  /** 时长滑杆键盘操作（IKI61N，组件内自闭环，不改公共 helper 与公共 Esc 链）：
   *  Esc 关闭对话框——画布公共 Esc 链对任何 INPUT 豁免（isEditableKeyboardTarget，
   *  type=range 同被吞），故在此直调 onClose（X 同口径）；preventDefault + stopPropagation
   *  阻断冒泡，公共链不会二次处理。
   *  方向键不拦截：min/max/step 取模型能力且与发送校验同网格（(v-min)%step===0），
   *  无受控量化冲突，原生步进语义直接生效；readOnly 时滑杆 disabled 本就不可聚焦。 */
  const onDurationSliderKeyDown = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Escape') return;
    e.preventDefault();
    e.stopPropagation();
    onClose();
  };

  return (
    <div
      className={`${styles.dialogWrap} ${followAnchor ? styles.dialogWrapFollow : ''}`}
      style={followAnchor ? { left: followAnchor.left, top: followAnchor.top } : undefined}
      data-gen-panel-territory
    >
      {/* @ 菜单（IKFA1O）：挂 .dialogWrap 层向上弹出（.dialog 滚动框会裁剪浮层）；
          顶部统一搜索与已引用，下方保留原有四类画布素材入口 */}
      {mention.open && !readOnly && (
        <div className={styles.mentionDock} ref={mentionMenuRef}>
          <AtMentionMenu
            renderInline
            anchorRef={mentionMenuRef}
            items={canvasMentionItems ?? []}
            editorQuery={mention.query}
            referencedItems={mentionItems.map(r => ({
              id: r.assetId, assetId: r.assetId, name: r.name, thumbUrl: r.url,
              kind: r.mediaType, badge: r.badge,
            }))}
            onSelectReferenced={(item) => pickMentionRef(item.id)}
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
                onMentionCanvas?.(item);
              }
            }}
            onClose={closeMention}
            onEscapeClose={() => closeMention(true)}
          />
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

          {/* 宽高比（IKFQ5S：仅首尾帧 + 模型支持 adaptive 时内置不渲染；2.0 首尾帧仍需用户选固定比例） */}
          {!forceAdaptive && (
            <>
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
            </>
          )}

          {/* IKG0LP：是否带音频——仅模型能力位 features.audio 允许时提供；缺省开，与上游默认及改动前行为一致 */}
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
                    // IKG0LP：写回草稿节点，重开面板时恢复
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
      {/* 第一行：附件操作条（IKGB1X，三面板共用共享组件 AttachmentActionBar）——左「+ 参考」「资产库」
          pill 直达退役菜单两项链路（kind/role 与旧「+」同口径透传），右侧并入原展开/关闭按钮；
          能力位不支持 / 达上限 / 生成中只读时常显置灰并悬停说明原因（替代旧「+ 不出现」）；
          首尾帧模式（IKGB7Y）：按首空槽角色顺序填充（首帧优先、其后尾帧，kind 为槽位边界 'image'），
          两槽均满才置灰；点选进行中「+ 参考」随 pickMode 高亮（与槽位入口同口径） */}
      <div className={styles.actionBarRow}>
        <AttachmentActionBar
          kind={actionBarKind}
          role={isKeyframe ? (videoMediaRefs.first ? 'last' : 'first') : 'reference'}
          /* 类型收窄守卫（TypeScript 类型层必需，非运行期可达）：共享组件回调签名 kind 为
             'image'|'video'|'audio' 联合，本面板回调仅收 'image'|'video'，不 narrowing 不能通过类型检查；
             运行期 actionBarKind 已锁边界，'audio' 分支不会到达 */
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

      {/* 顶部媒体行（统一草稿绑定：按模式门控展示。「连线 + material」合并推导参考）
          首尾帧模式：首帧 + 尾帧同一行（具名槽位常显，不吃空态隐藏）；全能参考/图生视频：普通参考
          （图生视频不收视频参考），栏内无普通参考且无文本附件时整条不渲染（IKGB1X 空态）。
          角色由「模式 + 目标槽」决定，不再提供跨模式角色切换（避免槽隐藏后参考丢失）。
          栏尾旧「+」菜单（RefSourceMenu 普通变体）随操作条落地退役，仅保留首尾帧具名槽位变体（IKGB7W）。 */}
      {(isKeyframe || stripHasItems || (videoMediaRefs.invalid?.length ?? 0) > 0 || !!conflict || readOnly) && (
      <div className={styles.refRoleArea}>
        {isKeyframe ? (
          <div className={styles.refSlot}>
            {/* 首帧：有图时共享缩略图（角色徽标「首帧」）；无图时统一入口具名槽位（仅图片） */}
            {videoMediaRefs.first ? (
              renderRefThumb(videoMediaRefs.first, undefined, '首帧')
            ) : (
              !readOnly && canAddFirst && renderSourceMenu('image', 'first', '首帧')
            )}
            {/* 尾帧（与首帧同一行）：有图时共享缩略图；无图时统一入口具名槽位（仅图片） */}
            {videoMediaRefs.last ? (
              renderRefThumb(videoMediaRefs.last, undefined, '尾帧')
            ) : (
              !readOnly && canAddLast && renderSourceMenu('image', 'last', '尾帧')
            )}
            {mixedStrip.render([], textThumbsAt(0))}
          </div>
        ) : (
          stripHasItems && (
            <div className={styles.refSlot}>
              {mixedStrip.render(
                videoMediaRefs.reference.map((r, i) => renderRefThumb(r, r.materialId != null ? `material:${r.materialId}` : `node:${r.nodeId}`, undefined, stripDrag.itemProps(mixedStrip.index(i)))),
                textThumbsAt(videoMediaRefs.reference.length),
              )}
              {/* n/N 计数保留在附件栏原位（IKGB1X）：有普通参考时显示 */}
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
        {/* 组合冲突提示（IKDMQS）：明确说明不可提交的原因，不静默丢弃 */}
        {conflict && <div className={styles.refConflictHint} role="alert">{conflict}</div>}
        {readOnly && <div className={styles.readOnlyHint}>{readOnlyReason}</div>}
      </div>
      )}

      <PromptSyncActions plans={pendingPlanSyncs} disabled={readOnly || syncingPlan} onSync={onSyncPlan} />
      {configurationError && <div className={styles.refConflictHint} role="alert">{configurationError}</div>}

      {/* 输入框（IKFA1O 结构化正文）：任意光标处输入 @ 插入已引用素材标签；标签绑定稳定身份 */}
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

      {/* 底部状态栏 */}
      <div className={styles.bottomBar}>
        {/* 左侧 */}
        <div className={styles.barLeft}>
          {/* 模式选择器（与首页底部操作同步：全能参考 / 首尾帧 / 图生视频） */}
          <div className={styles.modeWrap} ref={modeWrapRef}>
            <button
              className={styles.modeBtn}
              disabled={readOnly || pickLocked}
              title={pickLocked ? '选取进行中，完成选取后再切换模式' : undefined}
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

          {/* 配置信息（点击展开配置面板）。IKFQ5S：仅首尾帧 + 模型支持 adaptive 时才在状态栏隐去比例。 */}
          <button
            className={styles.configBtn}
            disabled={pickLocked}
            title={pickLocked ? '选取进行中，完成选取后再调整模型配置' : undefined}
            onClick={() => setShowConfig(!showConfig)}
          >
            <SlidersHorizontal size={14} strokeWidth={2} />
            <span>{currentModel?.model_label ?? '选择模型'}</span>
            {!forceAdaptive && (
              <>
                <span className={styles.barDivider}>|</span>
                <span>{selectedRatio}</span>
              </>
            )}
            <span className={styles.barDivider}>|</span>
            <span>{currentSizeLabel}</span>
            <span className={styles.barDivider}>|</span>
            <span>{duration}s</span>
          </button>
        </div>

        {/* 右侧：发送 */}
        <div className={styles.barRight}>
          {/* 价格预览（只算不扣）：与提交同源的定价维度 —— 模型 + 分辨率 + 比例 + 时长 + 带音频。
              没有项目上下文就不挂（徽标自己也不在无项目时挂内层）。 */}
          {projectId ? (
            <GenerationQuoteBadge
              projectId={projectId}
              type="video"
              parameters={{
                model_id: currentModel?.model_id ?? '',
                ...(quoteResolution ? { resolution: quoteResolution } : {}),
                ...(selectedRatio ? { aspect_ratio: selectedRatio } : {}),
                ...(duration ? { duration } : {}),
                generate_audio: generateAudio,
              }}
            />
          ) : null}
          {/* 字数统计 */}
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
