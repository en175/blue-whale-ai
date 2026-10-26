import { type MediaGenStatus } from '@/custom/enums';
import PromptSyncActions from '../PromptSyncActions';
import { composeImageSendPrompt } from './composeImageSendPrompt';
import { useState, useRef, useEffect, useMemo } from 'react';
import type { Node } from '@xyflow/react';
import {
  X,
  Maximize2,
  Minimize2,
  SlidersHorizontal,
  ArrowUp,
} from 'lucide-react';
import { fetchGenerationModels, type GenerationModel } from '@/custom/api/generation';
import { videoReferenceMaxOf } from '@/custom/utils/model-reference-limits';
import {
  composedPromptLimitError,
  promptCharCountLabel,
  promptMaxLengthOf,
} from '@/custom/utils/prompt-max-length';
import RatioGroup from '@/custom/components/RatioGroup';
import Select from '@/custom/components/Select';
import GenerationQuoteBadge from '../GenerationQuoteBadge';
import { buildImageJobReferences } from '../../tools/video/videoJobReferences';
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
} from '@/custom/utils/prompt-doc';
import PromptRefEditor, {
  type MentionState,
  type PromptRefEditorHandle,
} from '../PromptRefEditor';
import ReplaceRefMenu from '../PromptRefEditor/ReplaceRefMenu';
import RefThumbnail, { INSERT_REF_APPEND_TITLE } from '../RefThumbnail';
import { useMixedRefStrip, orderRefStripItems, useRefStripDrag, type RefStripOrderProps } from '../RefThumbnail/strip-dnd';
import { pickRatioForSize, ratiosForSelectedSize } from '@/custom/utils/image-size-ratios';
import { refOverflowToast } from '@/custom/utils/ref-overflow';
import type { ImageMediaRef } from '../../media/mediaRefs';
import { cardNameOfNode, localNodeIdOf } from '../../media/mediaRefs';

import { useDismissOnOutside } from '../../hooks/shared/useDismissOnOutside';
import AtMentionMenu from '../AtMentionMenu';
import AttachmentActionBar from '../AttachmentActionBar';
import { type AtMentionItem } from '../../agent/atMention';
import { anchoredOverlayStyle, type FollowDialogAnchor } from '../../agent/followDialog';
import styles from './index.module.css';

export interface UploadedFile {
  id: string;
  url: string;
  type: 'image' | 'video';
  name: string;
  file?: File;
  assetId?: string | number;
}

export interface ImageTextAttachment {
  nodeId: string;
  isPromptPlan?: boolean;
  title: string;
  text: string;
}

interface ImageDialogProps extends RefStripOrderProps {
  onClose: () => void;
  projectId?: string;
  onSend: (text: string, modelId: string, size: string, ratio: string, files: UploadedFile[], promptDoc?: PromptDoc | null) => Promise<void> | void;
  initialText?: string;
  initialDoc?: PromptDoc | null;
  initialFiles?: UploadedFile[];
  initialParams?: ImageGenSeedParams;
  attachments?: ImageTextAttachment[];
  onRemoveAttachment?: (nodeId: string) => void;
  onPickFromCanvas?: () => void;
  onPickFromAssets?: () => void;
  pickMode?: boolean;
  externalPick?: { ts: number; files: UploadedFile[] } | null;
  onExternalPickConsumed?: () => void;
  onOpenCharacterLibrary?: () => void;
  onToast?: (type: 'success' | 'error' | 'warn', msg: string) => void;
  draftBinding?: {
    status?: MediaGenStatus;
    restoreExisting?: boolean;
    saveFailed?: boolean;
    submitting?: boolean;
    onParamsChange: (patch: { prompt?: string; promptDoc?: StoredPromptDoc; modelId?: string; size?: string; ratio?: string }) => void;
  };
  mediaRefs?: ImageMediaRef[];
  planReferenceError?: string;
  pendingPlanSyncs?: Array<{ nodeId: string; title: string }>;
  onSyncPlan?: (nodeId: string) => void;
  syncingPlan?: boolean;
  invalidMediaRefs?: Array<{ nodeId: string; name: string }>;
  onRemoveMediaRef?: (sourceNodeId: string) => void;
  onLocateTextSource?: (textNodeId: string) => void;
  textIndexError?: string;
  onReorderMediaRefs?: (orderedNodeIds: string[]) => void;
  onReorderAttachments?: (orderedNodeIds: string[]) => void;
  mentionItems?: AtMentionItem[];
  onMentionCanvas?: (item: AtMentionItem) => void;
  currentNodes?: Node[];
  followAnchor?: FollowDialogAnchor | null;
  dragHidden?: boolean;
}

export interface ImageGenSeedParams {
  modelId?: string;
  ratio?: string;
  size?: string;
}

export default function ImageDialog({ projectId, onClose, onSend, initialText, initialDoc, initialFiles, initialParams, attachments, onRemoveAttachment, pendingPlanSyncs, onSyncPlan, syncingPlan, onPickFromCanvas, onPickFromAssets, pickMode, externalPick, onExternalPickConsumed, onToast, draftBinding, mediaRefs, invalidMediaRefs, planReferenceError, onRemoveMediaRef, onLocateTextSource, textIndexError, onReorderMediaRefs, onReorderAttachments, stripOrder, onStripOrderChange, mentionItems: canvasMentionItems, onMentionCanvas, currentNodes, followAnchor, dragHidden }: ImageDialogProps) {
  const [promptDoc, setPromptDoc] = useState<PromptDoc>(() =>
    initialDoc ?? { version: PROMPT_DOC_VERSION, segments: initialText ? [{ kind: 'text' as const, text: initialText }] : [] },
  );
  const editorRef = useRef<PromptRefEditorHandle>(null);
  const [mention, setMention] = useState<MentionState>({ open: false, query: '' });
  const [modelList, setModelList] = useState<GenerationModel[]>([]);
  const [modelsLoaded, setModelsLoaded] = useState(false);
  const [selectedModel, setSelectedModel] = useState('');
  const [selectedResolution, setSelectedResolution] = useState('');
  const [selectedRatio, setSelectedRatio] = useState('');
  const [showConfig, setShowConfig] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [files, setFiles] = useState<UploadedFile[]>(initialFiles ?? []);
  const [uploading, setUploading] = useState(false);
  const configPanelRef = useRef<HTMLDivElement>(null);
  const mentionMenuRef = useRef<HTMLDivElement>(null);
  const [replaceTarget, setReplaceTarget] = useState<string | null>(null);
  const replaceMenuRef = useRef<HTMLDivElement>(null);

  useDismissOnOutside([
    { open: showConfig, ref: configPanelRef, dismiss: () => setShowConfig(false) },
    { open: replaceTarget !== null, ref: replaceMenuRef, dismiss: () => setReplaceTarget(null) },
  ]);

  const currentGen = modelList.find((m) => m.model_id === selectedModel);
  const maxInput = promptMaxLengthOf(currentGen?.features?.max_prompt_length);
  const maxImages = currentGen?.features?.image_reference_max ?? 10;
  const maxVideos = videoReferenceMaxOf(currentGen?.features);

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

  useEffect(() => {
    if (!externalPick) return;
    if (!mediaRefs) {
      setFiles((prev) => {
        let next = prev;
        for (const file of externalPick.files) {
          const imgCount = next.filter((f) => f.type === 'image').length;
          const vidCount = next.filter((f) => f.type === 'video').length;
          const full = file.type === 'image' ? imgCount >= maxImages : vidCount >= maxVideos;
          if (full) {
            onToast?.('warn', refOverflowToast([file.type], { image: maxImages, video: maxVideos }));
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

  const modelOptions = modelList.map((m) => ({ key: m.model_id, label: m.model_label }));
  const resolutionOptions = currentGen?.supported_sizes?.length
    ? currentGen.supported_sizes.map((s) => ({ key: s.id, label: s.label }))
    : [];
  const ratioOptions = currentGen ? ratiosForSelectedSize(currentGen, selectedResolution) : [];
  const currentModel = modelOptions.find((m) => m.key === selectedModel);
  const currentResolutionLabel =
    resolutionOptions.find((r) => r.key === selectedResolution)?.label ?? selectedResolution;
  const imageCount = files.filter((f) => f.type === 'image').length;
  const edgeRefs = mediaRefs ?? null;
  const mixedStrip = useMixedRefStrip(
    edgeRefs ? edgeRefs.map(r => `node:${r.nodeId}`) : files.map(f => `file:${f.id}`),
    (attachments ?? []).map(a => a.nodeId), { stripOrder, onStripOrderChange },
  );
  const imagesFull = edgeRefs ? edgeRefs.length >= maxImages : imageCount >= maxImages;

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
  const quoteReferences = useMemo(() => buildImageJobReferences(orderedAssetIds), [orderedAssetIds]);
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
  const refLabelOf = (key: PromptRefKey): string | null =>
    key.kind === 'text_ref'
      ? textRefLabelOf(key.id, orderedTextNodeIds)
      : imageRefLabelOf(key.id, orderedAssetIds);
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
  const flatValue = useMemo(
    () => flattenPromptDocWith(promptDoc, (key) =>
      key.kind === 'text_ref'
        ? textRefLabelOf(key.id, orderedTextNodeIds)
        : imageRefLabelOf(key.id, orderedAssetIds)),
    [promptDoc, orderedAssetIds, orderedTextNodeIds],
  );
  const hasInvalidRef = docHasInvalidRef(promptDoc);
  const hasAttachmentText = (attachments ?? []).some((a) => a.text.trim().length > 0);
  const readOnly = uploading || draftBinding?.submitting === true || draftBinding?.status === 'generating';
  const readOnlyReason = draftBinding?.status === 'generating'
    ? '生成中，参数与连线只读；可在画布卡片上取消生成'
    : '正在保存并提交，参数与连线只读';
  const actionBarDisabledReason = readOnly ? readOnlyReason
    : imagesFull ? `参考图片最多 ${maxImages} 张，已达上限`
    : null;
  const stripHasItems = (edgeRefs ? edgeRefs.length : files.length) > 0 || (attachments?.length ?? 0) > 0;
  const pickLocked = pickMode === true;
  const configurationError = planReferenceError ? planReferenceError
    : !modelsLoaded ? '正在加载模型配置'
    : !currentGen ? '原生成模型已不可用，请重新选择模型'
    : selectedResolution && !resolutionOptions.some(option => option.key === selectedResolution)
      ? '原分辨率已不可用，请重新选择分辨率'
    : selectedRatio && !ratioOptions.some(option => option.id === selectedRatio)
      ? '原比例与当前配置不兼容，请重新选择比例'
    : invalidMediaRefs?.length ? '参考素材不可用，请调整参考后发送'
    : textIndexError ? textIndexError
    : edgeRefs?.length && !currentGen.features.reference_image ? '当前模型不支持图片参考，请调整模型或参考'
    : edgeRefs && edgeRefs.length > Math.min(maxImages, currentGen.features.image_reference_max || maxImages)
      ? '参考图片数量超过模型支持上限，请调整参考'
    : hasInvalidRef ? '正文有已失效的素材标签，请点击标签替换或删除后再发送'
    : maxInput != null && flatValue.length > maxInput ? `提示词超过 ${maxInput} 字上限，请精简后再发送`
    : null;
  const canSend = !uploading && !readOnly && !pickLocked && !draftBinding?.saveFailed && !configurationError && (flatValue.trim().length > 0 || hasAttachmentText);

  const syncDraftParams = (patch: { prompt?: string; promptDoc?: StoredPromptDoc; modelId?: string; size?: string; ratio?: string }) => {
    draftBinding?.onParamsChange(patch);
  };

  const pendingNewRefInsert = useRef(false);
  const prevAssetIdsRef = useRef(orderedAssetIds);
  const prevTextNodeIdsRef = useRef(orderedTextNodeIds);

  const handleDocChange = (doc: PromptDoc) => {
    setPromptDoc(doc);
    pendingNewRefInsert.current = false;
    const flat = flattenPromptDocWith(doc, (key) =>
      key.kind === 'text_ref'
        ? textRefLabelOf(key.id, orderedTextNodeIdsRef.current)
        : imageRefLabelOf(key.id, orderedAssetIdsRef.current));
    syncDraftParams({ prompt: flat, promptDoc: { version: PROMPT_DOC_VERSION, segments: doc.segments, flat } });
  };

  const replaceItems: Array<{
    assetId: string; url: string; name: string; badge: string;
    mediaType: 'image' | 'text'; searchText?: string;
  }> = [
    ...orderedImageRefs.map((r) => ({ assetId: r.assetId, url: r.url, name: r.name, badge: `图片${r.number}`, mediaType: 'image' as const })),
    ...(attachments ?? []).map((a, i) => ({ assetId: a.nodeId, url: '', name: a.title, badge: `文本${i + 1}`, mediaType: 'text' as const, searchText: a.text })),
  ];
  const closeMention = (restoreFocus = false) => {
    editorRef.current?.dismissMention(restoreFocus);
    setMention({ open: false, query: '' });
  };

  const refKeyOf = (assetId: string): PromptRefKey => ({
    kind: orderedTextNodeIdsRef.current.includes(assetId) ? 'text_ref' : 'asset_ref',
    id: assetId,
  });

  const pickMentionRef = (assetId: string) => {
    editorRef.current?.insertRefAtMention(refKeyOf(assetId));
    setMention({ open: false, query: '' });
  };

  const insertRefByKey = (assetId: string) => {
    editorRef.current?.insertRefAtPending(refKeyOf(assetId), true);
  };

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
    const addedText = orderedTextNodeIds.filter((id) => !prevText.includes(id));
    if (addedText.length > 0) {
      pendingNewRefInsert.current = false;
      editorRef.current?.insertRefAtPending({ kind: 'text_ref', id: addedText[addedText.length - 1] });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderedAssetIds, orderedTextNodeIds]);

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

  useEffect(() => {
    let active = true;
    fetchGenerationModels('image')
      .then((list) => {
        if (!active) return;
        setModelList(list);
        setModelsLoaded(true);
        if (draftBinding && (draftBinding.restoreExisting || initialParams?.modelId)) {
          setSelectedModel(initialParams?.modelId ?? '');
          setSelectedResolution(initialParams?.size ?? '');
          setSelectedRatio(initialParams?.ratio ?? '');
          return;
        }
        if (!list.length) return;
        if (initialParams?.modelId && !list.some((m) => m.model_id === initialParams.modelId)) {
          onToast?.('warn', '原生成模型已不可用，已回退默认模型，请确认后发送');
        }
        const target =
          (initialParams?.modelId && list.find((m) => m.model_id === initialParams.modelId)) ||
          list[0];
        const applied = applyModelDefaults(target);
        let finalSize = applied.size;
        let finalRatio = applied.ratio;
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
          if (initialParams.ratio && allowed.some((option) => option.id === initialParams.ratio)) {
            setSelectedRatio(initialParams.ratio);
            finalRatio = initialParams.ratio;
          }
        }
        syncDraftParams({ modelId: applied.modelId, size: finalSize, ratio: finalRatio });
      })
      .catch(() => { if (active) setModelsLoaded(true); });
    return () => { active = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  const handleSend = async () => {
    if (!canSend) return;
    if (!currentGen) {
      console.warn('图片模型能力加载中，请稍后重试');
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
    setUploading(true);
    try {
      await onSend(flatValue, selectedModel, selectedResolution, selectedRatio, files, docHasAnyRef(promptDoc) ? promptDoc : null);
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
      style={anchoredOverlayStyle(followAnchor ?? null, dragHidden)}
      data-gen-panel-territory
    >
      {}
      {mention.open && (
        <div className={styles.mentionDock} ref={mentionMenuRef}>
          <AtMentionMenu
            renderInline
            anchorRef={mentionMenuRef}
            items={canvasMentionItems ?? []}
            editorQuery={mention.query}
            referencedItems={replaceItems.map(r => ({
              id: r.assetId, assetId: r.assetId, name: r.name, thumbUrl: r.url,
              kind: r.mediaType, badge: r.badge, searchText: r.searchText,
            }))}
            onSelectReferenced={(item) => pickMentionRef(item.id)}
            disabledKinds={['audio']}
            onSelect={(item) => {
              if (item.kind === 'image' && item.assetId && orderedAssetIds.includes(item.assetId)) {
                pickMentionRef(item.assetId);
              } else if (item.kind === 'text' && orderedTextNodeIds.includes(item.id)) {
                pickMentionRef(item.id);
              } else {
                editorRef.current?.consumeMentionForPendingInsert();
                pendingNewRefInsert.current = item.kind === 'image' || item.kind === 'text';
                setMention({ open: false, query: '' });
                onMentionCanvas?.(item);
              }
            }}
            onClose={closeMention}
            onEscapeClose={() => closeMention(true)}
          />
        </div>
      )}
      {}
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
      {}
      {showConfig && (
        <div className={styles.configPanel} ref={configPanelRef}>
          {}
          <button
            className={styles.configCloseBtn}
            onClick={() => setShowConfig(false)}
            title="关闭"
          >
            <X size={14} strokeWidth={2} />
          </button>
          {}
          <div className={styles.configSection}>
            <span className={styles.configLabel}>模型与质量</span>
            <div className={styles.configRow}>
              <Select
                value={selectedModel}
                onChange={(key) => {
                  const gen = modelList.find((x) => x.model_id === key);
                  if (gen) syncDraftParams(applyModelDefaults(gen));
                  else {
                    setSelectedModel(key);
                    syncDraftParams({ modelId: key });
                  }
                }}
                disabled={readOnly}
                side="top"
                placeholder="选择模型"
                ariaLabel="选择模型"
                options={modelOptions.map((m) => ({ value: m.key, label: m.label }))}
              />

              <Select
                value={selectedResolution}
                onChange={(key) => {
                  setSelectedResolution(key);
                  const nextRatio = currentGen ? pickRatioForSize(currentGen, key, selectedRatio) : selectedRatio;
                  if (currentGen) setSelectedRatio(nextRatio);
                  syncDraftParams({ size: key, ratio: nextRatio });
                }}
                disabled={readOnly}
                side="top"
                ariaLabel="选择分辨率"
                options={resolutionOptions.map((r) => ({ value: r.key, label: r.label }))}
              />
            </div>
          </div>

          {}
          <div className={styles.configSection}>
            <span className={styles.configLabel}>宽高比</span>
            <RatioGroup
              className={styles.ratioGroup}
              value={selectedRatio}
              disabled={readOnly}
              ariaLabel="宽高比"
              onChange={(id) => {
                setSelectedRatio(id);
                syncDraftParams({ ratio: id });
              }}
              options={ratioOptions.map((option) => ({
                value: option.id,
                label: option.label,
              }))}
            />
          </div>
        </div>
      )}

      <div className={`${styles.dialog} ${expanded ? styles.dialogExpanded : ''}`}>
      {}
      <div className={styles.inputBox}>
        {}
        <AttachmentActionBar
          kind="image"
          onPickFromCanvas={() => onPickFromCanvas?.()}
          onPickFromAssets={() => onPickFromAssets?.()}
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
                <X size={14} strokeWidth={2} />
              </button>
            </>
          )}
        />

        {}
        {stripHasItems && (
          <div className={styles.previewRow}>
            {mixedStrip.render(edgeRefs
              ? edgeRefs.map((r, i) => (
                  <RefThumbnail
                    key={r.nodeId}
                    data-testid="dock-media-ref"
                    kind="image"
                    url={r.url}
                    name={r.name}
                    number={refsNumbering.get(r.assetId)}
                    locked={r.textNodeId != null}
                    onLocate={r.textNodeId != null && onLocateTextSource ? () => onLocateTextSource(r.textNodeId!) : undefined}
                    onRemove={!readOnly && r.textNodeId == null ? () => onRemoveMediaRef?.(r.nodeId) : undefined}
                    onInsertRef={!readOnly ? () => insertRefByKey(r.assetId) : undefined}
                    insertTitle={INSERT_REF_APPEND_TITLE}
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
                    insertTitle={INSERT_REF_APPEND_TITLE}
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
                insertTitle={INSERT_REF_APPEND_TITLE}
              />
            )))}
          </div>
        )}

        {}
        {readOnly && (
          <div className={styles.readOnlyHint}>{readOnlyReason}</div>
        )}

        {}
      <PromptSyncActions plans={pendingPlanSyncs} disabled={readOnly || syncingPlan} onSync={onSyncPlan} />
        {configurationError && <div role="alert">{configurationError}</div>}
        {invalidMediaRefs?.map(ref => <div key={ref.nodeId}>
          {ref.name}（不可用）
          {!readOnly && <button type="button" onClick={() => onRemoveMediaRef?.(ref.nodeId)}>移除失效参考</button>}
        </div>)}
        {}
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

          {}
          <div className={styles.bottomBar}>
            {}
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

          {}
          <div className={styles.barRight}>
            {}
            {projectId ? (
              <GenerationQuoteBadge
                projectId={projectId}
                type="image"
                parameters={{
                  model_id: selectedModel,
                  ...(selectedResolution ? { size: selectedResolution } : {}),
                  ...(selectedRatio ? { aspect_ratio: selectedRatio } : {}),
                }}
                references={quoteReferences}
              />
            ) : null}
            {}
            <div className={`${styles.charCount} ${maxInput != null && flatValue.length >= maxInput ? styles.charCountWarn : ''}`}>
              {promptCharCountLabel(flatValue.length, maxInput)}
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
