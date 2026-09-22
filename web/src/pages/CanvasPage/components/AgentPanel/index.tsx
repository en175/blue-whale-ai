/* ============================================
 * AgentPanel Agent 智能体对话面板：消息流与任务执行
 * ============================================ */
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
  Coins,
  MessageSquare,
  Check,
  RotateCcw,
  Package,
} from 'lucide-react';
import styles from './index.module.css';
import { fetchGenerationModels, type GenerationModel } from '@/api/generation';
import { fetchMySkills } from '@/api/skills';
import { useAgentSession, type TurnOutcome } from '../../hooks/useAgentSession';
import { deriveRunStatus, formatElapsed, formatTokens, type RunStatus } from '../../hooks/runStatusLine';
import type { PartialCardPreview } from '../../hooks/partialCardPreview';
import {
  fetchSessionCredits,
  type SessionContentBlock,
  type GenerationCardBlock,
  type OutboundAssetRef,
  type RequirementUnderstanding,
} from '@/api/agentSessions';
import {
  commitSidebarAttachment,
  createAttachmentPreviewUrl,
  planAttachment,
  revokeAttachmentPreviewUrl,
  type SidebarCanvasUpload,
} from './attachments';
import { composerImagePreview } from './composerImagePreview';
import { ComposerAttachmentChip } from './ComposerAttachmentChip';
import { isInlineMediaThumbnail, MessageAssetPreview, rememberAssetUrl, useAssetUrlCache } from './MessageAssetPreview';
import SkillModal from '@/pages/Home/components/SkillModal';
import ConfirmModal from '@/components/ConfirmModal';
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
import { isProcessItem, itemsFromBlocks, itemsFromLive, type TimelineItem, type Turn } from '../../hooks/sessionTimeline';
import { collectKnownAssets, type KnownAsset } from './assetMentions';
import { Markdown } from './Markdown';
import { AssetMentionChip } from './AssetMentionChip';
import { LastTurnLine, ProcessGroup, TurnFooter } from './TurnTimeline';

/** 父组件没传已应用集合时的空集。提到模块级是为了保持引用稳定，避免每次渲染都造一个新 Set。 */
const EMPTY_APPLIED_IDS: ReadonlySet<string> = new Set<string>();

/** Markdown 搬到了自己的文件（IKFLB9）；这里再导出一次，测试和别处的引用不用改。 */
export { Markdown };

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
  completed: '✻',
  cancelled: '⊘',
  failed: '✕',
};

const RUN_STATUS_PHASE_CLASS: Record<RunStatus['phase'], string> = {
  dispatching: '',
  working: '',
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
  hasRunId,
  outcome,
  streamedText,
}: {
  startedAt: number | null;
  activity: string | null;
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
    hasRunId,
    outcome: outcome?.outcome ?? null,
    finishedAt: outcome?.finishedAt ?? null,
    streamedText,
    estimatedOutputTokensAtFinish: outcome?.estimatedOutputTokens ?? null,
    failureText: outcome?.failureText ?? null,
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
        <span>Prompt 撰写中…</span>
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

/** 方案卡上那八项的小标题。与服务端 `domain/solution-card.ts` 的那份一字不差：用户读到的措辞
 *  和服务端校验的是同一份东西，两边分头写就是两份真相。 */
const SOLUTION_FIELD_LABELS = {
  goal: '这次要做什么',
  target_media: '做图还是视频',
  direction: '创意方向',
  constraints: '必须守住的',
  asset_roles: '你给的素材各起什么作用',
  assumptions: '我替你定的几项',
  execution_route: '用哪个模型出片',
  delivery_spec: '出片参数',
  scope: '这张卡管的范围',
  derived_from: '承接上一张',
} as const;

function SolutionField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className={styles.solutionField}>
      <div className={styles.solutionFieldLabel}>{label}</div>
      {children}
    </div>
  );
}

/**
 * 方案卡（IKF3KE）。
 *
 * 产卡之前用户唯一读到、也唯一需要表态的东西。它在对话流里，和生成卡同一个位置——这里没有
 * 「侧边栏」这个概念，整个 Agent 面板才是相对画布的那一侧。
 *
 * 三个按钮各自的去向：确认 → 服务端接着把生成卡写出来；取消 → 这一版作废，回到对话；
 * 补充 → 这一版作废，用户写的话当下一轮的输入，模型据此重提一版。取消与补充都作废，是为了不
 * 留下「用户看过但没表态」的悬空版本。
 *
 * 已确认或已作废的版本留在原处、变灰、按钮消失：用户往回翻时要读得懂当时发生了什么。
 */
function SolutionCardBlock({
  understanding,
  disabled,
  onConfirm,
  onVoid,
}: {
  understanding: RequirementUnderstanding;
  disabled: boolean;
  onConfirm: () => void;
  onVoid: (note?: string) => void;
}) {
  const [noteOpen, setNoteOpen] = useState(false);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const card = understanding.solution_card ?? null;
  const pending = understanding.status === 'awaiting_confirmation';
  const route = card?.execution_route;
  const spec = card?.delivery_spec;
  const specParts = [
    spec?.aspect_ratio,
    spec?.duration_seconds !== undefined ? `${spec.duration_seconds} 秒` : undefined,
    spec?.resolution,
  ].filter((one): one is string => Boolean(one));

  const act = (run: () => void) => {
    setBusy(true);
    run();
  };

  return (
    <>
      <div className={`${styles.solutionCard} ${pending ? '' : styles.solutionCardSettled}`}>
        <div className={styles.solutionCardHead}>
          <BookText size={12} strokeWidth={2} />
          <span>方案卡</span>
        </div>

        {/* 老版本（产卡门顺手提的那种）没有结构化内容，退回只显示摘要——如实显示，好过什么都不显示。 */}
        {!card && <div className={styles.solutionFieldValue}>{understanding.proposed_summary}</div>}

        {card && (
          <>
            <SolutionField label={SOLUTION_FIELD_LABELS.goal}>
              <div className={styles.solutionFieldValue}>{card.goal}</div>
            </SolutionField>
            <SolutionField label={SOLUTION_FIELD_LABELS.target_media}>
              <div className={styles.solutionFieldValue}>{card.target_media === 'video' ? '视频' : '图片'}</div>
            </SolutionField>
            {/* 续写的卡（决策十六）只管接下来追加的那一段；另开一件事的卡（IKG78Y）是另一张。用户得知道这张卡不是整条。整条是默认，不占位。 */}
            {(card.scope?.kind === 'continuation' || card.scope?.kind === 'new_task') && (
              <SolutionField label={SOLUTION_FIELD_LABELS.scope}>
                <div className={styles.solutionFieldValue}>{card.scope.label}</div>
              </SolutionField>
            )}
            {/* 承接的是哪张（服务端填，IKG793）：另开的一件事重提成整条时也带着，所以不看 kind。 */}
            {card.scope?.derived_from && (
              <SolutionField label={SOLUTION_FIELD_LABELS.derived_from}>
                <div className={styles.solutionFieldValue}>{`〈${card.scope.derived_from}〉`}</div>
              </SolutionField>
            )}
            {card.direction && (
              <SolutionField label={SOLUTION_FIELD_LABELS.direction}>
                <div className={styles.solutionFieldValue}>{card.direction}</div>
              </SolutionField>
            )}
            {card.constraints && card.constraints.length > 0 && (
              <SolutionField label={SOLUTION_FIELD_LABELS.constraints}>
                <ul className={styles.solutionList}>
                  {card.constraints.map((one, i) => (
                    <li key={i}>{one}</li>
                  ))}
                </ul>
              </SolutionField>
            )}
            {card.asset_roles && card.asset_roles.length > 0 && (
              <SolutionField label={SOLUTION_FIELD_LABELS.asset_roles}>
                <ul className={styles.solutionList}>
                  {card.asset_roles.map((one) => (
                    <li key={one.asset_ref_id}>{one.role}</li>
                  ))}
                </ul>
              </SolutionField>
            )}
            {/* 必填项：用户没说而模型替他定的，必须一眼看得见——这正是他最该核的地方。 */}
            <SolutionField label={SOLUTION_FIELD_LABELS.assumptions}>
              <ul className={styles.solutionList}>
                {card.assumptions.map((one, i) => (
                  <li key={i}>{one}</li>
                ))}
              </ul>
            </SolutionField>
            {/* 服务端按平台模型目录核过的那一行。推荐理由与备选不上卡——那两样在对话正文里说更清楚。 */}
            {route && (
              <SolutionField label={SOLUTION_FIELD_LABELS.execution_route}>
                <div className={styles.solutionFieldValue}>
                  {route.model_family}
                  {route.model_version ? ` ${route.model_version}` : ''}
                </div>
              </SolutionField>
            )}
            {/* 出片参数：用户真能判断对错的那几项，值域来自平台目录。没聊到的不占位。 */}
            {specParts.length > 0 && (
              <SolutionField label={SOLUTION_FIELD_LABELS.delivery_spec}>
                <div className={styles.solutionFieldValue}>{specParts.join(' · ')}</div>
              </SolutionField>
            )}
          </>
        )}

        {pending && !noteOpen && (
          <div className={styles.solutionActions}>
            <button
              type="button"
              className={styles.solutionPrimaryBtn}
              disabled={disabled || busy}
              onClick={() => act(onConfirm)}
            >
              确认
            </button>
            <button
              type="button"
              className={styles.solutionGhostBtn}
              disabled={disabled || busy}
              onClick={() => act(() => onVoid())}
            >
              取消
            </button>
            <button
              type="button"
              className={styles.solutionGhostBtn}
              disabled={disabled || busy}
              onClick={() => setNoteOpen(true)}
            >
              补充
            </button>
          </div>
        )}

        {pending && noteOpen && (
          <>
            <textarea
              className={styles.solutionNote}
              value={note}
              autoFocus
              placeholder="想补充或改哪里？写下来，我按这个重提一版。"
              onChange={(e) => setNote(e.target.value)}
            />
            <div className={styles.solutionActions}>
              <button
                type="button"
                className={styles.solutionPrimaryBtn}
                disabled={disabled || busy || !note.trim()}
                onClick={() => act(() => onVoid(note.trim()))}
              >
                发给它
              </button>
              <button type="button" className={styles.solutionGhostBtn} disabled={busy} onClick={() => setNoteOpen(false)}>
                返回
              </button>
            </div>
          </>
        )}

        {!pending && (
          <div className={styles.solutionSettledNote}>
            {understanding.status === 'accepted' ? '已确认，生成卡按这个方案写' : '这一版已作废'}
          </div>
        )}
      </div>
      {/* 「接下来怎么做」不在卡里：它是模型接着要说的话，不是方案的一部分，和正文一样读（IKGH1Y 追加）。 */}
      {card?.next_steps && <Markdown text={card.next_steps} />}
    </>
  );
}

/**
 * 提示词卡（IKFLB9 定稿改版）：标题 + 张数 / 模型 / 画幅；「参考」一排素材胶囊；正文里提到的素材也是胶囊
 * （和正文同一个 Markdown，所以 #1 / 文件名都能认）；默认收成三行，「展开全文」再看；只有一个动作：应用到画布
 * （「复制提示词」「打开查看」按老板要求去掉，IKGH1Y）。
 */
function GenerationCard({ card, onApply, disabled, applied, assets }: {
  card: NonNullable<SessionContentBlock['card']>;
  onApply: () => void;
  disabled: boolean;
  applied?: boolean;
  assets: readonly KnownAsset[];
}) {
  const [full, setFull] = useState(false);
  const refs = card.assetRefItems;
  // 卡自己带的素材引用并进正文识别：历史消息里 knownAssets 可能没有它们。正文里的 `@图1` 按服务端
  // 算好的记号原文认，胶囊上写「图1」，和上面「参考」那一排、画布 `#N` 同一个号；悬停看全名。
  const cardAssets = useMemo<KnownAsset[]>(() => {
    const known = new Set(assets.map((a) => a.assetId));
    const markers = (refs ?? []).flatMap((r) =>
      (r.markerTexts ?? []).map((text) => ({ assetId: r.assetId, label: text, display: r.marker, name: r.label, mediaType: r.mediaType })),
    );
    const named = (refs ?? []).filter((r) => !known.has(r.assetId)).map((r) => ({ assetId: r.assetId, label: r.label, mediaType: r.mediaType }));
    return [...markers, ...assets, ...named].sort((a, b) => b.label.length - a.label.length);
  }, [assets, refs]);
  const meta = [
    card.targetMedia === 'video' ? '视频' : card.targetMedia === 'image' ? '图片' : null,
    card.targetModel,
    card.aspectRatio,
    card.durationSeconds !== undefined ? `${card.durationSeconds} 秒` : card.timeRange,
  ].filter((one): one is string => Boolean(one));
  const prompt = card.prompt || '提示词正文缺失，请继续对话重新生成';
  const long = prompt.length > 140 || prompt.includes('\n');
  return (
    <div className={styles.generationCard}>
      <div className={styles.shotMeta}>
        <span className={styles.shotTitle}>
          <BookText size={13} strokeWidth={2} className={styles.shotTitleIcon} />
          {card.shotTitle}
        </span>
        {/* 按哪套写法编的（F32）。只做展示与核对——它不下传生成面板，出片时模型由用户在那里选。 */}
        {meta.length > 0 && <span className={styles.shotTargetModel}>{meta.join(' · ')}</span>}
        {/* 会话里另开的一件事的卡（IKG793）：标它接的是哪张，两组卡并存时用户分得清。 */}
        {card.taskLabel && <span className={styles.shotTaskLabel} title={card.taskLabel}>{card.taskLabel}</span>}
      </div>
      {refs && refs.length > 0 && (
        <div className={styles.shotRefs}>
          <span className={styles.shotRefsLabel}>参考</span>
          {refs.map((r) => (
            <AssetMentionChip key={r.assetId} assetId={r.assetId} label={r.marker ?? r.label} name={r.label} mediaType={r.mediaType} />
          ))}
        </div>
      )}
      <div className={`${styles.shotPrompt} ${long && !full ? styles.shotPromptClamp : ''}`}>
        <Markdown text={prompt} assets={cardAssets} className={styles.shotPromptMd} />
      </div>
      {long && (
        <button type="button" className={styles.shotMore} onClick={() => setFull((v) => !v)} aria-expanded={full}>
          {full ? '收起 ▴' : '展开全文 ▾'}
        </button>
      )}
      <div className={styles.shotActions}>
        <button type="button" className={`${styles.cardBtn} ${styles.cardBtnPrimary}`} disabled={disabled || !card.source} onClick={onApply}>
          <Plus size={13} />
          {applied ? '定位文本节点' : '应用到画布'}
        </button>
      </div>
    </div>
  );
}

/**
 * 一轮里助手那一半（IKDK5I / IKDK5K / IKFLB9 定稿）。
 *
 * 落库的回答与进行中的回答走同一个函数——前者从消息部件投影条目，后者从进行中的一轮投影，
 * 两者形状一致（sessionTimeline.ts）。过程（思考、工具、等待）收成顶上一个折叠组，正文与卡按顺序铺在下面：
 * 正文是主角，过程点开才看，不再一句正文一句思考交替。
 *
 * 卡片按自己的身份做 key，正文按序号：进行中的回答被服务端消息替换时条目形状不变，开合状态得以保留。
 */
function AssistantTurnBody({
  turn,
  streamingText,
  onCardApply,
  disabled,
  appliedCardIds,
  knownAssets,
}: {
  turn: Turn;
  /** 打字动画已露出的正文前缀，只对进行中的那一轮有意义。 */
  streamingText: string;
  /** 本会话用户提过的素材，正文里提到名字就画成胶囊（IKDLW3）。 */
  knownAssets: readonly KnownAsset[];
  onCardApply: (card: NonNullable<SessionContentBlock['card']>) => void;
  disabled: boolean;
  appliedCardIds: ReadonlySet<string>;
}) {
  const items: TimelineItem[] = turn.assistant
    ? itemsFromBlocks(turn.assistant.blocks ?? [], turn.assistant.content)
    : turn.live
      ? itemsFromLive(turn.live, streamingText)
      : [];
  if (items.length === 0) return null;
  const live = turn.live !== null && !turn.live.ended;
  const process = items.filter(isProcessItem);
  const body = items.filter((item) => !isProcessItem(item));
  const ordinals: Record<string, number> = {};
  const keyOf = (item: TimelineItem): string => {
    if (item.kind === 'card') {
      const id = item.card.cardId ?? item.card.shotTitle;
      if (id) return `card:${id}`;
    }
    const n = (ordinals[item.kind] = (ordinals[item.kind] ?? 0) + 1);
    return `${item.kind}:${n}`;
  };
  return (
    <>
      <ProcessGroup items={process} live={live} totalMs={turn.account?.seconds != null ? turn.account.seconds * 1000 : null} />
      {body.map((item) => {
        const key = keyOf(item);
        switch (item.kind) {
          case 'text':
            return <Markdown key={key} text={item.text} assets={knownAssets} />;
          case 'card': {
            const cardId = item.card.cardId ?? item.card.shotTitle;
            return (
              <GenerationCard
                key={key}
                card={item.card}
                onApply={() => onCardApply(item.card)}
                disabled={disabled}
                applied={appliedCardIds.has(cardId)}
                assets={knownAssets}
              />
            );
          }
          case 'card_preview':
            return <CardPreview key={key} preview={item.preview} />;
          default:
            return null;
        }
      })}
    </>
  );
}

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

/** 抽屉滑入滑出动画时长：与 index.module.css 的 drawerSlideIn / transform transition 等长，卸载要等动画走完 */
const DRAWER_SLIDE_MS = 240;

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
  /** 选中文件后立刻生成的 blob URL，给输入框缩略图用。 */
  url?: string;
  /** 三步上传完成后的 CDN URL；乐观气泡用它出缩略图，发送契约仍只带 asset_id。 */
  remoteUrl?: string;
}

interface AgentPanelProps {
  open?: boolean;
  candidateBlocks?: SessionContentBlock[] | null;
  onPrepareCandidate?: (blocks: SessionContentBlock[]) => Promise<SessionContentBlock[]>;
  onCancelCandidate?: () => void;
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
  /** 从资产中选择：打开资产库选择弹窗（图片/视频），选中后落画布节点 + 会话附件（与上传一致） */
  onPickFromAssets?: () => void;
  /** 外部注入的资产选择结果（ts 驱动；画布侧已落节点，这里只挂会话附件） */
  externalAssetPicks?: { ts: number; blocks: import('@/api/agentSessions').SessionContentBlock[] } | null;
}

/** 图片/视频已有缩略图呈现时，不再重复渲染成 `@` 文字提及。 */
function hasInlineVisualMention(blocks: SessionContentBlock[] | undefined, chipId: string): boolean {
  return (blocks ?? []).some((block) => {
    const ids = [block.chip_id, block.asset_id, block.resource_id, block.node_id];
    if (!ids.includes(chipId)) return false;
    return isInlineMediaThumbnail(block);
  });
}

/** 文本引用胶囊的悬浮正文（IKDLQJ）：块里带着快照正文时随悬浮展示，便于核对当时发出去的内容。 */
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
    // 仅新点选更新有效候选；删除已确认引用不能重新激活曾被忽略的点选。
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
  /** Agent 模型列表：全部取自接口（fetchGenerationModels text capability），无本地写死兜底 */
  const [modelList, setModelList] = useState<GenerationModel[]>([]);
  const [selectedModel, setSelectedModel] = useState('');
  const [modelOpen, setModelOpen] = useState(false);
  const [showUpload, setShowUpload] = useState(false);
  const [showSkillModal, setShowSkillModal] = useState(false);
  const [floating, setFloating] = useState(false);
  /* ---- 对话状态机：消息流/运行态/流式文本由 session 维度事件流驱动（快照水合 + assistant.delta 流式） ---- */
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
  } = useAgentSession(projectId ?? '', selectedModel);
  /** 最近一轮的账，给输入框上方那一行；还在跑的轮没有账。 */
  const lastAccount = turns.length > 0 ? turns[turns.length - 1].account : null;
  /** 本会话用户提过的素材（IKDLW3）：助手正文里出现它们的名字就画成胶囊。 */
  const knownAssets = useMemo(() => collectKnownAssets(turns), [turns]);
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
  /** 本条消息待携带的素材：选中即开始上传，发送时才变成 `asset_ref` 部件（IKAL46）。 */
  const [attachments, setAttachments] = useState<PendingAttachment[]>([]);
  const attachmentsRef = useRef<PendingAttachment[]>([]);
  attachmentsRef.current = attachments;
  useEffect(() => {
    return () => {
      for (const item of attachmentsRef.current) revokeAttachmentPreviewUrl(item.url);
    };
  }, []);
  /* 「上传图片」/「上传视频」此前走同一个 handler、accept 也不分，两个菜单项完全等价。
   * 现在各自把 accept 收窄到对应类型（真实 media_type 仍按文件 MIME 判定）。 */
  /** 画布上现存的生成卡节点 cardId 集合。父组件没给（例如测试）时按空集处理——空集意味着
   *  「都没应用过」，是安全的一侧：宁可让用户多按一次，也不要把没进画布的卡显示成绿勾。 */
  const appliedIds = appliedCardIds ?? EMPTY_APPLIED_IDS;
  /** 已「取消」的生成卡组（按消息ID标记，组内未应用的卡不再可操作） */
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

  /* ---- 停靠抽屉（IKDLD4）：宽度可调 + 关闭滑出 ---- */
  /** 抽屉宽度：初始读持久化值（按当前视口钳制），拖左缘实时改，松手才写回 */
  const [panelWidth, setPanelWidth] = useState(() => readPersistedPanelWidth(window.innerWidth));
  /** 左缘拖拽中：整面板锁 ew-resize 光标并禁文本选中 */
  const [resizing, setResizing] = useState(false);
  const resizeDragRef = useRef<{ startX: number; startWidth: number } | null>(null);
  /** 关闭中：抽屉先滑出（240ms 动画）再回调 onClose 隐藏 */
  const [closing, setClosing] = useState(false);
  const closeTimerRef = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (open) setClosing(false);
    else {
      window.clearTimeout(closeTimerRef.current);
      setPendingReference(null);
      preparedBlocksRef.current = null;
      setHistoryOpen(false);
      setModelOpen(false);
      setShowUpload(false);
      setShowSkillModal(false);
      setDeleteTarget(null);
    }
  }, [open]);

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

  const currentModel = modelList.find((m) => m.model_id === selectedModel);

  /**
   * 加载 Agent（text capability）模型列表：接口为唯一数据源。
   *
   * 默认选中**目录里标了 `is_default` 的那一条**（IKE0VX）。在此之前默认值是
   * `list[0]`，也就是 `sort_order` 最小的一条——于是「Agent 默认用哪个模型」是排序字段
   * 的副作用：谁在管理后台调一次 text 的排序，就换掉了所有新会话的默认模型，而那个字段
   * 在界面上叫「排序」，改的人不会知道自己改了这个。
   *
   * 一条都没标时仍退回 `list[0]`，不硬失败：目录是运营数据，没标记不该让面板不可用。
   */
  useEffect(() => {
    fetchGenerationModels('text')
      .then((list) => {
        setModelList(list);
        if (list.length) {
          const fallback = list.find((m) => m.is_default) ?? list[0];
          setSelectedModel((prev) => prev || fallback.model_id);
        }
      })
      .catch(() => undefined);
  }, []);

  /**
   * 切到一条会话时，选择器跟着那条会话已经选过的模型走（IKE0II）。
   *
   * 不做这一步，选择器就变成另一种假：切到一条用豆包跑过的历史会话，界面显示 MiniMax，
   * 而这条会话在服务端仍然是豆包——用户看到的和实际在跑的又对不上了。
   *
   * 只在那条会话**真的选过**时回填。`model` 为 null 的有两种：老会话，以及刚新建的会话；
   * 这两种都保留用户此刻的选择，而不是重置回列表第一项——刚点完豆包又新建一条会话，
   * 选择器跳回 MiniMax 是错的。
   *
   * 每条会话只回填一次，之后用户在这条会话里怎么改就是怎么改；`sessions` 列表因为别的原因
   * 刷新时不会把用户刚点的选择顶掉。
   */
  const hydratedModelSessionRef = useRef<string | null>(null);
  useEffect(() => {
    if (!sessionId) return;
    const record = sessions.find((item) => item.session_id === sessionId);
    // 列表还没到就先不判：此刻回填等于用「查不到」冒充「没选过」。
    if (!record) return;
    if (hydratedModelSessionRef.current === sessionId) return;
    hydratedModelSessionRef.current = sessionId;
    if (record.model) setSelectedModel(record.model);
  }, [sessionId, sessions]);

  /** 外部注入 @ 引用/生成卡：仅在版本真正变化时触发一次；生成卡追加胶囊（可多次叠加），普通引用整体替换文本
   * ref 记录已处理的 version，防 StrictMode 开发态 effect 双调用导致重复插入 */
  const lastInputVersionRef = useRef(0);
  /** 上一次 composed 中的 chip IDs（用于检测 chip 是否被删除） */
  const prevChipIdsRef = useRef<Set<string>>(new Set());
  /** 编辑器重做恢复标签时，同步恢复其已确认内容；成功发送后一起清空。 */
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
    // 首次会话水合承接当前输入；已有会话被切换或删除时不能携带草稿。
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
    for (const block of pendingMediaBlocksRef.current) {
      if (block.chip_id) {
        referenceHistoryRef.current.set(block.chip_id, pendingMediaBlocksRef.current.filter((item) => item.chip_id === block.chip_id));
      }
    }

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
    const restored = [...chipIds].flatMap((id) =>
      pendingMediaBlocksRef.current.some((block) => block.chip_id === id) ? [] : referenceHistoryRef.current.get(id) ?? [],
    );
    if (restored.length) {
      pendingMediaBlocksRef.current = [...pendingMediaBlocksRef.current, ...restored];
      syncMediaBlocks();
    }

    // 更新记录
    prevChipIdsRef.current = chipIds;
  }, [composed]);

  /** 资产库选择注入（ts 驱动）：画布侧已落节点并完成关联，这里只把 asset_ref 块挂进待发媒体。
   *  不走 inputVersion 通道：那条路会重置输入框文本，选资产不应清掉用户已敲的字。 */
  const lastAssetPickTsRef = useRef(0);
  useEffect(() => {
    if (!externalAssetPicks || externalAssetPicks.ts === lastAssetPickTsRef.current) return;
    lastAssetPickTsRef.current = externalAssetPicks.ts;
    if (externalAssetPicks.blocks.length === 0) return;
    pendingMediaBlocksRef.current = [...pendingMediaBlocksRef.current, ...externalAssetPicks.blocks];
    syncMediaBlocks();
  }, [externalAssetPicks]);

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

  /* Run 级技能推荐（IK3NPI）已整体移除：那是 Java 运行时的接口，前后端分离重写时被带进
   * 新前端，后端从未实现——每条消息发出后这里都会白打一次 404（IKBRZV 复测 BUG-NEW-01），
   * 推荐区域因此从上线起从未渲染过。后端真做这个接口时连同 UI 一起按新契约重加。 */

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
          // 主输入框是 contentEditable，要把它从「可编辑一律让路」里单独挑出来。
          isMainComposer: Boolean(target?.closest('[data-agent-composer]')),
        })
      ) {
        stopRun();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open, closing, cancellable, stopRun, pendingReference]);

  /**
   * 进入页面、切换会话、用户发出新消息：回到底部并恢复跟随。
   * 按用户消息条数认「发了新消息」——乐观气泡一上屏就算，被服务端消息替换时条数不变。
   */
  const { handlers: listScrollHandlers, follow: followListBottom, pin: pinListBottom } = useStickToBottom(listRef);
  const userMessageCount = turns.reduce((n, turn) => n + turn.user.length, 0);
  useEffect(() => {
    pinListBottom();
  }, [sessionId, userMessageCount, pinListBottom]);

  /**
   * 轮次有任何变化（流式正文、思考、工具进度）：用户贴着底就跟到底，往上翻了就不动（见 useStickToBottom）。
   * `turns` 是一份派生值，进行中的一轮每收一条增量就换引用，所以只依赖它和打字动画即可。
   *
   * 注意这里管不到思考原话的滚动：`.thinkingReasoning` 自带 `max-height` 与 `overflow-y`，
   * 是独立的滚动容器，外层滚到底对它无效。那一段由 ThinkingBlock 自己滚（见其中的注释）。
   */
  useEffect(() => {
    followListBottom();
  }, [turns, streamingText, runningRunId, followListBottom]);

  /** 挂载即完成初始化：停靠抽屉全高贴右由纯 CSS 定位（IKDLD4），JS 坐标只有浮动模式需要。 */
  useEffect(() => {
    if (initialized) return;
    setInitialized(true);
  }, [initialized]);

  /** 窗口缩放自适应：浮动模式把位置收回可视区；停靠抽屉对当前宽度重新钳制。 */
  useEffect(() => {
    const handleResize = () => {
      if (!floating) {
        setPanelWidth((w) => clampPanelWidth(w, window.innerWidth));
        return;
      }
      const metrics = measurePanel();
      if (!metrics) return;
      // 浮动模式沿用上次位置，只把它收回可视区
      setPosition((prev) => {
        const layout = freePanelLayout(metrics, prev.x, prev.y);
        setPanelHeight(layout.height);
        return { x: layout.x, y: layout.y };
      });
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [floating, measurePanel]);

  /** 切换到浮动模式时居中；切回停靠抽屉不需要 JS 坐标（纯 CSS 全高贴右） */
  useEffect(() => {
    if (!floating) return;
    const metrics = measurePanel();
    if (!metrics) return;
    // 浮动模式：缩宽、居中
    const centerX = (metrics.pageWidth - metrics.panelWidth) / 2;
    const centerY = (metrics.pageHeight - metrics.panelHeight) / 2;
    const layout = freePanelLayout(metrics, centerX, centerY);
    setPosition({ x: layout.x, y: layout.y });
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

  /* ---- 停靠抽屉左缘拖拽调宽（IKDLD4）：Pointer Events + pointer capture，跟手无过渡动画 ---- */
  const handleResizeStart = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    // jsdom 没有 pointer capture 实现；浏览器上捕获后指针移出手柄也不丢事件
    e.currentTarget.setPointerCapture?.(e.pointerId);
    resizeDragRef.current = { startX: e.clientX, startWidth: panelWidth };
    setResizing(true);
  };
  /** 拖拽轨迹 → 钳制后的目标宽度：抽屉固定在右缘，指针左移（clientX 变小）= 加宽 */
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
  /** 双击手柄复位默认宽度（经视口钳制，极窄视口复位的也是可用宽度） */
  const handleResizeReset = () => {
    const width = clampPanelWidth(DEFAULT_PANEL_WIDTH, window.innerWidth);
    setPanelWidth(width);
    persistPanelWidth(width);
  };

  /** 关闭：先让抽屉滑出（动画 240ms），走完再回调父组件隐藏 */
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

  /** 点击快捷问题 */
  const handleQuickQuestion = (prompt: string) => {
    chipEditorRef.current?.setText(prompt);
  };

  /** 开启新对话：清空当前输入、消息流、武装技能与历史下拉 */
  const handleNewChat = () => {
    clearDraft();
    draftSessionRef.current = null;
    resetChat();
    setForcedSkill(null);
    setHistoryOpen(false);
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
  const readyPreviewUrls = new Map(
    attachments.flatMap((item) =>
      item.status === 'ready' && item.assetId && item.remoteUrl ? [[item.assetId, item.remoteUrl] as const] : [],
    ),
  );

  /** 能不能发：有文字、或有已就绪的附件；上传途中一律挡住（IKAL46）。 */
  const canSend =
    (composerHasText || readyAssets.length > 0 || pendingMediaBlocksState.length > 0) && !uploadingAttachment;

  const handleSend = async () => {
    if (submittingMessageRef.current) return;
    if (pendingReference) {
      setReferenceNotice('请先确认或取消待确认引用');
      return;
    }
    const fullText = resolveComposed(composed).trim();
    // 胶囊有两个来源，发送时必须合成一条序列：画布 @ 进来的节点/卡片，和本地上传的素材。
    // 后者带资产库身份，序列化成 `asset_ref`（agent 会建 Grant，模型真读得到）；前者只有
    // 画布 id，序列化成 `resource_ref`（模型先看到占位标签）。见 agentSessions.toReferencePart。
    const uploadedBlocks: import('@/api/agentSessions').SessionContentBlock[] = readyAssets.map((asset) => {
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
    const chipRefs = composed.segments
      .filter((s): s is { kind: 'ref'; ref: { id: string; label: string; prompt: string } } => s.kind === 'ref')
      .map((s) => s.ref);
    const chips = chipRefs.map((ref) => ({ id: ref.id, label: ref.label }));

    // 按编辑器的行内顺序提交；删除的胶囊即使还未触发 effect 也不能残留在消息里。
    const orderedContent: SessionContentBlock[] = composed.segments.flatMap((segment) =>
      segment.kind === 'text'
        ? [{ type: 'text', text: segment.value }]
        : mediaBlocks.filter((block) => block.chip_id === segment.ref.id),
    );
    orderedContent.push(...mediaBlocks.filter((block) => !block.chip_id));

    // POST 接受前保留完整草稿，失败不需要重建段落、引用位置或缩略图。
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

  /** 手动应用已提交的预览；来源随会话保留，应用结果由服务端决定。 */
  const handleCardApply = (
    card: NonNullable<SessionContentBlock['card']>,
  ) => {
    if (runningRunId !== null || streaming) return;
    const cardId = card.cardId ?? card.shotTitle;
    // 不在这里记「已应用」：那个事实由画布上有没有这个节点决定，落节点之后自然就成立了。
    const payload: GenerationCardBlock = { ...card, cardId, source: card.source ? { ...card.source, sessionId: card.source.sessionId || sessionId || '' } : undefined };
    onApplyToDock?.(payload);
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

  /** 移除首页带入的待发媒体块（按对象引用匹配，ref 同步后重渲染） */
  const removePendingMediaBlock = (block: import('@/api/agentSessions').SessionContentBlock) => {
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
      {/* 停靠抽屉左缘调宽手柄：6px 隐形热区，悬停亮线；浮动模式没有（IKDLD4） */}
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
          {/* 提示文案 */}
          <div className={styles.hintArea}>
            <h3 className={styles.hintTitle}>让 Agent 帮你创作</h3>
            <p className={styles.hintDesc}>
              描述你想生成的图片或视频，发送第一条消息即可开始。同一会话关闭重开后，未发送的草稿会保留。
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
        /* 对话消息流：按轮渲染（IKDK5I）。一轮 = 这一批用户输入 + 回答它的那些条目 + 轮尾的账。
           进行中的回答就是「最后一轮还在长」，不再是挂在整个列表之后的全局区——运行中再发一句，
           回答仍然在自己的问题下面。 */
        <div className={styles.messageList} ref={listRef} {...listScrollHandlers}>
          {turns.map((turn, turnIndex) => (
            <div key={turn.key} className={styles.turn}>
              {turn.user.map((m) => (
                <div key={m.id} className={styles.userBubble}>
                  {/* Skill 标记（无气泡，仅文字+图标） */}
                  {m.skill_ref && (
                    <div className={styles.userSkillChip}>
                      <BookText size={13} strokeWidth={2} />
                      <span>{m.skill_ref.name}</span>
                    </div>
                  )}
                  {/* 图片/画布视频提及先于正文：缩略图 → 文件名 → 用户文字。 */}
                  <MessageAssetPreview blocks={m.blocks} chips={m.chips} />
                  {/* @卡片气泡（与输入框中的气泡一致）；文本引用附悬浮正文便于核对快照（IKDLQJ） */}
                  {m.chips?.filter((c) => !hasInlineVisualMention(m.blocks, c.id)).map((c) => (
                    <div key={`chip-${c.id}`} className={styles.userMediaChip} title={quoteTooltipOfChip(m.blocks, c.id)}>
                      <span className={styles.userMediaChipAt}>@</span>
                      <span className={styles.userMediaChipLabel}>{c.label}</span>
                    </div>
                  ))}
                  {/* 文字内容 */}
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
                  {/* 方案卡（IKF3KE）：它就在这一轮的回答后面，和生成卡同一个位置。
                      待确认的那一版带三个按钮；已确认或已作废的留在原处置灰。 */}
                  {turn.solutionCards.map((understanding) => (
                    <SolutionCardBlock
                      key={`${understanding.understanding_id}:${understanding.version}`}
                      understanding={understanding}
                      // 有别的轮在跑时不给点：那一轮结束之前点了也白点，只会撞在相位上。
                      disabled={runningRunId !== null || streaming}
                      onConfirm={() => {
                        void confirmSolution(understanding.understanding_id, understanding.version);
                      }}
                      onVoid={(note) => {
                        void voidSolution(understanding.understanding_id, understanding.version, note);
                      }}
                    />
                  ))}
                  {/* 这一轮的账挂在轮尾（IKDK5L）；还在跑的轮由输入框上方的状态行读秒。 */}
                  {turn.account && !turn.live && (
                    <TurnFooter
                      account={turn.account}
                      onRetryCard={
                        // 聊天里改卡没改成（IKEV0V）：只在最后一轮、且没有别的轮在跑时给「再试一次」，
                        // 它把这一轮用户的原话重发一遍。重试接口只接失败的轮，这一轮是完成的。
                        turnIndex === turns.length - 1 && runningRunId === null && !streaming
                          ? () => {
                              const text = turn.user.map((m) => m.content).filter(Boolean).join('\n');
                              if (text.trim()) void sendMessage([{ type: 'text', text }], undefined, undefined, undefined, text);
                            }
                          : undefined
                      }
                      onRetry={
                        // 整轮失败的重来（IKHCJ2 第 5 项）：走重试接口，就在失败那行旁边。
                        // 在这之前这里只有一行字、什么都点不了，唯一的入口是输入框工具栏角落
                        // 一个 14px 无字图标——测试报告因此记成「前端无重试入口」。
                        //
                        // **只给最后一轮**：`retryRun` 重试的是最近一次失败的那个 run，往上翻到
                        // 一个更早的失败轮点它，重来的会是另一轮，而用户看不出这件事。
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
          {/* 「已超过 1 分钟无新内容」的兜底提示已移除（IKCPQ1 / IKD79P）：等待期间的反馈由
              状态行（秒数持续走动、最近一个活动节点）与工具行的读秒负责。 */}
          {/* 取消运行的入口统一在发送侧（发送按钮变停止按钮 + ESC），这里不再重复一个（IKA4PH）。 */}
        </div>
      )}


      {/* 输入区域 */}
      <div className={styles.inputArea}>
        {/* 运行中的状态行（IKA3GD）：钉在输入框正上方，不在滚动区里。
            它是"屏幕上什么都没有"的地板，用户往上翻历史时更不能让它跟着滚走。
            终态即收起（IKDK5L）：这一轮的账挂到了它所属那一轮的尾部，不再常驻在这里。 */}
        {turnOutcome === null ? (
          <RunStatusLine
            startedAt={turnStartedAt}
            activity={liveActivity}
            hasRunId={runningRunId !== null}
            outcome={null}
            streamedText={streamingText}
          />
        ) : (
          /* 不在跑的时候这一行报最近一轮的账（IKFLB9 定稿）：耗时、token、上下文、几点结束。
             只有这一行，不再每轮尾都写一遍。 */
          lastAccount && <LastTurnLine account={lastAccount} />
        )}
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
          {/* 待发素材（IKAL46 / IKCJFQ）：有预览 URL 就走图片/视频缩略图胶囊。 */}
          {(attachments.length > 0 || pendingMediaBlocksState.length > 0) && (
            <div className={styles.attachmentRow}>
              {/* 首页带入的媒体块（已上传就绪，asset_ref）：展示并允许移除，否则发送前用户完全看不到。
                *  带 chip_id 的画布 @ 块除外——它们已作为胶囊在输入框里展示，此处再画就是重复。 */}
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
                  // 快照身份区分同一节点的不同确认版本，撤销/重做不会串用新版正文。
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

          {/* 右侧 */}
          <div className={styles.toolbarRight}>
            <div className={styles.modelWrap} ref={modelRef}>
              <button
                className={`${styles.modelBtn} ${modelOpen ? styles.modelBtnActive : ''}`}
                title={currentModel?.model_label ? `Agent 模型：${currentModel.model_label}` : '选择 Agent 模型'}
                aria-label={currentModel?.model_label ? `Agent 模型：${currentModel.model_label}` : '选择 Agent 模型'}
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
                  {modelList.map((m) => (
                    <button
                      key={m.model_id}
                      className={`${styles.modelOption} ${m.model_id === selectedModel ? styles.modelOptionActive : ''}`}
                      onClick={() => {
                        setSelectedModel(m.model_id);
                        setModelOpen(false);
                      }}
                    >
                      <span>{m.model_label}</span>
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
