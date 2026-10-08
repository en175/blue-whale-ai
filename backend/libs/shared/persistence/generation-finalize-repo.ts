import { assertPureJobInput } from "./job-input-purity.js";
import { withBillingCompensation, type JobBilling } from "./job-billing.js";
import {
  SOURCE_BOTTOM_DOCK,
  VIDEO_STRATEGY_VERSION,
  type CreatedJob,
} from "./generation-command-repo.js";
import {
  FINALIZE_GENERATION_JOB_OPERATION,
  readCreateIdempotency,
  runWithCreateIdempotency,
  writeCreateIdempotency,
  type CreateJobIdempotency,
  type CreateJobResult,
} from "./generation-job-idempotency.js";
import { appendProjectEvent } from "./product-event-repo.js";
import {
  extraNumber,
  extraString,
  loadJobExtrasOne,
  setJobExtras,
} from "./generation-jobs-extra-repo.js";
import type { PrismaClient } from "@prisma/client";


export interface FinalizeSourceJob {
  id: string;
  project_id: string;
  user_id: string;
  status: string;
  type: string;
  video_stage: string | null;
  final_job_id: string | null;
  final_job_status: string | null;
  finalize_deadline_ms: bigint | null;
  output_asset_ids: PrismaJsonArray | null;
  input: Record<string, unknown>;
}

export type PrismaJsonArray = unknown[] | { toJSON?: () => unknown };

export interface CreateFinalizeJobInput {
  projectId: string;
  userId: string;
  sourceSampleJobId: string;
  input: Record<string, unknown>;
  actionIdentity: string;
  actionType: string;
}

export type FinalizeJobResult =
  | CreatedJob
  | { kind: "finalize_already_attempted" }
  | Extract<CreateJobResult, { kind: "idempotency_conflict" }>;

export async function findFinalizeSourceJob(
  prisma: PrismaClient,
  args: { projectId: string; userId: string; jobId: string },
): Promise<FinalizeSourceJob | null> {
  const row = await prisma.generation_jobs.findFirst({
    where: {
      id: BigInt(args.jobId),
      project_id: BigInt(args.projectId),
      user_id: BigInt(args.userId),
      is_delete: false,
    },
    select: {
      id: true,
      project_id: true,
      user_id: true,
      status: true,
      type: true,
      output_asset_ids: true,
      input: true,
    },
  });
  if (!row) return null;
  const extras = await loadJobExtrasOne(prisma, row.id.toString());
  const finalJobId = extraNumber(extras, "final_job_id");
  let finalJobStatus: string | null = null;
  if (finalJobId != null) {
    const finalRow = await prisma.generation_jobs.findUnique({
      where: { id: BigInt(finalJobId) },
      select: { status: true },
    });
    finalJobStatus = finalRow?.status ?? null;
  }
  const deadlineMs = extraNumber(extras, "finalize_deadline_ms");
  return {
    id: row.id.toString(),
    project_id: row.project_id?.toString() ?? "0",
    user_id: row.user_id.toString(),
    status: row.status,
    type: row.type,
    video_stage: extraString(extras, "video_stage"),
    final_job_id: finalJobId != null ? String(finalJobId) : null,
    final_job_status: finalJobStatus,
    finalize_deadline_ms: deadlineMs != null ? BigInt(deadlineMs) : null,
    output_asset_ids: (row.output_asset_ids ?? null) as PrismaJsonArray | null,
    input: (row.input ?? {}) as Record<string, unknown>,
  };
}

function isSourceUniqueViolation(error: unknown): boolean {
  if ((error as { code?: string } | null)?.code !== "P2002") return false;
  const target = (error as { meta?: { target?: unknown } }).meta?.target;
  if (!Array.isArray(target)) return true;
  return target.map(String).includes("source_sample_job_id");
}

export async function createFinalizeJob(
  prisma: PrismaClient,
  input: CreateFinalizeJobInput,
  options?: { billing?: JobBilling; idempotency?: CreateJobIdempotency },
): Promise<FinalizeJobResult> {
  try {
    return await runWithCreateIdempotency(
      prisma,
      input.projectId,
      options?.idempotency,
      () =>
        withBillingCompensation(options?.billing, (billing) =>
          prisma.$transaction(
            (tx) => createFinalizeJobWithinTx(tx, input, billing, options?.idempotency),
            { maxWait: 10_000, timeout: 30_000 },
          ),
        ),
      FINALIZE_GENERATION_JOB_OPERATION,
    );
  } catch (error) {
    if (isSourceUniqueViolation(error)) {
      return { kind: "finalize_already_attempted" };
    }
    throw error;
  }
}

async function createFinalizeJobWithinTx(
  tx: Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0],
  input: CreateFinalizeJobInput,
  billing: JobBilling | undefined,
  idempotency: CreateJobIdempotency | undefined,
): Promise<CreatedJob> {
  assertPureJobInput({ input: input.input });
  const now = new Date();
  const deadline = new Date(now.getTime() + 30 * 60 * 1000);
  const job = await tx.generation_jobs.create({
    data: {
      project_id: BigInt(input.projectId),
      user_id: BigInt(input.userId),
      type: "video",
      source: SOURCE_BOTTOM_DOCK,
      status: "queued",
      progress: 0,
      input: input.input as never,
      execution_deadline_at: deadline,
      next_action_at: now,
      fencing_token: 0,
      source_sample_job_id: BigInt(input.sourceSampleJobId),
    },
  });
  await setJobExtras(tx, job.id, {
    strategy_version: VIDEO_STRATEGY_VERSION,
    video_stage: "final",
    charge_state: "held",
  });
  if (billing) {
    await billing.hold(Number(job.id));
  }
  await tx.generation_output_slots.create({
    data: {
      project_id: BigInt(input.projectId),
      generation_job_id: job.id,
      slot_index: 0,
      status: "pending",
    },
  });
  await tx.cost_reservations.create({
    data: {
      generation_job_id: job.id,
      user_id: BigInt(input.userId),
      project_id: BigInt(input.projectId),
      action_identity: input.actionIdentity,
      action_type: input.actionType,
      provider: "volc",
      reserved_amount_fen: 0n,
      status: "reserved",
      price_catalog_version: "dev",
      exchange_rate_version: "dev",
      model_policy_version: "dev",
      cost_rule_version: "dev",
    },
  });
  const sampleExtras = await loadJobExtrasOne(tx, input.sourceSampleJobId);
  if (extraNumber(sampleExtras, "final_job_id") == null) {
    await setJobExtras(tx, BigInt(input.sourceSampleJobId), { final_job_id: Number(job.id) });
  }
  await tx.generation_job_logs.create({
    data: {
      generation_job_id: job.id,
      event: "finalize_created",
      status: "queued",
      message: `成片任务已创建（来源样片 ${input.sourceSampleJobId}）`,
      payload: {
        source_sample_job_id: input.sourceSampleJobId,
        input: input.input,
      } as never,
    },
  });
  const event = await appendProjectEvent(tx, {
    projectId: input.projectId,
    eventType: "generation_job.created",
    aggregateType: "generation_job",
    aggregateId: job.id.toString(),
    aggregateVersion: job.version,
    correlationId: input.actionIdentity,
    payload: {
      job_id: job.id.toString(),
      type: job.type,
      source: job.source,
      status: job.status,
      progress: job.progress,
      output_asset_ids: [],
      video_stage: "final",
      source_sample_job_id: input.sourceSampleJobId,
    },
  });
  await writeCreateIdempotency(
    tx,
    { projectId: input.projectId, jobId: job.id, acceptedCursor: event.cursor },
    idempotency,
    FINALIZE_GENERATION_JOB_OPERATION,
  );
  return { generation_job_id: job.id.toString(), cursor: Number(event.cursor) };
}

export interface FinalizeCommandRepo {
  findFinalizeSourceJob(args: {
    projectId: string;
    userId: string;
    jobId: string;
  }): Promise<FinalizeSourceJob | null>;
  createFinalizeJob(
    input: CreateFinalizeJobInput,
    options?: { billing?: JobBilling; idempotency?: CreateJobIdempotency },
  ): Promise<FinalizeJobResult>;
  lookupFinalizeIdempotency(
    projectId: string,
    idempotency: CreateJobIdempotency,
  ): Promise<CreateJobResult | null>;
}

export function createFinalizeCommandRepo(prisma: PrismaClient): FinalizeCommandRepo {
  return {
    findFinalizeSourceJob: (args) => findFinalizeSourceJob(prisma, args),
    createFinalizeJob: (input, options) => createFinalizeJob(prisma, input, options),
    lookupFinalizeIdempotency: (projectId, idempotency) =>
      readCreateIdempotency(prisma, projectId, idempotency, FINALIZE_GENERATION_JOB_OPERATION),
  };
}
