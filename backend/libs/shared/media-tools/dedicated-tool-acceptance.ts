import type { Prisma, PrismaClient } from "@prisma/client";
import { DomainError } from "@lib/contracts";
import type { CanvasBinding } from "@lib/contracts";
import {
  lockCanvasRecoveryForAcceptance,
  writeCanvasRecoveryRows,
} from "@lib/shared/persistence/index.js";
import {
  jobExistenceProbe,
  withBillingCompensation,
  type JobBilling,
} from "@lib/shared/persistence/job-billing.js";

const TX_OPTIONS = { maxWait: 10_000, timeout: 30_000 } as const;

export class DedicatedToolConflictError extends Error {
  constructor() {
    super("idempotency conflict");
  }
}

export interface DedicatedToolAcceptance {
  prisma: PrismaClient;
  jobBilling: JobBilling | undefined;
  userId: string;
  projectId: string;
  toolType: string;
  operation: string;
  requestHash: string;
  idempotencyKey: string;
  canvasBinding: CanvasBinding | null;
  conflictMessage: string;
  onConflict?: () => never;
  createData: Prisma.generation_jobsUncheckedCreateInput;
}

export interface DedicatedToolAcceptanceResult {
  replayed: boolean;
  jobId: string | null;
  bindingRevision: number | null;
}

export async function acceptDedicatedToolJob(
  args: DedicatedToolAcceptance,
): Promise<DedicatedToolAcceptanceResult> {
  return withBillingCompensation(
    args.jobBilling,
    (billing) =>
      args.prisma.$transaction(
        async (tx) => {
          let plan = null;
          if (args.canvasBinding) {
            const locked = await lockCanvasRecoveryForAcceptance(tx, {
              projectId: args.projectId,
              userId: args.userId,
              binding: args.canvasBinding,
              operation: args.operation,
              requestHash: args.requestHash,
              idempotencyKey: args.idempotencyKey,
              taskType: args.toolType,
            });
            if (locked.kind === "replay") {
              return {
                replayed: true,
                jobId: locked.result.generation_job_id,
                bindingRevision: null,
              };
            }
            if (locked.kind === "idempotency_conflict") {
              if (args.onConflict) args.onConflict();
              throw new DomainError(409, args.conflictMessage);
            }
            plan = locked.plan;
          }
          const created = await tx.generation_jobs.create({
            data: args.createData,
          });
          await billing?.charge(Number(created.id));
          await tx.project_command_receipts.create({
            data: {
              project_id: BigInt(args.projectId),
              operation: args.operation,
              idempotency_key: args.idempotencyKey,
              request_hash: args.requestHash,
              generation_job_id: created.id,
              accepted_cursor: 0n,
            },
          });
          if (plan) await writeCanvasRecoveryRows(tx, plan, created.id);
          return {
            replayed: false,
            jobId: created.id.toString(),
            bindingRevision: plan?.bindingRevision ?? null,
          };
        },
        TX_OPTIONS,
      ),
    jobExistenceProbe(args.prisma),
  );
}

export async function acceptDedicatedToolJobWithoutKey(args: {
  prisma: PrismaClient;
  jobBilling: JobBilling | undefined;
  createData: Prisma.generation_jobsUncheckedCreateInput;
}): Promise<{ id: bigint }> {
  return withBillingCompensation(
    args.jobBilling,
    (billing) =>
      args.prisma.$transaction(
        async (tx) => {
          const created = await tx.generation_jobs.create({
            data: args.createData,
          });
          await billing?.charge(Number(created.id));
          return { id: created.id };
        },
        TX_OPTIONS,
      ),
    jobExistenceProbe(args.prisma),
  );
}
