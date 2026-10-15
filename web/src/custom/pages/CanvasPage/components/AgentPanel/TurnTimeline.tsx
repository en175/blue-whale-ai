import { type ToolStatus } from '@/custom/enums';
import { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown, ChevronRight, ChevronUp, Clock, Loader2, Minus, X } from 'lucide-react';
import styles from './index.module.css';
import { formatElapsed, formatTokens } from '../../hooks/runStatusLine';
import { formatDuration, phasesOf, processItemElapsedMs, processItemRunning, settledStepLabel, toolLabel, withWriting, type ProcessItem, type ProcessPhase, type TimelineItem, type TurnAccount } from '../../hooks/sessionTimeline';

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

export function ThinkingBlock({
  steps,
  reasoning,
  live,
  autoOpen = false,
}: {
  steps: string[];
  reasoning?: string;
  live: boolean;
  autoOpen?: boolean;
}) {
  const [override, setOverride] = useState<boolean | null>(null);
  const open = override ?? autoOpen;

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
              {}
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

export function ToolCallRow({ item }: { item: Extract<TimelineItem, { kind: 'tool' }> }) {
  const running = item.status === 'running';
  const [override, setOverride] = useState<boolean | null>(null);
  const hasSubsteps = item.substeps.length > 0;
  const open = hasSubsteps && (override ?? running);
  const now = useNow(running && item.startedAt !== null);
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

export function ProcessGroup({ items: given, live, totalMs = null }: { items: readonly ProcessItem[]; live: boolean; totalMs?: number | null }) {
  const [override, setOverride] = useState<boolean | null>(null);
  const open = override ?? live;
  const now = useNow(live);
  if (given.length === 0) return null;
  const items = live ? given : withWriting(given, totalMs);
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

function PhaseRow({ phase, now }: { phase: ProcessPhase; now: number }) {
  const running = phase.items.some(processItemRunning);
  const [override, setOverride] = useState<boolean | null>(null);
  const expandable = phase.items.some((item) => item.kind !== 'writing');
  const open = expandable && (override ?? running);
  const elapsed = phase.items.reduce((acc, item) => acc + processItemElapsedMs(item, now), 0);
  return (
    <div className={styles.processPhase}>
      <button
        type="button"
        className={styles.processPhaseHead}
        onClick={expandable ? () => setOverride(!open) : undefined}
        disabled={!expandable}
        aria-expanded={expandable ? open : undefined}
      >
        <span className={styles.processChevron} aria-hidden="true">
          {!expandable ? null : open ? <ChevronDown size={12} strokeWidth={2.5} /> : <ChevronRight size={12} strokeWidth={2.5} />}
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
              case 'writing':
                return null;
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

export function TurnFooter({
  account,
  onRetryCard,
  onRetry,
}: {
  account: TurnAccount;
  onRetryCard?: () => void;
  onRetry?: () => void;
}) {
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
      {account.outcome === 'failed' && account.failureRetryable && onRetry && (
        <button type="button" className={styles.turnFooterRetry} onClick={onRetry}>
          重新回答
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

function clockOf(ms: number): string {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

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
