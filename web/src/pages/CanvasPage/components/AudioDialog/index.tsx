/* ============================================
 * AudioDialog 音频生成底部对话框：结构化正文引用 + 真实模型（fetchGenerationModels('audio')）
 * IKFCKS：参考音频 chip 替换为共享参考缩略图（三态交互，播放随 chip 下线）；
 *  画布文本卡连线作为文本附件以 FileText 缩略图进参考栏（× 仅断开连线）
 * IKGB82：接入附件操作条（IKGB1X 契约）——输入框上方第一行「+ 参考」「资产库」pill
 *  直达原菜单两项链路，展开/关闭并入操作条右侧；附件栏空态整条不渲染；
 *  达上限与生成中只读时常显置灰并悬停说明原因；栏尾旧「+」菜单退役。
 * ============================================ */
import { useEffect, useMemo, useRef, useState } from 'react';
import { X, AudioLines, ChevronDown, ArrowUp, Maximize2, Minimize2 } from 'lucide-react';
import { fetchGenerationModels, type GenerationModel } from '@/api/generation';
import { checkAddAudioRef, audioRefItemMediaTypeOf } from '../../audioMediaRefs';
import { checkReferenceLimits, audioReferenceMaxOf, imageReferenceMaxOfForAudio } from '@/lib/model-reference-limits';
import { remoteImageCrossOrigin } from '@/utils/remoteImageCors';
import { useDismissOnOutside } from '../../hooks/useDismissOnOutside';
import { useAudioDurations } from '../../hooks/useAudioDurations';
import type { MediaGenStatus } from '../MediaNode';
import type { FollowDialogAnchor } from '../../followDialog';
import type { AtMentionItem } from '../../atMention';
import { docHasAnyRef, docHasInvalidRef, type PromptDoc } from '@/lib/prompt-doc';
import AudioPromptEditor, { type AudioPromptEditorHandle } from './AudioPromptEditor';
import RefThumbnail from '../RefThumbnail';
import AttachmentActionBar from '../AttachmentActionBar';
import { orderRefStripItems, useMixedRefStrip, useRefStripDrag, type RefStripOrderProps } from '../RefThumbnail/strip-dnd';
import { composeImageSendPrompt, type ImageTextAttachment } from '../ImageDialog';
import {
  composedPromptLimitError,
  isPromptOverLimit,
  promptCharCountLabel,
  promptMaxLengthOf,
} from '@/lib/prompt-max-length';
import styles from './index.module.css';
/** 参考素材类型（保留给 MusicDialog 共享类型） */
type RefKind = 'audio' | 'image';

/** 参考项（保留给 MusicDialog 共享类型） */
export interface AudioRefItem {
  id: string;
  kind: RefKind;
  name: string;
  src: string;
  source: 'local' | 'canvas';
  /** 画布节点选取带入的资产 ID（有则发送时直接复用，跳过上传） */
  assetId?: string | number;
  /** 本地上传保留原始 File（发送时走三步上传换取 assetId） */
  file?: File;
  /** IKFM41 §11：文本带入参考标记——携带即为锁定条目（不渲染移除入口），提交 type 按实际类型 */
  textNodeId?: string;
  /** IKFM41：实际媒体类型（直接参考与文本带入均可为 image / audio） */
  mediaType?: 'audio' | 'image';
}

/** 画布可选媒体节点（保留给 MusicDialog 共享类型） */
export interface CanvasPickItem {
  id: string;
  src: string;
  name: string;
  mediaType: 'image' | 'video' | 'audio';
  assetId?: string;
}

export interface AudioDialogProps extends RefStripOrderProps {
  onClose: () => void;
  /** 发送：提示词 + 模型ID */
  onSend: (text: string, modelId: string, refs: AudioRefItem[], promptDoc?: PromptDoc | null) => void | Promise<void>;
  /** 初始文字描述（草稿打开时带入已保存 prompt） */
  initialText?: string;
  initialDoc?: PromptDoc | null;
  initialRefs?: AudioRefItem[];
  /** 初始模型（节点打开时带入已保存 draftModelId） */
  initialModelId?: string;
  /** 草稿绑定（IKDMQT）：面板编辑实时写回草稿节点；status 为 generating 时参数只读 */
  draftBinding?: {
    status?: MediaGenStatus;
    restoreExisting?: boolean;
    submitting?: boolean;
    saveFailed?: boolean;
    onParamsChange: (patch: { prompt?: string; modelId?: string; promptDoc?: PromptDoc | null }) => void;
  };
  /** Toast 提示（IKDMQU Q3：恢复的模型不可用时提示，由父级注入） */
  onToast?: (type: 'success' | 'error' | 'warn', msg: string) => void;
  /** 画布媒体节点：供「从画布选择」参考图片或音频 */
  canvasMedia?: CanvasPickItem[];
  /** 触发「从画布选择」模式：父级应设置 pickMode */
  onPickFromCanvas?: () => void;
  onPickFromAssets?: () => void;
  /** 外部注入的画布选择结果：父级点击音频节点后生成（自由模式面板用；
   *  草稿模式的画布选取由父级直接建连线，不再经此通道） */
  externalPick?: { ts: number; item: AudioRefItem } | null;
  /** 资产弹窗一次确认的音频，消费后清空，防止重开重放。 */
  externalAssetPick?: { ts: number; items: AudioRefItem[] } | null;
  onAssetPickConsumed?: () => void;
  /** 是否处于画布选择模式中：用于按钮高亮 */
  pickMode?: boolean;
  /** 草稿模式的画布参考（IKFDFZ）：父级从「来源→草稿」连线实时推导（id 为来源节点 id），
   *  与本地上传项合并展示/提交——显示输入 = 实际任务输入 */
  draftRefs?: AudioRefItem[];
  /** 连线推导中失效来源（IKFDFZ）：保留原因提示并阻止发送，用户恢复素材或断开连线后解除 */
  draftRefInvalid?: Array<{ nodeId: string; name: string; reason: string }>;
  /** IKFM41 §11：文本索引发送校验错误（失效/不支持类型），面板持续显示并阻止发送 */
  textIndexError?: string;
  /** IKFM41 §11：文本索引提供的锁定参考定位来源文本卡（平移居中 + 短暂高亮） */
  onLocateTextSource?: (textNodeId: string) => void;
  /** 移除画布参考（IKFDFZ）：断开对应连线（保留来源素材与其他目标关系） */
  onRemoveDraftRef?: (nodeId: string) => void;
  /** 面板「从画布选择」列表添加参考（IKFDFZ）：草稿模式经父级校验后建连线；自由模式缺省走本地注入 */
  onAddCanvasRef?: (nodeId: string) => void;
  /** 底部模式切换 → AI 音乐对话框（已废弃：仅保留 prop 兼容父级，不再渲染） */
  onSwitchToMusic?: () => void;
  /** 画布 @ 引用候选 */
  mentionItems?: AtMentionItem[];
  /** 选中 @ 素材后写入参考区 */
  onMentionCanvas?: (item: AtMentionItem) => void;
  /** 连线文本附件（IKFCKS）：音频草稿的画布文本卡连线实时推导，FileText 缩略图进参考栏 */
  attachments?: ImageTextAttachment[];
  /** 移除文本附件（IKFCKS）：× 仅断开当前连线（保留画布原文本卡） */
  onRemoveAttachment?: (nodeId: string) => void;
  /** 参考栏拖拽换位（IKFCKT）：文本附件新顺序 = 重排文本连入边序（顺序即生成上下文拼接顺序） */
  onReorderAttachments?: (orderedNodeIds: string[]) => void;
  /** 绑定草稿卡时悬浮跟随；缺省仍锚定底部 */
  followAnchor?: FollowDialogAnchor | null;
}

export default function AudioDialog({
  onClose,
  onSend,
  initialText,
  initialDoc,
  initialRefs,
  initialModelId,
  draftBinding,
  onToast,
  canvasMedia = [],
  onPickFromCanvas,
  onPickFromAssets,
  externalPick,
  externalAssetPick,
  onAssetPickConsumed,
  pickMode,
  draftRefs,
  draftRefInvalid,
  textIndexError,
  onLocateTextSource,
  onRemoveDraftRef,
  onAddCanvasRef,
  mentionItems,
  onMentionCanvas,
  attachments,
  onRemoveAttachment,
  onReorderAttachments,
  stripOrder,
  onStripOrderChange,
  followAnchor,
}: AudioDialogProps) {
  const [text, setText] = useState(initialText ?? '');
  const editorRef = useRef<AudioPromptEditorHandle>(null);
  const [promptDoc, setPromptDoc] = useState<PromptDoc | null>(initialDoc ?? null);
  const [models, setModels] = useState<GenerationModel[]>([]);
  const [modelId, setModelId] = useState(initialModelId ?? '');
  const [modelsLoaded, setModelsLoaded] = useState(false);
  const [modelOpen, setModelOpen] = useState(false);
  /** 放大态：输入区高度占屏幕 2/3；收起回底部默认高度 */
  const [expanded, setExpanded] = useState(false);
  /** 参考音频列表（本地上传 + 自由模式的画布拾取；草稿模式的画布参考经 draftRefs 连线推导） */
  const [refs, setRefs] = useState<AudioRefItem[]>(initialRefs ?? []);
  /** 画布选择面板 */
  const [pickerOpen, setPickerOpen] = useState(false);
  const modelWrapRef = useRef<HTMLDivElement>(null);
  const sourceWrapRef = useRef<HTMLDivElement>(null);

  /** 参考音频时长探测（IKFCKS：放大预览「图标+名称+时长」卡片用；播放随 chip 下线） */
  const durationSources = useMemo(
    () => [...(draftRefs ?? []), ...refs].map((r) => ({ key: `${r.source}-${r.id}`, src: r.src })),
    [draftRefs, refs],
  );
  const durations = useAudioDurations(durationSources);

  useDismissOnOutside([
    { open: modelOpen, ref: modelWrapRef, dismiss: () => setModelOpen(false) },
    { open: pickerOpen, ref: sourceWrapRef, dismiss: () => setPickerOpen(false) },
  ]);

  useEffect(() => {
    let active = true;
    fetchGenerationModels('audio')
      .then((list) => {
        if (!active) return;
        setModels(list);
        setModelsLoaded(true);
        // 原卡编辑保留已保存模型；不可用时由用户显式调整，不自动回写默认值。
        if (draftBinding?.restoreExisting || draftBinding?.status === 'generating') return;
        if (list.length > 0) {
          // 草稿带入的模型优先（仍在可用列表中时），否则回退首个；选中即写回草稿
          // IKDMQU Q3：恢复的模型已不可用时明确提示（回退默认，不静默降级），用户调整后再发送
          const restoredAvailable =
            !!initialModelId && list.some((m) => m.model_id === initialModelId);
          if (initialModelId && !restoredAvailable) {
            onToast?.('warn', '原生成模型已不可用，已回退默认模型，请确认后发送');
          }
          const restored = restoredAvailable ? initialModelId! : list[0].model_id;
          setModelId(restored);
          draftBinding?.onParamsChange({ modelId: restored });
        }
      })
      .catch(() => {
        if (!active) return;
        setModels([]);
        setModelsLoaded(true);
      });
    return () => { active = false; };
    // 挂载时按 seed 初始化一次，后续编辑经用户交互写回
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const currentModel = models.find((m) => m.model_id === modelId);
  const modelUnavailable = modelsLoaded && !currentModel;
  const maxInput = promptMaxLengthOf(currentModel?.features?.max_prompt_length);
  /** 参考音频上限（ADR-0086：读能力行 audio_reference_max，缺省 3；与后端 validateAudioReferences 同源） */
  const maxAudioRefs = audioReferenceMaxOf(currentModel?.features);
  /** 草稿绑定生成中（IKDMQT）：描述/模型/发送只读，保留查看与画布上的取消入口 */
  const readOnly = draftBinding?.submitting || draftBinding?.status === 'generating';
  /** IKFR4Z 持续选取会话锁定：模式中隔离提示词编辑、模型切换与生成（须先完成选取）；
   *  参考移除、来源入口与关闭不受限（规格 AC-07） */
  const pickLocked = pickMode === true;

  const handleModelSelect = (id: string) => {
    setModelId(id);
    setModelOpen(false);
    draftBinding?.onParamsChange({ modelId: id });
  };

  const audioRefCount = [...(draftRefs ?? []), ...refs].filter((r) => audioRefItemMediaTypeOf(r) !== 'image').length;
  const imageRefCount = [...(draftRefs ?? []), ...refs].filter((r) => audioRefItemMediaTypeOf(r) === 'image').length;
  // IKHEXG：音频链路用 FOR_AUDIO 口径——模型未解析时回落官方音频缺省 1，而非图片/视频的 10。
  const maxImageRefs = imageReferenceMaxOfForAudio(currentModel?.features);
  /** 媒体参考无法再添加时的原因（混用 / 分类上限）；文本卡仍可从画布点选。 */
  const mediaLimitReason = imageRefCount > 0 && audioRefCount > 0 ? '音频与图片参考不可混用'
    : imageRefCount >= maxImageRefs ? `参考图最多 ${maxImageRefs} 个`
    : audioRefCount >= maxAudioRefs ? `参考音频最多 ${maxAudioRefs} 段`
    : null;
  /** 生成中只读原因（操作条悬停原因与只读提示条同一文案来源） */
  const readOnlyReason = '生成中，参数只读；可在画布卡片上取消生成';
  /** 附件操作条禁用原因：生成中只读优先；音频件数达上限时置灰（图片上限不挡文本选取）。 */
  const actionBarDisabledReason = readOnly ? readOnlyReason
    : audioRefCount >= maxAudioRefs ? `参考音频最多 ${maxAudioRefs} 段，已达上限`
    : null;

  const startCanvasPick = () => {
    setPickerOpen(true);
    onPickFromCanvas?.();
  };

  /** 添加参考项（去重 + 图音频混用/分类上限，超限明确提示不静默丢弃），画布选择后关闭面板 */
  const addRef = (item: AudioRefItem) => {
    if (refs.some((r) => (r.id === item.id && r.source === item.source) || (r.assetId != null && item.assetId != null && String(r.assetId) === String(item.assetId)))) {
      setPickerOpen(false);
      return;
    }
    const incomingType = audioRefItemMediaTypeOf(item);
    const existing = [...(draftRefs ?? []), ...refs].map((r) => ({
      nodeId: r.id,
      url: r.src,
      name: r.name,
      assetId: String(r.assetId ?? ''),
      mediaType: audioRefItemMediaTypeOf(r),
    }));
    const msg = checkAddAudioRef(
      item.assetId != null ? String(item.assetId) : undefined,
      existing,
      0,
      incomingType,
    );
    if (msg) {
      onToast?.('warn', msg);
      setPickerOpen(false);
      return;
    }
    setRefs((prev) => [...prev, { ...item, kind: incomingType, mediaType: incomingType }]);
    setPickerOpen(false);
  };

  /** 外部注入的画布选择结果：去重 + 上限保护（自由模式通道；草稿模式画布选取由父级建线） */
  useEffect(() => {
    if (!externalPick) return;
    addRef(externalPick.item);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [externalPick]);

  useEffect(() => {
    if (!externalAssetPick) return;
    if (!draftBinding && !readOnly) {
      const next = [...refs];
      for (const item of externalAssetPick.items) {
        if (next.some(ref => String(ref.assetId) === String(item.assetId))) continue;
        const incomingType = audioRefItemMediaTypeOf(item);
        const existing = next.map((r) => ({
          nodeId: r.id,
          url: r.src,
          name: r.name,
          assetId: String(r.assetId ?? ''),
          mediaType: audioRefItemMediaTypeOf(r),
        }));
        const error = checkAddAudioRef(
          item.assetId != null ? String(item.assetId) : undefined,
          existing,
          0,
          incomingType,
        );
        if (error) {
          onToast?.('warn', error);
          continue;
        }
        next.push({ ...item, kind: incomingType, mediaType: incomingType });
      }
      setRefs(next);
    }
    onAssetPickConsumed?.();
    // 每次弹窗确认仅消费一次，后续编辑不重放。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [externalAssetPick]);

  /** 画布选取结束（点到节点或空白取消）后收起面板内的选择列表（IKFDFZ：
   *  草稿模式画布选取由父级直接建线，不经 addRef 的收起路径） */
  useEffect(() => {
    if (!pickMode) setPickerOpen(false);
  }, [pickMode]);

  const canvasPickItems = (canvasMedia ?? []).filter((m) => m.mediaType === 'audio' || m.mediaType === 'image');
  const namedRefs = refs.map((ref) => {
    const node = ref.source === 'canvas' ? canvasPickItems.find((item) => item.id === ref.id) : undefined;
    return node && node.name !== ref.name ? { ...ref, name: node.name } : ref;
  });
  /** 面板展示/提交的完整参考：画布参考（draftRefs，父级连线推导，名称随来源节点即时刷新）
   *  + 本地上传/自由拾取项；顺序统一由参考栏 stripOrder 决定 */
  const allRefs = [...(draftRefs ?? []), ...namedRefs];
  /** 附件栏空态派生（IKGB82）：无任何附件项（音频参考 + 文本附件）时整条不渲染，不引入新的持久状态 */
  const stripHasItems = allRefs.length > 0 || (attachments?.length ?? 0) > 0;

  /** 移除参考（IKFDFZ）：画布参考断开对应连线（保留来源素材与其他目标关系）；
   *  本地上传回收 blob URL 并仅移除面板本地项 */
  const handleRemoveRef = (id: string) => {
    if ((draftRefs ?? []).some((r) => r.id === id)) {
      onRemoveDraftRef?.(id);
      return;
    }
    setRefs((prev) => {
      const item = prev.find((r) => r.id === id);
      if (item?.source === 'local' && item.src.startsWith('blob:')) {
        URL.revokeObjectURL(item.src);
      }
      return prev.filter((r) => r.id !== id);
    });
  };

  const mixedStrip = useMixedRefStrip(allRefs.map(r => `${r.source}:${r.id}`), (attachments ?? []).map(a => a.nodeId), { stripOrder, onStripOrderChange });
  const currentRefs = orderRefStripItems(allRefs, r => `media:${r.source}:${r.id}`, mixedStrip.order);
  const orderedAttachments = orderRefStripItems(attachments ?? [], a => `text:${a.nodeId}`, mixedStrip.order);
  const invalidPrompt = (promptDoc !== null && docHasInvalidRef(promptDoc)) || isPromptOverLimit(text, maxInput);
  const handleStripReorder = (from: number, to: number) => {
    const { nextMedia: nextRefIds, nextText: nextTextKeys, mediaChanged: refChanged, textChanged } = mixedStrip.reorder(from, to);
    if (refChanged) {
      setRefs((prev) => nextRefIds.flatMap((id) => {
        const found = prev.find((r) => `${r.source}:${r.id}` === id);
        return found ? [found] : [];
      }));
    }
    if (textChanged) onReorderAttachments?.(nextTextKeys);
  };
  const stripDrag = useRefStripDrag({ disabled: readOnly, onReorder: handleStripReorder });

  /** 组件卸载时 revoke 所有 blob URL，防内存泄漏 */
  useEffect(() => {
    return () => {
      refs.forEach((r) => {
        if (r.source === 'local' && r.src.startsWith('blob:')) URL.revokeObjectURL(r.src);
      });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** 连线来源失效（IKFDFZ）：保留参考与原因提示并阻止发送，恢复素材或断开连线后解除 */
  const invalidDraftRefs = (draftRefInvalid ?? []).length > 0;
  /** IKFM41 §11：文本索引错误（失效/不支持类型）与连线失效同为发送防线，面板持续显示 */
  const textIndexBlocked = Boolean(textIndexError);
  /** 按最终参考的实际类型校验分类上限、混用与参考素材总时长，随模型和来源变化重算。
   *  IKHEXG：带上 duration——否则 `max_reference_duration_sec` 在音频链路永远不触发
   *  （该键在后台对音频行开放，不传时长等于「配了不生效」）。`durations` 与缩略图同一份来源。 */
  const referenceLimitError = checkReferenceLimits(
    currentModel?.features,
    currentRefs.map((ref) => ({
      type: audioRefItemMediaTypeOf(ref),
      duration: durations.get(`${ref.source}-${ref.id}`),
    })),
    'audio',
  );
  /** 连入文本节点有正文时，输入框为空也可发送（IKHGET，对齐图像/视频节点口径） */
  const hasAttachmentText = (attachments ?? []).some((item) => item.text.trim().length > 0);
  const canSend = Boolean(
    (text.trim() || hasAttachmentText)
    && currentModel
    && !readOnly
    && !pickLocked
    && !invalidPrompt
    && !invalidDraftRefs
    && !textIndexBlocked
    && !referenceLimitError
    && !draftBinding?.saveFailed,
  );
  const handleSend = () => {
    if (!canSend || !currentModel) return;
    const promptDocToSend = promptDoc && docHasAnyRef(promptDoc) ? promptDoc : null;
    const composedOverLimit = composedPromptLimitError(
      composeImageSendPrompt(attachments, text.trim(), promptDocToSend),
      maxInput,
    );
    if (composedOverLimit) {
      onToast?.('warn', composedOverLimit);
      return;
    }
    onSend(text.trim(), modelId, currentRefs, promptDocToSend);
    // 草稿绑定发送后保留输入（卡片原地转生成中，面板进入只读），非草稿保持清空
    if (!draftBinding) {
      editorRef.current?.clear();
      setText('');
      setRefs([]);
    }
  };

  return (
    <div
      className={`${styles.dialogWrap} ${followAnchor ? styles.dialogWrapFollow : ''}`}
      style={followAnchor ? { left: followAnchor.left, top: followAnchor.top } : undefined}
      data-gen-panel-territory
    >
      <div className={`${styles.dialog} ${expanded ? styles.dialogExpanded : ''}`}>
      {/* 第一行：附件操作条（IKGB82，IKGB1X 契约共享组件）——左「+ 参考」「资产库」pill
          直达退役菜单两项链路，右侧并入原 topActions 展开/关闭按钮；达上限与生成中
          只读时常显置灰并悬停说明原因（替代旧「入口消失」口径）；
          actionBarRow 包装仅承载行间距（与 BottomDialog 同形同值；图片面板经 .inputBox flex gap 得同值行距） */}
      <div className={styles.actionBarRow}>
        <AttachmentActionBar
          kind="audio"
          onPickFromCanvas={startCanvasPick}
          onPickFromAssets={() => { setPickerOpen(false); onPickFromAssets?.(); }}
          pickMode={pickMode}
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

      {/* 画布选择面板锚点（startCanvasPick 既有行为保留）：独立于附件栏空态渲染，
          面板从操作条下方弹出；达上限后不提供入口（与旧栏尾分支同口径） */}
      <div className={styles.refWrap} ref={sourceWrapRef}>
        {pickerOpen && !mediaLimitReason && (
          <div className={styles.pickerPanel} onClick={(e) => e.stopPropagation()}>
            <div className={styles.pickerHead}>
              <span>从画布选择素材</span>
              <button className={styles.pickerClose} onClick={() => setPickerOpen(false)} title="关闭">
                <X size={12} strokeWidth={2} />
              </button>
            </div>
            {canvasPickItems.length === 0 ? (
              <div className={styles.pickerEmpty}>画布暂无可选图片或音频</div>
            ) : (
              <div className={styles.pickerList}>
                {canvasPickItems.map((it) => (
                  <button
                    key={it.id}
                    className={styles.pickerItem}
                    onClick={() => {
                      // 草稿模式经父级校验后建连线（IKFDFZ）；自由模式注入面板本地列表
                      const kind = audioRefItemMediaTypeOf({ mediaType: it.mediaType });
                      if (onAddCanvasRef) {
                        onAddCanvasRef(it.id);
                        setPickerOpen(false);
                        return;
                      }
                      addRef({ id: it.id, kind, mediaType: kind, name: it.name, src: it.src, source: 'canvas', assetId: it.assetId });
                    }}
                  >
                    {it.mediaType === 'image' ? (
                      <img className={styles.pickerThumb} src={it.src} crossOrigin={remoteImageCrossOrigin(it.src)} alt="" />
                    ) : (
                      <div className={styles.pickerAudio}>
                        <AudioLines size={14} strokeWidth={2} />
                      </div>
                    )}
                    <span className={styles.pickerName}>{it.name || it.id}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* 附件栏（IKGB82 空态整条不渲染）：有参考/文本附件时出现在操作条与输入框之间——
          顶部参考缩略图条（IKFCKS）：音频参考 + 文本附件统一走共享参考缩略图，
          三态交互（编号圆钮 / 悬停 ×/@ / 200ms 放大预览）；播放 chip 随替换下线。
          栏尾旧「+」菜单（RefSourceMenu 普通变体）随操作条落地自音频面板退役；
          达上限时「已达上限」文案保留在栏尾原位。 */}
      {stripHasItems && (
      <div className={styles.topRow}>
        {/* 参考音频缩略图：编号按参考顺序派生；× 移除面板参考（本地上传回收 blob URL；
            @ 与手动 @ 使用共享正文编辑器；已选项只插入标签，未落库项不提供身份。
            IKFM41：文本带入条目锁定（不渲染 ×、渲染定位来源入口），kind 按实际类型。 */}
        {mixedStrip.render(allRefs.map((r, i) => (
          <RefThumbnail
            key={`${r.source}-${r.id}`}
            data-testid="audio-ref-thumb"
            kind={audioRefItemMediaTypeOf(r)}
            url={r.src}
            name={r.name}
            number={currentRefs.findIndex(ref => ref.id === r.id && ref.source === r.source) + 1}
            audioDuration={durations.get(`${r.source}-${r.id}`)}
            locked={r.textNodeId != null}
            onLocate={r.textNodeId != null && onLocateTextSource ? () => onLocateTextSource(r.textNodeId!) : undefined}
            onRemove={!readOnly && r.textNodeId == null ? () => handleRemoveRef(r.id) : undefined}
            onInsertRef={
              !readOnly && r.assetId
                ? () => editorRef.current?.insert({ kind: 'asset_ref', id: String(r.assetId) })
                : undefined
            }
            dragProps={stripDrag.itemProps(mixedStrip.index(i))}
          />
        )),
        (attachments ?? []).map((a, i) => (
          <RefThumbnail
            key={a.nodeId}
            data-testid="dock-text-ref"
            kind="text"
            name={a.title}
            number={mixedStrip.order.filter(key => key.startsWith('text:')).indexOf(`text:${a.nodeId}`) + 1}
            textPreview={a.text}
            onInsertRef={!readOnly ? () => editorRef.current?.insert({ kind: 'text_ref', id: a.nodeId }) : undefined}
            dragProps={stripDrag.itemProps(mixedStrip.index(currentRefs.length + i))}
            onRemove={
              !readOnly && onRemoveAttachment ? () => onRemoveAttachment(a.nodeId) : undefined
            }
          />
        )))}
        <div className={styles.refWrap}>
          {mediaLimitReason && (
            <span className={styles.refCount} title={mediaLimitReason}>
              已达上限
            </span>
          )}
        </div>
      </div>
      )}

      {/* 输入框 */}
      <div className={styles.mentionAnchor} data-testid="audio-input">
        <AudioPromptEditor ref={editorRef} refs={currentRefs} attachments={orderedAttachments}
          initialText={initialText} initialDoc={initialDoc} readOnly={readOnly || pickLocked} className={styles.textarea}
          placeholder="描述想生成的音频：可生成音乐、音效、台词、多人对话等任意类型，最长 120 秒。使用 @ 引用画布素材。"
          mentionItems={mentionItems} onMentionCanvas={onMentionCanvas}
          onChange={(doc, value) => { setPromptDoc(doc); setText(value); draftBinding?.onParamsChange({ prompt: value, promptDoc: doc }); }} />
      </div>
      {invalidPrompt && <div role="alert">正文有已失效的素材标签或超过字数上限，请调整后发送</div>}
      {/* 分类上限与文本索引校验会产出同一句「参考图最多 x 个」：只展示一条（优先文本索引原因） */}
      {(textIndexError || referenceLimitError) && (
        <div role="alert" data-testid={textIndexError ? 'audio-text-index-error' : 'audio-ref-overflow'}>
          {textIndexError || referenceLimitError}
        </div>
      )}
      {invalidDraftRefs && (
        <div role="alert" data-testid="audio-ref-invalid">
          {draftRefInvalid!.map((item) => `${item.name}：${item.reason}，请恢复素材或移除后发送`).join('；')}
        </div>
      )}

      {modelUnavailable && <div role="alert">模型不可用，请选择可用模型后发送</div>}

      {/* 底部状态栏 */}
      <div className={styles.bottomBar}>
        <div className={styles.barLeft}>
          {/* 模式：固定显示「音频生成」，无下拉（AI 音乐已废弃） */}
          <div className={styles.modeBtn}>
            <AudioLines size={14} strokeWidth={2} />
            <span>音频生成</span>
          </div>

          {/* 模型选择 */}
          <div className={styles.modeWrap} ref={modelWrapRef}>
            <button
              className={styles.modeBtn}
              onClick={() => setModelOpen((v) => !v)}
              disabled={readOnly || pickLocked}
              title={pickLocked ? '选取进行中，完成选取后再调整模型配置' : undefined}
            >
              <span>{currentModel?.model_label ?? '选择模型'}</span>
              <ChevronDown
                size={10}
                strokeWidth={2}
                className={`${styles.modeArrow} ${modelOpen ? styles.modeArrowUp : ''}`}
              />
            </button>
            {modelOpen && (
              <div className={styles.modeDropdown}>
                {models.map((opt) => (
                  <button
                    key={opt.model_id}
                    className={`${styles.modeOption} ${opt.model_id === modelId ? styles.modeOptionActive : ''}`}
                    onClick={() => handleModelSelect(opt.model_id)}
                  >
                    {opt.model_label}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className={styles.barRight}>
          {readOnly && (
            <span className={styles.readOnlyHint}>{readOnlyReason}</span>
          )}
          {/* 字数统计 */}
          <div className={`${styles.charCount} ${maxInput != null && text.length >= maxInput ? styles.charCountWarn : ''}`}>
            {promptCharCountLabel(text.length, maxInput)}
          </div>
          <button
            className={`${styles.sendBtn} ${canSend ? styles.sendBtnActive : ''}`}
            data-testid="audio-send"
            disabled={!canSend}
            onClick={handleSend}
            title="发送"
          >
            <ArrowUp size={12.8} fill="currentColor" strokeWidth={0} />
          </button>
        </div>
      </div>
      </div>
    </div>
  );
}
