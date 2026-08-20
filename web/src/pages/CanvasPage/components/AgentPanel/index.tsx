/* ============================================
 * AgentPanel Agent 智能体对话面板：消息流与任务执行
 * ============================================ */
import { useState, useRef, useEffect, useCallback, type ReactNode } from 'react';
import {
  X,
  Plus,
  ChevronDown,
  ChevronUp,
  ArrowUp,
  Square,
  RotateCw,
  PictureInPicture2,
  BookText,
  Coins,
  History,
} from 'lucide-react';
import styles from './index.module.css';
import { isApiError } from '@/api/http';
import { fetchRunSkillRecommendations, type RunSkillRecommendation } from '@/api/skills';
import { useAgentSession, type ChatMessage, type AgentPhase } from '../../hooks/useAgentSession';
import { deriveRunStatus } from '../../hooks/runStatusLine';
import type { PartialCardPreview } from '../../hooks/partialCardPreview';
import type { SessionContentBlock, GenerationCardBlock } from '@/api/agentSessions';
import SkillModal from '@/pages/Home/components/SkillModal';
import ConfirmModal from '@/components/ConfirmModal';
import ChipTextEditor, { type ChipTextEditorHandle } from '../ChipTextEditor';
import { getPanelLayout } from './layout';

/** 内联 markdown：**bold** 与 `code` */
function renderInline(text: string, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const regex = /(\*\*[^*]+\*\*|`[^`]+`)/g;
  let last = 0;
  let i = 0;
  let m: RegExpExecArray | null;
  while ((m = regex.exec(text))) {
    if (m.index > last) nodes.push(text.slice(last, m.index));
    const token = m[0];
    if (token.startsWith('**')) {
      nodes.push(<strong key={`${keyPrefix}-b${i}`}>{token.slice(2, -2)}</strong>);
    } else {
      nodes.push(<code key={`${keyPrefix}-c${i}`}>{token.slice(1, -1)}</code>);
    }
    last = m.index + token.length;
    i += 1;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

/** 极简 markdown 块级渲染（标题/列表/引用/段落） */
function Markdown({ text }: { text: string }) {
  const blocks: ReactNode[] = [];
  text.split('\n').forEach((raw, idx) => {
    const line = raw.trim();
    if (!line) return;
    const h = /^(#{1,6})\s+(.*)$/.exec(line);
    if (h) {
      blocks.push(<div key={idx} className={styles.mdH}>{renderInline(h[2], `h${idx}`)}</div>);
      return;
    }
    const li = /^[-*]\s+(.*)$/.exec(line);
    if (li) {
      blocks.push(<div key={idx} className={styles.mdLi}>- {renderInline(li[1], `l${idx}`)}</div>);
      return;
    }
    const q = /^>\s?(.*)$/.exec(line);
    if (q) {
      blocks.push(<div key={idx} className={styles.mdQuote}>&gt; {renderInline(q[1], `q${idx}`)}</div>);
      return;
    }
    blocks.push(<p key={idx} className={styles.mdP}>{renderInline(line, `p${idx}`)}</p>);
  });
  return <>{blocks}</>;
}

/**
 * 运行中的常驻状态行。这是"屏幕上什么都没有"的地板：提交那一刻就出现，秒数一直走，
 * 直到终态才消失。它不等模型吐字、不等产卡成功、事件流断了也照走——上面那些更好看的
 * 东西都可能失效，这条不能。文案取自 run.activity 的可见节点白名单。
 */
function RunStatusLine({ startedAt, activity, stalled }: { startedAt: number | null; activity: string | null; stalled: boolean }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (startedAt === null) return;
    // 先立刻对齐一次，避免刚挂载时沿用上一轮的旧时间戳。
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [startedAt]);

  const status = deriveRunStatus({ activeSince: startedAt, now, activity, stalled });
  if (!status) return null;
  return (
    <div
      className={`${styles.runStatus} ${status.tone === 'stalled' ? styles.runStatusStalled : ''}`}
      role="status"
      aria-live="polite"
    >
      <span className={styles.runStatusMark} aria-hidden="true">✶</span>
      <span>{status.label}</span>
      <span className={styles.runStatusElapsed}>({status.seconds}s)</span>
    </div>
  );
}

/**
 * 产卡过程中那张写到一半的卡。产卡是一个 Run 里最长的一次等待，而这几秒模型是在写不是在等，
 * 这里把写的过程放上屏。
 *
 * 刻意长得不像成品卡：虚线框、压低对比度、没有任何可点的东西。它是未经校验的中间产物，
 * 能落到画布上的只有终态那一张。
 */
function CardPreview({ preview }: { preview: PartialCardPreview | null }) {
  if (!preview) return null;
  return (
    <div className={styles.cardPreview} aria-live="off">
      <div className={styles.cardPreviewLabel}>
        <BookText size={12} strokeWidth={2} />
        <span>生成卡撰写中…</span>
      </div>
      {preview.overview && <div className={styles.cardPreviewOverview}>{preview.overview}</div>}
      {preview.shots.map((shot, i) => (
        <div key={i} className={styles.cardPreviewShot}>
          {shot.title && <div className={styles.cardPreviewShotTitle}>{shot.title}</div>}
          {shot.promptText && (
            <div className={styles.cardPreviewShotPrompt}>
              {shot.promptText}
              <span className={styles.cardPreviewCaret} aria-hidden="true">▍</span>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

/** 可折叠思考过程：小字展示当前步骤，默认收起 */
function ThinkingBlock({ steps, defaultOpen = false }: { steps: string[]; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  if (steps.length === 0) return null;
  return (
    <div className={styles.thinkingBlock}>
      <button
        type="button"
        className={styles.thinkingToggle}
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
      >
        <span>思考过程</span>
        {open ? <ChevronUp size={12} strokeWidth={2.5} /> : <ChevronDown size={12} strokeWidth={2.5} />}
      </button>
      {open && (
        <div className={styles.thinkingBody}>
          {steps.map((s, i) => (
            <div key={i} className={styles.thinkingStep}>{s}</div>
          ))}
        </div>
      )}
    </div>
  );
}

/** 分镜提示词生成卡：单镜头卡（画面/提示词/素材引用 + 手动应用，双击字段可编辑） */
function GenerationCard({
  card,
  onApply,
  disabled,
  applied,
  cancelled,
}: {
  card: NonNullable<SessionContentBlock['card']>;
  onApply: (patch: { shotTitle?: string; visual?: string; prompt?: string }) => void;
  disabled: boolean;
  applied?: boolean;
  /** 本组生成卡已被「取消」：未应用的卡不再可操作（已应用的卡维持已应用态） */
  cancelled?: boolean;
}) {
  /** 双击编辑：本地覆盖字段，应用时随 patch 一并提交 */
  const [edited, setEdited] = useState<{ shotTitle?: string; visual?: string; prompt?: string }>({});
  const [editingField, setEditingField] = useState<'shotTitle' | 'visual' | 'prompt' | null>(null);
  const [draftValue, setDraftValue] = useState('');

  const shotTitle = edited.shotTitle ?? card.shotTitle;
  const visual = edited.visual ?? card.visual;
  const prompt = edited.prompt ?? card.prompt;

  const startEdit = (field: 'shotTitle' | 'visual' | 'prompt', current?: string) => {
    if (applied || cancelled || disabled) return;
    setEditingField(field);
    setDraftValue(current ?? '');
  };
  const commitEdit = () => {
    if (!editingField) return;
    setEdited((prev) => ({ ...prev, [editingField]: draftValue }));
    setEditingField(null);
  };
  const cancelEdit = () => setEditingField(null);

  /** 编辑框自适应高度：撑满实际内容，不用固定行数截断/滚动（保持与双击前的展示一致） */
  const autoResizeTextarea = (el: HTMLTextAreaElement | null) => {
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  };

  return (
    <div className={`${styles.generationCard} ${cancelled ? styles.generationCardCancelled : ''}`}>
      <div className={styles.shotHeader}>
        {editingField === 'shotTitle' ? (
          <input
            className={styles.shotEditInput}
            value={draftValue}
            autoFocus
            onChange={(e) => setDraftValue(e.target.value)}
            onBlur={commitEdit}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitEdit();
              else if (e.key === 'Escape') cancelEdit();
            }}
          />
        ) : (
          <span className={styles.shotTitle} title="双击编辑" onDoubleClick={() => startEdit('shotTitle', shotTitle)}>
            {shotTitle}
            {!applied && card.timeRange && <span className={styles.shotTime}> · {card.timeRange}</span>}
          </span>
        )}
        {applied ? (
          <span className={styles.shotApplied}>已进入画布</span>
        ) : cancelled ? (
          <span className={styles.shotCancelled}>已取消</span>
        ) : (
          <button
            type="button"
            className={`${styles.cardBtn} ${styles.cardBtnPrimary} ${styles.shotApplyBtn}`}
            onClick={() => onApply(edited)}
            disabled={disabled}
          >
            应用到画布
          </button>
        )}
      </div>
      {editingField === 'visual' ? (
        <div className={styles.shotField}>
          <span className={styles.shotFieldLabel}>画面</span>
          <textarea
            ref={autoResizeTextarea}
            className={styles.shotEditTextarea}
            value={draftValue}
            autoFocus
            rows={1}
            onChange={(e) => {
              setDraftValue(e.target.value);
              autoResizeTextarea(e.target);
            }}
            onBlur={commitEdit}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                commitEdit();
              } else if (e.key === 'Escape') cancelEdit();
            }}
          />
        </div>
      ) : (
        visual && (
          <div className={styles.shotField}>
            <span className={styles.shotFieldLabel}>画面</span>
            <span className={styles.shotFieldValue} title="双击编辑" onDoubleClick={() => startEdit('visual', visual)}>
              {visual}
            </span>
          </div>
        )
      )}
      {editingField === 'prompt' ? (
        <div className={styles.shotField}>
          <span className={styles.shotFieldLabel}>提示词</span>
          <textarea
            ref={autoResizeTextarea}
            className={styles.shotEditTextarea}
            value={draftValue}
            autoFocus
            rows={1}
            onChange={(e) => {
              setDraftValue(e.target.value);
              autoResizeTextarea(e.target);
            }}
            onBlur={commitEdit}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                commitEdit();
              } else if (e.key === 'Escape') cancelEdit();
            }}
          />
        </div>
      ) : (
        prompt && (
          <div className={styles.shotField}>
            <span className={styles.shotFieldLabel}>提示词</span>
            <span className={styles.shotFieldValue} title="双击编辑" onDoubleClick={() => startEdit('prompt', prompt)}>
              {prompt}
            </span>
          </div>
        )
      )}
      {card.assetRefs && card.assetRefs.length > 0 && (
        <div className={styles.shotRefs}>
          {card.assetRefs.map((r) => (
            <span key={r} className={styles.shotRef}>{r}</span>
          ))}
        </div>
      )}
      {applied && <div className={styles.appliedHint}>生成卡已进入画布</div>}
      {!applied && cancelled && <div className={styles.cancelledHint}>已取消，不会应用到画布</div>}
    </div>
  );
}

/** 助手消息：按结构化块渲染（text/thinking/card），无块时回退纯文本；追问与需求理解确认都走自然语言（grillme 式），不用结构化卡
 * 生成卡组支持「手动应用整组」「取消」（04 §5.2 用户动作），组内单卡仍可各自应用/双击编辑 */
function AssistantMessageBody({
  message,
  onCardApply,
  onApplyAllCards,
  onCancelCardGroup,
  disabled,
  appliedCardIds,
  cancelledMessageIds,
}: {
  message: ChatMessage;
  onCardApply: (card: NonNullable<SessionContentBlock['card']>, patch: { shotTitle?: string; visual?: string; prompt?: string }) => void;
  onApplyAllCards: (cards: NonNullable<SessionContentBlock['card']>[]) => void;
  onCancelCardGroup: (messageId: string) => void;
  disabled: boolean;
  appliedCardIds: Set<string>;
  cancelledMessageIds: Set<string>;
}) {
  const blocks = message.blocks ?? [];
  const structured = blocks.filter((b) => b.type !== 'text');
  // 有结构化块 → 按块渲染；无 → 纯文本 markdown
  if (structured.length === 0) return <Markdown text={message.content} />;
  const cardBlocks = blocks.filter((b) => b.type === 'card' && b.card).map((b) => b.card!);
  const groupCancelled = cancelledMessageIds.has(message.id);
  const unappliedCards = cardBlocks.filter((c) => !appliedCardIds.has(c.cardId ?? c.shotTitle));
  const showGroupActions = cardBlocks.length > 1 && !groupCancelled && unappliedCards.length > 0;
  return (
    <>
      {blocks.map((b, i) => {
        if (b.type === 'thinking' && b.thinking?.steps) {
          return <ThinkingBlock key={i} steps={b.thinking.steps} />;
        }
        if (b.type === 'card' && b.card) {
          const cardId = b.card.cardId ?? b.card.shotTitle;
          return (
            <GenerationCard
              key={i}
              card={b.card}
              onApply={(patch) => onCardApply(b.card!, patch)}
              disabled={disabled}
              applied={appliedCardIds.has(cardId)}
              cancelled={groupCancelled}
            />
          );
        }
        if (b.text) return <Markdown key={i} text={b.text} />;
        return null;
      })}
      {showGroupActions && (
        <div className={styles.cardGroupActions}>
          <button
            type="button"
            className={styles.cardGroupCancelBtn}
            onClick={() => onCancelCardGroup(message.id)}
            disabled={disabled}
          >
            取消
          </button>
          <button
            type="button"
            className={`${styles.cardBtn} ${styles.cardBtnPrimary}`}
            onClick={() => onApplyAllCards(unappliedCards)}
            disabled={disabled}
          >
            应用整组到画布
          </button>
        </div>
      )}
    </>
  );
}

/** 可选模型列表 */
const models = [
  { key: 'minimax-m3', label: 'MiniMax-M3', cost: '1x' },
  { key: 'deepseek-v4-pro', label: 'DeepSeek-V4-Pro', cost: '1x' },
  { key: 'deepseek-v4-flash', label: 'DeepSeek-V4-Flash', cost: '1x' },
  { key: 'qwen3.8-max', label: 'Qwen3.8-Max', cost: '1x' },
];

/** 快捷问题 */
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

/** 侧边栏状态文案（对齐 04-侧边栏规范 §7 用户感知） */
const phaseLabels: Record<AgentPhase, string> = {
  idle: '等待输入',
  processing: 'Agent 处理中',
  awaiting_input: '等待你补充',
  awaiting_confirm: '等待你确认需求理解',
  generating_cards: '正在整理分镜提示词',
  cards_ready: '生成卡已就绪',
  applying: '正在应用到画布',
  applied: '已进入画布',
  payment_required: '运行授权或余额不足',
  failed: '处理失败',
};

/** 默认位置（页面中间偏右） */
const DEFAULT_POSITION = { x: 0, y: 0 };

interface AgentPanelProps {
  onClose: () => void;
  initialInput?: string;
  /** 生成卡引用标签：有值时输入框渲染成可移除胶囊（画布「给 Agent」），而非纯文本预填 */
  initialCardLabel?: string;
  /** 外部注入版本号：变化时覆盖输入框（节点「添加到对话」） */
  inputVersion?: number;
  /** 当前项目ID：发送消息走 POST /api/projects/:id/conversation/messages */
  projectId?: string;
  /** 生成卡手动应用 → 落画布节点（B2：先落画布再选引用 dock/Agent）；载荷是会话层唯一的生成卡形状，不再另开一份 */
  onApplyToDock?: (payload: GenerationCardBlock) => void;
  /** 首页「直接使用」技能 → 画布导航携带的强制技能 ID：挂载后武装为下一条消息的 forced skill */
  initialSkillId?: string;
}

export default function AgentPanel({ onClose, initialInput, initialCardLabel, inputVersion, projectId, onApplyToDock, initialSkillId }: AgentPanelProps) {
  /** 富文本输入框（可多次插入生成卡引用胶囊 + 普通 @ 文本预填） */
  const chipEditorRef = useRef<ChipTextEditorHandle>(null);
  /** 输入框实时纯文本（胶囊已替换成完整 prompt），供发送按钮启用态判断 */
  const [composedText, setComposedText] = useState('');
  const [selectedModel, setSelectedModel] = useState(models[0].key);
  const [modelOpen, setModelOpen] = useState(false);
  const [showUpload, setShowUpload] = useState(false);
  const [showSkillModal, setShowSkillModal] = useState(false);
  const [floating, setFloating] = useState(false);
  /* ---- 对话状态机：消息流/运行态/流式文本由 session 维度事件流驱动（快照水合 + assistant.delta 流式） ---- */
  const {
    messages,
    sessionId,
    sessions,
    streamingText,
    streaming,
    runningRunId,
    failedRunId,
    thinkingSteps,
    turnStartedAt,
    partialCard,
    longRunning,
    chatError,
    pendingUnderstanding,
    confirmError,
    confirmationPending,
    confirmUnderstanding,
    correctUnderstanding,
    retryUnavailable,
    sendError,
    paymentRequiredMessage,
    agentPhase,
    sendMessage,
    stopRun,
    retryRun,
    resetChat,
    reconnectSession,
    switchSession,
    deleteSession,
    refreshSessions,
  } = useAgentSession(projectId ?? '');
  /** 历史会话下拉展开态 */
  const [historyOpen, setHistoryOpen] = useState(false);
  /** 待确认删除的历史会话（点 X 后弹二次确认，取消不删） */
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; title: string } | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  /** 历史会话下拉容器 ref（外部点击自动收起判定） */
  const historyRef = useRef<HTMLDivElement>(null);
  /** 模型选择下拉容器 ref（外部点击自动收起判定） */
  const modelRef = useRef<HTMLDivElement>(null);
  /** 上传菜单容器 ref（外部点击自动收起判定） */
  const uploadRef = useRef<HTMLDivElement>(null);
  /** 当前 Run 的技能推荐列表（推荐区域展示） */
  const [recs, setRecs] = useState<RunSkillRecommendation[]>([]);
  /** 已点 Use 的推荐技能ID（仅用户点 Use 可激活） */
  const [usedSkillIds, setUsedSkillIds] = useState<Set<string>>(new Set());
  /** 已手动应用、落成画布节点的生成卡 ID（标记「已应用」）。dock 是那个节点之后可选的下游动作，不是这一步的去处 */
  const [appliedCardIds, setAppliedCardIds] = useState<Set<string>>(new Set());
  /** 已「取消」的生成卡组（按消息ID标记，组内未应用的卡不再可操作） */
  const [cancelledMessageIds, setCancelledMessageIds] = useState<Set<string>>(new Set());
  /** 「直接使用」武装的强制技能（下一条消息发送时携带 forced_creative_skill_id，发送后清除）；name 供指示条展示 */
  const [forcedSkill, setForcedSkill] = useState<{ id: string; name: string } | null>(null);
  /** 确认门「修改」编辑态：展开文本编辑，提交 correct 动作 */
  const [editingSummary, setEditingSummary] = useState(false);
  const [summaryDraft, setSummaryDraft] = useState('');

  /* ---- 拖动状态 ---- */
  const [position, setPosition] = useState(DEFAULT_POSITION);
  const [initialized, setInitialized] = useState(false);
  const [panelHeight, setPanelHeight] = useState<number | undefined>(undefined);
  const panelRef = useRef<HTMLDivElement>(null);
  const dragState = useRef({ dragging: false, startX: 0, startY: 0, origX: 0, origY: 0 });

  const currentModel = models.find((m) => m.key === selectedModel);

  /** 外部注入 @ 引用/生成卡：仅在版本真正变化时触发一次；生成卡追加胶囊（可多次叠加），普通引用整体替换文本
   * ref 记录已处理的 version，防 StrictMode 开发态 effect 双调用导致重复插入 */
  const lastInputVersionRef = useRef(0);
  useEffect(() => {
    if (!inputVersion || inputVersion === lastInputVersionRef.current) return;
    lastInputVersionRef.current = inputVersion;
    if (initialCardLabel) {
      chipEditorRef.current?.insertChip({
        id: String(inputVersion),
        label: initialCardLabel,
        prompt: initialInput ?? '',
      });
    } else {
      chipEditorRef.current?.setText(initialInput ?? '');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inputVersion]);

  /** 首页「直接使用」技能导航进来：武装为下一条消息的强制技能（StrictMode 双挂载只武装一次） */
  const lastSkillIdRef = useRef('');
  useEffect(() => {
    if (!initialSkillId || initialSkillId === lastSkillIdRef.current) return;
    lastSkillIdRef.current = initialSkillId;
    setForcedSkill({ id: initialSkillId, name: '已选技能' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialSkillId]);

  /** 运行开始后拉取 Run 级技能推荐（GET /api/agent/runs/:runId/creative-skill-recommendations）
   * 后端未部署该接口（404）时静默隐藏推荐区域 */
  useEffect(() => {
    if (runningRunId === null) return;
    let alive = true;
    fetchRunSkillRecommendations(runningRunId)
      .then((list) => {
        if (alive) setRecs(Array.isArray(list) ? list : []);
      })
      .catch((e) => {
        if (isApiError(e) && e.status === 404) {
          if (alive) setRecs([]);
          return;
        }
        console.warn('获取技能推荐失败:', e);
      });
    return () => {
      alive = false;
    };
  }, [runningRunId]);

  /** 新消息/流式文本自动滚动到底部 */
  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, streamingText, runningRunId]);

  /** 初始化位置：屏幕右侧；首次挂载也走统一安全边界，窄视口不会横向溢出。 */
  useEffect(() => {
    if (!initialized && panelRef.current) {
      const el = panelRef.current;
      const page = el.parentElement;
      if (page) {
        const rect = el.getBoundingClientRect();
        const header = page.querySelector('header');
        const headerH = header?.getBoundingClientRect().height ?? 0;
        const layout = getPanelLayout({
          pageWidth: page.clientWidth,
          pageHeight: page.clientHeight,
          headerHeight: headerH,
          panelWidth: rect.width,
          panelHeight: page.clientHeight - headerH - page.clientHeight * 0.08,
          desiredX: page.clientWidth * (1 - 0.015) - rect.width,
          desiredY: headerH + page.clientHeight * 0.01,
        });
        setPosition({ x: layout.x, y: layout.y });
        setPanelHeight(layout.height);
      }
      setInitialized(true);
    }
  }, [initialized]);

  /** 窗口缩放自适应：固定/浮动模式共用同一坐标与高度边界。 */
  useEffect(() => {
    const handleResize = () => {
      const el = panelRef.current;
      const page = el?.parentElement;
      if (!el || !page) return;
      const header = page.querySelector('header');
      const headerH = header?.getBoundingClientRect().height ?? 0;
      const rect = el.getBoundingClientRect();
      if (floating) {
        setPosition((prev) => {
          const layout = getPanelLayout({
            pageWidth: page.clientWidth,
            pageHeight: page.clientHeight,
            headerHeight: headerH,
            panelWidth: rect.width,
            panelHeight: rect.height,
            desiredX: prev.x,
            desiredY: prev.y,
          });
          setPanelHeight(layout.height);
          return { x: layout.x, y: layout.y };
        });
        return;
      }
      // 固定模式：保持初始比例（右 1.5%、上 1%、下 7%），避免缩窗后被推出可视区
      const layout = getPanelLayout({
        pageWidth: page.clientWidth,
        pageHeight: page.clientHeight,
        headerHeight: headerH,
        panelWidth: rect.width,
        panelHeight: page.clientHeight - headerH - page.clientHeight * 0.08,
        desiredX: page.clientWidth * (1 - 0.015) - rect.width,
        desiredY: headerH + page.clientHeight * 0.01,
      });
      setPosition({ x: layout.x, y: layout.y });
      setPanelHeight(layout.height);
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [floating]);

  /** 下拉（历史会话 / 模型选择 / 上传菜单）外部点击自动收起（点击面板其他区域或页面任意处） */
  useEffect(() => {
    if (!historyOpen && !modelOpen && !showUpload) return;
    const handleDocMouseDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (historyRef.current && !historyRef.current.contains(target)) setHistoryOpen(false);
      if (modelRef.current && !modelRef.current.contains(target)) setModelOpen(false);
      if (uploadRef.current && !uploadRef.current.contains(target)) setShowUpload(false);
    };
    document.addEventListener('mousedown', handleDocMouseDown);
    return () => document.removeEventListener('mousedown', handleDocMouseDown);
  }, [historyOpen, modelOpen, showUpload]);

  /** 鼠标按下头部开始拖动（仅浮动模式下可拖） */
  const handleDragStart = useCallback(
    (e: React.MouseEvent) => {
      if (!floating) return;
      // 只在 header 区域按下时触发拖动（排除按钮点击）
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

  /** 鼠标移动 */
  const handleDragMove = useCallback(
    (e: MouseEvent) => {
      const ds = dragState.current;
      if (!ds.dragging) return;
      const dx = e.clientX - ds.startX;
      const dy = e.clientY - ds.startY;
      const el = panelRef.current;
      const page = el?.parentElement;
      if (!el || !page) return;
      const headerH = page.querySelector('header')?.getBoundingClientRect().height ?? 0;
      const rect = el.getBoundingClientRect();
      const layout = getPanelLayout({
        pageWidth: page.clientWidth,
        pageHeight: page.clientHeight,
        headerHeight: headerH,
        panelWidth: rect.width,
        panelHeight: rect.height,
        desiredX: ds.origX + dx,
        desiredY: ds.origY + dy,
      });
      setPosition({ x: layout.x, y: layout.y });
    },
    [],
  );

  /** 鼠标释放 */
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

  /** 点击快捷问题 */
  const handleQuickQuestion = (prompt: string) => {
    chipEditorRef.current?.setText(prompt);
  };

  /** 开启新对话：清空当前输入、消息流、技能推荐、武装技能与历史下拉 */
  const handleNewChat = () => {
    chipEditorRef.current?.clear();
    resetChat();
    setRecs([]);
    setUsedSkillIds(new Set());
    setForcedSkill(null);
    setHistoryOpen(false);
  };

  /** 使用推荐技能：标记已激活，并把技能意图追加为一条消息提交给 Agent（顺带清掉「直接使用」武装，避免双技能叠加） */
  const handleUseSkill = async (r: RunSkillRecommendation) => {
    if (usedSkillIds.has(r.creative_skill_id) || runningRunId !== null || streaming) return;
    const accepted = await sendMessage(`使用「${r.name}」技能继续创作`, r.creative_skill_id);
    if (!accepted) return;
    setUsedSkillIds((prev) => new Set(prev).add(r.creative_skill_id));
    setForcedSkill(null);
  };

  /** 发送消息：composedText 已把胶囊替换成完整 prompt 并跟自由输入拼接好；
   * 若已武装「直接使用」技能，本条消息携带 forced_creative_skill_id 强制激活后清除 */
  const handleSend = async () => {
    const content = composedText.trim();
    if (!content || runningRunId !== null || streaming) return;
    const accepted = await sendMessage(content, forcedSkill?.id);
    if (!accepted) return;
    chipEditorRef.current?.clear();
    setForcedSkill(null);
  };

  /** 手动应用生成卡 → 落画布节点（B2：标记已应用 + 回调 CanvasPage 落生成卡节点；patch 为双击编辑后的字段覆盖） */
  const handleCardApply = (
    card: NonNullable<SessionContentBlock['card']>,
    patch: { shotTitle?: string; visual?: string; prompt?: string },
  ) => {
    if (runningRunId !== null || streaming) return;
    const cardId = card.cardId ?? card.shotTitle;
    setAppliedCardIds((prev) => new Set(prev).add(cardId));
    const payload: GenerationCardBlock = { ...card, ...patch, cardId };
    onApplyToDock?.(payload);
  };

  /** 手动应用整组生成卡（04 §5.2）：依次应用组内每张未应用的卡，不带各卡的双击编辑覆盖（编辑态仅存在于各卡内部，整组应用按原卡内容落地） */
  const handleApplyAllCards = (cards: NonNullable<SessionContentBlock['card']>[]) => {
    if (runningRunId !== null || streaming || cards.length === 0) return;
    cards.forEach((card) => handleCardApply(card, {}));
  };

  /** 取消这组生成卡（04 §5.2）：标记消息已取消，组内未应用的卡不再可操作 */
  const handleCancelCardGroup = (messageId: string) => {
    setCancelledMessageIds((prev) => new Set(prev).add(messageId));
  };

  /** 上传文件 */
  const handleUploadClick = () => {
    setShowUpload(!showUpload);
  };

  const handleFileSelect = () => {
    fileInputRef.current?.click();
    setShowUpload(false);
  };

  return (
    <div
      ref={panelRef}
      className={styles.panel}
      style={initialized ? { left: position.x, top: position.y, height: panelHeight, transform: 'none' } : undefined}
      onMouseDown={handleDragStart}
    >
      {/* 头部标题栏（拖动区域） */}
      <div className={`${styles.panelHeader} ${floating ? styles.panelHeaderFloating : ''}`}>
        <div className={styles.headerLeft}>
          <button className={styles.newChatBtn} onClick={handleNewChat} title="开启新对话">
            <Plus size={14} strokeWidth={2.5} />
            <span>新对话</span>
          </button>
          <div className={styles.historyWrap} ref={historyRef}>
            <button
              className={`${styles.historyBtn} ${historyOpen ? styles.iconBtnActive : ''}`}
              onClick={() => {
                const next = !historyOpen;
                setHistoryOpen(next);
                if (next) refreshSessions();
              }}
              title="历史会话"
            >
              <History size={14} strokeWidth={2} />
              {/* 当前会话标题：标题异步生成完成（session.updated）后就地更新，不再永远是「新对话」 */}
              <span className={styles.historyBtnTitle}>
                {sessions.find((s) => s.session_id === sessionId)?.title || '新对话'}
              </span>
              <ChevronDown size={12} strokeWidth={2} />
            </button>
            {historyOpen && (
              <div className={styles.historyDropdown}>
                <div className={styles.historyDropdownTitle}>历史会话</div>
                {sessions.length === 0 ? (
                  <div className={styles.historyEmpty}>暂无历史会话</div>
                ) : (
                  sessions.map((s) => (
                    <div
                      key={s.session_id}
                      className={`${styles.historyItem} ${s.session_id === sessionId ? styles.historyItemActive : ''}`}
                    >
                      <button
                        type="button"
                        className={styles.historyItemLabel}
                        onClick={() => {
                          switchSession(s.session_id);
                          setHistoryOpen(false);
                        }}
                      >
                        {s.title || '新对话'}
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
                    </div>
                  ))
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
          <button className={styles.iconBtn} onClick={onClose} title="关闭">
            <X size={14} strokeWidth={2} />
          </button>
        </div>
      </div>

      {messages.length === 0 && !streamingText ? (
        <>
          {/* 提示文案 */}
          <div className={styles.hintArea}>
            <h3 className={styles.hintTitle}>让 Agent 帮你创作</h3>
            <p className={styles.hintDesc}>
              描述你想生成的图片或视频，发送第一条消息即可开始。未发送的草稿会自动保留。
            </p>
          </div>

          {/* 快捷问题卡片 */}
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
        /* 对话消息流 */
        <div className={styles.messageList} ref={listRef}>
          {/* 侧边栏状态条（S5：状态机用户可见反馈） */}
          {messages.length > 0 && agentPhase !== 'idle' && (
            <div className={`${styles.phaseBar} ${styles[`phase_${agentPhase}`] ?? ''}`}>
              <span className={styles.phaseDot} />
              {phaseLabels[agentPhase]}
            </div>
          )}
          {messages.map((m) =>
            m.role === 'user' ? (
              <div key={m.id} className={styles.userBubble}>{m.content}</div>
            ) : (
              <div key={m.id} className={styles.assistantBlock}>
                <AssistantMessageBody
                  message={m}
                  onCardApply={handleCardApply}
                  onApplyAllCards={handleApplyAllCards}
                  onCancelCardGroup={handleCancelCardGroup}
                  disabled={runningRunId !== null || streaming}
                  appliedCardIds={appliedCardIds}
                  cancelledMessageIds={cancelledMessageIds}
                />
              </div>
            ),
          )}
          {/* Agent 的思考过程（run.activity 实时步 + reasoning_trace 终态链）；有步即展示，运行中/终态后都可回看 */}
          {thinkingSteps.length > 0 && (
            <div className={styles.assistantBlock}>
              <ThinkingBlock steps={thinkingSteps} />
            </div>
          )}
          {/* Agent 运行中的实时流式文本（assistant.delta 累积投影） */}
          {streamingText && (
            <div className={styles.assistantBlock}>
              <Markdown text={streamingText} />
            </div>
          )}
          {/* 产卡逐版预览（IKA3GF）：在正文之后、成品卡将要出现的位置 */}
          <CardPreview preview={partialCard} />
          {/* 确认门结构化 UI：需求理解提案已到、等待用户确认/修改（04 §4，动作依附当前内容下） */}
          {pendingUnderstanding && (
            <div className={styles.confirmGate}>
              <div className={styles.confirmTitle}>需求理解确认</div>
              {editingSummary ? (
                <>
                  <textarea
                    className={styles.confirmEditTextarea}
                    value={summaryDraft}
                    autoFocus
                    rows={3}
                    onChange={(e) => setSummaryDraft(e.target.value)}
                  />
                  {confirmError && <div className={styles.confirmError}>{confirmError}</div>}
                  <div className={styles.confirmActions}>
                    <button
                      type="button"
                      className={`${styles.confirmBtn} ${styles.confirmBtnPrimary}`}
                      onClick={async () => {
                        if (await correctUnderstanding(summaryDraft)) setEditingSummary(false);
                      }}
                      disabled={runningRunId !== null || streaming || confirmationPending || !summaryDraft.trim()}
                    >
                      {confirmationPending ? '提交中…' : '提交修改'}
                    </button>
                    <button
                      type="button"
                      className={styles.confirmBtn}
                      onClick={() => setEditingSummary(false)}
                      disabled={confirmationPending}
                    >
                      取消
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <div className={styles.confirmSummary}>{pendingUnderstanding.proposed_summary}</div>
                  {pendingUnderstanding.proposed_options?.length ? (
                    <div className={styles.confirmOptions}>
                      {pendingUnderstanding.proposed_options.map((opt) => (
                        <button
                          key={opt.id}
                          type="button"
                          className={styles.confirmOption}
                          onClick={() => void correctUnderstanding(opt.label)}
                          disabled={runningRunId !== null || streaming || confirmationPending}
                        >
                          {opt.label}
                        </button>
                      ))}
                    </div>
                  ) : null}
                  {confirmError && <div className={styles.confirmError}>{confirmError}</div>}
                  <div className={styles.confirmActions}>
                    <button
                      type="button"
                      className={`${styles.confirmBtn} ${styles.confirmBtnPrimary}`}
                      onClick={() => void confirmUnderstanding()}
                      disabled={runningRunId !== null || streaming || confirmationPending}
                    >
                      {confirmationPending ? '提交中…' : '确认需求理解'}
                    </button>
                    <button
                      type="button"
                      className={styles.confirmBtn}
                      onClick={() => {
                        setSummaryDraft(pendingUnderstanding.proposed_summary);
                        setEditingSummary(true);
                      }}
                      disabled={runningRunId !== null || streaming || confirmationPending}
                    >
                      修改
                    </button>
                  </div>
                </>
              )}
            </div>
          )}
          {longRunning && (
            <div className={styles.longRunHint}>
              <span>
                {runningRunId
                  ? '仍在处理中，已超过 1 分钟无新内容。若无响应可取消后重试。'
                  : '已超过 1 分钟未收到运行状态，可重新连接会话恢复最新状态。'}
              </span>
              {runningRunId && <span className={styles.longRunMeta}>run {runningRunId}</span>}
              {!runningRunId && (
                <button className={styles.cancelBtn} onClick={reconnectSession}>重新连接</button>
              )}
            </div>
          )}
          {runningRunId !== null && (
            <div className={styles.cancelRow}>
              <button className={styles.cancelBtn} onClick={stopRun}>取消运行</button>
            </div>
          )}
        </div>
      )}

      {/* Run 级技能推荐区域 */}
      {recs.length > 0 && (
        <div className={styles.recommendArea}>
          <div className={styles.recommendTitle}>推荐技能</div>
          <div className={styles.recommendList}>
            {recs.map((r) => {
              const used = usedSkillIds.has(r.creative_skill_id);
              return (
                <div key={r.creative_skill_id} className={styles.recommendItem}>
                  <div className={styles.recommendInfo}>
                    <span className={styles.recommendName}>{r.name}</span>
                    <span className={styles.recommendDesc} title={r.description}>{r.description}</span>
                  </div>
                  <button
                    className={`${styles.recommendUseBtn} ${used ? styles.recommendUsed : ''}`}
                    onClick={() => handleUseSkill(r)}
                    disabled={used || runningRunId !== null || streaming}
                  >
                    {used ? '已使用' : 'Use'}
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* 输入区域 */}
      <div className={styles.inputArea}>
        {/* 常驻状态行（IKA3GD）：钉在输入框正上方，不在滚动区里。
            它是"屏幕上什么都没有"的地板，用户往上翻历史时更不能让它跟着滚走。 */}
        <RunStatusLine
          startedAt={turnStartedAt}
          activity={thinkingSteps.at(-1) ?? null}
          stalled={longRunning}
        />
        {forcedSkill && (
          <div className={styles.armedSkill}>
            <span>技能「{forcedSkill.name}」已就绪，发送后生效</span>
            <button
              type="button"
              className={styles.armedSkillClear}
              onClick={() => setForcedSkill(null)}
              title="取消技能"
            >
              <X size={12} strokeWidth={2} />
            </button>
          </div>
        )}
        {chatError && <div className={styles.chatErrorHint}>{chatError}</div>}
        {sendError && <div className={styles.chatErrorHint}>{sendError}</div>}
        {paymentRequiredMessage && <div className={styles.chatErrorHint}>{paymentRequiredMessage}</div>}
        {retryUnavailable && (
          <div className={styles.chatErrorHint}>当前后端未提供重试接口；请开启新对话或联系管理员升级服务。</div>
        )}
        <div className={styles.inputBox}>
          <ChipTextEditor
            ref={chipEditorRef}
            placeholder="描述你的想法，使用 @ 引用素材"
            onChangeText={setComposedText}
            onSend={handleSend}
          />

          {/* 底部工具栏 */}
          <div className={styles.inputToolbar}>
          {/* 左侧 */}
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
                  <button onClick={handleFileSelect}>上传图片</button>
                  <button onClick={handleFileSelect}>上传视频</button>
                </div>
              )}
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*,video/*"
                className={styles.hiddenInput}
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

          {/* 右侧 */}
          <div className={styles.toolbarRight}>
            <div className={styles.modelWrap} ref={modelRef}>
              <button
                className={styles.modelBtn}
                onClick={() => setModelOpen(!modelOpen)}
              >
                <span className={styles.modelLabel}>
                  {currentModel?.label ?? '选择模型'}
                </span>
                <ChevronDown
                  size={12}
                  strokeWidth={2}
                  className={`${styles.modelArrow} ${modelOpen ? styles.modelArrowUp : ''}`}
                />
              </button>
              {modelOpen && (
                <div className={styles.modelDropdown}>
                  <div className={styles.modelDropdownHeader}>
                    <span className={styles.modelDropdownTitle}>Agent 模型</span>
                    <span className={styles.modelDropdownDesc}>选择驱动 Agent 的模型。</span>
                  </div>
                  {models.map((m) => (
                    <button
                      key={m.key}
                      className={`${styles.modelOption} ${m.key === selectedModel ? styles.modelOptionActive : ''}`}
                      onClick={() => {
                        setSelectedModel(m.key);
                        setModelOpen(false);
                      }}
                    >
                      <span>{m.label}</span>
                      <span className={styles.modelCost}>
                        <Coins size={12} strokeWidth={2} />
                        消耗 {m.cost}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>

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
            {runningRunId !== null ? (
              <button
                className={`${styles.sendBtn} ${styles.stopBtnActive}`}
                onClick={stopRun}
                title="停止运行"
              >
                <Square size={12} fill="#fff" strokeWidth={0} />
              </button>
            ) : (
              <button
                className={`${styles.sendBtn} ${composedText.trim() ? styles.sendBtnActive : ''}`}
                onClick={handleSend}
                disabled={!composedText.trim() || sessionId === null || streaming}
                title={
                  sessionId === null
                    ? '会话初始化中，输入内容会保留'
                    : streaming
                      ? '等待运行状态；超时后可重新连接'
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

      {/* Skill 技能库弹窗（与首页对话框共用） */}
      <SkillModal
        open={showSkillModal}
        onClose={() => setShowSkillModal(false)}
        onUseSkill={(s) => {
          if (!s.creative_skill_id) return;
          setForcedSkill({ id: s.creative_skill_id, name: s.name ?? '已选技能' });
          setShowSkillModal(false);
        }}
      />

      {/* 历史会话删除二次确认 */}
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
