/**
 * 一轮时间线里的三种叶子组件（IKDK5K / IKDK5L）：思考块、工具行、轮尾的账。
 *
 * 单独成文件是为了能在 jsdom 里直接渲染它们做回归——AgentPanel/index.tsx 牵着编辑器、
 * 弹窗和一堆接口，在测试里立不起来。条目的编排（AssistantTurnBody）仍在那边，因为它要用
 * 生成卡与 Markdown。
 */
import { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown, ChevronUp, Loader2, Minus, X } from 'lucide-react';
import styles from './index.module.css';
import { formatElapsed, formatTokens } from '../../hooks/runStatusLine';
import {
  formatDuration,
  settledStepLabel,
  toolLabel,
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
 * 轮尾的账（IKDK5L）：这一轮花了多久、多少输出 token、上下文占了多少。
 *
 * 此前这笔账常驻输入框上方，滚动之后和任何一条消息都对不上。放到它所属的那一轮尾部，
 * 用户回看时才知道「这一轮是怎么结束的」。完成的轮不写「已完成」——回答就在上面，
 * 不必再说一遍；取消与失败要写，那是这一轮唯一的交代。
 *
 * **完成了、但要写的生成卡没写出来**也要写（IKEV0V）：这只发生在聊天里改卡时，那一轮照常完成，
 * 侧边栏还挂着上一版。不交代的话，用户会把旧卡当成这次改出来的。`onRetryCard` 只给最后一轮：
 * 它把这一轮用户的原话重发一遍——重试接口只接失败的轮，这一轮是完成的，走不了那条。
 */
export function TurnFooter({ account, onRetryCard }: { account: TurnAccount; onRetryCard?: () => void }) {
  const meta: string[] = [];
  if (account.seconds !== null) meta.push(formatElapsed(account.seconds));
  if (account.tokenUsage) meta.push(`↓ ${formatTokens(account.tokenUsage.output_tokens)}`);
  const context = account.contextCapacity;
  if (context) meta.push(`上下文 ${Math.round(Math.min(1, Math.max(0, context.ratio)) * 100)}%`);
  if (context?.compaction_state === 'compacted') meta.push('已压缩历史');
  const cardFailed = account.outcome === 'completed' && Boolean(account.cardFailureText);
  const label =
    account.outcome === 'failed'
      ? account.failureText ?? '未能完成'
      : account.outcome === 'cancelled'
        ? '已取消'
        : cardFailed
          ? account.cardFailureText
          : null;
  if (!label && meta.length === 0) return null;
  return (
    <div className={`${styles.turnFooter} ${cardFailed ? styles.turnFooterCardFailed ?? '' : ACCOUNT_CLASS[account.outcome]}`}>
      <span className={styles.turnFooterMark} aria-hidden="true">
        {cardFailed ? '!' : ACCOUNT_MARK[account.outcome]}
      </span>
      {label && <span>{label}</span>}
      {cardFailed && onRetryCard && (
        <button type="button" className={styles.turnFooterRetry} onClick={onRetryCard}>
          再试一次
        </button>
      )}
      {meta.length > 0 && (
        <span className={styles.turnFooterMeta} title="这一轮的耗时 · 输出 token · 上下文占用">
          {meta.join(' · ')}
        </span>
      )}
    </div>
  );
}
