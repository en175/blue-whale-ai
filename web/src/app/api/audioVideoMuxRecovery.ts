import { queryOptions } from '@tanstack/react-query';
import { fetchJobs, type JobRecord } from './jobs';

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
