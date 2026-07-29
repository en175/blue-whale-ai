import type { Prisma, PrismaClient } from "@prisma/client";
import { randomUUID } from "node:crypto";

export interface AppendProjectEventInput {
  projectId: string;
  eventType: string;
  aggregateType: string;
  aggregateId: string;
  aggregateVersion: number;
  correlationId?: string | null;
  causationId?: string | null;
  payload: Prisma.InputJsonValue;
}

export interface ProductEventView {
  event_id: string;
  event_type: string;
  cursor: string;
  project_id: string;
  aggregate_type: string;
  aggregate_id: string;
  aggregate_version: number;
  correlation_id: string | null;
  causation_id: string | null;
  occurred_at: string;
  payload: Prisma.JsonValue | null;
}

interface ProjectEventTransaction {
  project_event_stream: {
    upsert(args: unknown): Promise<unknown>;
    update(args: unknown): Promise<{ high_watermark: bigint }>;
  };
  project_events: {
    create(args: unknown): Promise<ProjectEventRow>;
  };
}

interface ProjectEventRow {
  event_id: string;
  event_type: string;
  cursor: bigint;
  project_id: bigint;
  aggregate_type: string;
  aggregate_id: string;
  aggregate_version: number;
  correlation_id: string | null;
  causation_id: string | null;
  occurred_at: Date;
  payload: Prisma.JsonValue | null;
}

function toView(row: ProjectEventRow): ProductEventView {
  return {
    event_id: row.event_id,
    event_type: row.event_type,
    cursor: row.cursor.toString(),
    project_id: row.project_id.toString(),
    aggregate_type: row.aggregate_type,
    aggregate_id: row.aggregate_id,
    aggregate_version: row.aggregate_version,
    correlation_id: row.correlation_id,
    causation_id: row.causation_id,
    occurred_at: row.occurred_at.toISOString(),
    payload: row.payload,
  };
}

/** Append inside the caller's transaction so the product fact and event commit atomically. */
export async function appendProjectEvent(
  tx: ProjectEventTransaction,
  input: AppendProjectEventInput,
): Promise<ProductEventView> {
  const projectId = BigInt(input.projectId);
  await tx.project_event_stream.upsert({
    where: { project_id: projectId },
    create: { project_id: projectId, high_watermark: 0n },
    update: {},
  });
  const stream = await tx.project_event_stream.update({
    where: { project_id: projectId },
    data: { high_watermark: { increment: 1n } },
    select: { high_watermark: true },
  });
  const eventId = `evt_${randomUUID().replaceAll("-", "")}`;
  const row = await tx.project_events.create({
    data: {
      project_id: projectId,
      cursor: stream.high_watermark,
      event_id: eventId,
      event_type: input.eventType,
      aggregate_type: input.aggregateType,
      aggregate_id: input.aggregateId,
      aggregate_version: input.aggregateVersion,
      correlation_id: input.correlationId ?? null,
      causation_id: input.causationId ?? null,
      occurred_at: new Date(),
      payload: input.payload,
    },
  });
  return toView(row);
}

export interface ProductEventRepo {
  listAfter(
    projectId: string,
    after: string,
    limit: number,
  ): Promise<ProductEventView[]>;
  highWatermark(projectId: string): Promise<string>;
}

export function createProductEventRepo(prisma: PrismaClient): ProductEventRepo {
  return {
    async listAfter(projectId, after, limit) {
      const rows = await prisma.project_events.findMany({
        where: {
          project_id: BigInt(projectId),
          cursor: { gt: BigInt(after) },
          is_delete: 0,
        },
        orderBy: { cursor: "asc" },
        take: limit,
      });
      return rows.map(toView);
    },
    async highWatermark(projectId) {
      const stream = await prisma.project_event_stream.findUnique({
        where: { project_id: BigInt(projectId) },
        select: { high_watermark: true },
      });
      return (stream?.high_watermark ?? 0n).toString();
    },
  };
}
