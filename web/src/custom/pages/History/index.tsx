import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import Skeleton from '@/custom/components/Skeleton';
import JobSourceModal, { type JobSourceTarget } from '@/custom/components/JobSourceModal';
import { chargeLabel, jobStatusLabel, stageBadgeLabel } from '@/custom/components/JobSourceModal/labels';
import {
  videoHistoryOptions,
  HISTORY_JOBS_PER_PROJECT,
  type HistoryJobEntry,
} from '@/custom/api/generationHistory';
import Empty from '@/custom/components/Empty';
import { isApiError } from '@/shared/api/http';
import { readJobFailText } from '@/custom/api/jobs';
import styles from './index.module.css';

function sourceTargetOf(entry: HistoryJobEntry): JobSourceTarget | null {
  const { job } = entry;
  if (job.video_stage === 'final' && job.source_sample_job_id) {
    return { jobId: job.source_sample_job_id, title: '来源样片任务' };
  }
  if (job.video_stage === 'sample' && job.final_job_id) {
    return { jobId: job.final_job_id, title: '成片任务' };
  }
  return null;
}

function sampleExpired(job: HistoryJobEntry['job']): boolean {
  if (job.video_stage !== 'sample' || !job.finalize_deadline_at) return false;
  const deadline = Date.parse(job.finalize_deadline_at);
  return !Number.isNaN(deadline) && deadline < Date.now();
}

function HistoryRow({
  entry,
  onOpenSource,
}: {
  entry: HistoryJobEntry;
  onOpenSource: (target: JobSourceTarget) => void;
}) {
  const { job } = entry;
  const stage = stageBadgeLabel(job.video_stage);
  const source = sourceTargetOf(entry);
  const charge = chargeLabel(job.charge_state, job.actual_credits);
  const failText = job.status === 'failed' ? readJobFailText(job.error) : '';
  const expired = sampleExpired(job);

  return (
    <li className={styles.row}>
      <div className={styles.rowHead}>
        <span className={styles.project} title={entry.projectName}>
          {entry.projectName}
        </span>
        {stage && (
          <span className={`${styles.badge} ${styles.badgeStage}`}>{stage}</span>
        )}
        {!stage && <span className={styles.badge}>普通视频</span>}
        <span
          className={`${styles.badge} ${
            job.status === 'failed'
              ? styles.badgeFailed
              : job.status === 'checking'
                ? styles.badgeChecking
                : ''
          }`}
        >
          {jobStatusLabel(job.status)}
        </span>
        <span className={styles.time}>{new Date(job.created_at).toLocaleString()}</span>
      </div>
      <div className={styles.rowMeta}>
        <span className={styles.jobId}>任务 #{String(job.job_id)}</span>
        {charge && <span className={styles.charge}>费用：{charge}</span>}
        {job.video_stage === 'sample' && job.finalize_deadline_at && (
          <span className={expired ? styles.deadlineExpired : styles.deadline}>
            {expired ? '转成片期限已过，样片保留可预览下载' : `转成片截止 ${new Date(job.finalize_deadline_at).toLocaleString()}`}
          </span>
        )}
        {source && (
          <button
            type="button"
            className={styles.sourceLink}
            onClick={() => onOpenSource(source)}
          >
            {job.video_stage === 'final' ? `来自样片任务 #${source.jobId}` : `查看成片任务 #${source.jobId}`}
          </button>
        )}
      </div>
      {failText && <p className={styles.failText}>{failText}</p>}
    </li>
  );
}

export default function History() {
  const [sourceTarget, setSourceTarget] = useState<JobSourceTarget | null>(null);
  const history = useQuery(videoHistoryOptions());
  const perProjectCounts = new Map<string, number>();
  (history.data ?? []).forEach((entry) => {
    perProjectCounts.set(entry.projectId, (perProjectCounts.get(entry.projectId) ?? 0) + 1);
  });
  const truncated = [...perProjectCounts.values()].some((count) => count >= HISTORY_JOBS_PER_PROJECT);

  return (
    <div className={styles.page}>
      <div className={styles.container}>
        <div className={styles.header}>
          <h1 className={styles.pageTitle}>生成历史</h1>
        </div>
        <div className={styles.content}>
          {history.isPending && (
            <ul className={styles.list} aria-busy>
              {Array.from({ length: 5 }, (_, index) => (
                <li key={index} className={styles.row}>
                  <Skeleton className={styles.rowSkeleton} />
                </li>
              ))}
            </ul>
          )}
          {history.isError && (
            <Empty
              className={styles.empty}
              title={isApiError(history.error) ? history.error.message : '生成历史加载失败，请刷新重试。'}
            />
          )}
          {history.data && history.data.length === 0 && (
            <Empty className={styles.empty} title="暂无视频生成历史" />
          )}
          {history.data && history.data.length > 0 && (
            <ul className={styles.list}>
              {history.data.map((entry) => (
                <HistoryRow key={String(entry.job.job_id)} entry={entry} onOpenSource={setSourceTarget} />
              ))}
            </ul>
          )}
          {history.data && history.data.length > 0 && truncated && (
            <p className={styles.truncatedNotice}>仅显示最近 {HISTORY_JOBS_PER_PROJECT} 条</p>
          )}
        </div>
      </div>
      <JobSourceModal target={sourceTarget} onClose={() => setSourceTarget(null)} />
    </div>
  );
}
