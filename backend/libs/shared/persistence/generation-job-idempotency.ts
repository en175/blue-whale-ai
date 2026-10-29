import type { Prisma, PrismaClient } from "@prisma/client";

import type { CreatedJob } from "./generation-command-repo.js";

export const CREATE_GENERATION_JOB_OPERATION = "generation.create";

export const FINALIZE_GENERATION_JOB_OPERATION = "generation.finalize";

export interface CreateJobIdempotency {
  key: string;
  requestHash: string;
}

export type CreateJobResult = CreatedJob | { kind: "idempotency_conflict" };

interface CreateIdempotencyWrite {
  projectId: string;
  jobId: bigint;
  acceptedCursor: string;
}

export async function writeCreateIdempotency(
  tx: Prisma.TransactionClient,
  write: CreateIdempotencyWrite,
  idempotency: CreateJobIdempotency | undefined,
  operation: string = CREATE_GENERATION_JOB_OPERATION,
): Promise<void> {
  if (!idempotency) return;
  await tx.project_command_receipts.create({
    data: {
      project_id: BigInt(write.projectId),
      operation,
      idempotency_key: idempotency.key,
      request_hash: idempotency.requestHash,
      generation_job_id: write.jobId,
      accepted_cursor: BigInt(write.acceptedCursor),
    },
  });
}

export async function readCreateIdempotency(
  prisma: PrismaClient,
  projectId: string,
  idempotency: CreateJobIdempotency,
  operation: string = CREATE_GENERATION_JOB_OPERATION,
): Promise<CreateJobResult | null> {
  const row = await prisma.project_command_receipts.findUnique({
    where: {
      project_id_operation_idempotency_key: {
        project_id: BigInt(projectId),
        operation,
        idempotency_key: idempotency.key,
      },
    },
    select: {
      request_hash: true,
      generation_job_id: true,
      accepted_cursor: true,
    },
  });
  if (!row) return null;
  if (row.request_hash !== idempotency.requestHash) {
    return { kind: "idempotency_conflict" };
  }
  if (row.generation_job_id === null) {
    throw new Error(
      `幂等行缺少 generation_job_id：project=${projectId} operation=${operation}`,
    );
  }
  return {
    generation_job_id: row.generation_job_id.toString(),
    cursor: Number(row.accepted_cursor),
  };
}

export async function runWithCreateIdempotency(
  prisma: PrismaClient,
  projectId: string,
  idempotency: CreateJobIdempotency | undefined,
  run: () => Promise<CreateJobResult>,
  operation: string = CREATE_GENERATION_JOB_OPERATION,
): Promise<CreateJobResult> {
  if (!idempotency) return run();
  const replayed = await readCreateIdempotency(prisma, projectId, idempotency, operation);
  if (replayed) return replayed;
  try {
    return await run();
  } catch (error) {
    const winner = await readCreateIdempotency(prisma, projectId, idempotency, operation);
    if (winner) return winner;
    throw error;
  }
}
