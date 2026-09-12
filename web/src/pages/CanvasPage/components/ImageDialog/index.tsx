import PromptSyncActions from '../PromptSyncActions';
/* ============================================
 * ImageDialog 图片对话窗口：参考图上传/模型/清晰度/比例配置
 * ============================================ */
import { useState, useRef, useEffect, useMemo } from 'react';
import type { Node } from '@xyflow/react';
import {
  X,
  ChevronDown,
  ChevronUp,
  Maximize2,
  Minimize2,
  SlidersHorizontal,
  ArrowUp,
  MousePointerClick,
  FolderOpen,
  Plus,
} from 'lucide-react';
import { fetchGenerationModels, type GenerationModel } from '@/api/generation';
import {
  PROMPT_DOC_VERSION,
  docHasAnyRef,
  docHasInvalidRef,
  flattenPromptDoc,
  type PromptDoc,
  type StoredPromptDoc,
} from '@/lib/prompt-doc';
import PromptRefEditor, {
  type MentionState,
  type PromptRefEditorHandle,
} from '../PromptRefEditor';
import MentionMenu from '../PromptRefEditor/MentionMenu';
import { pickRatioForSize, ratiosForSelectedSize } from '@/lib/image-size-ratios';
import { REF_LIMITS, refOverflowToast } from '@/utils/ref-overflow';
import type { ImageMediaRef } from '../../mediaRefs';
import { cardNameOfNode, localNodeIdOf } from '../../mediaRefs';
import type { MediaGenStatus } from '../MediaNode';
import { useDismissOnOutside } from '../../hooks/useDismissOnOutside';
import AtMentionMenu from '../AtMentionMenu';
import { type AtMentionItem } from '../../atMention';
import type { FollowDialogAnchor } from '../../followDialog';
import styles from './index.module.css';

/** 输入框默认字数上限（模型目录未配 max_prompt_length 时沿用旧行为，ADR-0085） */
const DEFAULT_MAX_INPUT = 1000;

/** 视频最大上传数量（接口未下发该字段，前端统一 3） */
const MAX_VIDEOS = 3;

export interface UploadedFile {
  id: string;
  url: string;
  type: 'image' | 'video';
  name: string;
  /** 原始 File 对象（用户本地选择时携带，用于上传获取 assetId） */
  file?: File;
  /** 已有资产 ID（画布节点选取时携带，直接作为 input_asset_ids） */
  assetId?: string | number;
}

/** 连线文本附件（IKDLQF）：目标图片节点经连线带入的 textNode 正文快照，面板只读展示 */
export interface ImageTextAttachment {
  /** 来源文本节点 id */
  nodeId: string;
  isPromptPlan?: boolean;
  /** 来源节点标题 */
  title: string;
  /** 当次正文 */
  text: string;
}

/** 附件正文超过该长度默认折叠（可展开读全） */
const ATTACHMENT_COLLAPSE_LENGTH = 120;

interface ImageDialogProps {
  onClose: () => void;
  /** 发送：提示词（拍平镜像）+ 模型ID + 分辨率档位 id（如 2k） + 宽高比 + 参考素材列表 + 结构化正文（含素材标签时携带，IKFA1M）（异步：上传完成后 resolve） */
  onSend: (text: string, modelId: string, size: string, ratio: string, files: UploadedFile[], promptDoc?: PromptDoc | null) => Promise<void> | void;
  /** 初始提示词（节点「重新编辑」带入原生成提示词） */
  initialText?: string;
  /** 初始结构化正文（IKFA1M 草稿恢复）：携带时优先于 initialText */
  initialDoc?: PromptDoc | null;
  /** 初始参考素材（节点操作带入被点节点图片） */
  initialFiles?: UploadedFile[];
  /** 初始生成参数（首页 AI图片 带入：选中首页所选的模型/清晰度/宽高比） */
  initialParams?: ImageGenSeedParams;
  /** 连线文本附件（IKDLQF）：仅图片媒体节点面板发起时携带，打开当下快照，只读展示 */
  attachments?: ImageTextAttachment[];
  onRemovePlan?: (nodeId: string) => void;
  /** 调整文本附件顺序（IKDLQH）：回调携带重排后来源 nodeId 序列；仅多附件时展示控件，缺省不渲染排序入口 */
  onReorderAttachments?: (orderedNodeIds: string[]) => void;
  /** 到节点选择：进入画布图片节点选取模式 */
  onPickFromCanvas?: () => void;
  /** 从资产中选择：打开资产库选择弹窗（仅图片） */
  onPickFromAssets?: () => void;
  /** 画布选取模式进行中（左上角图标高亮提示） */
  pickMode?: boolean;
  /** 外部注入参考素材（ts 驱动；画布节点单选 / 角色库多选，files 为一批）。
   *  事件一次消费（IKF5KE）：面板处理一批后必须经 onExternalPickConsumed 通知父级清除，
   *  否则已处理事件会在面板重挂载时重放（已删除附件复活） */
  externalPick?: { ts: number; files: UploadedFile[] } | null;
  /** 外部选取事件已消费：父级据此清除事件，保证一批注入只生效一次 */
  onExternalPickConsumed?: () => void;
  /** 打开角色库弹窗 */
  onOpenCharacterLibrary?: () => void;
  /** Toast 提示（上传超限等场景，由父级注入） */
  onToast?: (type: 'success' | 'error' | 'warn', msg: string) => void;
  /** 草稿绑定（IKDMQQ）：面板编辑实时写回草稿节点；status 为 generating 时参数只读 */
  draftBinding?: {
    status?: MediaGenStatus;
    restoreExisting?: boolean;
    saveFailed?: boolean;
    submitting?: boolean;
    onParamsChange: (patch: { prompt?: string; promptDoc?: StoredPromptDoc; modelId?: string; size?: string; ratio?: string }) => void;
  };
  /** 连线图片参考（IKDMQR）：草稿绑定时由父级按连线实时推导传入，面板据此渲染参考区；
   *  传入了 mediaRefs 即为连线绑定模式，面板本地 files 不再参与展示与提交 */
  mediaRefs?: ImageMediaRef[];
  planReferenceError?: string;
  pendingPlanSyncs?: Array<{ nodeId: string; title: string }>;
  onSyncPlan?: (nodeId: string) => void;
  syncingPlan?: boolean;
  invalidMediaRefs?: Array<{ nodeId: string; name: string }>;
  /** 移除某个图片参考（IKDMQR）：携带来源节点 id，父级断开对应连线 */
  onRemoveMediaRef?: (sourceNodeId: string) => void;
  /** 画布 @ 引用候选（当前画布可引用节点） */
  mentionItems?: AtMentionItem[];
  /** 选中 @ 素材后写入参考区 */
  onMentionCanvas?: (item: AtMentionItem) => void;
  /** 当前画布媒体节点（IKFA8Y）：自由模式参考项按来源节点身份刷新名称，
   *  卡片改名后参考显示同步新名称（不改变引用绑定与提交输入） */
  currentNodes?: Node[];
  /** 绑定生成节点时悬浮跟随；缺省仍锚定底部 */
  followAnchor?: FollowDialogAnchor | null;
}

/** 首页带入的初始生成参数（各字段经模型能力校验后应用，不在能力内的项回退模型默认值） */
export interface ImageGenSeedParams {
  /** 模型ID */
  modelId?: string;
  /** 宽高比（如 16:9） */
  ratio?: string;
  /** 分辨率档位 id（如 2k） */
  size?: string;
}

/** 宽高比图标：按比例绘制小矩形 */
function RatioIcon({ ratio }: { ratio: string }) {
  const [w, h] = ratio.split(':').map(Number);
  const max = 16;
  const width = w >= h ? max : Math.round((h / w) * max);
  const height = h >= w ? max : Math.round((h / w) * max);
  return <span className={styles.ratioIcon} style={{ width, height }} />;
}

/** 连线文本附件项：标题 + 正文预览，长文默认折叠可展开；多附件且父级提供重排回调时展示上移/下移（IKDLQH） */
function AttachmentItem({ attachment, move, onRemove }: {
  attachment: ImageTextAttachment;
  onRemove?: () => void;
  move?: { isFirst: boolean; isLast: boolean; onMove: (delta: -1 | 1) => void };
}) {
  const [expanded, setExpanded] = useState(false);
  const collapsible = attachment.text.length > ATTACHMENT_COLLAPSE_LENGTH;
  return (
    <div className={styles.attachmentItem}>
      <div className={styles.attachmentHead}>
        <span className={styles.attachmentTitle}>{attachment.title}</span>
        {onRemove && <button type="button" className={styles.attachmentMove} aria-label={`移除方案 ${attachment.title}`} title="移除方案" onClick={onRemove}><X size={12} /></button>}
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

export default function ImageDialog({ onClose, onSend, initialText, initialDoc, initialFiles, initialParams, attachments, onRemovePlan, pendingPlanSyncs, onSyncPlan, syncingPlan, onReorderAttachments, onPickFromCanvas, onPickFromAssets, pickMode, externalPick, onExternalPickConsumed, onToast, draftBinding, mediaRefs, invalidMediaRefs, planReferenceError, onRemoveMediaRef, mentionItems: canvasMentionItems, onMentionCanvas, currentNodes, followAnchor }: ImageDialogProps) {
  /** 结构化正文（IKFA1M）：文字与素材标签的片段序列；标签绑定稳定身份，编号按当前输入派生 */
  const [promptDoc, setPromptDoc] = useState<PromptDoc>(() =>
    initialDoc ?? { version: PROMPT_DOC_VERSION, segments: initialText ? [{ kind: 'text' as const, text: initialText }] : [] },
  );
  const editorRef = useRef<PromptRefEditorHandle>(null);
  /** @ 菜单状态（已引用 + 添加新参考） */
  const [mention, setMention] = useState<MentionState>({ open: false, query: '' });
  const [mentionIndex, setMentionIndex] = useState(0);
  const [modelList, setModelList] = useState<GenerationModel[]>([]);
  const [modelsLoaded, setModelsLoaded] = useState(false);
  const [selectedModel, setSelectedModel] = useState('');
  const [selectedResolution, setSelectedResolution] = useState('');
  const [selectedRatio, setSelectedRatio] = useState('');
  const [showConfig, setShowConfig] = useState(false);
  /** 放大态：输入区高度占屏幕 2/3；收起回底部默认高度 */
  const [expanded, setExpanded] = useState(false);
  const [modelOpen, setModelOpen] = useState(false);
  const [resOpen, setResOpen] = useState(false);
  const [files, setFiles] = useState<UploadedFile[]>(initialFiles ?? []);
  /** 上传中状态：禁用发送按钮和输入框 */
  const [uploading, setUploading] = useState(false);
  /** 媒体入口按钮弹菜单：从资产中选择 / 到节点选择 */
  const [sourceMenuOpen, setSourceMenuOpen] = useState(false);
  const modelWrapRef = useRef<HTMLDivElement>(null);
  const resWrapRef = useRef<HTMLDivElement>(null);
  const configPanelRef = useRef<HTMLDivElement>(null);
  const sourceWrapRef = useRef<HTMLDivElement>(null);
  const mentionMenuRef = useRef<HTMLDivElement>(null);
  const [canvasMentionOpen, setCanvasMentionOpen] = useState(false);

  useDismissOnOutside([
    { open: modelOpen, ref: modelWrapRef, dismiss: () => setModelOpen(false) },
    { open: resOpen, ref: resWrapRef, dismiss: () => setResOpen(false) },
    { open: sourceMenuOpen, ref: sourceWrapRef, dismiss: () => setSourceMenuOpen(false) },
    { open: showConfig, ref: configPanelRef, dismiss: () => setShowConfig(false) },
    { open: mention.open && !canvasMentionOpen, ref: mentionMenuRef, dismiss: () => closeMention() },
  ]);

  /** 快照参考项名称刷新（IKFA8Y）：自由模式的参考名称取自选取当刻，卡片改名后按画布节点 id
   *  重新取当前名称（只改展示名称；上传项与资产库项无画布节点，保持原名）。 */
  useEffect(() => {
    if (!currentNodes || currentNodes.length === 0) return;
    const current = new Map(currentNodes.map((n) => [n.id, n]));
    setFiles((prev) => {
      let changed = false;
      const next = prev.map((file) => {
        const nodeId = localNodeIdOf(file.id);
        if (!nodeId) return file;
        const name = cardNameOfNode(current.get(nodeId));
        if (name === undefined || name === file.name) return file;
        changed = true;
        return { ...file, name };
      });
      return changed ? next : prev;
    });
  }, [currentNodes]);

  /** 外部注入参考素材（画布节点选取/角色库多选；去重 + 上限保护）。
   *  连线绑定模式（IKDMQR）：参考由父级按连线推导，外部注入不参与（选取入口改为建立连线）。
   *  一次消费（IKF5KE）：一批事件无论是否并入本地 files，处理后都通知父级清除，
   *  防止已处理事件在面板关闭/重建后的新挂载上重放 */
  useEffect(() => {
    if (!externalPick) return;
    if (!mediaRefs) {
      setFiles((prev) => {
        let next = prev;
        for (const file of externalPick.files) {
          const imgCount = next.filter((f) => f.type === 'image').length;
          const vidCount = next.filter((f) => f.type === 'video').length;
          const full = file.type === 'image' ? imgCount >= maxImages : vidCount >= MAX_VIDEOS;
          if (full) {
            onToast?.('warn', refOverflowToast([file.type], { image: maxImages, video: MAX_VIDEOS }));
            break;
          }
          if (next.some((f) => f.id === file.id)) continue;
          next = [...next, file];
        }
        return next;
      });
    }
    onExternalPickConsumed?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [externalPick]);

  /** 能力选项全部取自接口（无本地写死兜底）：模型列表未加载完时为空 */
  const modelOptions = modelList.map((m) => ({ key: m.model_id, label: m.model_label }));
  const currentGen = modelList.find((m) => m.model_id === selectedModel);
  // ADR-0085（IKESD9）：prompt 上限跟随所选模型的目录配置，未下发回落默认
  const maxInput = currentGen?.features?.max_prompt_length ?? DEFAULT_MAX_INPUT;
  const resolutionOptions = currentGen?.supported_sizes?.length
    ? currentGen.supported_sizes.map((s) => ({ key: s.id, label: s.label }))
    : [];
  const ratioOptions = currentGen ? ratiosForSelectedSize(currentGen, selectedResolution) : [];
  const currentModel = modelOptions.find((m) => m.key === selectedModel);
  const currentResolutionLabel =
    resolutionOptions.find((r) => r.key === selectedResolution)?.label ?? selectedResolution;
  const imageCount = files.filter((f) => f.type === 'image').length;
  /** 参考图上限固定 9 张（产品约定），不随模型能力接口的 max_reference_images 波动 */
  const maxImages = REF_LIMITS.image;
  /** 连线绑定模式（IKDMQR）：参考区渲染连线推导的 mediaRefs；否则渲染面板本地 files */
  const edgeRefs = mediaRefs ?? null;
  const imagesFull = edgeRefs ? edgeRefs.length >= maxImages : imageCount >= maxImages;

  /** 有效图片参考（保序去重）+ 展示编号（IKFA1M）：
   *  编号 = 素材在最终 input_asset_ids 中的下标+1——连线模式 = 连线顺序（与服务端同源推导）；
   *  本地模式 = 图片文件顺序（含待上传项占位，与 collectImageInputAssetIds 保序一致）。
   *  附件区角标、@ 菜单、正文标签、服务端编译共用同一映射。 */
  const orderedImageRefs = useMemo(() => {
    const out: Array<{ assetId: string; url: string; name: string; number: number }> = [];
    if (edgeRefs) {
      edgeRefs.forEach((r) => {
        if (out.some((x) => x.assetId === r.assetId)) return;
        out.push({ assetId: r.assetId, url: r.url, name: r.name, number: out.length + 1 });
      });
      return out;
    }
    let n = 0;
    for (const f of files) {
      if (f.type !== 'image') continue;
      n += 1;
      if (f.assetId == null) continue;
      const assetId = String(f.assetId);
      if (out.some((x) => x.assetId === assetId)) continue;
      out.push({ assetId, url: f.url, name: f.name, number: n });
    }
    return out;
  }, [edgeRefs, files]);
  const orderedAssetIds = useMemo(() => orderedImageRefs.map((r) => r.assetId), [orderedImageRefs]);
  const refsNumbering = useMemo(
    () => new Map(orderedImageRefs.map((r) => [r.assetId, r.number] as const)),
    [orderedImageRefs],
  );
  const refsMeta = useMemo(
    () => new Map(orderedImageRefs.map((r) => [r.assetId, { url: r.url, name: r.name }] as const)),
    [orderedImageRefs],
  );
  /** 本地模式每个图片文件在最终输入中的编号（含无 assetId 待上传项） */
  const fileNumberOf = useMemo(() => {
    const m = new Map<string, number>();
    let n = 0;
    for (const f of files) {
      if (f.type !== 'image') continue;
      n += 1;
      m.set(f.id, n);
    }
    return m;
  }, [files]);
  const orderedAssetIdsRef = useRef(orderedAssetIds);
  orderedAssetIdsRef.current = orderedAssetIds;
  /** 拍平镜像（IKFA1M）：标签 → 图片N / 已失效：原图片N；字数统计与发送门槛共用 */
  const flatValue = useMemo(() => flattenPromptDoc(promptDoc, orderedAssetIds), [promptDoc, orderedAssetIds]);
  /** 失效标签存在时阻止生成（可删除失效提及后继续；自动/交互修复在下一票 IKFA1N） */
  const hasInvalidRef = docHasInvalidRef(promptDoc);
  /** 附件正文有效（去空白非空）时允许空提示词提交（IKDLQF 契约：附件可单独驱动生成）；
   *  全部有效文本为空时沿用「提示词必填」 */
  const hasAttachmentText = (attachments ?? []).some((a) => a.text.trim().length > 0);
  /** 生成中只读（IKDMQQ）：任务执行期间目标参数冻结，保留查看与画布上的取消入口 */
  const readOnly = uploading || draftBinding?.submitting === true || draftBinding?.status === 'generating';
  const configurationError = planReferenceError ? planReferenceError
    : !modelsLoaded ? '正在加载模型配置'
    : !currentGen ? '原生成模型已不可用，请重新选择模型'
    : selectedResolution && !resolutionOptions.some(option => option.key === selectedResolution)
      ? '原分辨率已不可用，请重新选择分辨率'
    : selectedRatio && !ratioOptions.includes(selectedRatio)
      ? '原比例与当前配置不兼容，请重新选择比例'
    : invalidMediaRefs?.length ? '参考素材不可用，请调整参考后发送'
    : edgeRefs?.length && !currentGen.features.reference_image ? '当前模型不支持图片参考，请调整模型或参考'
    : edgeRefs && edgeRefs.length > Math.min(maxImages, currentGen.features.max_reference_images || maxImages)
      ? '参考图片数量超过模型支持上限，请调整参考'
    : hasInvalidRef ? '正文有已失效的素材标签，请删除后再发送'
    : flatValue.length > maxInput ? `提示词超过 ${maxInput} 字上限，请精简后再发送`
    : null;
  const canSend = !uploading && !readOnly && !draftBinding?.saveFailed && !configurationError && (flatValue.trim().length > 0 || hasAttachmentText);

  /** 草稿绑定参数同步（IKDMQQ）：面板内的模型/分辨率/比例/提示词变更实时写回草稿节点 */
  const syncDraftParams = (patch: { prompt?: string; promptDoc?: StoredPromptDoc; modelId?: string; size?: string; ratio?: string }) => {
    draftBinding?.onParamsChange(patch);
  };

  const pendingNewRefInsert = useRef(false);
  const prevAssetIdsRef = useRef(orderedAssetIds);

  /** 结构化正文变更（IKFA1M）：同步拍平镜像与结构（双写防丢失），失效/编号随 reconcile 落草稿 */
  const handleDocChange = (doc: PromptDoc) => {
    setPromptDoc(doc);
    pendingNewRefInsert.current = false;
    const flat = flattenPromptDoc(doc, orderedAssetIdsRef.current);
    syncDraftParams({ prompt: flat, promptDoc: { version: PROMPT_DOC_VERSION, segments: doc.segments, flat } });
  };

  /** @ 菜单：已引用项按查询过滤（名称/编号可搜索） */
  const mentionQuery = mention.open ? mention.query.trim().toLowerCase() : '';
  const mentionItems = orderedImageRefs.filter(
    (r) => !mentionQuery || r.name.toLowerCase().includes(mentionQuery) || `图片${r.number}`.includes(mentionQuery),
  );
  /** 添加新参考入口与 previewRow 同源可见性：达上限或只读时不提供（不留下伪有效标签） */
  const canAddNewRef = !imagesFull && !readOnly;

  const closeMention = () => {
    editorRef.current?.dismissMention();
    setMention({ open: false, query: '' });
    setCanvasMentionOpen(false);
  };

  const pickMentionRef = (assetId: string) => {
    editorRef.current?.insertRefAtMention(assetId);
    setMention({ open: false, query: '' });
  };

  /** @ 菜单选择「添加新参考」：删除本次 @ 查询并记住插入点，走既有添加流程；
   *  添加成功（参考集合出现新身份）后在该位置插入标签；校验拒绝则集合不变、不插入 */
  const pickMentionNewRef = (source: 'assets' | 'canvas') => {
    editorRef.current?.consumeMentionForPendingInsert();
    pendingNewRefInsert.current = true;
    setMention({ open: false, query: '' });
    if (source === 'assets') onPickFromAssets?.();
    else onPickFromCanvas?.();
  };

  const pickMentionEntry = (index: number) => {
    if (index < mentionItems.length) {
      pickMentionRef(mentionItems[index].assetId);
      return;
    }
    pickMentionNewRef(index === mentionItems.length ? 'assets' : 'canvas');
  };

  const handleMentionKey = (key: 'down' | 'up' | 'enter' | 'escape'): boolean => {
    if (!mention.open) return false;
    if (key === 'escape') {
      closeMention();
      return true;
    }
    const total = mentionItems.length + (canAddNewRef ? 2 : 0);
    if (total === 0) return false;
    if (key === 'down') setMentionIndex((i) => (i + 1) % total);
    else if (key === 'up') setMentionIndex((i) => (i - 1 + total) % total);
    else if (key === 'enter') pickMentionEntry(Math.min(mentionIndex, total - 1));
    return true;
  };

  /** 新参考添加成功检测：有效身份集合出现新增 → 在记住的插入点落标签（A3） */
  useEffect(() => {
    const prev = prevAssetIdsRef.current;
    prevAssetIdsRef.current = orderedAssetIds;
    if (!pendingNewRefInsert.current) return;
    const added = orderedAssetIds.filter((id) => !prev.includes(id));
    if (added.length === 0) return;
    pendingNewRefInsert.current = false;
    editorRef.current?.insertRefAtPending(added[added.length - 1]);
  }, [orderedAssetIds]);

  /** 选中模型后应用其默认清晰度/宽高比，返回实际应用值（供草稿参数同步） */
  const applyModelDefaults = (m: GenerationModel) => {
    setSelectedModel(m.model_id);
    const nextSize =
      m.default_size && m.supported_sizes.some((s) => s.id === m.default_size)
        ? m.default_size
        : (m.supported_sizes[0]?.id ?? '');
    if (m.supported_sizes.length) setSelectedResolution(nextSize);
    const nextRatio = pickRatioForSize(m, nextSize, m.default_aspect_ratio);
    setSelectedRatio(nextRatio);
    return { modelId: m.model_id, size: nextSize, ratio: nextRatio };
  };

  // 加载图片模型能力列表：优先选中首页带入的模型，参数逐项按模型能力校验后应用
  useEffect(() => {
    let active = true;
    fetchGenerationModels('image')
      .then((list) => {
        if (!active) return;
        setModelList(list);
        setModelsLoaded(true);
        // 节点已有配置原样恢复；能力变化须由用户调整，打开面板不改写它。
        if (draftBinding && (draftBinding.restoreExisting || initialParams?.modelId)) {
          setSelectedModel(initialParams?.modelId ?? '');
          setSelectedResolution(initialParams?.size ?? '');
          setSelectedRatio(initialParams?.ratio ?? '');
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
        let finalSize = applied.size;
        let finalRatio = applied.ratio;
        // 首页带入参数覆盖默认值（逐项经模型能力校验，不合法项保持该模型默认值）
        if (initialParams) {
          const nextSize =
            initialParams.size && target.supported_sizes.some((s) => s.id === initialParams.size)
              ? initialParams.size
              : target.default_size && target.supported_sizes.some((s) => s.id === target.default_size)
                ? target.default_size
                : target.supported_sizes[0]?.id;
          if (nextSize) {
            setSelectedResolution(nextSize);
            finalSize = nextSize;
          }
          const allowed = ratiosForSelectedSize(target, nextSize ?? '');
          if (initialParams.ratio && allowed.includes(initialParams.ratio)) {
            setSelectedRatio(initialParams.ratio);
            finalRatio = initialParams.ratio;
          }
        }
        // 草稿绑定：把实际生效的完整参数写回草稿节点（含首次默认落值）
        syncDraftParams({ modelId: applied.modelId, size: finalSize, ratio: finalRatio });
      })
      .catch(() => { if (active) setModelsLoaded(true); });
    return () => { active = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** 移除参考素材（非连线绑定模式的面板本地列表；连线绑定模式走 onRemoveMediaRef） */
  const handleRemoveFile = (id: string) => {
    setFiles((prev) => prev.filter((f) => f.id !== id));
  };

  /** 附件排序（IKDLQH）：与相邻项交换后把新 nodeId 序列交给父级；列表仍渲染自 props（父级同步同序快照） */
  const handleAttachmentMove = (index: number, delta: -1 | 1) => {
    if (!attachments || !onReorderAttachments) return;
    const ids = attachments.map((a) => a.nodeId);
    const [moved] = ids.splice(index, 1);
    ids.splice(index + delta, 0, moved);
    onReorderAttachments(ids);
  };

  /** 发送（清晰度传分辨率档位 id，对应生成接口 parameters.size） */
  const handleSend = async () => {
    if (!canSend) return;
    if (!currentGen) {
      console.warn('图片模型能力加载中，请稍后重试');
      return;
    }
    setUploading(true);
    try {
      // 结构化正文仅在含素材标签时携带；纯文本沿用旧语义（不上送 prompt_doc）
      await onSend(flatValue, selectedModel, selectedResolution, selectedRatio, files, docHasAnyRef(promptDoc) ? promptDoc : null);
      // 草稿绑定：保留提示词展示（草稿身份卡承载当次输入）；其余入口维持发送后清空
      if (!draftBinding) {
        editorRef.current?.clear();
        setPromptDoc({ version: PROMPT_DOC_VERSION, segments: [] });
      }
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className={`${styles.dialogWrap} ${followAnchor ? styles.dialogWrapFollow : ''}`}
      style={followAnchor ? { left: followAnchor.left, top: followAnchor.top } : undefined}>
      {/* @ 菜单：挂在 .dialogWrap 层向上弹出（.dialog 是 200px 滚动框会裁剪浮层，IKFA1M） */}
      {mention.open && (
        <div className={styles.mentionDock} ref={mentionMenuRef}>
          <MentionMenu
            items={mentionItems}
            activeIndex={mentionIndex}
            canAddNew={canAddNewRef}
            onPick={pickMentionRef}
            onPickNew={pickMentionNewRef}
            onHoverIndex={setMentionIndex}
          />
          {onMentionCanvas && !canvasMentionOpen && <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => setCanvasMentionOpen(true)}>引用画布素材</button>}
          {canvasMentionOpen && onMentionCanvas && <AtMentionMenu
            anchorRef={mentionMenuRef}
            items={canvasMentionItems ?? []}
            editorQuery={mention.query}
            disabledKinds={['audio']}
            onSelect={(item) => {
              if (item.kind === 'image' && item.assetId && orderedAssetIds.includes(item.assetId)) {
                pickMentionRef(item.assetId);
              } else {
                editorRef.current?.consumeMentionForPendingInsert();
                pendingNewRefInsert.current = item.kind === 'image';
                setMention({ open: false, query: '' });
                onMentionCanvas(item);
              }
              setCanvasMentionOpen(false);
            }}
            onClose={() => setCanvasMentionOpen(false)}
          />}
        </div>
      )}
      {/* 配置面板（可展开/收起）：挂在不带 overflow 的定位外壳 .dialogWrap 上，
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
          {/* 模型与质量：两个选择器同一行 */}
          <div className={styles.configSection}>
            <span className={styles.configLabel}>模型与质量</span>
            <div className={styles.configRow}>
              <div className={styles.selectWrap} ref={modelWrapRef}>
                <button
                  className={styles.selectBtn}
                  onClick={() => { setModelOpen(!modelOpen); setResOpen(false); }}
                  disabled={readOnly}
                >
                  <span>{currentModel?.label ?? '选择模型'}</span>
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
                        disabled={readOnly}
                        className={`${styles.selectOption} ${m.key === selectedModel ? styles.selectOptionActive : ''}`}
                        onClick={() => {
                          const gen = modelList.find((x) => x.model_id === m.key);
                          if (gen) syncDraftParams(applyModelDefaults(gen));
                          else {
                            setSelectedModel(m.key);
                            syncDraftParams({ modelId: m.key });
                          }
                          setModelOpen(false);
                        }}
                      >
                        {m.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <div className={styles.selectWrap} ref={resWrapRef}>
                <button
                  className={styles.selectBtn}
                  onClick={() => { setResOpen(!resOpen); setModelOpen(false); }}
                  disabled={readOnly}
                >
                  <span>{currentResolutionLabel}</span>
                  <ChevronDown
                    size={14}
                    strokeWidth={2}
                    className={`${styles.configArrow} ${resOpen ? styles.configArrowUp : ''}`}
                  />
                </button>
                {resOpen && (
                  <div className={styles.selectDropdown}>
                    {resolutionOptions.map((r) => (
                      <button
                        key={r.key}
                        disabled={readOnly}
                        className={`${styles.selectOption} ${r.key === selectedResolution ? styles.selectOptionActive : ''}`}
                        onClick={() => {
                          setSelectedResolution(r.key);
                          const nextRatio = currentGen ? pickRatioForSize(currentGen, r.key, selectedRatio) : selectedRatio;
                          if (currentGen) setSelectedRatio(nextRatio);
                          syncDraftParams({ size: r.key, ratio: nextRatio });
                          setResOpen(false);
                        }}
                      >
                        {r.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* 宽高比 */}
          <div className={styles.configSection}>
            <span className={styles.configLabel}>宽高比</span>
            <div className={styles.ratioGroup}>
              {ratioOptions.map((r) => (
                <button
                  key={r}
                  className={`${styles.ratioBtn} ${r === selectedRatio ? styles.ratioBtnActive : ''}`}
                  onClick={() => {
                    setSelectedRatio(r);
                    syncDraftParams({ ratio: r });
                  }}
                  disabled={readOnly}
                >
                  <RatioIcon ratio={r} />
                  <span>{r}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      <div className={`${styles.dialog} ${expanded ? styles.dialogExpanded : ''}`}>
      {/* 输入卡片 */}
      <div className={styles.inputBox}>
        {/* 顶部：素材预览 + 右上角操作 */}
        <div className={styles.topRow}>
          <div className={styles.previewRow}>
            {edgeRefs
              ? edgeRefs.map((r) => (
                  <div key={r.nodeId} className={styles.previewItem} title={r.name} data-testid="dock-media-ref">
                    <img src={r.url} alt={r.name} />
                    <span className={styles.previewBadge}>图片{refsNumbering.get(r.assetId) ?? '?'}</span>
                    {!readOnly && (
                      <button
                        className={styles.previewRemove}
                        onClick={() => onRemoveMediaRef?.(r.nodeId)}
                        title="移除"
                      >
                        <X size={10} strokeWidth={2.5} />
                      </button>
                    )}
                  </div>
                ))
              : files.map((f) => (
              <div key={f.id} className={styles.previewItem} title={f.name}>
                {f.type === 'video' ? (
                  <video src={f.url} muted preload="metadata" />
                ) : (
                  <img src={f.url} alt={f.name} />
                )}
                {f.type === 'image' && <span className={styles.previewBadge}>图片{fileNumberOf.get(f.id) ?? '?'}</span>}
                {!readOnly && (
                  <button
                    className={styles.previewRemove}
                    onClick={() => handleRemoveFile(f.id)}
                    title="移除"
                  >
                    <X size={10} strokeWidth={2.5} />
                  </button>
                )}
              </div>
            ))}
            {/* 附件队列末尾：媒体来源菜单（上传入口退役，IKDLQR/IKDLQL 方向；保留资产选择/节点选择，
                画布资产改造融合）。图片达上限或生成中只读时隐藏 */}
            {!imagesFull && !readOnly && (
            <div className={styles.sourceWrap} ref={sourceWrapRef}>
              <button
                className={`${styles.previewItem} ${styles.previewPlaceholder} ${pickMode ? styles.previewPicking : ''}`}
                onClick={() => setSourceMenuOpen((v) => !v)}
                title="从资产中选择 / 到节点选择"
              >
                <Plus size={18} strokeWidth={2} />
              </button>
              {sourceMenuOpen && (
                <>
                  <div className={styles.menuOverlay} onClick={() => setSourceMenuOpen(false)} />
                  <div className={styles.sourceMenu}>
                    <button
                      className={styles.sourceMenuItem}
                      onClick={() => { setSourceMenuOpen(false); onPickFromAssets?.(); }}
                    >
                      <FolderOpen size={14} strokeWidth={2} />
                      <span>从资产中选择</span>
                    </button>
                    <button
                      className={styles.sourceMenuItem}
                      onClick={() => { setSourceMenuOpen(false); onPickFromCanvas?.(); }}
                    >
                      <MousePointerClick size={14} strokeWidth={2} />
                      <span>到节点选择</span>
                    </button>
                  </div>
                </>
              )}
            </div>
            )}
          </div>

          <div className={styles.topActions}>
            <button
              className={styles.iconBtn}
              onClick={() => setExpanded((v) => !v)}
              title={expanded ? '收起' : '展开'}
            >
              {expanded ? <Minimize2 size={14} strokeWidth={2} /> : <Maximize2 size={14} strokeWidth={2} />}
            </button>
            <button className={styles.iconBtn} onClick={onClose} title="关闭">
              <X size={14} strokeWidth={2} />
            </button>
          </div>
        </div>

        {/* 连线文本附件（IKDLQF）：只读展示，增删通过画布连线建立/断开进行；多附件可上移/下移排序（IKDLQH） */}
        {attachments && attachments.length > 0 && (
          <div className={styles.attachments}>
            <span className={styles.configLabel}>文本附件（{attachments.length}）</span>
            {attachments.map((a, i) => (
              <AttachmentItem
                key={a.nodeId}
                attachment={a}
                onRemove={!readOnly && !syncingPlan && a.isPromptPlan && onRemovePlan ? () => onRemovePlan(a.nodeId) : undefined}
                move={
                  // 生成中只读（IKDMQQ）：排序同属输入编辑，一并禁用
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

        {/* 生成中只读提示（IKDMQQ）：任务执行期间参数冻结，取消入口在画布卡片上 */}
        {readOnly && (
          <div className={styles.readOnlyHint}>{draftBinding?.status === 'generating'
            ? '生成中，参数与连线只读；可在画布卡片上取消生成'
            : '正在保存并提交，参数与连线只读'}</div>
        )}

        {/* 输入框 */}
      <PromptSyncActions plans={pendingPlanSyncs} disabled={readOnly || syncingPlan} onSync={onSyncPlan} />
        {configurationError && <div role="alert">{configurationError}</div>}
        {invalidMediaRefs?.map(ref => <div key={ref.nodeId}>
          {ref.name}（不可用）
          {!readOnly && <button type="button" onClick={() => onRemoveMediaRef?.(ref.nodeId)}>移除失效参考</button>}
        </div>)}
        {/* 正文编辑（IKFA1M）：任意光标处输入 @ 插入已引用素材标签；标签绑定稳定身份 */}
        <div className={styles.inputArea}>
          <PromptRefEditor
            ref={editorRef}
            initialDoc={initialDoc ?? null}
            initialText={initialText ?? ''}
            placeholder={uploading ? '正在上传参考图...' : `描述你希望如何编辑这张图片。图片最多 ${maxImages} 张。输入 @ 可引用已选素材。`}
            readOnly={uploading || readOnly}
            orderedAssetIds={orderedAssetIds}
            numbering={refsNumbering}
            refsMeta={refsMeta}
            onChange={handleDocChange}
            onMentionChange={(state) => {
              setMention(state);
              if (state.open) setMentionIndex(0);
            }}
            onMentionKey={handleMentionKey}
            className={styles.textarea}
          />
        </div>


          {/* 底部状态栏 */}
          <div className={styles.bottomBar}>
            {/* 左侧 */}
            <div className={styles.barLeft}>
              <button
                className={styles.configBtn}
                onClick={() => setShowConfig(!showConfig)}
              >
              <SlidersHorizontal size={14} strokeWidth={2} />
              <span>{currentModel?.label ?? (selectedModel || '选择模型')}</span>
              <span className={styles.barDivider} />
              <span>{selectedRatio}</span>
              <span className={styles.barDivider} />
              <span>{currentResolutionLabel}</span>
            </button>
          </div>

          {/* 右侧：发送按钮 */}
          <div className={styles.barRight}>
            {/* 字数统计 */}
            <div className={`${styles.charCount} ${flatValue.length >= maxInput ? styles.charCountWarn : ''}`}>
              {flatValue.length}/{maxInput}
            </div>
            <button
              className={`${styles.sendBtn} ${canSend ? styles.sendBtnActive : ''}`}
              onClick={handleSend}
              disabled={!canSend}
              title={uploading ? '上传中...' : '发送'}
            >
              <ArrowUp size={12.8} fill="currentColor" strokeWidth={0} />
            </button>
          </div>
        </div>
      </div>
      </div>
    </div>
  );
}
