import { useState, useRef, useEffect, useLayoutEffect, useCallback, useMemo } from 'react';
import {
  X,
  Plus,
  ChevronDown,
  ArrowUp,
  Square,
  RotateCw,
  PictureInPicture2,
  BookText,
  MessageSquare,
  Check,
  RotateCcw,
} from 'lucide-react';
import Empty from '@/custom/components/Empty';
import styles from './index.module.css';
import { fetchMySkills } from '@/custom/api/skills';
import { useAgentSession } from '../../hooks/agent/useAgentSession';
import {
  type SessionContentBlock,
  type GenerationCardBlock,
  type OutboundAssetRef,
} from '@/custom/api/agentSessions';
import {
  commitSidebarAttachment,
  createAttachmentPreviewUrl,
  planAttachment,
  revokeAttachmentPreviewUrl,
  type SidebarCanvasUpload,
} from './attachments';
import { composerImagePreview } from './composerImagePreview';
import { ComposerAttachmentChip } from './ComposerAttachmentChip';
import { MessageAssetPreview } from './MessageAssetPreview';
import { isInlineMediaThumbnail, rememberAssetUrl, useAssetUrlCache } from './assetUrlCache';
import SkillModal from '@/custom/pages/Home/components/SkillModal';
import ConfirmModal from '@/custom/components/ConfirmModal';
import ChipTextEditor, { type ChipRef, type ChipTextEditorHandle } from '../ChipTextEditor';
import {
  EMPTY_COMPOSED,
  composedIsEmpty,
  resolveComposed,
  type ComposedValue,
} from '../ChipTextEditor/composed';
import { shouldCancelOnKey } from './cancelShortcut';
import { freePanelLayout, type PanelMetrics } from './layout';
import { useStickToBottom } from './stickToBottom';
import {
  DEFAULT_PANEL_WIDTH,
  clampPanelWidth,
  persistPanelWidth,
  readPersistedPanelWidth,
} from './drawerWidth';
import { showsTurnFooter } from '../../hooks/agent/sessionTimeline';
import { collectKnownAssets } from './assetMentions';
import { Markdown } from './Markdown';
import { LastTurnLine, TurnFooter } from './TurnTimeline';
import { RunStatusLine } from './RunStatusLine';
import { SolutionCardBlock } from './SolutionCardBlock';
import { AssistantTurnBody } from './AssistantTurnBody';

const EMPTY_APPLIED_IDS: ReadonlySet<string> = new Set<string>();

export { Markdown };


const quickQuestions = [
  {
    title: '生成一张插画',
    prompt: '帮我生成一张插画，主题是夏日海边的小镇，色调温暖明亮。',
  },
  {
    title: '构思一个短视频',
    prompt: '帮我构思一个 15 秒的短视频，用于展示一款环保水杯。',
  },
  {
    title: '头脑风暴创意方向',
    prompt: '我想做一个品牌视觉方案，先帮我头脑风暴几个创意方向。',
  },
];

const DEFAULT_POSITION = { x: 0, y: 0 };

const DRAWER_SLIDE_MS = 240;

interface PendingAttachment {
  key: string;
  name: string;
  mediaType: 'image' | 'video';
  status: 'uploading' | 'ready' | 'failed';
  assetId?: string;
  error?: string;
  url?: string;
  remoteUrl?: string;
}

interface AgentPanelProps {
  open?: boolean;
  candidateBlocks?: SessionContentBlock[] | null;
  onPrepareCandidate?: (blocks: SessionContentBlock[]) => Promise<SessionContentBlock[]>;
  onCancelCandidate?: () => void;
  onClose: () => void;
  initialInput?: string;
  initialCardLabel?: string;
  inputVersion?: number;
  projectId?: string;
  onApplyToDock?: (payload: GenerationCardBlock) => void;
  appliedCardIds?: ReadonlySet<string>;
  initialSkillId?: string;
  initialSkillName?: string;
  mediaBlocks?: import('@/custom/api/agentSessions').SessionContentBlock[];
  onPlaceFileOnCanvas: (file: File) => Promise<SidebarCanvasUpload>;
  onPickFromAssets?: () => void;
  externalAssetPicks?: { ts: number; blocks: import('@/custom/api/agentSessions').SessionContentBlock[] } | null;
}

function hasInlineVisualMention(blocks: SessionContentBlock[] | undefined, chipId: string): boolean {
  return (blocks ?? []).some((block) => {
    const ids = [block.chip_id, block.asset_id, block.resource_id, block.node_id];
    if (!ids.includes(chipId)) return false;
    return isInlineMediaThumbnail(block);
  });
}

function quoteTooltipOfChip(blocks: SessionContentBlock[] | undefined, chipId: string): string | undefined {
  const block = (blocks ?? []).find(
    (b) => Boolean(b.quote_id) && (b.quote_id === chipId || b.resource_id === chipId),
  );
  const text = block?.resource_text;
  if (typeof text !== 'string' || !text) return undefined;
  return text.length > 500 ? `${text.slice(0, 500)}…` : text;
}

export default function AgentPanel({ open = true, onClose, initialInput, initialCardLabel, inputVersion, projectId, onApplyToDock, appliedCardIds, initialSkillId, initialSkillName, mediaBlocks: initialMediaBlocks, onPlaceFileOnCanvas, onPickFromAssets, externalAssetPicks, candidateBlocks, onPrepareCandidate, onCancelCandidate }: AgentPanelProps) {
  useAssetUrlCache();
  const chipEditorRef = useRef<ChipTextEditorHandle>(null);

  const [composed, setComposed] = useState<ComposedValue>(EMPTY_COMPOSED);
  const composerHasText = !composedIsEmpty(composed);
  const pendingMediaBlocksRef = useRef<import('@/custom/api/agentSessions').SessionContentBlock[]>([]);
  const [pendingMediaBlocksState, setPendingMediaBlocksState] = useState<import('@/custom/api/agentSessions').SessionContentBlock[]>([]);
  const syncMediaBlocks = () => {
    setPendingMediaBlocksState([...pendingMediaBlocksRef.current]);
  };
  const [pendingReference, setPendingReference] = useState<{ chip: ChipRef; blocks: SessionContentBlock[] } | null>(null);
  const currentCandidateRef = useRef(candidateBlocks);
  const preparedBlocksRef = useRef<SessionContentBlock[] | null>(null);
  const [referenceNotice, setReferenceNotice] = useState('');
  const [submittingMessage, setSubmittingMessage] = useState(false);
  const submittingMessageRef = useRef(false);
  useLayoutEffect(() => {
    if (!open || !candidateBlocks?.length) {
      currentCandidateRef.current = null;
      setPendingReference(null);
      return;
    }
    if (submittingMessageRef.current) return;
    const first = candidateBlocks[0];
    if (pendingMediaBlocksRef.current.some((block) => block.node_id === first.node_id)) return;
    currentCandidateRef.current = candidateBlocks;
    setPendingReference({
      chip: {
        id: first.chip_id!, label: first.display_label || '素材', prompt: '',
        ...(first.type === 'image' ? { imageUrl: first.url } : {}),
        ...(first.type === 'video' ? { videoUrl: first.url } : {}),
        ...(first.type === 'audio' ? { audioUrl: first.url } : {}),
      },
      blocks: candidateBlocks,
    });
  }, [candidateBlocks, open]);
  useEffect(() => { setReferenceNotice(''); }, [pendingReference]);
  const [showUpload, setShowUpload] = useState(false);
  const [showSkillModal, setShowSkillModal] = useState(false);
  const [floating, setFloating] = useState(false);
  const {
    turns,
    sessionId,
    sessions,
    activeSkillIds,
    changeActiveSkills,
    streamingText,
    streaming,
    runningRunId,
    failedRunId,
    liveActivity,
    turnStartedAt,
    turnOutcome,
    chatError,
    retryUnavailable,
    sendError,
    paymentRequiredMessage,
    sendMessage,
    confirmSolution,
    voidSolution,
    stopRun,
    retryRun,
    resetChat,
    switchSession,
    deleteSession,
    deleteError,
    dismissDeleteError,
    refreshSessions,
  } = useAgentSession(projectId ?? '');
  const lastAccount = turns.length > 0 ? turns[turns.length - 1].account : null;
  const knownAssets = useMemo(() => collectKnownAssets(turns), [turns]);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; title: string } | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const historyRef = useRef<HTMLDivElement>(null);
  const uploadRef = useRef<HTMLDivElement>(null);
  const [attachments, setAttachments] = useState<PendingAttachment[]>([]);
  const attachmentsRef = useRef<PendingAttachment[]>([]);
  attachmentsRef.current = attachments;
  useEffect(() => {
    return () => {
      for (const item of attachmentsRef.current) revokeAttachmentPreviewUrl(item.url);
    };
  }, []);
  const appliedIds = appliedCardIds ?? EMPTY_APPLIED_IDS;
  const [forcedSkill, setForcedSkill] = useState<{ id: string; name: string } | null>(null);
  const [skillNames, setSkillNames] = useState<Record<string, string>>({});

  const [position, setPosition] = useState(DEFAULT_POSITION);
  const [initialized, setInitialized] = useState(false);
  const [panelHeight, setPanelHeight] = useState<number | undefined>(undefined);
  const panelRef = useRef<HTMLDivElement>(null);
  const dragState = useRef({ dragging: false, startX: 0, startY: 0, origX: 0, origY: 0 });

  const [panelWidth, setPanelWidth] = useState(() => readPersistedPanelWidth(window.innerWidth));
  const [resizing, setResizing] = useState(false);
  const resizeDragRef = useRef<{ startX: number; startWidth: number } | null>(null);
  const [closing, setClosing] = useState(false);
  const closeTimerRef = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (open) setClosing(false);
    else {
      window.clearTimeout(closeTimerRef.current);
      setPendingReference(null);
      preparedBlocksRef.current = null;
      setHistoryOpen(false);
      setShowUpload(false);
      setShowSkillModal(false);
      setDeleteTarget(null);
    }
  }, [open]);

  const measurePanel = useCallback((): PanelMetrics | null => {
    const el = panelRef.current;
    const page = el?.parentElement;
    if (!el || !page) return null;
    const rect = el.getBoundingClientRect();
    return {
      pageWidth: page.clientWidth,
      pageHeight: page.clientHeight,
      headerHeight: page.querySelector('header')?.getBoundingClientRect().height ?? 0,
      panelWidth: rect.width,
      panelHeight: rect.height,
    };
  }, []);

  const lastInputVersionRef = useRef(0);
  const prevChipIdsRef = useRef<Set<string>>(new Set());
  const referenceHistoryRef = useRef(new Map<string, SessionContentBlock[]>());
  const draftEpochRef = useRef(0);
  const draftSessionRef = useRef(sessionId);
  const clearDraft = useCallback(() => {
    draftEpochRef.current += 1;
    currentCandidateRef.current = null;
    preparedBlocksRef.current = null;
    setPendingReference(null);
    onCancelCandidate?.();
    referenceHistoryRef.current.clear();
    prevChipIdsRef.current.clear();
    chipEditorRef.current?.clear();
    setComposed(EMPTY_COMPOSED);
    pendingMediaBlocksRef.current = [];
    setPendingMediaBlocksState([]);
    setForcedSkill(null);
    for (const item of attachmentsRef.current) revokeAttachmentPreviewUrl(item.url);
    setAttachments([]);
    submittingMessageRef.current = false;
    setSubmittingMessage(false);
  }, [onCancelCandidate]);
  useEffect(() => {
    if (draftSessionRef.current && draftSessionRef.current !== sessionId) clearDraft();
    draftSessionRef.current = sessionId;
  }, [sessionId, clearDraft]);

  useEffect(() => {
    if (!inputVersion || inputVersion === lastInputVersionRef.current) return;
    lastInputVersionRef.current = inputVersion;
    if (initialCardLabel) {
      const mediaPreview = composerImagePreview(initialMediaBlocks);
      chipEditorRef.current?.insertChip({
        id: String(inputVersion),
        label: mediaPreview?.label ?? initialCardLabel,
        prompt: initialInput ?? '',
        ...(mediaPreview?.mediaType === 'video'
          ? { videoUrl: mediaPreview.url }
          : mediaPreview
            ? { imageUrl: mediaPreview.url }
            : {}),
      });
    } else {
      chipEditorRef.current?.setText(initialInput ?? '');
    }
    console.log('[AgentPanel] 注入媒体块:', initialMediaBlocks?.length, 'blocks', initialMediaBlocks);
    if (initialMediaBlocks && initialMediaBlocks.length > 0) {
      pendingMediaBlocksRef.current = [...pendingMediaBlocksRef.current, ...initialMediaBlocks];
      syncMediaBlocks();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inputVersion]);

  useEffect(() => {
    const chipIds = new Set(
      composed.segments
        .filter((s): s is { kind: 'ref'; ref: { id: string; label: string; prompt: string } } => s.kind === 'ref')
        .map((s) => s.ref.id),
    );
    for (const block of pendingMediaBlocksRef.current) {
      if (block.chip_id) {
        referenceHistoryRef.current.set(block.chip_id, pendingMediaBlocksRef.current.filter((item) => item.chip_id === block.chip_id));
      }
    }

    const prevIds = prevChipIdsRef.current;
    const chipsRemoved = [...prevIds].some((id) => !chipIds.has(id));

    if (chipsRemoved && pendingMediaBlocksRef.current.length > 0) {
      const filtered = pendingMediaBlocksRef.current.filter((b) => !b.chip_id || chipIds.has(b.chip_id));
      pendingMediaBlocksRef.current = filtered;
      syncMediaBlocks();
      console.log('[AgentPanel] chip 删除同步, 剩余 blocks:', filtered.length);
    }
    const restored = [...chipIds].flatMap((id) =>
      pendingMediaBlocksRef.current.some((block) => block.chip_id === id) ? [] : referenceHistoryRef.current.get(id) ?? [],
    );
    if (restored.length) {
      pendingMediaBlocksRef.current = [...pendingMediaBlocksRef.current, ...restored];
      syncMediaBlocks();
    }

    prevChipIdsRef.current = chipIds;
  }, [composed]);

  const lastAssetPickTsRef = useRef(0);
  useEffect(() => {
    if (!externalAssetPicks || externalAssetPicks.ts === lastAssetPickTsRef.current) return;
    lastAssetPickTsRef.current = externalAssetPicks.ts;
    if (externalAssetPicks.blocks.length === 0) return;
    pendingMediaBlocksRef.current = [...pendingMediaBlocksRef.current, ...externalAssetPicks.blocks];
    syncMediaBlocks();
  }, [externalAssetPicks]);

  const lastSkillIdRef = useRef('');
  useEffect(() => {
    if (!initialSkillId || initialSkillId === lastSkillIdRef.current) return;
    lastSkillIdRef.current = initialSkillId;
    setForcedSkill({ id: initialSkillId, name: initialSkillName || '已选技能' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialSkillId]);

  useEffect(() => {
    const unknown = activeSkillIds.filter((id) => !skillNames[id]);
    if (unknown.length === 0) return;
    let alive = true;
    fetchMySkills(1, 50)
      .then((page) => {
        if (!alive) return;
        const found: Record<string, string> = {};
        for (const record of page?.records ?? []) {
          if (record.creative_skill_id && record.name) found[record.creative_skill_id] = record.name;
        }
        if (Object.keys(found).length > 0) setSkillNames((prev) => ({ ...found, ...prev }));
      })
      .catch((e) => console.warn('解析创作套路名称失败:', e));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSkillIds]);


  const cancellable = streaming || runningRunId !== null;
  useEffect(() => {
    if (!open || closing || !cancellable || pendingReference) return;
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target instanceof HTMLElement ? e.target : null;
      if (
        shouldCancelOnKey({
          key: e.key,
          defaultPrevented: e.defaultPrevented,
          targetTagName: target?.tagName,
          isEditable: target?.isContentEditable ?? false,
          inOverlay: Boolean(target?.closest('[role="dialog"], [aria-modal="true"]')),
          isMainComposer: Boolean(target?.closest('[data-agent-composer]')),
        })
      ) {
        stopRun();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open, closing, cancellable, stopRun, pendingReference]);

  const { handlers: listScrollHandlers, follow: followListBottom, pin: pinListBottom } = useStickToBottom(listRef);
  const userMessageCount = turns.reduce((n, turn) => n + turn.user.length, 0);
  useEffect(() => {
    pinListBottom();
  }, [sessionId, userMessageCount, pinListBottom]);

  useEffect(() => {
    followListBottom();
  }, [turns, streamingText, runningRunId, followListBottom]);

  useEffect(() => {
    if (initialized) return;
    setInitialized(true);
  }, [initialized]);

  useEffect(() => {
    const handleResize = () => {
      if (!floating) {
        setPanelWidth((w) => clampPanelWidth(w, window.innerWidth));
        return;
      }
      const metrics = measurePanel();
      if (!metrics) return;
      setPosition((prev) => {
        const layout = freePanelLayout(metrics, prev.x, prev.y);
        setPanelHeight(layout.height);
        return { x: layout.x, y: layout.y };
      });
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [floating, measurePanel]);

  useEffect(() => {
    if (!floating) return;
    const metrics = measurePanel();
    if (!metrics) return;
    const centerX = (metrics.pageWidth - metrics.panelWidth) / 2;
    const centerY = (metrics.pageHeight - metrics.panelHeight) / 2;
    const layout = freePanelLayout(metrics, centerX, centerY);
    setPosition({ x: layout.x, y: layout.y });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [floating]);

  useEffect(() => {
    if (!historyOpen && !showUpload) return;
    const handleDocMouseDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (historyRef.current && !historyRef.current.contains(target)) {
        setHistoryOpen(false);
        dismissDeleteError();
      }
      if (uploadRef.current && !uploadRef.current.contains(target)) setShowUpload(false);
    };
    document.addEventListener('mousedown', handleDocMouseDown);
    return () => document.removeEventListener('mousedown', handleDocMouseDown);
  }, [historyOpen, showUpload, dismissDeleteError]);

  const handleDragStart = useCallback(
    (e: React.MouseEvent) => {
      if (!floating) return;
      const target = e.target as HTMLElement;
      if (target.closest('button')) return;
      const header = target.closest(`.${styles.panelHeader}`);
      if (!header) return;

      e.preventDefault();
      dragState.current = {
        dragging: true,
        startX: e.clientX,
        startY: e.clientY,
        origX: position.x,
        origY: position.y,
      };
    },
    [position, floating],
  );

  const handleDragMove = useCallback(
    (e: MouseEvent) => {
      const ds = dragState.current;
      if (!ds.dragging) return;
      const dx = e.clientX - ds.startX;
      const dy = e.clientY - ds.startY;
      const metrics = measurePanel();
      if (!metrics) return;
      const layout = freePanelLayout(metrics, ds.origX + dx, ds.origY + dy);
      setPosition({ x: layout.x, y: layout.y });
    },
    [measurePanel],
  );

  const handleDragEnd = useCallback(() => {
    dragState.current.dragging = false;
  }, []);

  useEffect(() => {
    window.addEventListener('mousemove', handleDragMove);
    window.addEventListener('mouseup', handleDragEnd);
    return () => {
      window.removeEventListener('mousemove', handleDragMove);
      window.removeEventListener('mouseup', handleDragEnd);
    };
  }, [handleDragMove, handleDragEnd]);

  const handleResizeStart = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.currentTarget.setPointerCapture?.(e.pointerId);
    resizeDragRef.current = { startX: e.clientX, startWidth: panelWidth };
    setResizing(true);
  };
  const dragWidth = (drag: { startX: number; startWidth: number }, clientX: number) =>
    clampPanelWidth(drag.startWidth + (drag.startX - clientX), window.innerWidth);
  const handleResizeMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const drag = resizeDragRef.current;
    if (!drag) return;
    setPanelWidth(dragWidth(drag, e.clientX));
  };
  const handleResizeEnd = (e: React.PointerEvent<HTMLDivElement>) => {
    const drag = resizeDragRef.current;
    if (!drag) return;
    resizeDragRef.current = null;
    setResizing(false);
    const finalWidth = dragWidth(drag, e.clientX);
    setPanelWidth(finalWidth);
    persistPanelWidth(finalWidth);
  };
  const handleResizeReset = () => {
    const width = clampPanelWidth(DEFAULT_PANEL_WIDTH, window.innerWidth);
    setPanelWidth(width);
    persistPanelWidth(width);
  };

  const handleClose = useCallback(() => {
    if (closing) return;
    currentCandidateRef.current = null;
    preparedBlocksRef.current = null;
    setPendingReference(null);
    onCancelCandidate?.();
    setClosing(true);
    closeTimerRef.current = window.setTimeout(() => onClose(), DRAWER_SLIDE_MS);
  }, [closing, onClose, onCancelCandidate]);

  useEffect(() => () => window.clearTimeout(closeTimerRef.current), []);

  const handleQuickQuestion = (prompt: string) => {
    chipEditorRef.current?.setText(prompt);
  };

  const handleNewChat = () => {
    clearDraft();
    draftSessionRef.current = null;
    resetChat();
    setForcedSkill(null);
    setHistoryOpen(false);
  };

  const uploadingAttachment = attachments.some((item) => item.status === 'uploading');
  const readyAssets: OutboundAssetRef[] = attachments.flatMap((item) =>
    item.status === 'ready' && item.assetId
      ? [{ asset_id: item.assetId, media_type: item.mediaType, display_label: item.name }]
      : [],
  );
  const readyPreviewUrls = new Map(
    attachments.flatMap((item) =>
      item.status === 'ready' && item.assetId && item.remoteUrl ? [[item.assetId, item.remoteUrl] as const] : [],
    ),
  );

  const canSend =
    (composerHasText || readyAssets.length > 0 || pendingMediaBlocksState.length > 0) && !uploadingAttachment;

  const handleSend = async () => {
    if (submittingMessageRef.current) return;
    if (pendingReference) {
      setReferenceNotice('请先确认或取消待确认引用');
      return;
    }
    const fullText = resolveComposed(composed).trim();
    const uploadedBlocks: import('@/custom/api/agentSessions').SessionContentBlock[] = readyAssets.map((asset) => {
      const previewUrl = readyPreviewUrls.get(asset.asset_id);
      return {
        type: 'asset_ref',
        asset_id: asset.asset_id,
        media_type: asset.media_type,
        ...(asset.display_label ? { display_label: asset.display_label } : {}),
        ...(previewUrl ? { url: previewUrl } : {}),
      };
    });
    const mediaBlocks = [...pendingMediaBlocksRef.current, ...uploadedBlocks];
    if (!fullText && mediaBlocks.length === 0) return;
    if (uploadingAttachment) return;
    if (runningRunId !== null || streaming) return;

    const userText = composed.segments
      .filter((s) => s.kind === 'text')
      .map((s) => s.value)
      .join('')
      .trim();

    const chipRefs = composed.segments
      .filter((s): s is { kind: 'ref'; ref: { id: string; label: string; prompt: string } } => s.kind === 'ref')
      .map((s) => s.ref);
    const chips = chipRefs.map((ref) => ({ id: ref.id, label: ref.label }));

    const orderedContent: SessionContentBlock[] = composed.segments.flatMap((segment) =>
      segment.kind === 'text'
        ? [{ type: 'text', text: segment.value }]
        : mediaBlocks.filter((block) => block.chip_id === segment.ref.id),
    );
    orderedContent.push(...mediaBlocks.filter((block) => !block.chip_id));

    submittingMessageRef.current = true;
    setSubmittingMessage(true);
    const armed = forcedSkill;
    if (armed) setSkillNames((prev) => ({ ...prev, [armed.id]: armed.name }));
    const sentAttachments = attachments;
    const sentEpoch = draftEpochRef.current;
    const clearSubmittedContent = chipEditorRef.current?.captureSubmission();
    const sentBlocks = new Set(orderedContent);
    try {
      const accepted = await sendMessage(orderedContent, armed?.id, undefined, armed?.name, userText, chips);
      if (accepted && sentEpoch === draftEpochRef.current) {
        for (const chip of chips) referenceHistoryRef.current.delete(chip.id);
        clearSubmittedContent?.();
        pendingMediaBlocksRef.current = pendingMediaBlocksRef.current.filter((block) => !sentBlocks.has(block));
        syncMediaBlocks();
        setForcedSkill((current) => current === armed ? null : current);
        setAttachments((current) => current.filter((item) => !sentAttachments.some((sent) => sent.key === item.key)));
        for (const item of sentAttachments) revokeAttachmentPreviewUrl(item.url);
      }
    } finally {
      if (sentEpoch === draftEpochRef.current) {
        submittingMessageRef.current = false;
        setSubmittingMessage(false);
        onCancelCandidate?.();
      }
    }
  };

  const handleCardApply = (
    card: NonNullable<SessionContentBlock['card']>,
  ) => {
    if (runningRunId !== null || streaming) return;
    const cardId = card.cardId ?? card.shotTitle;
    const payload: GenerationCardBlock = { ...card, cardId, source: card.source ? { ...card.source, sessionId: card.source.sessionId || sessionId || '' } : undefined };
    onApplyToDock?.(payload);
  };

  const handleUploadClick = () => {
    setShowUpload(!showUpload);
  };

  const handleFileSelect = (kind: 'image' | 'video') => {
    const input = fileInputRef.current;
    if (input) {
      input.accept = kind === 'image' ? 'image/*' : 'video/*';
      input.click();
    }
    setShowUpload(false);
  };

  const handleFilesChosen = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const chosen = Array.from(event.target.files ?? []);
    event.target.value = '';
    for (const file of chosen) {
      const key = `att-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const previewUrl = createAttachmentPreviewUrl(file);
      const plan = planAttachment(file, projectId);
      if (plan.ok === false) {
        setAttachments((prev) => [
          ...prev,
          { key, name: file.name, mediaType: 'image', status: 'failed', error: plan.error, url: previewUrl },
        ]);
        continue;
      }
      setAttachments((prev) => [
        ...prev,
        { key, name: file.name, mediaType: plan.mediaType, status: 'uploading', url: previewUrl },
      ]);
      const result = await commitSidebarAttachment(file, projectId, onPlaceFileOnCanvas);
      if (result.ok === false) {
        setAttachments((prev) =>
          prev.map((item) =>
            item.key === key ? { ...item, status: 'failed' as const, error: result.error } : item,
          ),
        );
        continue;
      }
      rememberAssetUrl(result.uploaded.asset_id, result.uploaded.url);
      setAttachments((prev) =>
        prev.map((item) =>
          item.key === key
            ? { ...item, status: 'ready' as const, assetId: result.uploaded.asset_id, remoteUrl: result.uploaded.url }
            : item,
        ),
      );
    }
  };

  const removeAttachment = (key: string) =>
    setAttachments((prev) => {
      const target = prev.find((item) => item.key === key);
      revokeAttachmentPreviewUrl(target?.url);
      return prev.filter((item) => item.key !== key);
    });

  const removePendingMediaBlock = (block: import('@/custom/api/agentSessions').SessionContentBlock) => {
    pendingMediaBlocksRef.current = pendingMediaBlocksRef.current.filter((b) => b !== block);
    syncMediaBlocks();
  };

  return (
    <div
      ref={panelRef}
      className={`${styles.panel} ${
        floating
          ? styles.panelFloating
          : `${styles.panelDrawer} ${closing ? styles.panelDrawerClosing : ''}`
      } ${!floating && resizing ? styles.panelResizing : ''}`}
      style={
        !open ? { display: 'none' } : floating
          ? initialized
            ? { left: position.x, top: position.y, height: panelHeight, transform: 'none' }
            : undefined
          : { width: panelWidth }
      }
      onMouseDown={handleDragStart}
    >
      {}
      {!floating && (
        <div
          className={styles.resizeHandle}
          title={`拖拽调宽 · 双击复位 ${DEFAULT_PANEL_WIDTH}px`}
          onPointerDown={handleResizeStart}
          onPointerMove={handleResizeMove}
          onPointerUp={handleResizeEnd}
          onDoubleClick={handleResizeReset}
        />
      )}
      {}
      <div className={`${styles.panelHeader} ${floating ? styles.panelHeaderFloating : ''}`}>
        <div className={styles.headerLeft}>
          {}
        </div>
        <div className={styles.headerCenter}>
          {}
          <div className={styles.historyWrap} ref={historyRef}>
            <button
              className={`${styles.historyBtn} ${historyOpen ? styles.iconBtnActive : ''}`}
              onClick={() => {
                const next = !historyOpen;
                setHistoryOpen(next);
                if (next) refreshSessions();
                else dismissDeleteError();
              }}
              title="切换会话 / 新建对话"
            >
              <MessageSquare size={14} strokeWidth={2} />
              {}
              <span className={styles.historyBtnTitle}>
                {sessions.find((s) => s.session_id === sessionId)?.title || '新对话'}
              </span>
              <ChevronDown size={12} strokeWidth={2} />
            </button>
            {historyOpen && (
              <div className={styles.historyDropdown}>
                <button type="button" className={styles.historyNewItem} onClick={handleNewChat}>
                  <Plus size={14} strokeWidth={2.5} />
                  <span>新对话</span>
                </button>
                <div className={styles.historyDivider} />
                {sessions.length === 0 ? (
                  <Empty className={styles.historyEmpty} title="暂无历史会话" />
                ) : (
                  sessions.map((s) => {
                    const failed = deleteError?.sessionId === s.session_id ? deleteError : null;
                    return (
                      <div
                        key={s.session_id}
                        className={`${styles.historyItem} ${s.session_id === sessionId ? styles.historyItemActive : ''} ${failed ? styles.historyItemFailed : ''}`}
                      >
                        {failed ? (
                          <>
                            {}
                            <span className={styles.historyItemError} title={failed.message}>
                              {failed.message}
                            </span>
                            <button
                              type="button"
                              className={styles.historyItemRetry}
                              title="重试删除"
                              onClick={(e) => {
                                e.stopPropagation();
                                deleteSession(s.session_id);
                              }}
                            >
                              <RotateCcw size={12} strokeWidth={2} />
                            </button>
                          </>
                        ) : (
                          <>
                            <button
                              type="button"
                              className={styles.historyItemLabel}
                              onClick={() => {
                                if (s.session_id !== sessionId) {
                                  clearDraft();
                                  draftSessionRef.current = s.session_id;
                                }
                                switchSession(s.session_id);
                                setHistoryOpen(false);
                              }}
                            >
                              {s.session_id === sessionId && <Check size={12} strokeWidth={2.5} className={styles.historyItemCheck} />}
                              <span className={styles.historyItemText}>{s.title || '新对话'}</span>
                            </button>
                            <button
                              type="button"
                              className={styles.historyItemDelete}
                              title="删除会话"
                              onClick={(e) => {
                                e.stopPropagation();
                                setDeleteTarget({ id: s.session_id, title: s.title || '新对话' });
                              }}
                            >
                              <X size={12} strokeWidth={2} />
                            </button>
                          </>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            )}
          </div>
        </div>
        <div className={styles.headerRight}>
          <button
            className={`${styles.iconBtn} ${floating ? styles.iconBtnActive : ''}`}
            onClick={() => setFloating((f) => !f)}
            title={floating ? '固定窗口' : '浮动窗口（可拖动）'}
          >
            <PictureInPicture2 size={14} strokeWidth={2} />
          </button>
          <button className={styles.iconBtn} onClick={handleClose} title="关闭">
            <X size={14} strokeWidth={2} />
          </button>
        </div>
      </div>

      {turns.length === 0 ? (
        <>
          {}
          <div className={styles.hintArea}>
            <h3 className={styles.hintTitle}>让 Agent 帮你创作</h3>
            <p className={styles.hintDesc}>
              描述你想生成的图片或视频，发送第一条消息即可开始。同一会话关闭重开后，未发送的草稿会保留。
            </p>
          </div>

          {}
          <div className={styles.quickCards}>
            {quickQuestions.map((q, i) => (
              <button
                key={i}
                className={styles.quickCard}
                onClick={() => handleQuickQuestion(q.prompt)}
              >
                <span className={styles.quickTitle}>{q.title}</span>
                <span className={styles.quickDesc}>{q.prompt}</span>
              </button>
            ))}
          </div>
        </>
      ) : (
        <div className={styles.messageList} ref={listRef} {...listScrollHandlers}>
          {turns.map((turn, turnIndex) => (
            <div key={turn.key} className={styles.turn}>
              {turn.user.map((m) => (
                <div key={m.id} className={styles.userBubble}>
                  {}
                  {m.skill_ref && (
                    <div className={styles.userSkillChip}>
                      <BookText size={13} strokeWidth={2} />
                      <span>{m.skill_ref.name}</span>
                    </div>
                  )}
                  {}
                  <MessageAssetPreview blocks={m.blocks} chips={m.chips} />
                  {}
                  {m.chips?.filter((c) => !hasInlineVisualMention(m.blocks, c.id)).map((c) => (
                    <div key={`chip-${c.id}`} className={styles.userMediaChip} title={quoteTooltipOfChip(m.blocks, c.id)}>
                      <span className={styles.userMediaChipAt}>@</span>
                      <span className={styles.userMediaChipLabel}>{c.label}</span>
                    </div>
                  ))}
                  {}
                  {m.content && <span className={styles.userMessageText}>{m.content}</span>}
                </div>
              ))}
              {(turn.assistant || turn.live || turn.account) && (
                <div className={styles.assistantBlock}>
                  <AssistantTurnBody
                    turn={turn}
                    streamingText={streamingText}
                    onCardApply={handleCardApply}
                    disabled={runningRunId !== null || streaming}
                    appliedCardIds={appliedIds}
                    knownAssets={knownAssets}
                  />
                  {}
                  {turn.solutionCards.map((understanding) => (
                    <SolutionCardBlock
                      key={`${understanding.understanding_id}:${understanding.version}`}
                      understanding={understanding}
                      disabled={runningRunId !== null || streaming}
                      onConfirm={() => {
                        void confirmSolution(understanding.understanding_id, understanding.version);
                      }}
                      onVoid={(note) => {
                        void voidSolution(understanding.understanding_id, understanding.version, note);
                      }}
                    />
                  ))}
                  {}
                  {turn.account && showsTurnFooter(turn) && (
                    <TurnFooter
                      account={turn.account}
                      onRetryCard={
                        turnIndex === turns.length - 1 && runningRunId === null && !streaming
                          ? () => {
                              const text = turn.user.map((m) => m.content).filter(Boolean).join('\n');
                              if (text.trim()) void sendMessage([{ type: 'text', text }], undefined, undefined, undefined, text);
                            }
                          : undefined
                      }
                      onRetry={
                        turnIndex === turns.length - 1 &&
                        failedRunId !== null &&
                        !retryUnavailable &&
                        runningRunId === null &&
                        !streaming
                          ? retryRun
                          : undefined
                      }
                    />
                  )}
                </div>
              )}
            </div>
          ))}
          {}
          {}
        </div>
      )}


      {}
      <div className={styles.inputArea}>
        {}
        {turnOutcome === null ? (
          <RunStatusLine
            startedAt={turnStartedAt}
            activity={liveActivity}
            hasRunId={runningRunId !== null}
            outcome={null}
            streamedText={streamingText}
          />
        ) : (
          lastAccount && <LastTurnLine account={lastAccount} />
        )}
        {chatError && <div className={styles.chatErrorHint}>{chatError}</div>}
        {sendError && <div className={styles.chatErrorHint}>{sendError}</div>}
        {paymentRequiredMessage && <div className={styles.chatErrorHint}>{paymentRequiredMessage}</div>}
        {retryUnavailable && (
          <div className={styles.chatErrorHint}>当前后端未提供重试接口；请开启新对话或联系管理员升级服务。</div>
        )}
        {}
        <div className={styles.inputBox} data-agent-composer>
          {}
          {(activeSkillIds.length > 0 || forcedSkill) && (
            <div className={styles.skillBubbleRow}>
              {activeSkillIds.map((id) => (
                <div key={id} className={styles.skillBubble}>
                  <BookText size={13} strokeWidth={2} className={styles.skillBubbleIcon} />
                  <span className={styles.skillBubbleLabel}>{skillNames[id] ?? id}</span>
                  <button
                    type="button"
                    className={styles.skillBubbleRemove}
                    onClick={() => void changeActiveSkills(activeSkillIds.filter((entry) => entry !== id))}
                    title="取消这条创作套路"
                  >
                    <X size={12} strokeWidth={2} />
                  </button>
                </div>
              ))}
              {}
              {forcedSkill && !activeSkillIds.includes(forcedSkill.id) && (
                <div className={styles.skillBubble}>
                  <BookText size={13} strokeWidth={2} className={styles.skillBubbleIcon} />
                  <span className={styles.skillBubbleLabel}>{forcedSkill.name}</span>
                  <button
                    type="button"
                    className={styles.skillBubbleRemove}
                    onClick={() => setForcedSkill(null)}
                    title="取消技能"
                  >
                    <X size={12} strokeWidth={2} />
                  </button>
                </div>
              )}
            </div>
          )}

          {}
          {}
          {(attachments.length > 0 || pendingMediaBlocksState.length > 0) && (
            <div className={styles.attachmentRow}>
              {}
              {pendingMediaBlocksState.filter((b) => !b.chip_id).map((block, i) => (
                <ComposerAttachmentChip
                  key={`pm-${i}`}
                  name={block.display_label || block.name || '附件'}
                  mediaType={block.media_type === 'video' || block.type === 'video' ? 'video' : 'image'}
                  status="ready"
                  url={block.url}
                  onRemove={() => removePendingMediaBlock(block)}
                />
              ))}
              {attachments.map((item) => (
                <ComposerAttachmentChip
                  key={item.key}
                  name={item.name}
                  mediaType={item.mediaType}
                  status={item.status}
                  url={item.url}
                  error={item.error}
                  onRemove={() => removeAttachment(item.key)}
                />
              ))}
            </div>
          )}
          {referenceNotice && <div role="alert">{referenceNotice}</div>}
          <div className={styles.composerSlot}>
            <ChipTextEditor
              ref={chipEditorRef}
              placeholder="描述你的想法，使用 @ 引用素材"
              onChange={setComposed}
              onSend={handleSend}
              readOnly={submittingMessage}
              pendingChip={pendingReference?.chip}
              onCancelPending={onCancelCandidate}
              onPreparePending={async () => {
                if (!pendingReference) return null;
                const candidate = pendingReference.blocks;
                const epoch = draftEpochRef.current;
                preparedBlocksRef.current = null;
                try {
                  const blocks = onPrepareCandidate
                    ? await onPrepareCandidate(pendingReference.blocks)
                    : pendingReference.blocks;
                  if (currentCandidateRef.current !== candidate || draftEpochRef.current !== epoch) return null;
                  const first = blocks[0];
                  const id = first.quote_id ? `quote:${first.quote_id}` : pendingReference.chip.id;
                  preparedBlocksRef.current = blocks.map((block) => ({ ...block, chip_id: id }));
                  return { ...pendingReference.chip, id, label: first.display_label || pendingReference.chip.label, prompt: first.resource_text || '' };
                } catch (error) {
                  if (currentCandidateRef.current === candidate && draftEpochRef.current === epoch) {
                    setReferenceNotice(`确认引用失败：${error instanceof Error ? error.message : '请检查网络后重试'}`);
                  }
                  return null;
                }
              }}
              onConfirmPending={() => {
                if (!pendingReference || !preparedBlocksRef.current) return;
                pendingMediaBlocksRef.current = [...pendingMediaBlocksRef.current, ...preparedBlocksRef.current];
                preparedBlocksRef.current = null;
                syncMediaBlocks();
                setPendingReference(null);
                onCancelCandidate?.();
              }}
              className={styles.composerEditable}
            />
          </div>

          {}
          <div className={styles.inputToolbar}>
          {}
          <div className={styles.toolbarLeft}>
            <div className={styles.uploadWrap} ref={uploadRef}>
              <button
                className={styles.toolBtn}
                onClick={handleUploadClick}
                title="上传素材"
              >
                <Plus size={15} strokeWidth={2} />
              </button>
              {showUpload && (
                <div className={styles.uploadPopup}>
                  <button onClick={() => handleFileSelect('image')} disabled={!projectId}>
                    上传图片
                  </button>
                  <button onClick={() => handleFileSelect('video')} disabled={!projectId}>
                    上传视频
                  </button>
                  <button onClick={() => { setShowUpload(false); onPickFromAssets?.(); }} disabled={!projectId}>
                    从资产中选择
                  </button>
                </div>
              )}
              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept="image/*,video/*"
                className={styles.hiddenInput}
                onChange={handleFilesChosen}
              />
            </div>

            <button
              className={styles.skillBtn}
              onClick={() => setShowSkillModal(!showSkillModal)}
            >
              <BookText size={13} strokeWidth={2} />
              <span>技能</span>
            </button>
          </div>

          {}
          <div className={styles.toolbarRight}>

            {failedRunId !== null && (
              <button
                className={styles.retryBtn}
                onClick={retryRun}
                title={retryUnavailable ? '重试暂不可用（后端未部署重试接口）' : '重试失败的运行'}
                disabled={retryUnavailable}
              >
                <RotateCw size={14} strokeWidth={2} />
              </button>
            )}
            {}
            {cancellable ? (
              <button
                className={`${styles.sendBtn} ${styles.stopBtnActive}`}
                onClick={stopRun}
                title="停止运行（ESC）"
                aria-label="停止运行，快捷键 ESC"
              >
                <Square size={12} fill="#fff" strokeWidth={0} />
              </button>
            ) : (
              <button
                className={`${styles.sendBtn} ${canSend ? styles.sendBtnActive : ''}`}
                onClick={handleSend}
                disabled={(!canSend && !pendingReference) || streaming}
                title={
                  streaming
                    ? '等待运行状态；超时后可重新连接'
                    : uploadingAttachment
                      ? '素材上传中，稍候即可发送'
                      : '发送'
                }
              >
                <ArrowUp size={15} fill="#fff" strokeWidth={0} />
              </button>
            )}
          </div>
        </div>
        </div>
      </div>

      {}
      <SkillModal
        open={showSkillModal}
        onClose={() => setShowSkillModal(false)}
        onUseSkill={(s) => {
          if (!s.creative_skill_id) return;
          setForcedSkill({ id: s.creative_skill_id, name: s.name ?? '已选技能' });
          setShowSkillModal(false);
        }}
      />

      {}
      <ConfirmModal
        open={deleteTarget !== null}
        title="删除会话"
        message={`确定要删除会话「${deleteTarget?.title ?? ''}」吗？删除后无法恢复。`}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={() => {
          if (deleteTarget) deleteSession(deleteTarget.id);
          setDeleteTarget(null);
        }}
      />
    </div>
  );
}
