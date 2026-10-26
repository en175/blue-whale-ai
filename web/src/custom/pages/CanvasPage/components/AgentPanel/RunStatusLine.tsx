import { useState, useEffect } from 'react';
import styles from './index.module.css';
import { deriveRunStatus, formatElapsed, formatTokens, type RunStatus } from '../../hooks/agent/runStatusLine';
import type { TurnOutcome } from '../../hooks/agent/useAgentSession';

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

export function RunStatusLine({
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
    if (startedAt === null || settled) return;
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
      {}
      {hasMeta && (
        <span className={styles.runStatusMeta} aria-hidden={!status.settled}>
          {}
          {'('}
          {}
          {status.seconds !== null && formatElapsed(status.seconds)}
          {status.tokens && (
            <>
              {status.seconds !== null && ' · '}
              {}
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
              {}
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
