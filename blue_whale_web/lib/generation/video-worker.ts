import type { VideoQueueProducer } from "./video-queue.js";

type BullJob = { data: { jobId: string } };

export type DueVideoJobRepo = {
  listDueVideoJobIds(limit: number): Promise<string[]>;
};

export function createVideoJobProcessor(deps: {
  runStep: (jobId: string) => Promise<string | null>;
}): (job: BullJob) => Promise<string | null> {
  return (job) => deps.runStep(job.data.jobId);
}

export async function recoverDueVideoJobs(
  repo: DueVideoJobRepo,
  producer: VideoQueueProducer,
  limit = 100,
): Promise<number> {
  const jobIds = await repo.listDueVideoJobIds(limit);
  for (const jobId of jobIds) await producer.enqueue(jobId);
  return jobIds.length;
}
