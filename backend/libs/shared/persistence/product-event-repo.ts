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

// cursor 改用雪花 ID：客户端生成（时间戳+机器号+序号），不再走 project_event_stream.high_watermark 自增。
// 原实现 `UPDATE high_watermark = high_watermark + 1` 对同一项目的同一行加 X 锁、持有到事务 commit，
// 把同项目的并发 append（含 createJob）串成一条队、攥着连接等，连接池被打满（P2028）+ 偶发撞号（P2002）。
// 雪花在内存里生成、不碰共享行 → 无锁、不串行、全局唯一。
// 结构：[41 位 ms 时间戳, 相对 EPOCH] [10 位机器号] [12 位序号] = 63 位，BigInt 放得下、单调递增。
// 多进程/多容器部署须给每个分一个唯一 MACHINE_ID（env），默认 1。
const SNOWFLAKE_EPOCH = 1_704_067_200_000n; // 2024-01-01 UTC，固定起点压低数值
const MACHINE_ID =
  (process.env.MACHINE_ID ? BigInt(process.env.MACHINE_ID) : 1n) & 0x3ffn;
let __sfLastTs = 0n;
let __sfSeq = 0n;
function snowflake(): bigint {
  const now = BigInt(Date.now()) - SNOWFLAKE_EPOCH;
  if (now === __sfLastTs) {
    __sfSeq = (__sfSeq + 1n) & 0xfffn; // 同 ms 内 0..4095
  } else {
    __sfSeq = 0n;
    __sfLastTs = now;
  }
  return (now << 22n) | (MACHINE_ID << 12n) | __sfSeq;
}

/** Append inside the caller's transaction so the product fact and event commit atomically. */
export async function appendProjectEvent(
  tx: ProjectEventTransaction,
  input: AppendProjectEventInput,
): Promise<ProductEventView> {
  const projectId = BigInt(input.projectId);
  // cursor 用雪花 ID，不再 upsert + increment project_event_stream（去掉那把 per-project 行锁）。
  const cursor = snowflake();
  const eventId = `evt_${randomUUID().replaceAll("-", "")}`;
  const row = await tx.project_events.create({
    data: {
      project_id: projectId,
      cursor,
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
      // cursor 改雪花后 stream.high_watermark 不再维护；当前水位 = project_events 最大 cursor。
      const row = await prisma.project_events.aggregate({
        where: { project_id: BigInt(projectId), is_delete: 0 },
        _max: { cursor: true },
      });
      return (row?._max?.cursor ?? 0n).toString();
    },
  };
}
