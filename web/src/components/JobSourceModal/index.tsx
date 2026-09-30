/* ============================================
 * JobSourceModal — 两阶段任务来源弹层（IKIZQI）
 * 历史（/history 行内来源链接）与资产库（详情弹窗来源按钮）共用：
 * 按 jobId 拉 GET /api/jobs/:id，展示阶段/状态/费用与成功产物（预览 + 下载）。
 * 失败任务同样可查——后端失败信封 data 带全阶段投影（jobs.service getStatus 失败分支），
 * 从 ApiError.data 收敛，不丢阶段与费用。
 * ============================================ */
import { useQuery } from '@tanstack/react-query';
import Modal from '@/components/Modal';
import Skeleton from '@/components/Skeleton';
import { apiRequest, isApiError } from '@/api/http';
import { readJobFailText, type JobDetail, type JobStatus } from '@/api/jobs';
import { chargeLabel, jobStatusLabel, stageBadgeLabel } from './labels';
import styles from './index.module.css';

/** 弹层目标：jobId + 语境标题（「来源样片任务」/「成片任务」）。null = 关闭。 */
export interface JobSourceTarget {
  jobId: string;
  /** 语境标题：调用方知道链接方向（样片→成片 / 成片→样片 / 历史行）。 */
  title: string;
}
/** 成功/失败信封收敛后的展示视图（失败时阶段投影来自 ApiError.data）。 */
type JobSourceView = Pick<
  JobDetail,
  'status' | 'video_stage' | 'finalize_deadline_at' | 'charge_state' | 'actual_credits' | 'output_assets' | 'asset'
> & { failText: string };

/** 拉单任务详情并对失败信封收敛（ApiError.data 携带失败任务的阶段投影六件套）。 */
async function fetchJobSourceView(jobId: string): Promise<JobSourceView> {
  const fromFailureData = (data: unknown): Partial<JobSourceView> | null =>
    data && typeof data === 'object' ? (data as Partial<JobSourceView>) : null;
  try {
    const detail = await apiRequest<JobDetail>(`/api/jobs/${encodeURIComponent(jobId)}`, {
      silent: true,
    });
    return { ...detail, failText: '' };
  } catch (e) {
    if (isApiError(e)) {
      // 失败信封：code/msg 顶层 + data 带任务字段（含阶段投影）。HTTP 200、业务码 1xxx。
      const partial = fromFailureData(e.data) ?? {};
      return {
        status: (partial.status as JobStatus) ?? 'failed',
        video_stage: partial.video_stage,
        finalize_deadline_at: partial.finalize_deadline_at ?? null,
        charge_state: partial.charge_state ?? null,
        actual_credits: partial.actual_credits ?? null,
        output_assets: partial.output_assets ?? [],
        asset: partial.asset ?? null,
        failText: e.message || readJobFailText(undefined) || '任务失败',
      };
    }
    throw e;
  }
}

export default function JobSourceModal({
  target,
  onClose,
}: {
  target: JobSourceTarget | null;
  onClose: () => void;
}) {
  const { data, isPending, isError } = useQuery({
    queryKey: ['job-source', target?.jobId ?? ''],
    queryFn: () => fetchJobSourceView(target!.jobId),
    enabled: target !== null,
    retry: false,
  });

  const stage = target ? stageBadgeLabel(data?.video_stage) : null;

  return (
    <Modal
      open={target !== null}
      title={target?.title}
      width={560}
      footer={null}
      onCancel={onClose}
      ariaLabel={target?.title ?? '任务来源'}
    >
      {target && (isPending || (!data && !isError)) && (
        <div className={styles.loading}>
          <Skeleton className={styles.loadingSkeleton} />
        </div>
      )}
      {target && isError && <div className={styles.error}>任务查询失败，请稍后重试。</div>}
      {target && data && (
        <div className={styles.body}>
          <div className={styles.metaRow}>
            <span className={`${styles.badge} ${data.status === 'failed' ? styles.badgeFailed : ''}`}>
              {jobStatusLabel(data.status)}
            </span>
            {stage && <span className={`${styles.badge} ${styles.badgeStage}`}>{stage}</span>}
            {chargeLabel(data.charge_state, data.actual_credits) && (
              <span className={styles.charge}>
                费用：{chargeLabel(data.charge_state, data.actual_credits)}
              </span>
            )}
          </div>
          {data.failText && <p className={styles.failText}>{data.failText}</p>}
          {data.video_stage === 'sample' && data.finalize_deadline_at && (
            <p className={styles.deadline}>转成片截止 {new Date(data.finalize_deadline_at).toLocaleString()}</p>
          )}
          {(data.output_assets ?? []).length > 0 ? (
            <div className={styles.assets}>
              {(data.output_assets ?? []).map((asset) => (
                <div key={String(asset.id)} className={styles.assetItem}>
                  {asset.type === 'video' && (
                    <video className={styles.assetVideo} src={asset.url} controls playsInline preload="metadata" />
                  )}
                  <a
                    className={styles.downloadLink}
                    href={asset.url}
                    download
                    target="_blank"
                    rel="noreferrer"
                  >
                    下载已转存素材（#{String(asset.id)}）
                  </a>
                </div>
              ))}
            </div>
          ) : (
            data.status !== 'succeeded' && <p className={styles.noAssets}>无成功产物（失败任务不进成功资产）</p>
          )}
        </div>
      )}
    </Modal>
  );
}
