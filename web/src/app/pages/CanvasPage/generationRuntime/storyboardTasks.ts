import {
  finalizeVideoJob, regenerateSampleJob,
} from '@/api/jobs';
import type { CreateJobOutcome, GenerationTaskDefinition, TaskSubmissionInput } from './types';

export interface StoryboardPayload {
  kind: 'finalize' | 'regenerate-sample';
  sampleJobId: string;
  expectedCredits: number;
  quoteRevision: string;
  onAccepted?: (jobId: string) => void;
}

export type StoryboardTaskDefinition = GenerationTaskDefinition<StoryboardPayload>;

export const storyboardTask: StoryboardTaskDefinition = {
  taskTypes: [],

  identify: () => false,


  async create(projectId, input: TaskSubmissionInput<StoryboardPayload>, binding, key): Promise<CreateJobOutcome> {
    const payload = input.payload;
    const confirmed = { expected_credits: payload.expectedCredits, quote_revision: payload.quoteRevision };
    if (payload.kind === 'finalize') {
      const created = await finalizeVideoJob(projectId, payload.sampleJobId, confirmed, key, { silent: true });
      const outcome: CreateJobOutcome = { jobId: created.generation_job_id, cursor: created.cursor, canvasBinding: null };
      payload.onAccepted?.(outcome.jobId);
      return outcome;
    }
    const created = await regenerateSampleJob(
      projectId,
      payload.sampleJobId,
      binding ? { ...confirmed, canvas_binding: binding } : confirmed,
      key,
      { silent: true },
    );
    const outcome: CreateJobOutcome = {
      jobId: created.generation_job_id,
      cursor: created.cursor,
      canvasBinding: (created as { canvas_binding?: CreateJobOutcome['canvasBinding'] }).canvas_binding ?? null,
    };
    payload.onAccepted?.(outcome.jobId);
    return outcome;
  },
};
