import { queryOptions } from '@tanstack/react-query';
import { fetchJobs, type JobRecord } from './jobs';

/** 音视频合成画布恢复按项目与类型逐页读取（同 audioMixJobsOptions 先例），
 *  避免遗漏首 100 条之后尚未落盘的任务；冻结快照随 input 返回（服务端只剥离凭据）。 */
export function audioVideoMuxJobsOptions(projectId: string) {
  return queryOptions({
    queryKey: ['jobs', 'audio_video_mux', projectId] as const,
    queryFn: async (): Promise<JobRecord[]> => {
      const records: JobRecord[] = [];
      for (let page = 1; ; page += 1) {
        const result = await fetchJobs({ projectId, type: 'audio_video_mux', size: 100, page }, { silent: true });
        records.push(...result.records);
        if (result.records.length === 0 || records.length >= result.total) return records;
      }
    },
    staleTime: 0,
  });
}
