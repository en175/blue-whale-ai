import PromptSyncActions from '../PromptSyncActions';
/* ============================================
 * ImageDialog 图片对话窗口：参考图上传/模型/清晰度/比例配置
 * ============================================ */
import { useState, useRef, useEffect, useMemo } from 'react';
import type { Node } from '@xyflow/react';
import {
  X,
  ChevronDown,
  Maximize2,
  Minimize2,
  SlidersHorizontal,
  ArrowUp,
} from 'lucide-react';
import { fetchGenerationModels, type GenerationModel } from '@/api/generation';
import {
  PROMPT_DOC_VERSION,
  docHasAnyRef,
  docHasInvalidRef,
  flattenPromptDocWith,
  imageRefLabelOf,
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
import { useMixedRefStrip, orderRefStripItems, useRefStripDrag, type RefStripOrderProps } from '../RefThumbnail/strip-dnd';
import { pickRatioForSize, ratiosForSelectedSize } from '@/lib/image-size-ratios';
import { refOverflowToast } from '@/utils/ref-overflow';
import type { ImageMediaRef } from '../../mediaRefs';
import { cardNameOfNode, localNodeIdOf } from '../../mediaRefs';
import type { MediaGenStatus } from '../MediaNode';
import { useDismissOnOutside } from '../../hooks/useDismissOnOutside';
import AtMentionMenu from '../AtMentionMenu';
import RefSourceMenu from '../RefSourceMenu';
import { type AtMentionItem } from '../../atMention';
import type { FollowDialogAnchor } from '../../followDialog';
import styles from './index.module.css';

/** 输入框默认字数上限（模型目录未配 max_prompt_length 时沿用旧行为，ADR-0085） */
const DEFAULT_MAX_INPUT = 1000;
/** 参考文本与输入文本拼接后的提交上限 */
export const IMAGE_COMPOSED_PROMPT_LIMIT = 1000;
export const IMAGE_COMPOSED_PROMPT_OVER_LIMIT = '当前参考提示词内容超出1000字限制，请重新编辑。';

/** 参考文本在前、输入文本在后，跳过空白附件，以空行拼接为提交 prompt */
export function composeImageSendPrompt(
  attachments: ImageTextAttachment[] | undefined,
  input: string,
  promptDoc?: PromptDoc | null,
): string {
  const indexed = promptDoc?.segments.some((segment) => segment.kind === 'text_ref');
  const parts = indexed
    ? (attachments ?? []).map((item, i) => `文本${i + 1}：${item.text}`)
    : (attachments ?? []).map((item) => item.text).filter((text) => text.trim().length > 0);
  if (input.trim().length > 0) parts.push(input);
  return parts.join('\n\n');
}

/** 图片面板普通参考中视频素材上限（ADR-0086：读能力行 video_reference_max，缺省 3；
 *  旧写死 MAX_VIDEOS=3 退役）。 */
export const MAX_VIDEOS = 3;

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

interface ImageDialogProps extends RefStripOrderProps {
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
  /** 移除文本附件（IKFCKN）：× 仅断开当前连线（保留画布原文本卡），自由模式同步移除附件快照 */
  onRemoveAttachment?: (nodeId: string) => void;
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
  /** 参考栏拖拽换位（IKFCKT）：连线模式媒体换位 = 按新顺序重排目标连入媒体边序（编号=边序派生自动重编号） */
  onReorderMediaRefs?: (orderedNodeIds: string[]) => void;
  /** 参考栏拖拽换位（IKFCKT）：文本附件换位 = 按新顺序重排文本连入边序（顺序即生成上下文拼接顺序） */
  onReorderAttachments?: (orderedNodeIds: string[]) => void;
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

export default function ImageDialog({ onClose, onSend, initialText, initialDoc, initialFiles, initialParams, attachments, onRemoveAttachment, pendingPlanSyncs, onSyncPlan, syncingPlan, onPickFromCanvas, onPickFromAssets, pickMode, externalPick, onExternalPickConsumed, onToast, draftBinding, mediaRefs, invalidMediaRefs, planReferenceError, onRemoveMediaRef, onReorderMediaRefs, onReorderAttachments, stripOrder, onStripOrderChange, mentionItems: canvasMentionItems, onMentionCanvas, currentNodes, followAnchor }: ImageDialogProps) {
  /** 结构化正文（IKFA1M）：文字与素材标签的片段序列；标签绑定稳定身份，编号按当前输入派生 */
  const [promptDoc, setPromptDoc] = useState<PromptDoc>(() =>
    initialDoc ?? { version: PROMPT_DOC_VERSION, segments: initialText ? [{ kind: 'text' as const, text: initialText }] : [] },
  );
  const editorRef = useRef<PromptRefEditorHandle>(null);
  /** @ 菜单状态（已引用 + 素材分类） */
  const [mention, setMention] = useState<MentionState>({ open: false, query: '' });
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
  const modelWrapRef = useRef<HTMLDivElement>(null);
  const resWrapRef = useRef<HTMLDivElement>(null);
  const configPanelRef = useRef<HTMLDivElement>(null);
  const mentionMenuRef = useRef<HTMLDivElement>(null);
  /** 失效标签替换菜单（IKFA1N B5）：记录发起点击的标签节点 key，null 为关闭 */
  const [replaceTarget, setReplaceTarget] = useState<string | null>(null);
  const replaceMenuRef = useRef<HTMLDivElement>(null);

  useDismissOnOutside([
    { open: modelOpen, ref: modelWrapRef, dismiss: () => setModelOpen(false) },
    { open: resOpen, ref: resWrapRef, dismiss: () => setResOpen(false) },
    { open: showConfig, ref: configPanelRef, dismiss: () => setShowConfig(false) },
    { open: replaceTarget !== null, ref: replaceMenuRef, dismiss: () => setReplaceTarget(null) },
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
  /** 参考图上限（ADR-0086：读能力行 features.max_reference_images，缺省回落 DEFAULT_MAX_REFERENCE_IMAGES=10；
   *  旧写死 9 张退役）。连线绑定模式仍以服务端 max_reference_images 校验兜底。 */
  const maxImages = currentGen?.features?.max_reference_images ?? 10;
  /** 连线绑定模式（IKDMQR）：参考区渲染连线推导的 mediaRefs；否则渲染面板本地 files */
  const edgeRefs = mediaRefs ?? null;
  const mixedStrip = useMixedRefStrip(
    edgeRefs ? edgeRefs.map(r => `node:${r.nodeId}`) : files.map(f => `file:${f.id}`),
    (attachments ?? []).map(a => a.nodeId), { stripOrder, onStripOrderChange },
  );
  const imagesFull = edgeRefs ? edgeRefs.length >= maxImages : imageCount >= maxImages;

  /** 有效图片参考（保序去重）+ 展示编号（IKFA1M）：
   *  编号 = 素材在最终 input_asset_ids 中的下标+1——连线模式 = 连线顺序（与服务端同源推导）；
   *  本地模式 = 图片文件顺序（含待上传项占位，与 collectImageInputAssetIds 保序一致）。
   *  附件区角标、@ 菜单、正文标签、服务端编译共用同一映射。 */
  const orderedImageRefs = useMemo(() => {
    const out: Array<{ assetId: string; url: string; name: string; number: number }> = [];
    if (edgeRefs) {
      orderRefStripItems(edgeRefs, r => `media:node:${r.nodeId}`, mixedStrip.order).forEach((r) => {
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
  }, [edgeRefs, files, mixedStrip.order]);
  const orderedAssetIds = useMemo(() => orderedImageRefs.map((r) => r.assetId), [orderedImageRefs]);
  /** IKFA1P：文本附件标签映射（唯一口径）——附件顺序 = 画布连入边序（与服务端 text_attachments 同源） */
  const orderedTextNodeIds = useMemo(() => mixedStrip.order.filter(key => key.startsWith('text:')).map(key => key.slice(5)), [mixedStrip.order]);
  const refsLabels = useMemo(
    () => new Map<string, string>([
      ...orderedImageRefs.map((r) => [r.assetId, `图片${r.number}`] as const),
      ...orderedTextNodeIds.map((id, i) => [id, `文本${i + 1}`] as const),
    ]),
    [orderedImageRefs, orderedTextNodeIds],
  );
  const refsNumbering = useMemo(
    () => new Map(orderedImageRefs.map((r) => [r.assetId, r.number] as const)),
    [orderedImageRefs],
  );
  const refsMeta = useMemo(
    () => new Map<string, { url: string; name: string; mediaType: 'image' | 'text' }>([
      ...orderedImageRefs.map((r) => [r.assetId, { url: r.url, name: r.name, mediaType: 'image' as const }] as const),
      ...(attachments ?? []).map((a) => [a.nodeId, { url: '', name: a.title, mediaType: 'text' as const }] as const),
    ]),
    [orderedImageRefs, attachments],
  );
  /** 标签有效性判定（按寻址键分派，IKFA1P）：媒体 → 图片输入顺序；文本 → 当前附件集合 */
  const refLabelOf = (key: PromptRefKey): string | null =>
    key.kind === 'text_ref'
      ? textRefLabelOf(key.id, orderedTextNodeIds)
      : imageRefLabelOf(key.id, orderedAssetIds);
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
  const orderedTextNodeIdsRef = useRef(orderedTextNodeIds);
  orderedTextNodeIdsRef.current = orderedTextNodeIds;
  /** 拍平镜像（IKFA1M/IKFA1P）：标签 → 图片N/文本N / 已失效：原N；字数统计与发送门槛共用 */
  const flatValue = useMemo(
    () => flattenPromptDocWith(promptDoc, (key) =>
      key.kind === 'text_ref'
        ? textRefLabelOf(key.id, orderedTextNodeIds)
        : imageRefLabelOf(key.id, orderedAssetIds)),
    [promptDoc, orderedAssetIds, orderedTextNodeIds],
  );
  /** 失效标签存在时阻止生成（可删除失效提及后继续；自动/交互修复在下一票 IKFA1N） */
  const hasInvalidRef = docHasInvalidRef(promptDoc);
  /** 附件正文有效（去空白非空）时允许空提示词提交（IKDLQF 契约：附件可单独驱动生成）；
   *  全部有效文本为空时沿用「提示词必填」 */
  const hasAttachmentText = (attachments ?? []).some((a) => a.text.trim().length > 0);
  /** 生成中只读（IKDMQQ）：任务执行期间目标参数冻结，保留查看与画布上的取消入口 */
  const readOnly = uploading || draftBinding?.submitting === true || draftBinding?.status === 'generating';
  /** IKFR4X 持续选取会话锁定：模式中隔离提示词编辑、模型切换与生成（须先完成选取）；
   *  Dock 参考移除、来源入口与关闭不受限（规格 AC-07） */
  const pickLocked = pickMode === true;
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
    : hasInvalidRef ? '正文有已失效的素材标签，请点击标签替换或删除后再发送'
    : flatValue.length > maxInput ? `提示词超过 ${maxInput} 字上限，请精简后再发送`
    : null;
  const canSend = !uploading && !readOnly && !pickLocked && !draftBinding?.saveFailed && !configurationError && (flatValue.trim().length > 0 || hasAttachmentText);

  /** 草稿绑定参数同步（IKDMQQ）：面板内的模型/分辨率/比例/提示词变更实时写回草稿节点 */
  const syncDraftParams = (patch: { prompt?: string; promptDoc?: StoredPromptDoc; modelId?: string; size?: string; ratio?: string }) => {
    draftBinding?.onParamsChange(patch);
  };

  const pendingNewRefInsert = useRef(false);
  const prevAssetIdsRef = useRef(orderedAssetIds);
  const prevTextNodeIdsRef = useRef(orderedTextNodeIds);

  /** 结构化正文变更（IKFA1M/IKFA1P）：同步拍平镜像与结构（双写防丢失），失效/编号随 reconcile 落草稿 */
  const handleDocChange = (doc: PromptDoc) => {
    setPromptDoc(doc);
    pendingNewRefInsert.current = false;
    const flat = flattenPromptDocWith(doc, (key) =>
      key.kind === 'text_ref'
        ? textRefLabelOf(key.id, orderedTextNodeIdsRef.current)
        : imageRefLabelOf(key.id, orderedAssetIdsRef.current));
    syncDraftParams({ prompt: flat, promptDoc: { version: PROMPT_DOC_VERSION, segments: doc.segments, flat } });
  };

  /** 失效替换菜单可选项：全量有效参考与文本附件（IKFA1N B5 语义，不与 @ 查询过滤耦合） */
  const replaceItems = [
    ...orderedImageRefs.map((r) => ({ assetId: r.assetId, url: r.url, name: r.name, badge: `图片${r.number}`, mediaType: 'image' as const })),
    ...(attachments ?? []).map((a, i) => ({ assetId: a.nodeId, url: '', name: a.title, badge: `文本${i + 1}`, mediaType: 'text' as const })),
  ];
  const closeMention = () => {
    editorRef.current?.dismissMention();
    setMention({ open: false, query: '' });
  };

  /** 寻址键分派（IKFA1P）：文本身份（来源节点 id）与媒体身份空间不重叠——按当前附件集合定 kind */
  const refKeyOf = (assetId: string): PromptRefKey => ({
    kind: orderedTextNodeIdsRef.current.includes(assetId) ? 'text_ref' : 'asset_ref',
    id: assetId,
  });

  const pickMentionRef = (assetId: string) => {
    editorRef.current?.insertRefAtMention(refKeyOf(assetId));
    setMention({ open: false, query: '' });
  };

  /** 缩略图 @ 按钮（IKFCKK）：与手动 @ 选择同一种素材标签 chip，走 insertRefAtPending
   *  路径——有记忆光标原位插入、无记录追加末尾，插入后编辑器聚焦 */
  const insertRefByKey = (assetId: string) => {
    editorRef.current?.insertRefAtPending(refKeyOf(assetId));
  };

  /** 新参考添加成功检测：有效身份集合出现新增 → 在记住的插入点落标签（A3；IKFA1P 含新文本附件连入） */
  useEffect(() => {
    const prev = prevAssetIdsRef.current;
    prevAssetIdsRef.current = orderedAssetIds;
    const prevText = prevTextNodeIdsRef.current;
    prevTextNodeIdsRef.current = orderedTextNodeIds;
    if (!pendingNewRefInsert.current) return;
    const added = orderedAssetIds.filter((id) => !prev.includes(id));
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
  }, [orderedAssetIds, orderedTextNodeIds]);

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

  const handleStripReorder = (from: number, to: number) => {
    const result = mixedStrip.reorder(from, to);
    const { nextText, mediaChanged, textChanged } = result;
    const nextMedia = result.nextMedia.map(key => key.slice(key.indexOf(':') + 1));
    if (mediaChanged) {
      if (edgeRefs) {
        onReorderMediaRefs?.(nextMedia);
      } else {
        setFiles((prev) => nextMedia.flatMap((id) => {
          const found = prev.find((f) => f.id === id);
          return found ? [found] : [];
        }));
      }
    }
    if (textChanged) onReorderAttachments?.(nextText);
  };
  const stripDrag = useRefStripDrag({ disabled: readOnly, onReorder: handleStripReorder });

  /** 发送（清晰度传分辨率档位 id，对应生成接口 parameters.size） */
  const handleSend = async () => {
    if (!canSend) return;
    if (!currentGen) {
      console.warn('图片模型能力加载中，请稍后重试');
      return;
    }
    if (composeImageSendPrompt(attachments, flatValue, promptDoc).length > IMAGE_COMPOSED_PROMPT_LIMIT) {
      onToast?.('warn', IMAGE_COMPOSED_PROMPT_OVER_LIMIT);
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
    <div
      className={`${styles.dialogWrap} ${followAnchor ? styles.dialogWrapFollow : ''}`}
      style={followAnchor ? { left: followAnchor.left, top: followAnchor.top } : undefined}
    >
      {/* @ 菜单：挂在 .dialogWrap 层向上弹出（.dialog 是 200px 滚动框会裁剪浮层，IKFA1M） */}
      {mention.open && (
        <div className={styles.mentionDock} ref={mentionMenuRef}>
          <AtMentionMenu
            renderInline
            anchorRef={mentionMenuRef}
            items={canvasMentionItems ?? []}
            editorQuery={mention.query}
            referencedItems={replaceItems.map(r => ({
              id: r.assetId, assetId: r.assetId, name: r.name, thumbUrl: r.url,
              kind: r.mediaType, badge: r.badge,
            }))}
            onSelectReferenced={(item) => pickMentionRef(item.id)}
            disabledKinds={['audio']}
            onSelect={(item) => {
              if (item.kind === 'image' && item.assetId && orderedAssetIds.includes(item.assetId)) {
                pickMentionRef(item.assetId);
              } else if (item.kind === 'text' && orderedTextNodeIds.includes(item.id)) {
                // IKFA1P：已在附件中的文本 → 直接插标签（多次提及不重复建连线）
                pickMentionRef(item.id);
              } else {
                // IKFA1P：新文本走画布连线添加附件（pendingNewRefInsert 含文本检测）；新图片加入参考
                editorRef.current?.consumeMentionForPendingInsert();
                pendingNewRefInsert.current = item.kind === 'image' || item.kind === 'text';
                setMention({ open: false, query: '' });
                onMentionCanvas?.(item);
              }
            }}
            onClose={closeMention}
          />
        </div>
      )}
      {/* 失效标签替换菜单（IKFA1N B5）：与 @ 菜单同停靠位，选择后仅替换发起点击的那次提及 */}
      {replaceTarget !== null && (
        <div className={styles.mentionDock} ref={replaceMenuRef}>
          <ReplaceRefMenu
            items={replaceItems}
            onPick={(assetId) => {
              editorRef.current?.replaceRefAt(replaceTarget, refKeyOf(assetId));
              setReplaceTarget(null);
            }}
          />
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
            {/* IKFCKK：附件条替换为共享参考缩略图（三态交互），编号圆钮仅显示数字、
                底部「图片N」文字标签随旧自绘实现下线；× 走既有断开引用链路、@ 复用记忆光标插入。
                IKFCKT：媒体与文本按稳定身份序混排，dragProps 使用实际 DOM 对应的统一 index */}
            {mixedStrip.render(edgeRefs
              ? edgeRefs.map((r, i) => (
                  <RefThumbnail
                    key={r.nodeId}
                    data-testid="dock-media-ref"
                    kind="image"
                    url={r.url}
                    name={r.name}
                    number={refsNumbering.get(r.assetId)}
                    onRemove={!readOnly ? () => onRemoveMediaRef?.(r.nodeId) : undefined}
                    onInsertRef={!readOnly ? () => insertRefByKey(r.assetId) : undefined}
                    dragProps={stripDrag.itemProps(mixedStrip.index(i))}
                  />
                ))
              : files.map((f, i) => (
                  <RefThumbnail
                    key={f.id}
                    kind={f.type}
                    url={f.url}
                    name={f.name}
                    number={f.type === 'image' ? fileNumberOf.get(f.id) : undefined}
                    onRemove={!readOnly ? () => handleRemoveFile(f.id) : undefined}
                    onInsertRef={!readOnly && f.assetId != null ? () => insertRefByKey(String(f.assetId)) : undefined}
                    dragProps={stripDrag.itemProps(mixedStrip.index(i))}
                  />
                )),
            (attachments ?? []).map((a, i) => (
              <RefThumbnail
                key={a.nodeId}
                data-testid="dock-text-ref"
                kind="text"
                name={a.title}
                number={orderedTextNodeIds.indexOf(a.nodeId) + 1}
                textPreview={a.text}
                dragProps={stripDrag.itemProps(mixedStrip.index((edgeRefs ? edgeRefs.length : files.length) + i))}
                onRemove={
                  !readOnly && (!a.isPromptPlan || !syncingPlan) && onRemoveAttachment
                    ? () => onRemoveAttachment(a.nodeId)
                    : undefined
                }
                onInsertRef={!readOnly ? () => insertRefByKey(a.nodeId) : undefined}
              />
            )))}
            {/* 附件队列末尾：统一附件来源入口（IKFE8T，上传入口已退役）——
                「从资产中选择 / 从节点添加素材」两项菜单；图片达上限或生成中只读时隐藏 */}
            {!imagesFull && !readOnly && (
              <RefSourceMenu
                onPickFromAssets={() => onPickFromAssets?.()}
                onPickFromCanvas={() => onPickFromCanvas?.()}
                pickMode={pickMode}
              />
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
            readOnly={uploading || readOnly || pickLocked}
            labelOf={refLabelOf}
            reconcileKey={`${orderedAssetIds.join(',')}|${orderedTextNodeIds.join(',')}`}
            labels={refsLabels}
            refsMeta={refsMeta}
            onChange={handleDocChange}
            onMentionChange={(state) => {
              setMention(state);
            }}
            onInvalidTagClick={readOnly ? undefined : (nodeKey) => setReplaceTarget(nodeKey)}
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
                disabled={pickLocked}
                title={pickLocked ? '选取进行中，完成选取后再调整模型配置' : undefined}
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
