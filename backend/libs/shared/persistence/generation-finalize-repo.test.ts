import { describe, expect, it, vi } from "vitest";

import { createFinalizeCommandRepo, createFinalizeJob } from "./generation-finalize-repo.js";


const SAMPLE_JOB_ID = "302";

function extraRow(jobId: bigint, extra_key: string, value_type: string, value_text: string) {
  return { generation_job_id: jobId, extra_key, value_type, value_text };
}

function extrasDelegate(rows: ReturnType<typeof extraRow>[] = []) {
  return {
    upsert: vi.fn().mockResolvedValue({}),
    findMany: vi.fn().mockResolvedValue(rows),
    deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
  };
}

function expectExtraWrite(
  upsert: ReturnType<typeof vi.fn>,
  jobId: bigint,
  extra_key: string,
  value_type: string,
  value_text: string,
): void {
  expect(upsert).toHaveBeenCalledWith({
    where: { generation_job_id_extra_key: { generation_job_id: jobId, extra_key } },
    create: { generation_job_id: jobId, extra_key, value_type, value_text },
    update: { value_type, value_text, gmt_modified: expect.any(Date) },
  });
}

function jobRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 302n,
    project_id: 1n,
    user_id: 42n,
    status: "succeeded",
    type: "video",
    output_asset_ids: [901n],
    input: { model_id: "doubao-seedance-2-5-260628", prompt: "一只猫在跑步" },
    ...overrides,
  };
}

function buildPrisma(
  row: ReturnType<typeof jobRow> | null,
  extrasRows: ReturnType<typeof extraRow>[] = [],
) {
  const create = vi.fn().mockResolvedValue({ id: 305n, version: 0 });
  const idemCreate = vi.fn().mockResolvedValue({});
  const extras = extrasDelegate(extrasRows);
  const tx = {
    generation_jobs: { create },
    generation_job_extras: extras,
    generation_output_slots: { create: vi.fn().mockResolvedValue({}) },
    cost_reservations: { create: vi.fn().mockResolvedValue({}) },
    generation_job_logs: { create: vi.fn().mockResolvedValue({}) },
    project_events: {
      create: vi.fn().mockResolvedValue({
        event_id: "e1",
        event_type: "generation_job.created",
        cursor: 7n,
        project_id: 1n,
        aggregate_type: "generation_job",
        aggregate_id: "305",
        aggregate_version: 0,
        correlation_id: null,
        causation_id: null,
        occurred_at: new Date(0),
        payload: null,
      }),
    },
    command_idempotency: { create: idemCreate },
  };
  const findFirst = vi.fn().mockResolvedValue(row);
  const idemFindUnique = vi.fn().mockResolvedValue(null);
  const prisma = {
    generation_jobs: { findFirst },
    generation_job_extras: extras,
    command_idempotency: { findUnique: idemFindUnique, create: vi.fn() },
    $transaction: vi.fn(async (fn: (t: unknown) => Promise<unknown>) => fn(tx)),
  } as never;
  return { prisma, tx, create, findFirst, idemCreate, idemFindUnique, extras };
}

const INPUT = {
  projectId: "1",
  userId: "42",
  sourceSampleJobId: SAMPLE_JOB_ID,
  input: { model_id: "doubao-seedance-2-5-260628", prompt: "一只猫在跑步", resolution: "1080p" },
  actionIdentity: "a".repeat(64),
  actionType: "generate_video",
};

describe("createFinalizeJob（IKIZQC）", () => {
  it("★ 成片行落库：video_stage='final' + source_sample_job_id + charge_state='charged'，并回写样片 final_job_id", async () => {
    const { prisma, tx, create, extras } = buildPrisma(jobRow());
    const charge = vi.fn().mockResolvedValue(undefined);

    const result = await createFinalizeJob(prisma, INPUT, { billing: { charge, release: vi.fn() } });

    expect(result).toEqual({ generation_job_id: "305", cursor: 7 });
    expect(create.mock.calls[0]![0].data).toMatchObject({
      type: "video",
      status: "queued",
      source_sample_job_id: 302n,
    });
    expectExtraWrite(extras.upsert, 305n, "video_stage", "string", "final");
    expectExtraWrite(extras.upsert, 305n, "charge_state", "string", "charged");
    expectExtraWrite(extras.upsert, 305n, "strategy_version", "string", "seedance-2.0-v1");
    expect(extras.findMany).toHaveBeenCalledWith({
      where: { generation_job_id: 302n },
      select: { extra_key: true, value_type: true, value_text: true },
    });
    expectExtraWrite(extras.upsert, 302n, "final_job_id", "number", "305");
    expect(charge).toHaveBeenCalledTimes(1);
    expect(charge).toHaveBeenCalledWith(305);
    expect(tx.generation_job_logs.create).toHaveBeenCalled();
    expect(tx.cost_reservations.create).toHaveBeenCalled();
  });

  it("★ 样片扩展位已有 final_job_id → 回写守卫不覆盖（并发由来源唯一索引裁决，这条是防御性幂等）", async () => {
    const { prisma, create, extras } = buildPrisma(jobRow(), [
      extraRow(302n, "final_job_id", "number", "999"),
    ]);

    await createFinalizeJob(prisma, INPUT, {});

    expect(create).toHaveBeenCalledOnce();
    expect(extras.upsert).toHaveBeenCalledTimes(3);
    expect(extras.upsert).not.toHaveBeenCalledWith(
      expect.objectContaining({
        where: { generation_job_id_extra_key: { generation_job_id: 302n, extra_key: "final_job_id" } },
      }),
    );
  });

  it("★ G05: 来源唯一约束冲突（P2002 target=source_sample_job_id）→ finalize_already_attempted，未预扣", async () => {
    const { prisma, create, findFirst } = buildPrisma(jobRow());
    create.mockRejectedValue(
      Object.assign(new Error("Unique constraint failed"), {
        code: "P2002",
        meta: { target: ["source_sample_job_id"] },
      }),
    );
    const charge = vi.fn();

    const result = await createFinalizeJob(prisma, INPUT, { billing: { charge, release: vi.fn() } });

    expect(result).toEqual({ kind: "finalize_already_attempted" });
    expect(charge).not.toHaveBeenCalled();
    expect(findFirst).not.toHaveBeenCalled();
  });

  it("★ 幂等分域：command_idempotency 行以 operation=generation.finalize 写入（与建任务互不重放）", async () => {
    const { prisma, idemCreate } = buildPrisma(jobRow());

    await createFinalizeJob(
      prisma,
      INPUT,
      { idempotency: { key: "k1", requestHash: "r".repeat(64) } },
    );

    expect(idemCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        operation: "generation.finalize",
        idempotency_key: "k1",
        request_hash: "r".repeat(64),
        generation_job_id: 305n,
      }),
    });
  });

  it("★ 同键重放：幂等读命中（operation=generation.finalize）→ 直接重放首次结果，不再建行/预扣", async () => {
    const { prisma, idemFindUnique, create } = buildPrisma(jobRow());
    idemFindUnique.mockResolvedValue({
      request_hash: "r".repeat(64),
      generation_job_id: 305n,
      accepted_cursor: 7n,
    });

    const result = await createFinalizeJob(
      prisma,
      INPUT,
      { idempotency: { key: "k1", requestHash: "r".repeat(64) } },
    );

    expect(result).toEqual({ generation_job_id: "305", cursor: 7 });
    expect(create).not.toHaveBeenCalled();
    expect(idemFindUnique.mock.calls[0]![0].where.project_id_operation_idempotency_key).toMatchObject({
      operation: "generation.finalize",
    });
  });

  it("样片读取投影：findFinalizeSourceJob 归属（本人+本项目+未删）过滤并字符串化 ID", async () => {
    const { prisma, findFirst } = buildPrisma(jobRow(), [
      extraRow(302n, "video_stage", "string", "sample"),
    ]);

    const repo = createFinalizeCommandRepo(prisma);
    const sample = await repo.findFinalizeSourceJob({ projectId: "1", userId: "42", jobId: "302" });

    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: 302n,
          project_id: 1n,
          user_id: 42n,
          is_delete: false,
        },
      }),
    );
    expect(sample).toMatchObject({
      id: "302",
      project_id: "1",
      user_id: "42",
      status: "succeeded",
      video_stage: "sample",
      final_job_id: null,
      output_asset_ids: [901n],
    });
  });

  it("★ IKIZQD: 已有成片尝试 → 附带取该成片任务当前状态（checking 判 1014 的数据源）", async () => {
    const findUnique = vi.fn().mockResolvedValue({ status: "checking" });
    const prisma = {
      generation_jobs: {
        findFirst: vi.fn().mockResolvedValue(jobRow()),
        findUnique,
      },
      generation_job_extras: extrasDelegate([extraRow(302n, "final_job_id", "number", "305")]),
    } as never;

    const repo = createFinalizeCommandRepo(prisma);
    const sample = await repo.findFinalizeSourceJob({ projectId: "1", userId: "42", jobId: "302" });

    expect(findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 305n }, select: { status: true } }),
    );
    expect(sample).toMatchObject({ final_job_id: "305", final_job_status: "checking" });
  });

  it("IKIZQD: 成片行已删/不存在 → final_job_status 为 null（回落 already_attempted 语义）", async () => {
    const prisma = {
      generation_jobs: {
        findFirst: vi.fn().mockResolvedValue(jobRow()),
        findUnique: vi.fn().mockResolvedValue(null),
      },
      generation_job_extras: extrasDelegate([extraRow(302n, "final_job_id", "number", "305")]),
    } as never;

    const repo = createFinalizeCommandRepo(prisma);
    const sample = await repo.findFinalizeSourceJob({ projectId: "1", userId: "42", jobId: "302" });

    expect(sample).toMatchObject({ final_job_id: "305", final_job_status: null });
  });
});
