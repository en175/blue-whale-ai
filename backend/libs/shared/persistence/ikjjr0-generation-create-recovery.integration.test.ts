import { clearEffectiveRecoveryOwners, countEffectiveRecoveryOwners, findEffectiveRecoveryOwner } from "./recovery-owner-test-helpers.js";

import { PrismaMariaDb } from "@prisma/adapter-mariadb";
import type { Pool } from "mariadb";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildPoolConfig, getPrismaClient } from "./db.js";
import {
  RECOVERY_REASONS,
  type CanvasBinding,
} from "@lib/contracts";
import {
  RecoveryContractError,
  listCanvasRecoveryPage,
  type CanvasRecoveryAcceptance,
} from "./generation-canvas-recovery-repo.js";
import { createGenerationCommandRepo } from "./generation-command-repo.js";
import type { PrismaClient } from "@prisma/client";

const databaseUrl = process.env.IKJJR0_DATABASE_URL;

describe.skipIf(!databaseUrl)("成片恢复契约（generation.create 视频样片）真库验证（IKJJR0）", () => {
  let prisma: PrismaClient;
  let raw: Pool;

  const PROJECT_ID = "920001";
  const USER_ID = "920009";

  function binding(submissionId: string, node: string, revision = 0, role: CanvasBinding["recovery_seed"]["target"]["role"] = "result-placeholder"): CanvasBinding {
    return {
      protocol_version: 1,
      submission_id: submissionId,
      target_node_id: node,
      expected_binding_revision: revision,
      recovery_seed: {
        target: { role, x: 10, y: 20, width: 300, height: 200, name: "分镜卡" },
        sources: [],
      },
    };
  }

  function regenerateAcceptance(submissionId: string, node: string, revision = 0): CanvasRecoveryAcceptance {
    return {
      projectId: PROJECT_ID,
      userId: USER_ID,
      binding: binding(submissionId, node, revision),
      operation: "generation.create",
      requestHash: `rehash-${submissionId}`,
      idempotencyKey: submissionId,
      taskType: "video",
    };
  }

  async function regenerateCreate(
    acceptance: CanvasRecoveryAcceptance,
    billing: { charge: (jobId: number) => Promise<void>; release: (jobId: number, reason: string) => Promise<void> },
  ) {
    const repo = createGenerationCommandRepo(prisma);
    return repo.createJob(
      {
        projectId: acceptance.projectId,
        userId: acceptance.userId,
        type: "video",
        expectedOutputCount: 1,
        input: { prompt: "人物走过街角", model_id: "doubao-seedance-2-5-260628", resolution: "480p", sample_mode: true },
        actionIdentity: `ikjjr0-${acceptance.binding.submission_id.slice(0, 24)}`,
        actionType: "generate_video",
        videoStage: "sample",
        canvasRecovery: acceptance,
      },
      { billing, idempotency: { key: acceptance.idempotencyKey, requestHash: acceptance.requestHash } },
    );
  }

  beforeAll(async () => {
    prisma = getPrismaClient(databaseUrl!);
    const adapter = await new PrismaMariaDb(buildPoolConfig(databaseUrl!)).connect();
    raw = adapter.underlyingDriver();

    await prisma.project.deleteMany({ where: { id: BigInt(PROJECT_ID) } });
    await prisma.project.create({ data: { id: BigInt(PROJECT_ID), owner_id: BigInt(USER_ID), name: "ikjjr0" } });
  });

  afterAll(async () => {
    if (!prisma) return;
    await prisma.project.deleteMany({ where: { id: BigInt(PROJECT_ID) } });
    await raw.end();
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    const pid = BigInt(PROJECT_ID);
    await clearEffectiveRecoveryOwners(prisma, pid);
    await prisma.generation_canvas_outputs.deleteMany({});
    await prisma.generation_canvas_submissions.deleteMany({ where: { project_id: pid } });
    await prisma.project_command_receipts.deleteMany({ where: { project_id: pid } });
    await prisma.project_canvas.deleteMany({ where: { project_id: pid } });
    await prisma.project_edges.deleteMany({ where: { project_id: pid } });
    await prisma.project_nodes.deleteMany({ where: { project_id: pid } });
    await prisma.generation_output_slots.deleteMany({ where: { project_id: pid } });
    await prisma.generation_job_logs.deleteMany({});
    await prisma.billing_cost_reservations.deleteMany({});
    await prisma.generation_jobs.deleteMany({ where: { project_id: pid } });
  });

  it("★ R1 旧卡保留及独立新目标恢复：新意图绑新节点，旧 job/关联原样，恢复页双记录", async () => {
    const holdCalls: number[] = [];
    const billing = {
      charge: async (jobId: number) => { holdCalls.push(jobId); },
      release: async () => {},
    };

    const old = await regenerateCreate(regenerateAcceptance("0a1b2c3d-0000-4000-8000-0000000000c1", "node-final"), billing);
    expect(old).toMatchObject({ generation_job_id: expect.any(String) });
    const oldJobId = (old as { generation_job_id: string }).generation_job_id;

    const renewed = await regenerateCreate(regenerateAcceptance("0a1b2c3d-0000-4000-8000-0000000000c2", "node-regen"), billing);
    const renewedJobId = (renewed as { generation_job_id: string }).generation_job_id;
    expect(renewedJobId).not.toBe(oldJobId);

    const oldJob = await prisma.generation_jobs.findUnique({ where: { id: BigInt(oldJobId) } });
    expect(oldJob).not.toBeNull();
    const oldSubmission = await prisma.generation_canvas_submissions.findUnique({
      where: { project_id_submission_id: { project_id: BigInt(PROJECT_ID), submission_id: "0a1b2c3d-0000-4000-8000-0000000000c1" } },
    });
    expect(oldSubmission?.target_state).toBe("pending");

    const page = await listCanvasRecoveryPage(prisma, PROJECT_ID, 50, null);
    expect(page.records).toHaveLength(2);
    for (const record of page.records) {
      expect(record.is_current).toBe(true);
      expect(record.job).not.toBeNull();
      expect(record.items[0]).toMatchObject({ output_key: "$target", state: "pending", revision: 1, node_binding_revision: 1 });
    }

    const nodes = page.records.map(r => r.target_node_id).sort();
    expect(nodes).toEqual(["node-final", "node-regen"]);
  });

  it("★ R2 并发冲突不预扣：同节点同承接版本并发 → 恰一胜，charge 恰一次，败者零写入", async () => {
    const holds: number[] = [];
    const billing = {
      charge: async (jobId: number) => { holds.push(jobId); },
      release: async () => {},
    };
    const attempts = await Promise.allSettled([
      regenerateCreate(regenerateAcceptance("0a1b2c3d-0000-4000-8000-0000000000d1", "node-race"), billing),
      regenerateCreate(regenerateAcceptance("0a1b2c3d-0000-4000-8000-0000000000d2", "node-race"), billing),
    ]);
    const fulfilled = attempts.filter(r => r.status === "fulfilled");
    const rejected = attempts.filter(r => r.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(RecoveryContractError);

    expect(holds).toHaveLength(1);
    expect(await prisma.generation_jobs.count({ where: { project_id: BigInt(PROJECT_ID) } })).toBe(1);
    expect(await prisma.generation_canvas_submissions.count({ where: { project_id: BigInt(PROJECT_ID) } })).toBe(1);
    expect(await prisma.project_command_receipts.count({ where: { project_id: BigInt(PROJECT_ID) } })).toBe(1);
  });

  it("★ R3 预扣失败（charge 抛错）→ 整体失败零残留，不误发 release（钱没冻上不返还）", async () => {
    const releases: number[] = [];
    const billing = {
      charge: async () => { throw new Error("billing unavailable"); },
      release: async (jobId: number) => { releases.push(jobId); },
    };
    const failed = await regenerateCreate(regenerateAcceptance("0a1b2c3d-0000-4000-8000-0000000000e1", "node-holdfail"), billing)
      .catch(error => error as Error);
    expect(failed).toBeInstanceOf(Error);
    expect(releases).toHaveLength(0);

    expect(await prisma.generation_jobs.count({ where: { project_id: BigInt(PROJECT_ID) } })).toBe(0);
    expect(await prisma.generation_canvas_submissions.count({ where: { project_id: BigInt(PROJECT_ID) } })).toBe(0);
    expect(await countEffectiveRecoveryOwners(prisma, BigInt(PROJECT_ID))).toBe(0);
    expect(await prisma.project_command_receipts.count({ where: { project_id: BigInt(PROJECT_ID) } })).toBe(0);
    expect(await prisma.billing_cost_reservations.count({})).toBe(0);
  });

  it("★ R4 预扣失败补偿：charge 成功后事务失败 → release(jobId)，零残留（资金不随库回滚丢）", async () => {
    await prisma.generation_canvas_submissions.create({
      data: {
        project_id: BigInt(PROJECT_ID),
        user_id: BigInt(USER_ID),
        protocol_version: 1,
        submission_id: "0a1b2c3d-0000-4000-8000-0000000000f1",
        operation: "generation.create",
        request_hash: "occupied",
        generation_job_id: 999999n,
        task_type: "video",
        target_node_id: "node-compensate",
        binding_revision: 7,
        target_state: "pending",
        target_revision: 1,
      },
    });
    const holds: number[] = [];
    const releases: number[] = [];
    const billing = {
      charge: async (jobId: number) => { holds.push(jobId); },
      release: async (jobId: number) => { releases.push(jobId); },
    };

    const failed = await regenerateCreate(regenerateAcceptance("0a1b2c3d-0000-4000-8000-0000000000f1", "node-compensate", 7), billing)
      .catch(error => error as Error);
    expect(failed).toBeInstanceOf(Error);

    expect(holds).toHaveLength(1);
    expect(releases).toEqual(holds);

    expect(await prisma.generation_jobs.count({ where: { project_id: BigInt(PROJECT_ID) } })).toBe(0);
    expect(await prisma.project_command_receipts.count({ where: { project_id: BigInt(PROJECT_ID) } })).toBe(0);
    expect(await prisma.project_nodes.count({ where: { project_id: BigInt(PROJECT_ID), owner_submission_id: { not: null } } })).toBe(0);
    const seededOwner = await findEffectiveRecoveryOwner(prisma, BigInt(PROJECT_ID), "node-compensate");
    expect(Number(seededOwner?.binding_revision)).toBe(7);
  });

  it("★ R5 旧承接版本抢占旧成片节点 → 409，不覆盖旧承接（AC4）", async () => {
    const billing = { charge: async () => {}, release: async () => {} };
    const first = await regenerateCreate(regenerateAcceptance("0a1b2c3d-0000-4000-8000-000000001001", "node-old-final"), billing);
    expect(first).toMatchObject({ generation_job_id: expect.any(String) });

    const conflict = await regenerateCreate(regenerateAcceptance("0a1b2c3d-0000-4000-8000-000000001002", "node-old-final", 0), billing)
      .catch(error => error as RecoveryContractError);
    expect(conflict).toBeInstanceOf(RecoveryContractError);
    expect((conflict as RecoveryContractError).envelope).toMatchObject({
      code: 409,
      data: { reason: RECOVERY_REASONS.bindingConflict, currentBindingRevision: 1 },
    });
    const owner = await findEffectiveRecoveryOwner(prisma, BigInt(PROJECT_ID), "node-old-final");
    const ownerSubmission = await prisma.generation_canvas_submissions.findUnique({
      where: { id: owner!.generation_canvas_submission_id },
    });
    expect(ownerSubmission?.submission_id).toBe("0a1b2c3d-0000-4000-8000-000000001001");
  });
});
