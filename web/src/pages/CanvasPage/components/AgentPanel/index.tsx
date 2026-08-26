/* ============================================
 * AgentPanel Agent 智能体对话面板：消息流与任务执行
 * ============================================ */
import { useState, useRef, useEffect, useCallback } from 'react';
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
  MessageSquare,
  Check,
  CheckCircle2,
  RotateCcw,
  Package,
  Cog,
  AlertTriangle,
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import styles from './index.module.css';
import { isApiError } from '@/api/http';
import { fetchMySkills, fetchRunSkillRecommendations, type RunSkillRecommendation } from '@/api/skills';
import { useAgentSession, type ChatMessage, type TurnOutcome } from '../../hooks/useAgentSession';
import { deriveRunStatus, formatElapsed, formatTokens, type RunStatus } from '../../hooks/runStatusLine';
import type { PartialCardPreview } from '../../hooks/partialCardPreview';
import { fetchSessionCredits, type SessionContentBlock, type GenerationCardBlock, type OutboundAssetRef } from '@/api/agentSessions';
import { commitSidebarAttachment, planAttachment, type SidebarCanvasUpload } from './attachments';
import { MessageAssetPreview, rememberAssetUrl } from './MessageAssetPreview';
import SkillModal from '@/pages/Home/components/SkillModal';
import ConfirmModal from '@/components/ConfirmModal';
import ChipTextEditor, { type ChipTextEditorHandle } from '../ChipTextEditor';
import {
  EMPTY_COMPOSED,
  composedIsEmpty,
  resolveComposed,
  type ComposedValue,
} from '../ChipTextEditor/composed';
import AssetChip from '../AssetChip';
import { shouldCancelOnKey } from './cancelShortcut';
import { dockedPanelLayout, freePanelLayout, type PanelMetrics } from './layout';

/** 父组件没传已应用集合时的空集。提到模块级是为了保持引用稳定，避免每次渲染都造一个新 Set。 */
const EMPTY_APPLIED_IDS: ReadonlySet<string> = new Set<string>();

/**
 * Agent 回复的 Markdown 渲染。
 *
 * 原来是手写的逐行解析器，只认标题、无序列表和引用：模型输出的表格原样显示成一堆竖线，
 * 有序列表退化成普通段落，围栏代码块的 ``` 直接印在正文里（IKA2VC-4）。这些都不是能靠
 * 补几条正则收住的，换成 react-markdown + GFM 一次解决，也顺带把嵌套、链接、删除线补上。
 *
 * 表格自带横向滚动容器：面板本来就窄，宽表格必须自己滚，不能把整个消息流撑出横向滚动条。
 */
export function Markdown({ text }: { text: string }) {
  return (
    <div className={styles.md}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          table: ({ children }) => (
            <div className={styles.mdTableWrap}>
              <table>{children}</table>
            </div>
          ),
          // 模型偶尔会输出链接。新标签页打开，并断开与本页的 opener 引用。
          a: ({ children, href }) => (
            <a href={href} target="_blank" rel="noreferrer noopener">
              {children}
            </a>
          ),
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}

/**
 * 每个阶段的符号与样式。
 *
 * 按 **phase** 而不是 tone 分派：tone 只有四档，`completed` 和 `cancelled` 同为 `done`，
 * 用它分派会让「已完成」和「已取消」长得一模一样、只差两个字。而这两件事用户的反应完全
 * 不同——一个是拿结果，一个是想知道自己刚才停掉的是哪一轮——必须一眼分得开。
 *
 * 进行中的三态共用脉动的 `✶`：它们本来就是同一件事的连续过程，靠文案和语气区分即可，
 * 把符号也拆开反而会让运行中的界面一直在跳。
 */
const RUN_STATUS_MARK: Record<RunStatus['phase'], string> = {
  dispatching: '✶',
  working: '✶',
  stalled: '✶',
  completed: '✻',
  cancelled: '⊘',
  failed: '✕',
};

const RUN_STATUS_PHASE_CLASS: Record<RunStatus['phase'], string> = {
  dispatching: '',
  working: '',
  stalled: styles.runStatusStalled ?? '',
  completed: styles.runStatusDone ?? '',
  cancelled: styles.runStatusCancelled ?? '',
  failed: styles.runStatusError ?? '',
};

/**
 * 常驻状态行。这是"屏幕上什么都没有"的地板：提交那一刻就出现，秒数一直走，事件流断了
 * 也照走——上面那些更好看的东西（思考链、卡片逐段长出来）都可能失效，这条不能。
 *
 * IKA4PG 起它不再随终态消失，而是留下来报这一轮的账（耗时、token），下一轮开始才被替换。
 * 判断一次运行是不是卡死靠的就是"秒数还在走吗、token 还在变吗"，两者都必须持续可见。
 */
function RunStatusLine({
  startedAt,
  activity,
  stalled,
  hasRunId,
  outcome,
  streamedText,
}: {
  startedAt: number | null;
  activity: string | null;
  stalled: boolean;
  hasRunId: boolean;
  outcome: TurnOutcome | null;
  streamedText: string;
}) {
  const [now, setNow] = useState(() => Date.now());
  const settled = outcome !== null;
  useEffect(() => {
    // 终态后不再每秒重渲染：秒数已经冻住了，继续跑定时器只是白烧一次渲染。
    if (startedAt === null || settled) return;
    // 先立刻对齐一次，避免刚挂载时沿用上一轮的旧时间戳。
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [startedAt, settled]);

  const status = deriveRunStatus({
    activeSince: startedAt,
    now,
    activity,
    stalled,
    hasRunId,
    outcome: outcome?.outcome ?? null,
    finishedAt: outcome?.finishedAt ?? null,
    streamedText,
    estimatedOutputTokensAtFinish: outcome?.estimatedOutputTokens ?? null,
    tokenUsage: outcome?.tokenUsage ?? null,
    contextCapacity: outcome?.contextCapacity ?? null,
  });
  if (!status) return null;

  const context = status.context;
  const contextPercent = context ? Math.round(context.ratio * 100) : null;
  /**
   * 这一行有没有账可报（IKALN7）。
   *
   * 统计现在包在括号里紧跟状态词，所以「三项全缺」不能再靠一个空 span 蒙混过去——那会渲染出
   * 一对孤零零的 `()`。秒数、token、上下文各自都可缺（终态缺 finishedAt、非流式轮次没有
   * token、拿不到容量时没有上下文），三者皆无时整段不渲染。
   */
  const hasMeta =
    status.seconds !== null || status.tokens !== null || (context !== null && contextPercent !== null);
  return (
    <div
      className={`${styles.runStatus} ${RUN_STATUS_PHASE_CLASS[status.phase]}`}
      role="status"
      aria-live="polite"
    >
      <span className={styles.runStatusMark} aria-hidden="true">
        {RUN_STATUS_MARK[status.phase]}
      </span>
      <span>{status.label}</span>
      {/* 运行中把这一段对读屏遮起来：秒数每秒变一次，`aria-live` 会把它一遍遍念出来，
          盖过真正有信息量的状态文案。终态时放开，此时它只念一次，正是这一轮的账。 */}
      {hasMeta && (
        <span className={styles.runStatusMeta} aria-hidden={!status.settled}>
          {/* 统计包在括号里紧跟状态词（IKALN7），整体读作「已完成 (20s · ↓ 1.9k · 上下文 12%)」。
              此前 `.runStatusMeta` 带 `margin-left: auto`，把这一串顶到状态栏最右端，和左边的
              状态文案看着像两件不相干的东西；括号 + 取消 auto 之后它们是一个整体。 */}
          {'('}
          {/* 秒数、token、上下文各自可缺，分隔符因此只能在**前面已经有东西**时才出——
              否则终态缺 finishedAt（秒数为 null）时，这一行会以一个孤零零的「 · 」开头。 */}
          {status.seconds !== null && formatElapsed(status.seconds)}
          {status.tokens && (
            <>
              {status.seconds !== null && ' · '}
              {/* 流式期间这个数是按字符估的：模型只在结束时报真实用量，中途没有增量。
                  它的作用是活性信号——用户要判断的是"它还在动吗"，不是精确值。 */}
              <span title={status.tokens.estimated ? '流式期间为估算值，结束后显示实际用量' : '本轮实际输出用量'}>
                ↓ {formatTokens(status.tokens.output)}
                {status.tokens.estimated ? '≈' : ''}
              </span>
            </>
          )}
          {context !== null && contextPercent !== null && (
            <>
              {(status.seconds !== null || status.tokens !== null) && ' · '}
              <span title={`上下文 ${context.usedTokens} / ${context.maxTokens} tokens`}>
                上下文 {contextPercent}%
              </span>
              {/* 压缩过历史要给可见文案：此前只追加一个 ⤺，说明埋在 title 里，触屏根本没有
                  hover，等于没有提示。而"早先的对话已被摘要"直接影响用户对模型记得什么的预期。 */}
              {context.compacted && (
                <span className={styles.runStatusCompacted} title="上下文接近上限，较早的对话已被摘要压缩">
                  {' · '}已压缩历史
                </span>
              )}
            </>
          )}
          {')'}
        </span>
      )}
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

/**
 * 可折叠思考过程：小字展示。
 *
 * 两种内容，来源不同所以分开渲染：`steps` 是服务端选的模板文案，`reasoning` 是模型自己的
 * 原话（IKA3M6）。原话排在步骤下面——它更长、更零散，也更可能出现自我否定和内部名词，
 * 不该抢在"它现在在干什么"前面。
 *
 * ## 开合归谁管
 *
 * `autoOpen` 是**随状态变化的默认值**，不是初始值。此前这里是 `useState(defaultOpen)`：
 * 初始值只在挂载那一刻读一次，而这个块几乎总是先由 `run.activity` 的步骤挂载（那时还没有
 * 思考原话，`defaultOpen` 是 false），等原话流进来时组件早就挂上了，于是"运行中默认展开"
 * 这条从来没生效过——思考一直在流，用户一个字也看不见。
 *
 * 用户点过就以用户为准（`override`），没点过就跟着 `autoOpen` 走。这样运行中自动展开、
 * 正文一出现自动收起，而任何时候用户都能把它按回自己想要的样子。
 */
function ThinkingBlock({
  steps,
  reasoning,
  autoOpen = false,
}: {
  steps: string[];
  reasoning?: string;
  autoOpen?: boolean;
}) {
  const [override, setOverride] = useState<boolean | null>(null);
  const open = override ?? autoOpen;
  const setOpen = (next: boolean) => setOverride(next);

  /**
   * 思考原话自己就是一个滚动容器（`.thinkingReasoning` 上有 `max-height: 220px; overflow-y: auto`），
   * 所以外层消息列表滚到底对它没有任何作用——文字是在那个 220px 的盒子里往下长的，盒子外面的
   * 高度一点没变。要跟上流式输出，得滚这个盒子本身。
   *
   * `stick` 记的是「用户此刻是不是贴着底」，在 onScroll 里更新而不是在 effect 里现算：
   * 追加发生之后再量，距离底部早就被新内容撑开了，怎么算都是「已经离底」，于是永远不滚。
   * 用户往上翻看前文时 stick 变 false，不把他拽回来；翻回底部又变 true，继续跟。
   */
  const reasoningRef = useRef<HTMLDivElement>(null);
  const stickRef = useRef(true);
  useEffect(() => {
    const el = reasoningRef.current;
    if (!el || !open || !stickRef.current) return;
    el.scrollTop = el.scrollHeight;
  }, [reasoning, open]);

  if (steps.length === 0 && !reasoning) return null;
  return (
    <div className={styles.thinkingBlock}>
      <button
        type="button"
        className={styles.thinkingToggle}
        onClick={() => setOpen(!open)}
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
          {reasoning && (
            <div
              ref={reasoningRef}
              className={styles.thinkingReasoning}
              onScroll={(e) => {
                const el = e.currentTarget;
                stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
              }}
            >
              {reasoning}
            </div>
          )}
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
  /** 折叠态：**新产出的卡默认展开**（已确认）。纯视图状态，不持久化——刷新后重新展开是对的，
   *  用户回到这一屏是来看内容的，不是来接着上次的折叠姿势的。 */
  const [collapsed, setCollapsed] = useState(false);

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
      {/* 卡头元信息栏（IKAFSQ）：左侧徽标 / 右侧 #N + 主动作 + 折叠。
       *  三个徽标全部按数据渲染，缺失即不渲染——图片批次没有时长是正常的，不该占位。 */}
      <div className={styles.shotMeta}>
        <div className={styles.shotBadges}>
          {card.targetMedia && (
            <span className={styles.shotKind}>{card.targetMedia === 'video' ? 'SCENE' : 'IMAGE'}</span>
          )}
          {typeof card.durationSeconds === 'number' && (
            <span className={styles.shotBadge}>~{card.durationSeconds}s</span>
          )}
          {card.aspectRatio && <span className={styles.shotBadge}>{card.aspectRatio}</span>}
        </div>
        <div className={styles.shotMetaRight}>
          {/* 镜号直接用协议里的 shot_no：一个 Session 只有一组卡，schema 强制 1..N 连续，
           *  重编是整组替换，所以这个编号不存在歧义。 */}
          {typeof card.shotNo === 'number' && <span className={styles.shotNo}>#{card.shotNo}</span>}
          {applied ? (
            <span className={styles.shotAppliedMark} title="已进入画布">
              <CheckCircle2 size={16} strokeWidth={2.2} />
            </span>
          ) : cancelled ? (
            <span className={styles.shotCancelled}>已取消</span>
          ) : (
            <button
              type="button"
              className={styles.shotApplyBtn}
              onClick={() => onApply(edited)}
              disabled={disabled}
            >
              <Plus size={13} strokeWidth={2.5} />
              <span>手动应用</span>
            </button>
          )}
          <button
            type="button"
            className={styles.shotCollapse}
            title={collapsed ? '展开' : '收起'}
            aria-expanded={!collapsed}
            onClick={() => setCollapsed((v) => !v)}
          >
            {collapsed ? <ChevronDown size={14} strokeWidth={2} /> : <ChevronUp size={14} strokeWidth={2} />}
          </button>
        </div>
      </div>
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
      </div>
      {/* 折叠态到此为止：卡头一行 + 标题一行，与竞品一致。
       *  标题就是那句话——协议里每镜各有自己的 title，产卡 Skill 已被要求写成能概括本镜核心
       *  的十字左右短句（不是「镜头 3」这类废话），所以不需要另开一个摘要字段。 */}
      {collapsed ? null : (
      <>
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
      {/* 素材引用：有身份的走胶囊（缩略图 + 悬浮预览），只有旧数据才退回纯文字。
       *  不内联进正文——正文是纯文本、asset_bindings 是无位置的平列表，内联需要模型在正文里
       *  写位置标记，那是引用体系的整体设计，不在本单。 */}
      {card.assetRefItems && card.assetRefItems.length > 0 ? (
        <div className={styles.shotRefs}>
          {card.assetRefItems.map((ref, i) => (
            <AssetChip
              key={`${ref.assetId}-${i}`}
              assetId={ref.assetId}
              label={ref.label}
              mediaType={ref.mediaType}
            />
          ))}
        </div>
      ) : (
        card.assetRefs && card.assetRefs.length > 0 && (
          <div className={styles.shotRefs}>
            {card.assetRefs.map((r) => (
              <span key={r} className={styles.shotRef}>{r}</span>
            ))}
          </div>
        )
      )}
      {/* 「已进入画布」不再另起一条提示条：卡头那个绿勾已经说明白了，两处说同一件事是冗余。 */}
      {!applied && cancelled && <div className={styles.cancelledHint}>已取消，不会应用到画布</div>}
      </>
      )}
    </div>
  );
}

/** 助手消息：按结构化块渲染（text/thinking/card），无块时回退纯文本；追问与需求理解确认都走自然语言（grillme 式），不用结构化卡
 * 生成卡组支持「手动应用整组」「取消」（04 §5.2 用户动作），组内单卡仍可各自应用/双击编辑 */
/**
 * 一个内容块的 React key。
 *
 * 此前用的是数组下标（审查 W·A18）。`attachCards` 每次水合都会**先剥掉已有的 card 块再整体
 * 追加**：`blocks: [...kept, ...blocks]`。于是同一个下标上的卡片可能被换成另一张，而
 * key 和组件类型都没变——React 保住组件实例，`GenerationCard` 里的 `edited` / `editingField` /
 * `draftValue` 三份草稿原样留在原地，用户正在编辑的那几个字提交到了另一张卡上。
 *
 * 卡片按自己的身份做 key；其余块按**同类型内的序号**——这样插入一张卡不会让后面的文字块
 * 整体位移一格。服务端的 content 数组没有块级 id，同类型序号是这里能拿到的最稳的东西。
 */
function blockKey(block: SessionContentBlock, ordinals: Record<string, number>): string {
  if (block.type === 'card' && block.card) {
    const id = block.card.cardId ?? block.card.shotTitle;
    if (id) return `card:${id}`;
  }
  const kind = block.type ?? 'text';
  const n = (ordinals[kind] = (ordinals[kind] ?? 0) + 1);
  return `${kind}:${n}`;
}


/**
 * 一轮一条动作行（IKB93G）：常驻在对话流里、可展开，把「它在做」从「它在想」（ThinkingBlock）
 * 里拿出来。数据是服务端的按轮台账（IKB926），刷新后随消息部件回来，不是内存态。
 *
 * **只有真调了工具的轮次才渲染**（2026-08-26 真机裁定）：网格追问轮本来就零调用，给每一轮
 * 亮警示是把正常当异常——用户一屏黄色。零调用记录仍然完整落库，那是运维的检出原语，不是
 * 用户的。失败/被拒的动作渲染警示态：产卡被门拒不再只是「卡了一下」。
 *
 * 「还差 N 项」不展示（record 里仍带）：计数来自需求理解版本表，而落库靠观察者攒够 token
 * 才触发，短问答轮会滞后好几轮——一个几轮不动的数字比没有数字更糟。
 */
function ActionRow({ record }: { record: NonNullable<SessionContentBlock['run_actions']> }) {
  const [open, setOpen] = useState(false);
  if (record.actions.length === 0) return null;
  const seconds = (ms: number) => (ms >= 100 ? `${(ms / 1000).toFixed(1)}s` : '');
  const summary = record.actions.map((a) => a.summary.replace(/^正在/, '')).join(' · ');
  const failed = record.actions.some((a) => a.status !== 'ok');
  const statusLabel = { ok: '', failed: '失败', rejected: '被拒' } as const;
  return (
    <div className={`${styles.actionRow} ${failed ? styles.actionRowWarn : ''}`}>
      <button type="button" className={styles.actionRowHead} onClick={() => setOpen(!open)} aria-expanded={open}>
        {failed ? <AlertTriangle size={12} strokeWidth={2.5} /> : <Cog size={12} strokeWidth={2.5} />}
        <span className={styles.actionRowSummary}>{summary}</span>
        <span className={styles.actionRowMs}>{seconds(record.total_ms)}</span>
        {open ? <ChevronUp size={12} strokeWidth={2.5} /> : <ChevronDown size={12} strokeWidth={2.5} />}
      </button>
      {open && (
        <div className={styles.actionRowBody}>
          {record.actions.map((a, i) => (
            <div key={i}>
              <div className={styles.actionRowItem}>
                <span>
                  {a.summary}
                  {a.status !== 'ok' && <span className={styles.actionRowStatus}>（{statusLabel[a.status]}）</span>}
                </span>
                <span className={styles.actionRowMs}>{a.ended_ms != null ? seconds(a.ended_ms - a.started_ms) : ''}</span>
              </div>
              {a.substeps?.map((s, j) => (
                <div key={j} className={styles.actionRowSubstep}>
                  <span>{s.summary}</span>
                  <span className={styles.actionRowMs}>{s.ended_ms != null ? seconds(s.ended_ms - s.started_ms) : ''}</span>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

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
  appliedCardIds: ReadonlySet<string>;
  cancelledMessageIds: Set<string>;
}) {
  const blocks = message.blocks ?? [];
  // 每次渲染新起一份计数，`blockKey` 边走边填。
  const blockOrdinals: Record<string, number> = {};
  const structured = blocks.filter((b) => b.type !== 'text');
  // 有结构化块 → 按块渲染；无 → 纯文本 markdown
  if (structured.length === 0) return <Markdown text={message.content} />;
  const cardBlocks = blocks.filter((b) => b.type === 'card' && b.card).map((b) => b.card!);
  const groupCancelled = cancelledMessageIds.has(message.id);
  const unappliedCards = cardBlocks.filter((c) => !appliedCardIds.has(c.cardId ?? c.shotTitle));
  const showGroupActions = cardBlocks.length > 1 && !groupCancelled && unappliedCards.length > 0;
  return (
    <>
      {blocks.map((b) => {
        const key = blockKey(b, blockOrdinals);
        if (b.type === 'thinking' && (b.thinking?.steps || b.thinking?.reasoning)) {
          return (
            <ThinkingBlock key={key} steps={b.thinking.steps ?? []} reasoning={b.thinking.reasoning} />
          );
        }
        if (b.type === 'run_actions' && b.run_actions) {
          return <ActionRow key={key} record={b.run_actions} />;
        }
        if (b.type === 'card' && b.card) {
          const cardId = b.card.cardId ?? b.card.shotTitle;
          return (
            <GenerationCard
              key={key}
              card={b.card}
              onApply={(patch) => onCardApply(b.card!, patch)}
              disabled={disabled}
              applied={appliedCardIds.has(cardId)}
              cancelled={groupCancelled}
            />
          );
        }
        if (b.text) return <Markdown key={key} text={b.text} />;
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

/** 默认位置（页面中间偏右） */
/**
 * 拉不到确切积分时的退避重试间隔（毫秒）。
 *
 * 上游账单是 post-billing 才落库的，滞后从几百毫秒到十几秒都见过；此前只等 2.5 秒就放弃，
 * 于是常态是「胶囊显示 0」。总共约 23 秒，覆盖绝大多数滞后，又不会一直挂着请求。
 */
const CREDITS_RETRY_DELAYS = [2500, 6000, 15000] as const;

/**
 * 是否显示左上角的本会话累计积分胶囊（IKAP6O）。
 *
 * 产品决定先不展示。**隐藏的是显示，不是计费**——扣费链路、`fetchSessionCredits` 与整段
 * 退避重试逻辑一概保留，只是拉取与渲染都挂在这个开关上：关着就不发那三轮请求（没有展示方，
 * 拉了也没人看），改回 `true` 即恢复原样，不需要动其它任何一行。
 *
 * 类型显式写成 `boolean` 而不是让它收窄成字面量 `false`，否则下面的 `if (!…) return`
 * 会被当成恒真条件、胶囊那段 JSX 会被当成永不可达。
 */
const SHOW_SESSION_CREDIT_PILL: boolean = false;

const DEFAULT_POSITION = { x: 0, y: 0 };

/** 一条待发素材的本地状态（IKAL46）。
 *
 * `uploading` 期间不可发送——此刻还没有 `asset_id`，发出去的引用不成立。`failed` 保留在列表
 * 里并显示原因：用户刚选完文件，静默消失会让他以为图已经带上了。 */
interface PendingAttachment {
  /** 本地行键，与 asset_id 无关：上传完成前根本没有 asset_id */
  key: string;
  name: string;
  mediaType: 'image' | 'video';
  status: 'uploading' | 'ready' | 'failed';
  assetId?: string;
  error?: string;
}

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
  /**
   * 画布上现存的生成卡节点所对应的 cardId 集合（IKAFSQ）。
   *
   * 「已应用」不是一个要在这里维护的开关，而是一个**查出来的事实**：画布上存不存在带这个
   * cardId 的节点。从画布派生之后三件事自动成立，都不需要额外代码：
   *   · 用户在画布上删掉那个节点 → 卡自动变回「＋ 手动应用」
   *   · 刷新页面 → 画布本来就持久化，状态天然正确（从前是内存 useState，刷新即全掉）
   *   · 不可能出现「卡说已应用、画布上没有」这类两个状态打架的情况
   */
  appliedCardIds?: ReadonlySet<string>;
  /** 首页「直接使用」技能 → 画布导航携带的强制技能 ID：挂载后武装为下一条消息的 forced skill */
  initialSkillId?: string;
  /** 首页「直接使用」技能 → 画布导航携带的强制技能名称：气泡显示用 */
  initialSkillName?: string;
  /** 媒体块：从画布节点「添加到对话」时携带的图片/视频/音频元数据 */
  mediaBlocks?: import('@/api/agentSessions').SessionContentBlock[];
  /**
   * 侧边栏「+」上传必须走这条路（IKBA6C）：立即在画布落媒体节点，并完成同一份三步上传。
   * 只登记会话附件、不落画布，就是这次缺陷。
   */
  onPlaceFileOnCanvas: (file: File) => Promise<SidebarCanvasUpload>;
}

export default function AgentPanel({ onClose, initialInput, initialCardLabel, inputVersion, projectId, onApplyToDock, appliedCardIds, initialSkillId, initialSkillName, mediaBlocks: initialMediaBlocks, onPlaceFileOnCanvas }: AgentPanelProps) {
  /** 富文本输入框（可多次插入生成卡引用胶囊 + 普通 @ 文本预填） */
  const chipEditorRef = useRef<ChipTextEditorHandle>(null);
  /** 输入框实时纯文本（胶囊已替换成完整 prompt），供发送按钮启用态判断 */
  /**
   * 本会话累计消耗积分（IKAFPC）。
   *
   * 数字在**一轮结束后**才跳，不做流式实时滚动：上游要计费完成才出账，实时只能靠估，
   * 而这是钱的数字——宁可慢一拍，不给假数。取数失败时保留上一次已知值，不显示 0：
   * 「查不到」和「真没花钱」是两回事，后者会让用户以为这一轮免费。
   */
  const [sessionCredits, setSessionCredits] = useState<number | null>(null);

  /** 输入框内容的结构化形态：胶囊在编辑期是指针，只在发送时解引用（IKAFSX）。 */
  const [composed, setComposed] = useState<ComposedValue>(EMPTY_COMPOSED);
  const composerHasText = !composedIsEmpty(composed);
  /** 画布 @ 进来的媒体块（避免 effect 时序竞争，用 ref 同步管理） */
  const pendingMediaBlocksRef = useRef<import('@/api/agentSessions').SessionContentBlock[]>([]);
  // 同步 ref 到 state（触发 UI 重新渲染）
  const [pendingMediaBlocksState, setPendingMediaBlocksState] = useState<import('@/api/agentSessions').SessionContentBlock[]>([]);
  const syncMediaBlocks = () => {
    setPendingMediaBlocksState([...pendingMediaBlocksRef.current]);
  };
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
    activeSkillIds,
    changeActiveSkills,
    streamingText,
    streaming,
    runningRunId,
    failedRunId,
    thinkingSteps,
    reasoningText,
    turnStartedAt,
    turnOutcome,
    partialCard,
    longRunning,
    chatError,
    retryUnavailable,
    sendError,
    paymentRequiredMessage,
    sendMessage,
    stopRun,
    retryRun,
    resetChat,
    reconnectSession,
    switchSession,
    deleteSession,
    deleteError,
    dismissDeleteError,
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
  /** 本条消息待携带的素材：选中即开始上传，发送时才变成 `asset_ref` 部件（IKAL46）。
   *  这里刻意不做胶囊 UI——胶囊组件由专门的前端同学交付，此处只维护接口与最简可用的呈现。 */
  const [attachments, setAttachments] = useState<PendingAttachment[]>([]);
  /* 「上传图片」/「上传视频」此前走同一个 handler、accept 也不分，两个菜单项完全等价。
   * 现在各自把 accept 收窄到对应类型（真实 media_type 仍按文件 MIME 判定）。 */
  /** 当前 Run 的技能推荐列表（推荐区域展示） */
  const [recs, setRecs] = useState<RunSkillRecommendation[]>([]);
  /** 已点 Use 的推荐技能ID（仅用户点 Use 可激活） */
  const [usedSkillIds, setUsedSkillIds] = useState<Set<string>>(new Set());
  /** 画布上现存的生成卡节点 cardId 集合。父组件没给（例如测试）时按空集处理——空集意味着
   *  「都没应用过」，是安全的一侧：宁可让用户多按一次，也不要把没进画布的卡显示成绿勾。 */
  const appliedIds = appliedCardIds ?? EMPTY_APPLIED_IDS;
  /** 已「取消」的生成卡组（按消息ID标记，组内未应用的卡不再可操作） */
  const [cancelledMessageIds, setCancelledMessageIds] = useState<Set<string>>(new Set());
  /**
   * 「直接使用」刚点上、**还没发出去**的那一条。发出去之后它就载入了会话，由
   * `activeSkillIds` 接手（0028）——所以这里只是一个未提交的选择，不是当前状态。
   */
  const [forcedSkill, setForcedSkill] = useState<{ id: string; name: string } | null>(null);
  /**
   * 套路 id → 中文名。会话上只存 id，名字在技能目录里。
   *
   * 用户在本次会话里点过的那条名字我们当场就知道；刷新之后不知道，所以补一次「我的技能」
   * ——用户正是从那里点的「直接使用」。查不到就退回显示 id，不显示空胶囊。
   */
  const [skillNames, setSkillNames] = useState<Record<string, string>>({});
  /** 确认门「修改」编辑态：展开文本编辑，提交 correct 动作 */

  /* ---- 拖动状态 ---- */
  const [position, setPosition] = useState(DEFAULT_POSITION);
  const [initialized, setInitialized] = useState(false);
  const [panelHeight, setPanelHeight] = useState<number | undefined>(undefined);
  const panelRef = useRef<HTMLDivElement>(null);
  const dragState = useRef({ dragging: false, startX: 0, startY: 0, origX: 0, origY: 0 });

  /**
   * 量一次面板与它的父容器，初始化 / 缩窗 / 拖拽三处共用同一组输入。
   *
   * 此前这段 DOM 读取在四个调用点各写了一遍，量法还略有出入（有的先取 header 再取 rect，
   * 有的反过来）。量测和决策分开之后，「怎么算布局」只剩 layout.ts 一处（审查 W·S8）。
   * DOM 尚未就绪时返回 null，由调用方决定跳过还是照常收尾。
   */
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

  const currentModel = models.find((m) => m.key === selectedModel);

  /** 外部注入 @ 引用/生成卡：仅在版本真正变化时触发一次；生成卡追加胶囊（可多次叠加），普通引用整体替换文本
   * ref 记录已处理的 version，防 StrictMode 开发态 effect 双调用导致重复插入 */
  const lastInputVersionRef = useRef(0);
  /** 上一次 composed 中的 chip IDs（用于检测 chip 是否被删除） */
  const prevChipIdsRef = useRef<Set<string>>(new Set());

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
    // 注入媒体块到 ref
    console.log('[AgentPanel] 注入媒体块:', initialMediaBlocks?.length, 'blocks', initialMediaBlocks);
    if (initialMediaBlocks && initialMediaBlocks.length > 0) {
      pendingMediaBlocksRef.current = [...pendingMediaBlocksRef.current, ...initialMediaBlocks];
      syncMediaBlocks();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inputVersion]);

  /** chip 与媒体块双向同步：仅当 chip 被删除时才过滤对应 blocks（输入文字不触发） */
  useEffect(() => {
    const chipIds = new Set(
      composed.segments
        .filter((s): s is { kind: 'ref'; ref: { id: string; label: string; prompt: string } } => s.kind === 'ref')
        .map((s) => s.ref.id),
    );

    // 检测是否有 chip 被删除（对比上一次的 chip IDs）
    const prevIds = prevChipIdsRef.current;
    const chipsRemoved = [...prevIds].some((id) => !chipIds.has(id));

    if (chipsRemoved && pendingMediaBlocksRef.current.length > 0) {
      // 有 chip 被删除 → 过滤对应的 blocks
      const filtered = pendingMediaBlocksRef.current.filter((b) => !b.chip_id || chipIds.has(b.chip_id));
      pendingMediaBlocksRef.current = filtered;
      syncMediaBlocks();
      console.log('[AgentPanel] chip 删除同步, 剩余 blocks:', filtered.length);
    }

    // 更新记录
    prevChipIdsRef.current = chipIds;
  }, [composed]);

  /** 首页「直接使用」技能导航进来：武装为下一条消息的强制技能（StrictMode 双挂载只武装一次） */
  const lastSkillIdRef = useRef('');
  useEffect(() => {
    if (!initialSkillId || initialSkillId === lastSkillIdRef.current) return;
    lastSkillIdRef.current = initialSkillId;
    setForcedSkill({ id: initialSkillId, name: initialSkillName || '已选技能' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialSkillId]);

  /** 会话上有 id 但本地不知道名字（多半是刷新之后）：补一次「我的技能」把名字填上。 */
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
    // skillNames 有意不进依赖：它由这个 effect 自己写，进依赖就是一个自触发循环。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSkillIds]);

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

  /**
   * ESC 取消本次回答（IKA4PH）。取消入口统一在发送侧，ESC 是那颗按钮的键盘等价物。
   *
   * 只在本轮还没结束时挂载，不留一个常驻的全局监听；判定见 `shouldCancelOnKey`。
   *
   * 条件是 `streaming || runningRunId !== null` 而不只是后者：消息发出到拿到 runId 之间
   * `runningRunId` 还是 null，而那几秒正是用户最想按 ESC 的时候。取消已改为会话级
   * （IKACCL），不需要 runId 就能发出去。
   */
  const cancellable = streaming || runningRunId !== null;
  useEffect(() => {
    if (!cancellable) return;
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target instanceof HTMLElement ? e.target : null;
      if (
        shouldCancelOnKey({
          key: e.key,
          defaultPrevented: e.defaultPrevented,
          targetTagName: target?.tagName,
          isEditable: target?.isContentEditable ?? false,
          inOverlay: Boolean(target?.closest('[role="dialog"], [aria-modal="true"]')),
          // 主输入框是 contentEditable，要把它从「可编辑一律让路」里单独挑出来。
          isMainComposer: Boolean(target?.closest('[data-agent-composer]')),
        })
      ) {
        stopRun();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [cancellable, stopRun]);

  /**
   * 新消息 / 流式文本 / 流式思考 / 进入页面：滚动条始终拉到最底部，展示最新内容。
   *
   * 思考那两项此前不在依赖里，于是新增的步骤不会把列表带到底。
   *
   * 注意这里管不到思考原话的滚动：`.thinkingReasoning` 自带 `max-height` 与 `overflow-y`，
   * 是独立的滚动容器，外层滚到底对它无效。那一段由 ThinkingBlock 自己滚（见其中的注释）。
   */
  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages, streamingText, reasoningText, thinkingSteps, runningRunId]);

  /** 初始化位置：屏幕右侧；首次挂载也走统一安全边界，窄视口不会横向溢出。 */
  useEffect(() => {
    if (initialized) return;
    const metrics = measurePanel();
    if (metrics) {
      const layout = dockedPanelLayout(metrics);
      setPosition({ x: layout.x, y: layout.y });
      setPanelHeight(layout.height);
    }
    setInitialized(true);
  }, [initialized, measurePanel]);

  /** 窗口缩放自适应：固定/浮动模式共用同一坐标与高度边界。 */
  useEffect(() => {
    const handleResize = () => {
      const metrics = measurePanel();
      if (!metrics) return;
      // 浮动模式沿用上次位置，只把它收回可视区
      if (floating) {
        setPosition((prev) => {
          const layout = freePanelLayout(metrics, prev.x, prev.y);
          setPanelHeight(layout.height);
          return { x: layout.x, y: layout.y };
        });
        return;
      }
      // 固定模式：贴右上角、撑满可用高度，避免缩窗后被推出可视区（IKAGZC）
      const layout = dockedPanelLayout(metrics);
      setPosition({ x: layout.x, y: layout.y });
      setPanelHeight(layout.height);
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [floating, measurePanel]);

  /** 切换到浮动模式时居中；切回固定模式时回到画布右侧初始位置 */
  useEffect(() => {
    const metrics = measurePanel();
    if (!metrics) return;
    if (floating) {
      // 浮动模式：缩宽、居中
      const centerX = (metrics.pageWidth - metrics.panelWidth) / 2;
      const centerY = (metrics.pageHeight - metrics.panelHeight) / 2;
      const layout = freePanelLayout(metrics, centerX, centerY);
      setPosition({ x: layout.x, y: layout.y });
    } else {
      // 固定模式：贴右上角、撑满可用高度
      const layout = dockedPanelLayout(metrics);
      setPosition({ x: layout.x, y: layout.y });
      setPanelHeight(layout.height);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [floating]);

  /**
   * 拉本会话累计消耗积分：切会话时拉一次，每轮结束后再拉一次。
   *
   * 不在流式期间轮询——上游计费完成才出账，中途拉只会拿到上一轮的数，白费请求。
   * 失败保留上一次已知值：`setSessionCredits` 只在拿到确切数时调用。
   */
  useEffect(() => {
    // 胶囊隐藏时不拉账单（IKAP6O）：没有展示方，退避重试只是白发三轮请求。
    if (!SHOW_SESSION_CREDIT_PILL) return;
    if (!projectId || !sessionId) {
      setSessionCredits(null);
      return;
    }
    let cancelled = false;
    let timer: number | undefined;

    /**
     * 计费日志是 post-billing 才写的，可能比流结束晚好几秒；agent 那边回写券号也可能整体滞后。
     * 此前只补拉一次（2.5 秒），第二次还是查不到就把 0 写进胶囊——**把「不知道」显示成了
     * 「没花钱」**（审查 W·P1）。改成退避重试，并且全程不拿一个假数去覆盖已知值。
     */
    const load = async (attempt = 0): Promise<void> => {
      let result: Awaited<ReturnType<typeof fetchSessionCredits>> | null = null;
      try {
        result = await fetchSessionCredits(projectId, sessionId);
      } catch (e) {
        console.warn('拉取会话累计积分失败:', e);
      }
      if (cancelled) return;

      // 确切：既查得到，也不处在「账单还没写进上游」的空窗里。
      if (result && result.credits !== null && !(result.matched === 0 && result.runCount > 0)) {
        setSessionCredits(result.credits);
        return;
      }

      const delay = CREDITS_RETRY_DELAYS[attempt];
      if (delay === undefined) {
        // 退避用尽。有数就认这个数（宁可慢一拍，也好过一直空着）；`credits` 是 null 就保留
        // 上一次已知值——胶囊显示「—」而不是「0」，这正是工单要的。
        if (result?.credits != null) setSessionCredits(result.credits);
        return;
      }
      timer = window.setTimeout(() => void load(attempt + 1), delay);
    };

    void load();
    return () => {
      cancelled = true;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [projectId, sessionId, turnOutcome]);

  /** 下拉（历史会话 / 模型选择 / 上传菜单）外部点击自动收起（点击面板其他区域或页面任意处） */
  useEffect(() => {
    if (!historyOpen && !modelOpen && !showUpload) return;
    const handleDocMouseDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (historyRef.current && !historyRef.current.contains(target)) {
        setHistoryOpen(false);
        // 菜单收起时一并丢掉删除错误：留着它，下次打开会看到一条早已过期的红字。
        dismissDeleteError();
      }
      if (modelRef.current && !modelRef.current.contains(target)) setModelOpen(false);
      if (uploadRef.current && !uploadRef.current.contains(target)) setShowUpload(false);
    };
    document.addEventListener('mousedown', handleDocMouseDown);
    return () => document.removeEventListener('mousedown', handleDocMouseDown);
  }, [historyOpen, modelOpen, showUpload, dismissDeleteError]);

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
      const metrics = measurePanel();
      if (!metrics) return;
      const layout = freePanelLayout(metrics, ds.origX + dx, ds.origY + dy);
      setPosition({ x: layout.x, y: layout.y });
    },
    [measurePanel],
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
    // 不清空输入框：面板明写着「未发送的草稿会自动保留」，
    // 开新对话把用户刚敲的字抹掉，与承诺相反。
    resetChat();
    setRecs([]);
    setUsedSkillIds(new Set());
    setForcedSkill(null);
    setHistoryOpen(false);
  };

  /** 使用推荐技能：标记已激活，并把技能意图追加为一条消息提交给 Agent（顺带清掉「直接使用」武装，避免双技能叠加） */
  const handleUseSkill = async (r: RunSkillRecommendation) => {
    if (usedSkillIds.has(r.creative_skill_id) || runningRunId !== null || streaming) return;
    setSkillNames((prev) => ({ ...prev, [r.creative_skill_id]: r.name }));
    const accepted = await sendMessage([{ type: 'text', text: `使用「${r.name}」技能继续创作` }], r.creative_skill_id, undefined, r.name, `使用「${r.name}」技能继续创作`);
    if (!accepted) return;
    setUsedSkillIds((prev) => new Set(prev).add(r.creative_skill_id));
    setForcedSkill(null);
  };

  /** 发送消息：**解引用发生在这一刻**——编辑期胶囊一直是指针，此处才换成完整 prompt；
   * 若已武装「直接使用」技能，本条消息携带 forced_creative_skill_id 强制激活后清除 */
  /** 还在上传的附件会挡住发送：此刻它还没有 asset_id，带出去的引用不成立。 */
  const uploadingAttachment = attachments.some((item) => item.status === 'uploading');
  const readyAssets: OutboundAssetRef[] = attachments.flatMap((item) =>
    item.status === 'ready' && item.assetId
      ? [{ asset_id: item.assetId, media_type: item.mediaType, display_label: item.name }]
      : [],
  );

  /** 能不能发：有文字、或有已就绪的附件；上传途中一律挡住（IKAL46）。 */
  const canSend =
    (composerHasText || readyAssets.length > 0 || pendingMediaBlocksState.length > 0) && !uploadingAttachment;

  const handleSend = async () => {
    const fullText = resolveComposed(composed).trim();
    // 胶囊有两个来源，发送时必须合成一条序列：画布 @ 进来的节点/卡片，和本地上传的素材。
    // 后者带资产库身份，序列化成 `asset_ref`（agent 会建 Grant，模型真读得到）；前者只有
    // 画布 id，序列化成 `resource_ref`（模型先看到占位标签）。见 agentSessions.toReferencePart。
    const uploadedBlocks: import('@/api/agentSessions').SessionContentBlock[] = readyAssets.map((asset) => ({
      type: 'asset_ref',
      asset_id: asset.asset_id,
      media_type: asset.media_type,
      ...(asset.display_label ? { display_label: asset.display_label } : {}),
    }));
    const mediaBlocks = [...pendingMediaBlocksRef.current, ...uploadedBlocks];
    // 只带附件、一个字不打也能发（IKAL46）：这是用户对附件做的第一个动作。
    if (!fullText && mediaBlocks.length === 0) return;
    if (uploadingAttachment) return;
    if (runningRunId !== null || streaming) return;

    // 从 composed 中提取用户输入的纯文字（不含 chip prompt）
    const userText = composed.segments
      .filter((s) => s.kind === 'text')
      .map((s) => s.value)
      .join('')
      .trim();

    // 从 composed 中提取 @ 卡片气泡（与输入框展示一致）
    const chips = composed.segments
      .filter((s) => s.kind === 'ref')
      .map((s) => ({ id: s.ref.id, label: s.ref.label }));

    // content 只放用户实际输入的文字；胶囊由 resourceRef 那一路序列化成部件
    const textContent: import('@/api/agentSessions').SessionContentBlock[] = [];
    if (userText) {
      textContent.push({ type: 'text', text: userText });
    }

    // 先清空再发。等 POST 回来才清，用户已经看到自己的气泡上屏、输入框里原文却还在，
    // 极易重复点发送。失败时把原文回填，一个字都不丢。
    chipEditorRef.current?.clear();
    pendingMediaBlocksRef.current = [];
    syncMediaBlocks();
    const armed = forcedSkill;
    if (armed) setSkillNames((prev) => ({ ...prev, [armed.id]: armed.name }));
    const sentAttachments = attachments;
    setForcedSkill(null);
    setAttachments([]);
    const accepted = await sendMessage(textContent, armed?.id, mediaBlocks, armed?.name, userText, chips);
    if (!accepted) {
      chipEditorRef.current?.setText(userText);
      pendingMediaBlocksRef.current = [...mediaBlocks];
      syncMediaBlocks();
      setForcedSkill(armed);
      // 附件一并回填：重传一次的代价远大于把已经拿到的 asset_id 留在手上。
      setAttachments(sentAttachments);
    }
  };

  /** 手动应用生成卡 → 落画布节点（B2：标记已应用 + 回调 CanvasPage 落生成卡节点；patch 为双击编辑后的字段覆盖） */
  const handleCardApply = (
    card: NonNullable<SessionContentBlock['card']>,
    patch: { shotTitle?: string; visual?: string; prompt?: string },
  ) => {
    if (runningRunId !== null || streaming) return;
    const cardId = card.cardId ?? card.shotTitle;
    // 不在这里记「已应用」：那个事实由画布上有没有这个节点决定，落节点之后自然就成立了。
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

  /** 选「上传图片」/「上传视频」：把 accept 收窄到对应类型再开文件选择器。 */
  const handleFileSelect = (kind: 'image' | 'video') => {
    const input = fileInputRef.current;
    if (input) {
      input.accept = kind === 'image' ? 'image/*' : 'video/*';
      input.click();
    }
    setShowUpload(false);
  };

  /** 选中文件即开始上传：先插一条 `uploading` 行，拿到 asset_id 后就地改成 `ready`。
   *  上传发生在选择那一刻而不是发送那一刻——否则用户点了发送还要干等一次网络往返。
   *
   *  同一份文件必须同时落到画布（IKBA6C）：`commitSidebarAttachment` 只走
   *  `onPlaceFileOnCanvas`，不再单独 `uploadAssetFile`，避免会话附件与画布各传一次。
   *
   *  media_type 按文件的真实 MIME 判定，不按用户点的是哪个按钮：两者不一致时（在「上传图片」
   *  里挑了个视频，某些平台允许）真实类型才是对的，报错也要报得准。asset_ref 只认 image/video，
   *  音频当场拒掉而不是传上去再失败。 */
  const handleFilesChosen = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const chosen = Array.from(event.target.files ?? []);
    // 同一个文件连选两次也要能触发 change，否则第二次静默无反应。
    event.target.value = '';
    for (const file of chosen) {
      const key = `att-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const plan = planAttachment(file, projectId);
      if (plan.ok === false) {
        setAttachments((prev) => [
          ...prev,
          { key, name: file.name, mediaType: 'image', status: 'failed', error: plan.error },
        ]);
        continue;
      }
      setAttachments((prev) => [...prev, { key, name: file.name, mediaType: plan.mediaType, status: 'uploading' }]);
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
          item.key === key ? { ...item, status: 'ready' as const, assetId: result.uploaded.asset_id } : item,
        ),
      );
    }
  };

  const removeAttachment = (key: string) =>
    setAttachments((prev) => prev.filter((item) => item.key !== key));

  return (
    <div
      ref={panelRef}
      className={`${styles.panel} ${floating ? styles.panelFloating : ''}`}
      style={initialized ? { left: position.x, top: position.y, height: panelHeight, transform: 'none' } : undefined}
      onMouseDown={handleDragStart}
    >
      {/* 头部标题栏（拖动区域） */}
      <div className={`${styles.panelHeader} ${floating ? styles.panelHeaderFloating : ''}`}>
        <div className={styles.headerLeft}>
          {/* 本会话累计消耗积分（IKAFPC / IKAGZC），现由 IKAP6O 隐藏。
           *  头部是 `1fr auto 1fr` 三栏网格，左格空着标题依然相对面板居中，所以这里整段不渲染
           *  也不会把中间的会话切换器推偏。
           *  **位置从一开始就占住**：原来写成「查到了才渲染」，于是面板打开后胶囊凭空冒出来，
           *  还把右边的会话切换器推一下——用户看到的是一次白等。数字未落定时显示占位符，
           *  仍然不显示 0：「不知道」和「没花钱」是两回事，后者会让人以为这一轮免费。 */}
          {SHOW_SESSION_CREDIT_PILL && (
            <span
              className={styles.creditPill}
              title={
                sessionCredits === null
                  ? '正在统计本次对话累计消耗积分'
                  : `目前 Agent 对话累计消耗积分：${sessionCredits} 积分`
              }
            >
              <Coins size={12} strokeWidth={2} />
              <span className={styles.creditValue}>
                {sessionCredits === null ? '—' : sessionCredits}
              </span>
            </span>
          )}
        </div>
        <div className={styles.headerCenter}>
          {/* 会话切换器（IKAFQ6）：标题本身就是唯一入口，「新对话」收进菜单顶部。
           *  合并的动因是第一行要腾位置（IKAFPC 的积分胶囊要进来），代价是新建从一击变两击。
           *  选 menu button 而非 split button 的依据见工单：项目内通常四五个会话，切换比新建频繁，
           *  没有强默认动作；而且 split button 的标签位被「新对话」占死后，当前会话标题就没地方放了。 */}
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
              {/* 当前会话标题：标题异步生成完成（session.updated）后就地更新，不再永远是「新对话」 */}
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
                  <div className={styles.historyEmpty}>暂无历史会话</div>
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
                            {/* 删除失败就在这一行说清楚，下拉不关闭——用户能原地重试。
                             *  全局 toast 做不到这点：它弹出来时下拉已经收了，出错的行和提示是分离的。 */}
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
          {messages.map((m) =>
            m.role === 'user' ? (
              <div key={m.id} className={styles.userBubble}>
                {/* Skill 标记（无气泡，仅文字+图标） */}
                {m.skill_ref && (
                  <div className={styles.userSkillChip}>
                    <BookText size={13} strokeWidth={2} />
                    <span>{m.skill_ref.name}</span>
                  </div>
                )}
                {/* @卡片气泡（与输入框中的气泡一致） */}
                {m.chips?.map((c) => (
                  <div key={`chip-${c.id}`} className={styles.userMediaChip}>
                    <span className={styles.userMediaChipAt}>@</span>
                    <span>{c.label}</span>
                  </div>
                ))}
                {/* 文字内容 */}
                {m.content && <span>{m.content}</span>}
                {/* 上传素材的临时渲染（IKAL46）：统一胶囊组件到位后删掉 MessageAssetPreview 即可。 */}
                <MessageAssetPreview blocks={m.blocks} />
              </div>
            ) : (
              <div key={m.id} className={styles.assistantBlock}>
                <AssistantMessageBody
                  message={m}
                  onCardApply={handleCardApply}
                  onApplyAllCards={handleApplyAllCards}
                  onCancelCardGroup={handleCancelCardGroup}
                  disabled={runningRunId !== null || streaming}
                  appliedCardIds={appliedIds}
                  cancelledMessageIds={cancelledMessageIds}
                />
              </div>
            ),
          )}
          {/* Agent 的思考过程：run.activity 实时步 + reasoning_trace 终态链 + 模型原话（IKA3M6）。
              **正文出现之前展开，正文一出现就收起。** 那段等待正是它要填的，收起来就等于还是
              白屏；而正文一开始写，思考就退居次要——它已经完成了自己的作用，再占着屏幕只会
              把用户真正要读的东西挤下去。用户点过就以用户为准。
              key 挂 runId：换一轮就是新的一次思考，上一轮用户手动收起过不该带到下一轮。 */}
          {(thinkingSteps.length > 0 || reasoningText) && (
            <div className={styles.assistantBlock}>
              <ThinkingBlock
                key={runningRunId ?? 'idle'}
                steps={thinkingSteps}
                reasoning={reasoningText}
                autoOpen={!streamingText}
              />
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
          {longRunning && (
            <div className={styles.longRunHint}>
              <span>
                {runningRunId
                  ? '仍在处理中，已超过 1 分钟无新内容。若无响应可取消后重试。'
                  : '已超过 1 分钟未收到运行状态，可重新连接会话恢复最新状态。'}
              </span>
              {/* run id 是内部主键，不进用户界面。用户报障时只需说明是哪个会话、大约何时；
                  服务端按 agent_runs 的 (session_id, created_at) 索引反查具体 Run（IKA3M7）。 */}
              {!runningRunId && (
                <button className={styles.cancelBtn} onClick={reconnectSession}>重新连接</button>
              )}
            </div>
          )}
          {/* 取消运行的入口统一在发送侧（发送按钮变停止按钮 + ESC），这里不再重复一个（IKA4PH）。 */}
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
          hasRunId={runningRunId !== null}
          outcome={turnOutcome}
          streamedText={streamingText}
        />
        {chatError && <div className={styles.chatErrorHint}>{chatError}</div>}
        {sendError && <div className={styles.chatErrorHint}>{sendError}</div>}
        {paymentRequiredMessage && <div className={styles.chatErrorHint}>{paymentRequiredMessage}</div>}
        {retryUnavailable && (
          <div className={styles.chatErrorHint}>当前后端未提供重试接口；请开启新对话或联系管理员升级服务。</div>
        )}
        {/* data-agent-composer：ESC 判定用它把主输入框从「可编辑区域一律让路」里挑出来，
            主输入框是 Lexical 的 contentEditable，而发送后焦点通常正停在这里。 */}
        <div className={styles.inputBox} data-agent-composer>
          {/* 技能气泡：位于输入框内侧，chip 上方。
            *
            * 这一排就是「本会话现在挂着哪几条创作套路」（0028）。载入一次就一直在，每一轮都
            * 注入，直到点掉这里的 ×；新开对话是空的。`forcedSkill` 是刚点上还没发出去的那条，
            * 发出去之后由会话接手，所以两者显示成同一排、行为略有不同：前者的 × 只是撤销
            * 这次选择，后者的 × 是真的从会话上取消。 */}
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
              {/* 已经在会话上的不再重复显示一遍——那会让用户以为挂了两条。 */}
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

          {/* 这一层负责把编辑区撑到工具栏上沿：ChipTextEditor 自己的 wrapper 是 block，
           *  撑高的责任只能落在它外面。见 .composerSlot。 */}
          {/* 待发素材（IKAL46）。刻意保持纯文本行：胶囊组件由专门的前端同学交付，
            *  这里只负责把接口打通并给出最简可用的呈现。 */}
          {attachments.length > 0 && (
            <div className={styles.attachmentRow}>
              {attachments.map((item) => (
                <span
                  key={item.key}
                  className={`${styles.attachmentChip} ${item.status === 'failed' ? styles.attachmentFailed : ''}`}
                  title={item.status === 'failed' ? item.error : item.name}
                >
                  <span className={styles.attachmentName}>
                    {item.mediaType === 'video' ? '视频' : '图片'}：{item.name}
                  </span>
                  {item.status === 'uploading' && <span className={styles.attachmentHint}>上传中…</span>}
                  {item.status === 'failed' && (
                    <span className={styles.attachmentHint}>{item.error ?? '上传失败'}</span>
                  )}
                  <button
                    className={styles.attachmentRemove}
                    onClick={() => removeAttachment(item.key)}
                    title="移除"
                    aria-label={`移除 ${item.name}`}
                  >
                    <X size={11} strokeWidth={2.5} />
                  </button>
                </span>
              ))}
            </div>
          )}
          <div className={styles.composerSlot}>
            <ChipTextEditor
              ref={chipEditorRef}
              placeholder="描述你的想法，使用 @ 引用素材"
              onChange={setComposed}
              onSend={handleSend}
              className={styles.composerEditable}
            />
          </div>

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
                  <button onClick={() => handleFileSelect('image')} disabled={!projectId}>
                    上传图片
                  </button>
                  <button onClick={() => handleFileSelect('video')} disabled={!projectId}>
                    上传视频
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

          {/* 右侧 */}
          <div className={styles.toolbarRight}>
            <div className={styles.modelWrap} ref={modelRef}>
              <button
                className={`${styles.modelBtn} ${modelOpen ? styles.modelBtnActive : ''}`}
                title={currentModel?.label ? `Agent 模型：${currentModel.label}` : '选择 Agent 模型'}
                aria-label={currentModel?.label ? `Agent 模型：${currentModel.label}` : '选择 Agent 模型'}
                onClick={() => setModelOpen(!modelOpen)}
              >
                {/* 平时只露一个盒子图标：模型名称在这一行没有常驻价值，点开菜单里才需要看见
                 *  （IKAGZC）。title 兜住「当前是哪个模型」这个信息，不占版面。 */}
                <Package size={16} strokeWidth={2} />
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
            {/* 消息一发出即为停止形态：中间不再有一段按钮灰着、什么都按不了的窗口（IKACCL）。 */}
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
                /* 不再拿 sessionId 当门槛：刷新后要先「取项目 → 列会话 → 连会话」几个来回，
                 * 这段时间按钮是灰的，用户以为面板必须整页加载完才能用。而 sendMessage 早就会在
                 * 会话还没建好时自己补一个（ensureSession），这道门挡的是一条本来就走得通的路。 */
                disabled={!canSend || streaming}
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
