/**
 * 一轮时间线里的叶子组件（IKDK5K / IKDK5L / IKFLB9）：思考块、一段思考、工具行、等待行、轮尾的账。
 *
 * 单独成文件是为了能在 jsdom 里直接渲染它们做回归——AgentPanel/index.tsx 牵着编辑器、
 * 弹窗和一堆接口，在测试里立不起来。条目的编排（AssistantTurnBody）仍在那边，因为它要用
 * 生成卡与 Markdown。
 */
import { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown, ChevronRight, ChevronUp, Clock, Loader2, Minus, X } from 'lucide-react';
import styles from './index.module.css';
import { formatElapsed, formatTokens } from '../../hooks/runStatusLine';
import {
  formatDuration,
  phasesOf,
  processItemElapsedMs,
  processItemRunning,
  settledStepLabel,
  toolLabel,
  type ProcessItem,
  type ProcessPhase,
  type TimelineItem,
  type ToolStatus,
  type TurnAccount,
} from '../../hooks/sessionTimeline';

/**
 * 每秒推进一次的「现在」。只在 `active` 时开表——结束的行不需要再重渲染。
 */
function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [active]);
  return now;
}

/**
 * 思考块：模型在想什么（IKDK5K）。
 *
 * 两种内容，来源不同所以分开渲染：`steps` 是服务端报的轮级活动（「正在理解创作需求」），
 * `reasoning` 是模型自己的原话（经服务端过滤，IKDK5D）。工具自己的进度不在这里——它有自己
 * 的一行（ToolCallRow），同一事实只画一次。
 *
 * ## 开合归谁管
 *
 * `autoOpen` 是**随状态变化的默认值**，不是初始值：运行中、正文还没出来时展开（那段等待正是
 * 它要填的），正文一出现就收起（它已经完成了自己的作用）。用户点过就以用户为准（`override`）。
 */
export function ThinkingBlock({
  steps,
  reasoning,
  live,
  autoOpen = false,
}: {
  steps: string[];
  reasoning?: string;
  /** 这一轮还在跑：标记脉动，最后一步保留进行时。 */
  live: boolean;
  autoOpen?: boolean;
}) {
  const [override, setOverride] = useState<boolean | null>(null);
  const open = override ?? autoOpen;

  /**
   * 思考原话自己就是一个滚动容器（`.thinkingReasoning` 上有 `max-height; overflow-y: auto`），
   * 外层消息列表滚到底对它没有作用，要跟上流式输出得滚这个盒子本身。
   * `stick` 记的是「用户此刻是不是贴着底」，在 onScroll 里更新：用户往上翻看前文时不把他拽回来。
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
        onClick={() => setOverride(!open)}
        aria-expanded={open}
      >
        <span className={`${styles.thinkingMark} ${live ? styles.thinkingMarkLive : ''}`} aria-hidden="true">
          ✶
        </span>
        <span>思考过程</span>
        {open ? <ChevronUp size={12} strokeWidth={2.5} /> : <ChevronDown size={12} strokeWidth={2.5} />}
      </button>
      {open && (
        <div className={styles.thinkingBody}>
          {steps.map((s, i) => (
            <div key={i} className={styles.thinkingStep}>
              {/* 进行中只有最后一步还在做，前面的都已经过去了；结束后全部翻成过去式。 */}
              {live && i === steps.length - 1 ? s : settledStepLabel(s)}
            </div>
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

/**
 * 一段思考（IKFLB9）：模型在这一刻想了什么、想了多久，落在它发生的位置上。
 *
 * 此前思考是整轮一块、固定在最前，工具行之间的那几十秒没有任何东西——测试站项目 462 写卡那一行
 * 记 1m 9s，点开只有两条 <0.1s。现在每一段想各占一行，时长和工具行、等待行一起加起来就是这一轮。
 *
 * 默认收起；正在想的那一段展开，想完就收——那段等待正是它要填的。用户点过就以用户为准。
 * 投影把整段话都拦下时（原话讲的全是内部的东西）只剩一行「思考了 12s」，没有可展开的内容。
 */
export function ThoughtBlock({ item }: { item: Extract<TimelineItem, { kind: 'thought' }> }) {
  const [override, setOverride] = useState<boolean | null>(null);
  const hasText = item.text.trim() !== '';
  const open = hasText && (override ?? item.running);
  const now = useNow(item.running && item.startedAt !== null);
  const elapsedMs =
    item.elapsedMs ?? (item.running && item.startedAt !== null ? Math.floor((now - item.startedAt) / 1000) * 1000 : null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const stickRef = useRef(true);
  useEffect(() => {
    const el = bodyRef.current;
    if (!el || !open || !stickRef.current) return;
    el.scrollTop = el.scrollHeight;
  }, [item.text, open]);
  return (
    <div className={styles.thinkingBlock}>
      <button
        type="button"
        className={styles.thinkingToggle}
        onClick={hasText ? () => setOverride(!open) : undefined}
        disabled={!hasText}
        aria-expanded={hasText ? open : undefined}
      >
        <span className={`${styles.thinkingMark} ${item.running ? styles.thinkingMarkLive : ''}`} aria-hidden="true">
          ✶
        </span>
        <span>{item.running ? '思考中' : '思考了'}</span>
        {elapsedMs !== null && elapsedMs > 0 && <span className={styles.toolCallElapsed}>{formatDuration(elapsedMs)}</span>}
        {hasText && (open ? <ChevronUp size={12} strokeWidth={2.5} /> : <ChevronDown size={12} strokeWidth={2.5} />)}
      </button>
      {open && (
        <div
          ref={bodyRef}
          className={styles.thinkingReasoning}
          onScroll={(e) => {
            const el = e.currentTarget;
            stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
          }}
        >
          {item.text}
        </div>
      )}
    </div>
  );
}

/**
 * 等待行（IKFLB9）：两段之间没有任何输出的那段时间，比如工具返回之后模型把结果读一遍。
 *
 * 只在落库之后出现（服务端补缝算出来的），一秒以内的不画（见 MIN_VISIBLE_WAITING_MS）。画得比工具行
 * 更淡：它不是做了一件事，是在等一件事。
 */
export function WaitingRow({ item }: { item: Extract<TimelineItem, { kind: 'waiting' }> }) {
  return (
    <div className={`${styles.toolCall} ${styles.toolCallWaiting}`}>
      <div className={styles.toolCallHead}>
        <span className={styles.toolCallMark} aria-hidden="true">
          <Clock size={12} strokeWidth={2.5} />
        </span>
        <span className={styles.toolCallLabel}>{settledStepLabel(item.summary)}</span>
        <span className={styles.toolCallElapsed}>{formatDuration(item.elapsedMs)}</span>
      </div>
    </div>
  );
}

const TOOL_STATUS_CLASS: Record<ToolStatus, string> = {
  running: styles.toolCallRunning ?? '',
  completed: styles.toolCallDone ?? '',
  failed: styles.toolCallFailed ?? '',
  rejected: styles.toolCallRejected ?? '',
  cancelled: styles.toolCallRejected ?? '',
};

function ToolStatusMark({ status }: { status: ToolStatus }) {
  switch (status) {
    case 'running':
      return <Loader2 size={12} strokeWidth={2.5} className={styles.spin} />;
    case 'completed':
      return <Check size={12} strokeWidth={2.5} />;
    case 'failed':
      return <X size={12} strokeWidth={2.5} />;
    case 'rejected':
    case 'cancelled':
      return <Minus size={12} strokeWidth={2.5} />;
  }
}

/**
 * 工具行：它在做什么（IKDK5K）。
 *
 * 有生命周期：运行中转圈读秒，结束翻成过去式带耗时（「正在读取图片」→「已读取图片 · 10.4s」），
 * 失败与被门挡下各有自己的语气。子步骤运行中默认展开——用户此刻正盯着它等；结束后默认收起，
 * 点一下再看。用户点过就以用户为准。
 *
 * 文案里刻意没有「调用」「工具」和工具名：用户关心的是做了什么事，不是用什么机制做的。
 */
export function ToolCallRow({ item }: { item: Extract<TimelineItem, { kind: 'tool' }> }) {
  const running = item.status === 'running';
  const [override, setOverride] = useState<boolean | null>(null);
  const hasSubsteps = item.substeps.length > 0;
  const open = hasSubsteps && (override ?? running);
  const now = useNow(running && item.startedAt !== null);
  // 运行中按整秒读，结束后用服务端报的精确值。
  const elapsedMs =
    item.elapsedMs ?? (running && item.startedAt !== null ? Math.floor((now - item.startedAt) / 1000) * 1000 : null);
  return (
    <div className={`${styles.toolCall} ${TOOL_STATUS_CLASS[item.status]}`}>
      <button
        type="button"
        className={styles.toolCallHead}
        onClick={hasSubsteps ? () => setOverride(!open) : undefined}
        disabled={!hasSubsteps}
        aria-expanded={hasSubsteps ? open : undefined}
      >
        <span className={styles.toolCallMark} aria-hidden="true">
          <ToolStatusMark status={item.status} />
        </span>
        <span className={styles.toolCallLabel}>{toolLabel(item.summary, item.status)}</span>
        {item.calls > 1 && <span className={styles.toolCallElapsed}>×{item.calls}</span>}
        {elapsedMs !== null && elapsedMs > 0 && <span className={styles.toolCallElapsed}>{formatDuration(elapsedMs)}</span>}
        {hasSubsteps && (
          <span className={styles.toolCallChevron} aria-hidden="true">
            {open ? <ChevronUp size={12} strokeWidth={2.5} /> : <ChevronDown size={12} strokeWidth={2.5} />}
          </span>
        )}
      </button>
      {open && (
        <div className={styles.toolCallSubsteps}>
          {item.substeps.map((s, i) => (
            <div key={i} className={styles.toolCallSubstep}>
              <span className={styles.toolCallMark} aria-hidden="true">
                <ToolStatusMark status={s.status} />
              </span>
              <span className={styles.toolCallLabel}>{s.status === 'running' ? s.summary : settledStepLabel(s.summary)}</span>
              {s.elapsedMs !== null && <span className={styles.toolCallElapsed}>{formatDuration(s.elapsedMs)}</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * 过程组（IKFLB9 定稿）：一轮里模型做的事——思考、查阅、等待——收成一个整体，正文只放结论。
 *
 * 此前思考、工具行、等待行和正文一句一句交替着铺（「已等待 9.8s / ✶ 思考了 5.2s / 我先把方向对一下 / 已查阅…」），
 * 用户读到的是十几行碎片。定稿后每轮只有一行「▶ ✻ 已处理 31s · 思考 2 段 · 工具 1 次」，默认折起；点开按阶段分组
 * （理解需求 / 查阅对应的创作方法 / 整理回复），每个阶段一个合计时长，再点开才是里面的思考原文、读了哪些文件。
 *
 * 运行中是「✶ 处理中」并展开，正在跑的那个阶段也展开——那段等待正是它要填的；结束就收。用户点过以用户为准。
 * `totalMs` 是这一轮的总耗时（落库后取轮的账，和输入框上方那一行同一个数）；没有就把各段加起来。
 */
export function ProcessGroup({ items, live, totalMs = null }: { items: readonly ProcessItem[]; live: boolean; totalMs?: number | null }) {
  const [override, setOverride] = useState<boolean | null>(null);
  const open = override ?? live;
  const now = useNow(live);
  if (items.length === 0) return null;
  const phases = phasesOf(items);
  const summed = items.reduce((acc, item) => acc + processItemElapsedMs(item, now), 0);
  const total = totalMs ?? summed;
  const thoughts = items.filter((item) => item.kind === 'thought' || item.kind === 'reasoning').length;
  const tools = items.filter((item) => item.kind === 'tool').length;
  const counts = [thoughts > 0 ? `思考 ${thoughts} 段` : null, tools > 0 ? `工具 ${tools} 次` : null].filter(Boolean);
  return (
    <div className={styles.processGroup}>
      <button type="button" className={styles.processHead} onClick={() => setOverride(!open)} aria-expanded={open}>
        <span className={styles.processChevron} aria-hidden="true">
          {open ? <ChevronDown size={12} strokeWidth={2.5} /> : <ChevronRight size={12} strokeWidth={2.5} />}
        </span>
        <span className={`${styles.thinkingMark} ${live ? styles.thinkingMarkLive : ''}`} aria-hidden="true">
          {live ? '✶' : '✻'}
        </span>
        <span className={styles.processLabel}>{live ? '处理中' : `已处理 ${formatDuration(total)}`}</span>
        {counts.length > 0 && <span className={styles.processCounts}>{` · ${counts.join(' · ')}`}</span>}
      </button>
      {open && (
        <div className={styles.processBody}>
          {phases.map((phase, i) => (
            <PhaseRow key={i} phase={phase} now={now} />
          ))}
        </div>
      )}
    </div>
  );
}

/** 一个阶段：✓ / 转圈 + 名字 + 合计时长；点开是里面的思考段、工具行、等待行，各自沿用原来的叶子组件。 */
function PhaseRow({ phase, now }: { phase: ProcessPhase; now: number }) {
  const running = phase.items.some(processItemRunning);
  const [override, setOverride] = useState<boolean | null>(null);
  const open = override ?? running;
  const elapsed = phase.items.reduce((acc, item) => acc + processItemElapsedMs(item, now), 0);
  return (
    <div className={styles.processPhase}>
      <button type="button" className={styles.processPhaseHead} onClick={() => setOverride(!open)} aria-expanded={open}>
        <span className={styles.processChevron} aria-hidden="true">
          {open ? <ChevronDown size={12} strokeWidth={2.5} /> : <ChevronRight size={12} strokeWidth={2.5} />}
        </span>
        <span className={`${styles.toolCallMark} ${running ? styles.processPhaseMarkRunning : styles.processPhaseMarkDone}`} aria-hidden="true">
          {running ? <Loader2 size={12} strokeWidth={2.5} className={styles.spin} /> : <Check size={12} strokeWidth={2.5} />}
        </span>
        <span className={styles.toolCallLabel}>{phase.name}</span>
        <span className={styles.toolCallElapsed}>{running ? '进行中' : elapsed > 0 ? formatDuration(elapsed) : ''}</span>
      </button>
      {open && (
        <div className={styles.processPhaseItems}>
          {phase.items.map((item, i) => {
            switch (item.kind) {
              case 'reasoning':
                return <ThinkingBlock key={i} steps={item.steps} reasoning={item.reasoning} live={item.live} autoOpen={item.live} />;
              case 'thought':
                return <ThoughtBlock key={i} item={item} />;
              case 'tool':
                return <ToolCallRow key={i} item={item} />;
              case 'waiting':
                return <WaitingRow key={i} item={item} />;
            }
          })}
        </div>
      )}
    </div>
  );
}

const ACCOUNT_MARK: Record<TurnAccount['outcome'], string> = {
  completed: '✻',
  cancelled: '⊘',
  failed: '✕',
};

const ACCOUNT_CLASS: Record<TurnAccount['outcome'], string> = {
  completed: styles.turnFooterDone ?? '',
  cancelled: styles.turnFooterCancelled ?? '',
  failed: styles.turnFooterFailed ?? '',
};

/**
 * 轮尾的交代（IKDK5L / IKEV0V）：这一轮是怎么结束的——取消、失败、完成了但卡没写出来。
 *
 * 耗时、token、上下文那笔账不再挂在这里（IKFLB9 定稿）：它只在输入框上方一行（LastTurnLine），
 * 每轮尾都写一遍是噪音。完成的轮什么都不写——回答就在上面。
 *
 * `onRetryCard` 只给最后一轮：它把这一轮用户的原话重发一遍——重试接口只接失败的轮，这一轮是完成的，走不了那条。
 */
export function TurnFooter({ account, onRetryCard }: { account: TurnAccount; onRetryCard?: () => void }) {
  const cardFailed = account.outcome === 'completed' && Boolean(account.cardFailureText);
  const label =
    account.outcome === 'failed'
      ? account.failureText ?? '未能完成'
      : account.outcome === 'cancelled'
        ? '已取消'
        : cardFailed
          ? account.cardFailureText
          : null;
  if (!label) return null;
  return (
    <div className={`${styles.turnFooter} ${cardFailed ? styles.turnFooterCardFailed ?? '' : ACCOUNT_CLASS[account.outcome]}`}>
      <span className={styles.turnFooterMark} aria-hidden="true">
        {cardFailed ? '!' : ACCOUNT_MARK[account.outcome]}
      </span>
      <span>{label}</span>
      {cardFailed && account.cardFailureRetryable && onRetryCard && (
        <button type="button" className={styles.turnFooterRetry} onClick={onRetryCard}>
          再试一次
        </button>
      )}
    </div>
  );
}

const LAST_TURN_LABEL: Record<TurnAccount['outcome'], string> = {
  completed: '上一轮',
  cancelled: '上一轮已取消',
  failed: '上一轮未完成',
};

/** `21:37`。本地时间，只到分钟——那一行是给人扫一眼的。 */
function clockOf(ms: number): string {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/**
 * 输入框上方那一行账（IKFLB9 定稿）：「✻ 上一轮 57s · ↓ 14.7k · 上下文 9% · 21:37 完成」。
 *
 * 只有一行、只说最近一轮、钉在输入框上方不随消息滚走。运行中这一行让位给 RunStatusLine（读秒、在等什么）。
 * 三个数各自可缺，一个都没有、也没时刻时不画。
 */
export function LastTurnLine({ account }: { account: TurnAccount }) {
  const meta: string[] = [];
  if (account.seconds !== null) meta.push(formatElapsed(account.seconds));
  if (account.tokenUsage) meta.push(`↓ ${formatTokens(account.tokenUsage.output_tokens)}`);
  const context = account.contextCapacity;
  if (context) meta.push(`上下文 ${Math.round(Math.min(1, Math.max(0, context.ratio)) * 100)}%`);
  if (context?.compaction_state === 'compacted') meta.push('已压缩历史');
  if (account.finishedAt !== null) meta.push(`${clockOf(account.finishedAt)} ${account.outcome === 'completed' ? '完成' : '结束'}`);
  if (meta.length === 0) return null;
  return (
    <div className={`${styles.runStatus} ${styles.runStatusDone ?? ''} ${ACCOUNT_CLASS[account.outcome]}`} role="status">
      <span className={styles.runStatusMark} aria-hidden="true">
        {ACCOUNT_MARK[account.outcome]}
      </span>
      <span className={styles.runStatusMeta} title="最近一轮的耗时 · 输出 token · 上下文占用 · 结束时刻">
        {`${LAST_TURN_LABEL[account.outcome]} ${meta.join(' · ')}`}
      </span>
    </div>
  );
}
