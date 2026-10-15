import { type MediaGenStatus } from '@/custom/enums';
import { useEffect, useMemo, useRef, useState } from 'react';
import { X, AudioLines, ArrowUp, Maximize2, Minimize2 } from 'lucide-react';
import { fetchGenerationModels, type GenerationModel } from '@/custom/api/generation';
import { checkAddAudioRef, audioRefItemMediaTypeOf } from '../../audioMediaRefs';
import { checkReferenceLimits, audioReferenceMaxOf, imageReferenceMaxOfForAudio } from '@/custom/utils/model-reference-limits';
import { remoteImageCrossOrigin, resolveMediaSrc } from '@/shared/utils/remoteImageCors';
import Empty from '@/custom/components/Empty';
import Select from '@/custom/components/Select';
import { useDismissOnOutside } from '../../hooks/useDismissOnOutside';
import { useAudioDurations } from '../../hooks/useAudioDurations';

import { anchoredOverlayStyle, type FollowDialogAnchor } from '../../followDialog';
import type { AtMentionItem } from '../../atMention';
import { docHasAnyRef, docHasInvalidRef, type PromptDoc } from '@/custom/utils/prompt-doc';
import AudioPromptEditor, { type AudioPromptEditorHandle } from './AudioPromptEditor';
import RefThumbnail, { INSERT_REF_AT_SELECTION_TITLE } from '../RefThumbnail';
import AttachmentActionBar from '../AttachmentActionBar';
import { orderRefStripItems, useMixedRefStrip, useRefStripDrag, type RefStripOrderProps } from '../RefThumbnail/strip-dnd';
import { type ImageTextAttachment } from '../ImageDialog';
import { composeImageSendPrompt } from '../ImageDialog/composeImageSendPrompt';
import {
  composedPromptLimitError,
  isPromptOverLimit,
  promptCharCountLabel,
  promptMaxLengthOf,
} from '@/custom/utils/prompt-max-length';
import GenerationQuoteBadge from '../GenerationQuoteBadge';
import styles from './index.module.css';
type RefKind = 'audio' | 'image';

export interface AudioRefItem {
  id: string;
  kind: RefKind;
  name: string;
  src: string;
  source: 'local' | 'canvas';
  assetId?: string | number;
  file?: File;
  textNodeId?: string;
  mediaType?: 'audio' | 'image';
}

export interface CanvasPickItem {
  id: string;
  src: string;
  name: string;
  mediaType: 'image' | 'video' | 'audio';
  assetId?: string;
}

export interface AudioDialogProps extends RefStripOrderProps {
  onClose: () => void;
  projectId?: string;
  onSend: (text: string, modelId: string, refs: AudioRefItem[], promptDoc?: PromptDoc | null) => void | Promise<void>;
  initialText?: string;
  initialDoc?: PromptDoc | null;
  initialRefs?: AudioRefItem[];
  initialModelId?: string;
  draftBinding?: {
    status?: MediaGenStatus;
    restoreExisting?: boolean;
    submitting?: boolean;
    saveFailed?: boolean;
    onParamsChange: (patch: { prompt?: string; modelId?: string; promptDoc?: PromptDoc | null }) => void;
  };
  onToast?: (type: 'success' | 'error' | 'warn', msg: string) => void;
  canvasMedia?: CanvasPickItem[];
  onPickFromCanvas?: () => void;
  onPickFromAssets?: () => void;
  externalPick?: { ts: number; item: AudioRefItem } | null;
  externalAssetPick?: { ts: number; items: AudioRefItem[] } | null;
  onAssetPickConsumed?: () => void;
  pickMode?: boolean;
  draftRefs?: AudioRefItem[];
  draftRefInvalid?: Array<{ nodeId: string; name: string; reason: string }>;
  textIndexError?: string;
  onLocateTextSource?: (textNodeId: string) => void;
  onRemoveDraftRef?: (nodeId: string) => void;
  onAddCanvasRef?: (nodeId: string) => void;
  onSwitchToMusic?: () => void;
  mentionItems?: AtMentionItem[];
  onMentionCanvas?: (item: AtMentionItem) => void;
  attachments?: ImageTextAttachment[];
  onRemoveAttachment?: (nodeId: string) => void;
  onReorderAttachments?: (orderedNodeIds: string[]) => void;
  followAnchor?: FollowDialogAnchor | null;
  dragHidden?: boolean;
}

export default function AudioDialog({
  projectId,
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
  followAnchor, dragHidden,
}: AudioDialogProps) {
  const [text, setText] = useState(initialText ?? '');
  const editorRef = useRef<AudioPromptEditorHandle>(null);
  const [promptDoc, setPromptDoc] = useState<PromptDoc | null>(initialDoc ?? null);
  const [models, setModels] = useState<GenerationModel[]>([]);
  const [modelId, setModelId] = useState(initialModelId ?? '');
  const [modelsLoaded, setModelsLoaded] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [refs, setRefs] = useState<AudioRefItem[]>(initialRefs ?? []);
  const [pickerOpen, setPickerOpen] = useState(false);
  const sourceWrapRef = useRef<HTMLDivElement>(null);

  const durationSources = useMemo(
    () => [...(draftRefs ?? []), ...refs].map((r) => ({ key: `${r.source}-${r.id}`, src: r.src })),
    [draftRefs, refs],
  );
  const durations = useAudioDurations(durationSources);

  useDismissOnOutside([
    { open: pickerOpen, ref: sourceWrapRef, dismiss: () => setPickerOpen(false) },
  ]);

  useEffect(() => {
    let active = true;
    fetchGenerationModels('audio')
      .then((list) => {
        if (!active) return;
        setModels(list);
        setModelsLoaded(true);
        if (draftBinding?.restoreExisting || draftBinding?.status === 'generating') return;
        if (list.length > 0) {
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const currentModel = models.find((m) => m.model_id === modelId);
  const modelUnavailable = modelsLoaded && !currentModel;
  const maxInput = promptMaxLengthOf(currentModel?.features?.max_prompt_length);
  const maxAudioRefs = audioReferenceMaxOf(currentModel?.features);
  const readOnly = draftBinding?.submitting || draftBinding?.status === 'generating';
  const pickLocked = pickMode === true;

  const handleModelSelect = (id: string) => {
    setModelId(id);
    draftBinding?.onParamsChange({ modelId: id });
  };

  const audioRefCount = [...(draftRefs ?? []), ...refs].filter((r) => audioRefItemMediaTypeOf(r) !== 'image').length;
  const imageRefCount = [...(draftRefs ?? []), ...refs].filter((r) => audioRefItemMediaTypeOf(r) === 'image').length;
  const maxImageRefs = imageReferenceMaxOfForAudio(currentModel?.features);
  const mediaLimitReason = imageRefCount > 0 && audioRefCount > 0 ? '音频与图片参考不可混用'
    : imageRefCount >= maxImageRefs ? `参考图最多 ${maxImageRefs} 个`
    : audioRefCount >= maxAudioRefs ? `参考音频最多 ${maxAudioRefs} 段`
    : null;
  const readOnlyReason = '生成中，参数只读；可在画布卡片上取消生成';
  const actionBarDisabledReason = readOnly ? readOnlyReason
    : audioRefCount >= maxAudioRefs ? `参考音频最多 ${maxAudioRefs} 段，已达上限`
    : null;

  const startCanvasPick = () => {
    setPickerOpen(true);
    onPickFromCanvas?.();
  };

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [externalAssetPick]);

  useEffect(() => {
    if (!pickMode) setPickerOpen(false);
  }, [pickMode]);

  const canvasPickItems = (canvasMedia ?? []).filter((m) => m.mediaType === 'audio' || m.mediaType === 'image');
  const namedRefs = refs.map((ref) => {
    const node = ref.source === 'canvas' ? canvasPickItems.find((item) => item.id === ref.id) : undefined;
    return node && node.name !== ref.name ? { ...ref, name: node.name } : ref;
  });
  const allRefs = [...(draftRefs ?? []), ...namedRefs];
  const stripHasItems = allRefs.length > 0 || (attachments?.length ?? 0) > 0;

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

  useEffect(() => {
    return () => {
      refs.forEach((r) => {
        if (r.source === 'local' && r.src.startsWith('blob:')) URL.revokeObjectURL(r.src);
      });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const invalidDraftRefs = (draftRefInvalid ?? []).length > 0;
  const textIndexBlocked = Boolean(textIndexError);
  const referenceLimitError = checkReferenceLimits(
    currentModel?.features,
    currentRefs.map((ref) => ({
      type: audioRefItemMediaTypeOf(ref),
      duration: durations.get(`${ref.source}-${ref.id}`),
    })),
    'audio',
  );
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
    if (!draftBinding) {
      editorRef.current?.clear();
      setText('');
      setRefs([]);
    }
  };

  return (
    <div
      className={`${styles.dialogWrap} ${followAnchor ? styles.dialogWrapFollow : ''}`}
      style={anchoredOverlayStyle(followAnchor ?? null, dragHidden)}
      data-gen-panel-territory
    >
      <div className={`${styles.dialog} ${expanded ? styles.dialogExpanded : ''}`}>
      {}
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

      {}
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
              <Empty className={styles.pickerEmpty} title="画布暂无可选图片或音频" />
            ) : (
              <div className={styles.pickerList}>
                {canvasPickItems.map((it) => (
                  <button
                    key={it.id}
                    className={styles.pickerItem}
                    onClick={() => {
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
                      <img className={styles.pickerThumb} src={resolveMediaSrc(it.src)} crossOrigin={remoteImageCrossOrigin(it.src)} alt="" />
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

      {}
      {stripHasItems && (
      <div className={styles.topRow}>
        {}
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
            insertTitle={INSERT_REF_AT_SELECTION_TITLE}
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
            insertTitle={INSERT_REF_AT_SELECTION_TITLE}
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

      {}
      <div className={styles.mentionAnchor} data-testid="audio-input">
        <AudioPromptEditor ref={editorRef} refs={currentRefs} attachments={orderedAttachments}
          initialText={initialText} initialDoc={initialDoc} readOnly={readOnly || pickLocked} className={styles.textarea}
          placeholder="描述想生成的音频：可生成音乐、音效、台词、多人对话等任意类型，最长 120 秒。使用 @ 引用画布素材。"
          mentionItems={mentionItems} onMentionCanvas={onMentionCanvas}
          onChange={(doc, value) => { setPromptDoc(doc); setText(value); draftBinding?.onParamsChange({ prompt: value, promptDoc: doc }); }} />
      </div>
      {invalidPrompt && <div role="alert">正文有已失效的素材标签或超过字数上限，请调整后发送</div>}
      {}
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

      {}
      <div className={styles.bottomBar}>
        <div className={styles.barLeft}>
          {}
          <div className={styles.modeBtn}>
            <AudioLines size={14} strokeWidth={2} />
            <span>音频生成</span>
          </div>

          {}
          <div className={styles.modeWrap}>
            <Select
              value={modelId}
              onChange={handleModelSelect}
              size="sm"
              side="top"
              disabled={readOnly || pickLocked}
              triggerTitle={pickLocked ? '选取进行中，完成选取后再调整模型配置' : undefined}
              ariaLabel="选择模型"
              placeholder="选择模型"
              options={models.map((opt) => ({ value: opt.model_id, label: opt.model_label }))}
            />
          </div>
        </div>

        <div className={styles.barRight}>
          {}
          {projectId ? (
            <GenerationQuoteBadge
              projectId={projectId}
              type="audio"
              parameters={{ model_id: modelId }}
            />
          ) : null}
          {readOnly && (
            <span className={styles.readOnlyHint}>{readOnlyReason}</span>
          )}
          {}
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
