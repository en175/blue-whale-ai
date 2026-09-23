import { queryOptions } from '@tanstack/react-query';
import { fetchJobs, type JobRecord } from './jobs';

/** 画布恢复按项目与类型逐页读取，避免遗漏首 100 条之后尚未落盘的任务。 */
export function audioMixJobsOptions(projectId: string) {
  return queryOptions({
    queryKey: ['jobs', 'audio_mix', projectId] as const,
    queryFn: async (): Promise<JobRecord[]> => {
      const records: JobRecord[] = [];
      for (let page = 1; ; page += 1) {
        const result = await fetchJobs({ projectId, type: 'audio_mix', size: 100, page }, { silent: true });
        records.push(...result.records);
        if (result.records.length === 0 || records.length >= result.total) return records;
      }
    },
    staleTime: 0,
  });
}
