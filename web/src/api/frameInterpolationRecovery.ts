import { queryOptions } from '@tanstack/react-query';
import {
  VIDEO_FRAME_INTERPOLATION_JOB_TYPE,
  videoFrameInterpolationInputSchema,
} from '@lib/contracts/video-frame-interpolation';
import { fetchFrameInterpolationCurrent, fetchJobs } from './jobs';

/** 当前关联与该任务的公开冻结输入一同恢复，不从面板编辑值推测受理参数。 */
export function frameInterpolationRecoveryOptions(projectId: string, nodeId: string) {
  return queryOptions({
    queryKey: ['jobs', 'frame-interpolation-recovery', projectId, nodeId],
    staleTime: 0,
    retry: false,
    queryFn: async () => {
      const current = await fetchFrameInterpolationCurrent(projectId, nodeId);
      if (!current || current.status === 'cancelled') return { current, input: null };
      const jobs = await fetchJobs({ projectId, ids: [current.job_id], size: 1 }, { silent: true });
      const job = jobs.records.find((row) => String(row.job_id) === String(current.job_id));
      const parsed = videoFrameInterpolationInputSchema.safeParse(job?.input);
      if (job?.type !== VIDEO_FRAME_INTERPOLATION_JOB_TYPE || !parsed.success ||
        parsed.data.target_node_id !== nodeId ||
        !(job.input && typeof job.input === 'object' && 'fps' in job.input)) {
        throw new Error('插帧任务参数无法恢复，请刷新后重试');
      }
      return { current, input: parsed.data };
    },
  });
}
