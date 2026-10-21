























import { PrismaMariaDb } from "@prisma/adapter-mariadb";
import type { Pool } from "mariadb";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildPoolConfig, getPrismaClient } from "./db.js";
import {
  PRIMARY_OUTPUT_KEY,
  RECOVERY_REASONS,
  TARGET_OUTPUT_KEY,
  recoveryItemId,
  type CanvasBinding,
} from "@lib/contracts";
import {
  RecoveryContractError,
  lockCanvasRecoveryForAcceptance,
  writeCanvasRecoveryRows,
  type CanvasRecoveryAcceptance,
} from "./generation-canvas-recovery-repo.js";
import { saveCanvasWithRecovery } from "./canvas-recovery-save.js";
import { multiResultNodeId } from "./canvas-recovery-multi-output.js";
import { createJobWithinTx } from "./generation-command-repo.js";
import type { PrismaClient } from "@prisma/client";

const databaseUrl = process.env.IKJLTT_DATABASE_URL;

describe.skipIf(!databaseUrl)("旧 primary 不得改动新受理归属（IKJLTT）", () => {
  let prisma: PrismaClient;
  let raw: Pool;

  const PROJECT_ID = "960001";
  const USER_ID = "960009";
  const NODE = "ikjltt-node-a";
  const UUID_A = "5e6f7a8b-0000-4000-8000-00000000a001";
  const UUID_B = "5e6f7a8b-0000-4000-8000-00000000b002";
  const CMD = (suffix: string) => `5e6f7a8b-0000-4000-8000-0000000${suffix}`;

  function binding(submissionId: string, node: string, revision: number): CanvasBinding {
    return {
      protocol_version: 1,
      submission_id: submissionId,
      target_node_id: node,
      expected_binding_revision: revision,
      recovery_seed: {
        target: { role: "result-placeholder", x: 0, y: 0, width: 100, height: 100, name: "" },
        sources: [],
      },
    };
  }

  function acceptance(submissionId: string, node: string, revision: number, taskType = "image"): CanvasRecoveryAcceptance {
    return {
      projectId: PROJECT_ID,
      userId: USER_ID,
      binding: binding(submissionId, node, revision),
      operation: "generation.create",
      requestHash: `hash-${submissionId}`,
      idempotencyKey: submissionId,
      taskType,
    };
  }


  async function accept(acceptanceInput: CanvasRecoveryAcceptance, args?: {
    type?: string;
    input?: Record<string, unknown>;
  }) {
    return prisma.$transaction(async (tx) => {
      const locked = await lockCanvasRecoveryForAcceptance(tx, acceptanceInput);
      if (locked.kind !== "plan") return locked;
      const created = await createJobWithinTx(tx, {
        projectId: acceptanceInput.projectId,
        userId: acceptanceInput.userId,
        type: args?.type ?? "image",
        expectedOutputCount: 1,
        input: args?.input ?? { prompt: "whale" },
        actionIdentity: `ikjltt-${acceptanceInput.binding.submission_id}`,
        actionType: `generate_${args?.type ?? "image"}`,
      }, undefined, { key: acceptanceInput.idempotencyKey, requestHash: acceptanceInput.requestHash });
      await writeCanvasRecoveryRows(tx, locked.plan, BigInt(created.generation_job_id));
      return created;
    });
  }

  async function succeedJob(jobId: string, assetIdsJson: string) {
    await raw.query(
      "UPDATE generation_jobs SET status='succeeded', output_asset_ids=CAST(? AS JSON) WHERE id = ?",
      [assetIdsJson, Number(jobId)],
    );
  }


  async function succeedSceneSplitJob(jobId: string, segments: Array<{ index: number; assetId: string }>) {
    await succeedJob(jobId, JSON.stringify(segments.map(segment => segment.assetId)));
    await prisma.generation_job_logs.create({
      data: {
        generation_job_id: BigInt(jobId),
        event: "succeeded",
        status: "succeeded",
        message: "场景切分完成",
        payload: {
          duration: 10,
          segments: segments.map(segment => ({
            segment_index: segment.index,
            start_time: 0,
            end_time: 5,
            segment_asset_id: segment.assetId,
          })),
        },
      } as never,
    });
  }

  function markerNode(id: string, submissionId: string, outputKey: string, assetId: string) {
    return {
      id,
      type: "mediaNode",
      position: { x: 1, y: 2 },
      data: {
        generationRecovery: { protocolVersion: 1, submissionId, outputKey },
        assetId,
      },
    };
  }

  function save(args: {
    commandId: string;
    version: number | null;
    nodes: Array<Record<string, unknown>>;
    changes: Array<{ id: string; rev: number; action: string }>;
  }) {
    return saveCanvasWithRecovery(prisma, {
      ownerId: USER_ID,
      projectId: PROJECT_ID,
      expectedVersion: args.version,
      viewport: "{}",
      nodes: JSON.stringify(args.nodes),
      edges: "[]",
      confirmEmpty: false,
      commandId: args.commandId,
      changes: args.changes.map(change => ({
        recoveryItemId: change.id,
        expectedRevision: change.rev,
        action: change.action,
      })),
    });
  }

  async function expectRejection(promise: Promise<unknown>, reason = RECOVERY_REASONS.documentMismatch, code = 422) {
    return promise.then(
      () => { throw new Error("应拒绝"); },
      (error: unknown) => {
        expect(error).toBeInstanceOf(RecoveryContractError);
        expect((error as RecoveryContractError).envelope).toMatchObject({ code, data: { reason } });
      },
    );
  }

  async function canvasRow() {
    return prisma.canvas.findFirst({ where: { project_id: BigInt(PROJECT_ID) } });
  }

  async function submissionRow(submissionId: string) {
    return prisma.generation_canvas_submissions.findUnique({
      where: { project_id_submission_id: { project_id: BigInt(PROJECT_ID), submission_id: submissionId } },
    });
  }

  async function outputRow(submissionId: string, outputKey: string) {
    const submission = await submissionRow(submissionId);
    return prisma.generation_canvas_outputs.findUnique({
      where: {
        generation_canvas_submission_id_output_key: {
          generation_canvas_submission_id: submission!.id,
          output_key: outputKey,
        },
      },
    });
  }

  async function ownerRow(node: string) {
    return prisma.generation_canvas_node_owners.findUnique({
      where: { project_id_node_id: { project_id: BigInt(PROJECT_ID), node_id: node } },
    });
  }

  beforeAll(async () => {
    prisma = getPrismaClient(databaseUrl!);
    const adapter = await new PrismaMariaDb(buildPoolConfig(databaseUrl!)).connect();
    raw = adapter.underlyingDriver();
    await prisma.project.create({ data: { id: BigInt(PROJECT_ID), owner_id: BigInt(USER_ID), name: "ikjltt" } });
  });

  afterAll(async () => {
    if (!prisma) return;
    await prisma.project.deleteMany({ where: { id: BigInt(PROJECT_ID) } });
    await raw.end();
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await prisma.generation_canvas_node_owners.deleteMany({ where: { project_id: BigInt(PROJECT_ID) } });
    await prisma.generation_canvas_outputs.deleteMany({});
    await prisma.generation_canvas_submissions.deleteMany({ where: { project_id: BigInt(PROJECT_ID) } });
    await prisma.command_idempotency.deleteMany({ where: { project_id: BigInt(PROJECT_ID) } });
    await prisma.canvas.deleteMany({ where: { project_id: BigInt(PROJECT_ID) } });
    await prisma.generation_output_slots.deleteMany({ where: { project_id: BigInt(PROJECT_ID) } });
    await prisma.generation_job_logs.deleteMany({});
    await prisma.cost_reservations.deleteMany({});
    await prisma.generation_jobs.deleteMany({ where: { project_id: BigInt(PROJECT_ID) } });
  });



  async function seedTakeover() {
    const jobA = await accept(acceptance(UUID_A, NODE, 0));
    await succeedJob(jobA.generation_job_id, '["11"]');
    const jobB = await accept(acceptance(UUID_B, NODE, 1));
    await succeedJob(jobB.generation_job_id, '["21"]');
    return { jobA: jobA.generation_job_id, jobB: jobB.generation_job_id };
  }

  it("★ 1. 接管后旧 A 首次 apply(primary) → 409 整笔回滚；修复前接受并污染 owner output_key", async () => {
    await seedTakeover();

    await expectRejection(save({
      commandId: CMD("10001"),
      version: null,
      nodes: [markerNode(NODE, UUID_A, PRIMARY_OUTPUT_KEY, "11")],
      changes: [{ id: recoveryItemId(UUID_A, PRIMARY_OUTPUT_KEY), rev: 0, action: "apply" }],
    }), RECOVERY_REASONS.itemConflict, 409);

    const owner = await ownerRow(NODE);
    const submissionB = await submissionRow(UUID_B);
    expect(owner).toMatchObject({
      generation_canvas_submission_id: submissionB!.id,
      output_key: TARGET_OUTPUT_KEY,
      binding_revision: 2,
    });
    expect(await submissionRow(UUID_A)).toMatchObject({ target_state: "transferred" });
    expect(await outputRow(UUID_A, PRIMARY_OUTPUT_KEY)).toBeNull();
    expect(await canvasRow()).toBeNull();
    expect(await prisma.command_idempotency.count({
      where: { project_id: BigInt(PROJECT_ID), operation: "SAVE_CANVAS_RECOVERY_V1", idempotency_key: CMD("10001") },
    })).toBe(0);
  });

  it("★ 2. A 已转换后被接管，旧 A 重复 apply(primary) → 409；修复前成功且污染 (B,$target) 行", async () => {

    await accept(acceptance(UUID_A, NODE, 0)).then(async jobA => succeedJob(jobA.generation_job_id, '["11"]'));
    const base = await save({
      commandId: CMD("20001"),
      version: null,
      nodes: [markerNode(NODE, UUID_A, TARGET_OUTPUT_KEY, "11")],
      changes: [],
    });
    const fanned = await save({
      commandId: CMD("20002"),
      version: base.version,
      nodes: [markerNode(NODE, UUID_A, PRIMARY_OUTPUT_KEY, "11")],
      changes: [
        { id: recoveryItemId(UUID_A, TARGET_OUTPUT_KEY), rev: 1, action: "replaceTarget" },
        { id: recoveryItemId(UUID_A, PRIMARY_OUTPUT_KEY), rev: 0, action: "apply" },
      ],
    });
    expect((await ownerRow(NODE))?.output_key).toBe(PRIMARY_OUTPUT_KEY);

    await accept(acceptance(UUID_B, NODE, 1));
    expect((await ownerRow(NODE))?.output_key).toBe(TARGET_OUTPUT_KEY);

    await expectRejection(save({
      commandId: CMD("20003"),
      version: fanned.version,
      nodes: [markerNode(NODE, UUID_A, PRIMARY_OUTPUT_KEY, "11")],
      changes: [{ id: recoveryItemId(UUID_A, PRIMARY_OUTPUT_KEY), rev: 1, action: "apply" }],
    }), RECOVERY_REASONS.itemConflict, 409);
    const owner = await ownerRow(NODE);
    const submissionB = await submissionRow(UUID_B);
    expect(owner).toMatchObject({
      generation_canvas_submission_id: submissionB!.id,
      output_key: TARGET_OUTPUT_KEY,
    });
    expect(await outputRow(UUID_A, PRIMARY_OUTPUT_KEY)).toMatchObject({ state: "present", revision: 1 });
    expect((await canvasRow())?.version).toBe(fanned.version);
    expect(await prisma.command_idempotency.count({
      where: { project_id: BigInt(PROJECT_ID), operation: "SAVE_CANVAS_RECOVERY_V1", idempotency_key: CMD("20003") },
    })).toBe(0);
  });

  it("★ 3. 同笔交错：B 的合法 replaceTarget+apply(primary) 混入旧 A 的 apply → 整笔 422 零部分写入", async () => {
    await seedTakeover();
    await expectRejection(save({
      commandId: CMD("30001"),
      version: null,
      nodes: [markerNode(NODE, UUID_B, PRIMARY_OUTPUT_KEY, "21")],
      changes: [
        { id: recoveryItemId(UUID_B, TARGET_OUTPUT_KEY), rev: 1, action: "replaceTarget" },
        { id: recoveryItemId(UUID_B, PRIMARY_OUTPUT_KEY), rev: 0, action: "apply" },
        { id: recoveryItemId(UUID_A, PRIMARY_OUTPUT_KEY), rev: 0, action: "apply" },
      ],
    }));

    expect(await submissionRow(UUID_B)).toMatchObject({ target_state: "pending", target_revision: 1 });
    expect(await outputRow(UUID_B, PRIMARY_OUTPUT_KEY)).toBeNull();
    const owner = await ownerRow(NODE);
    expect(owner?.output_key).toBe(TARGET_OUTPUT_KEY);
    expect(await canvasRow()).toBeNull();
  });

  it("★ 4. 合法一对一首次转换与重复 apply 保持：owner 切 primary；重复无副作用", async () => {
    await accept(acceptance(UUID_A, NODE, 0)).then(async jobA => succeedJob(jobA.generation_job_id, '["11"]'));
    const base = await save({
      commandId: CMD("40001"),
      version: null,
      nodes: [markerNode(NODE, UUID_A, TARGET_OUTPUT_KEY, "11")],
      changes: [],
    });
    const fanned = await save({
      commandId: CMD("40002"),
      version: base.version,
      nodes: [markerNode(NODE, UUID_A, PRIMARY_OUTPUT_KEY, "11")],
      changes: [
        { id: recoveryItemId(UUID_A, TARGET_OUTPUT_KEY), rev: 1, action: "replaceTarget" },
        { id: recoveryItemId(UUID_A, PRIMARY_OUTPUT_KEY), rev: 0, action: "apply" },
      ],
    });
    expect(fanned.recoveryReceipt.changes).toEqual(expect.arrayContaining([
      expect.objectContaining({ state: "replaced", revision: 2 }),
      expect.objectContaining({ state: "present", revision: 1 }),
    ]));
    const submissionA = await submissionRow(UUID_A);
    expect(await ownerRow(NODE)).toMatchObject({
      generation_canvas_submission_id: submissionA!.id,
      output_key: PRIMARY_OUTPUT_KEY,
    });

    const replayed = await save({
      commandId: CMD("40003"),
      version: fanned.version,
      nodes: [markerNode(NODE, UUID_A, PRIMARY_OUTPUT_KEY, "11")],
      changes: [{ id: recoveryItemId(UUID_A, PRIMARY_OUTPUT_KEY), rev: 1, action: "apply" }],
    });
    expect(replayed.recoveryReceipt.changes[0]).toMatchObject({ state: "present", revision: 1 });
    expect(await outputRow(UUID_A, PRIMARY_OUTPUT_KEY)).toMatchObject({ state: "present", revision: 1 });
    expect(await ownerRow(NODE)).toMatchObject({
      generation_canvas_submission_id: submissionA!.id,
      output_key: PRIMARY_OUTPUT_KEY,
    });
  });

  it("★ 5. 独立节点旧输出不受 target 接管牵连：segment apply/remove/restore 在接管后仍合法", async () => {

    const jobA = await accept(acceptance(UUID_A, NODE, 0, "video_scene_split"), {
      type: "video_scene_split",
      input: { source_asset_id: "5", target_node_id: NODE, granularity: "fine" },
    });
    await succeedSceneSplitJob(jobA.generation_job_id, [
      { index: 1, assetId: "701" },
      { index: 2, assetId: "702" },
    ]);
    await accept(acceptance(UUID_B, NODE, 1));
    expect(await submissionRow(UUID_A)).toMatchObject({ target_state: "transferred" });

    const seg1 = multiResultNodeId(UUID_A, "segment:1");
    const seg2 = multiResultNodeId(UUID_A, "segment:2");
    const applied = await save({
      commandId: CMD("50001"),
      version: null,
      nodes: [markerNode(seg1, UUID_A, "segment:1", "701")],
      changes: [{ id: recoveryItemId(UUID_A, "segment:1"), rev: 0, action: "apply" }],
    });
    expect(applied.recoveryReceipt.changes[0]).toMatchObject({ state: "present", revision: 1, nodeBindingRevision: 1 });

    const removed = await save({
      commandId: CMD("50002"),
      version: applied.version,
      nodes: [markerNode(seg1, UUID_A, "segment:1", "701")],
      changes: [{ id: recoveryItemId(UUID_A, "segment:2"), rev: 0, action: "remove" }],
    });
    expect(removed.recoveryReceipt.changes[0]).toMatchObject({ state: "removed", revision: 1 });
    const restored = await save({
      commandId: CMD("50003"),
      version: removed.version,
      nodes: [markerNode(seg1, UUID_A, "segment:1", "701"), markerNode(seg2, UUID_A, "segment:2", "702")],
      changes: [{ id: recoveryItemId(UUID_A, "segment:2"), rev: 1, action: "restore" }],
    });
    expect(restored.recoveryReceipt.changes[0]).toMatchObject({ state: "present", revision: 2 });

    const submissionA = await submissionRow(UUID_A);
    const submissionB = await submissionRow(UUID_B);
    expect(await prisma.generation_canvas_node_owners.findUnique({
      where: { project_id_node_id: { project_id: BigInt(PROJECT_ID), node_id: seg1 } },
    })).toMatchObject({ generation_canvas_submission_id: submissionA!.id, output_key: "segment:1" });
    expect(await ownerRow(NODE)).toMatchObject({
      generation_canvas_submission_id: submissionB!.id,
      output_key: TARGET_OUTPUT_KEY,
    });
  });
});
