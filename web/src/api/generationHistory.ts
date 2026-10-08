import { queryOptions } from '@tanstack/react-query';
import { fetchProjects } from './projects';
import { fetchJobs, type JobRecord } from './jobs';

export interface HistoryJobEntry {
  job: JobRecord;
  projectId: string;
  projectName: string;
}

export const HISTORY_JOBS_PER_PROJECT = 100;

export function mergeProjectJobs(
  groups: Array<{ projectId: string; projectName: string; records: JobRecord[] }>,
): HistoryJobEntry[] {
  return groups
    .flatMap((group) =>
      group.records.map((job) => ({
        job,
        projectId: group.projectId,
        projectName: group.projectName,
      })),
    )
    .sort((a, b) => {
      const byTime = Date.parse(b.job.created_at || '') - Date.parse(a.job.created_at || '');
      if (byTime !== 0) return byTime;
      return Number(b.job.job_id) - Number(a.job.job_id);
    });
}

export async function fetchVideoHistory(): Promise<HistoryJobEntry[]> {
  const projects = await fetchProjects();
  const settled = await Promise.allSettled(
    projects.map(async (project) => ({
      projectId: String(project.id),
      projectName: project.name,
      records: (
        await fetchJobs(
          { projectId: String(project.id), type: 'video', size: HISTORY_JOBS_PER_PROJECT },
          { silent: true },
        )
      ).records,
    })),
  );
  return mergeProjectJobs(
    settled.flatMap((result) => (result.status === 'fulfilled' ? [result.value] : [])),
  );
}

export const generationHistoryKeys = {
  all: ['generation-history'] as const,
  video: () => [...generationHistoryKeys.all, 'video'] as const,
};

export function videoHistoryOptions() {
  return queryOptions({
    queryKey: generationHistoryKeys.video(),
    queryFn: () => fetchVideoHistory(),
  });
}
