import { PrismaMariaDb } from "@prisma/adapter-mariadb";
import type { Pool } from "mariadb";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildPoolConfig, getPrismaClient } from "./db.js";
import {
  RECOVERY_REASONS,
  TARGET_OUTPUT_KEY,
  PRIMARY_OUTPUT_KEY,
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

const databaseUrl = process.env.IKJLPC_DATABASE_URL;

describe.skipIf(!databaseUrl)("新协议保存反向脱节守护（IKJLPC）", () => {
  let prisma: PrismaClient;
  let raw: Pool;

  const PROJECT_ID = "940001";
  const USER_ID = "940009";
  const NODE_A = "ikjlpc-node-a";
  const NODE_B = "ikjlpc-node-b";
  const NODE_C = "ikjlpc-node-c";
  const NODE_X = "ikjlpc-node-x";
  const UUID_A = "3c4d5e6f-0000-4000-8000-00000000a001";
  const UUID_B = "3c4d5e6f-0000-4000-8000-00000000b002";
  const UUID_C = "3c4d5e6f-0000-4000-8000-00000000c003";
  const UUID_X = "3c4d5e6f-0000-4000-8000-00000000x009";
  const CMD = (suffix: string) => `3c4d5e6f-0000-4000-8000-0000000${suffix}`;

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

  function acceptance(
    submissionId: string,
    node: string,
    taskType = "image",
    bindingRevision = 0,
  ): CanvasRecoveryAcceptance {
    return {
      projectId: PROJECT_ID,
      userId: USER_ID,
      binding: binding(submissionId, node, bindingRevision),
      operation: "generation.create",
      requestHash: `hash-${submissionId}`,
      idempotencyKey: submissionId,
      taskType,
    };
  }

  async function accept(acceptanceInput: CanvasRecoveryAcceptance) {
    return prisma.$transaction(async (tx) => {
      const locked = await lockCanvasRecoveryForAcceptance(tx, acceptanceInput);
      if (locked.kind !== "plan") return locked;
      const created = await createJobWithinTx(tx, {
        projectId: acceptanceInput.projectId,
        userId: acceptanceInput.userId,
        type: acceptanceInput.taskType,
        expectedOutputCount: 1,
        input: { prompt: "whale" },
        actionIdentity: `ikjlpc-${acceptanceInput.binding.submission_id}`,
        actionType: `generate_${acceptanceInput.taskType}`,
      }, undefined, { key: acceptanceInput.idempotencyKey, requestHash: acceptanceInput.requestHash });
      await writeCanvasRecoveryRows(tx, locked.plan, BigInt(created.generation_job_id));
      return created;
    });
  }

  async function succeedJob(jobId: string, assetIds: string) {
    await raw.query(
      "UPDATE generation_jobs SET status='succeeded', output_asset_ids=CAST(? AS JSON) WHERE id = ?",
      [`[${assetIds}]`, Number(jobId)],
    );
  }

  async function failJob(jobId: string) {
    await raw.query("UPDATE generation_jobs SET status='failed' WHERE id = ?", [Number(jobId)]);
  }

  function markerNode(id: string, submissionId: string, outputKey: string, assetId = "7") {
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

  async function succeedSceneSplitJob(jobId: string, segments: Array<{ index: number; assetId: string }>) {
    await raw.query(
      "UPDATE generation_jobs SET status='succeeded', output_asset_ids=CAST(? AS JSON) WHERE id = ?",
      [JSON.stringify(segments.map(segment => segment.assetId)), Number(jobId)],
    );
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

  async function expectRejection(promise: Promise<unknown>, reason = RECOVERY_REASONS.documentMismatch) {
    return promise.then(
      () => { throw new Error("应拒绝"); },
      (error: unknown) => {
        expect(error).toBeInstanceOf(RecoveryContractError);
        expect((error as RecoveryContractError).envelope).toMatchObject({ code: 422, data: { reason } });
      },
    );
  }

  async function canvasRow() {
    return prisma.canvas.findFirst({ where: { project_id: BigInt(PROJECT_ID) } });
  }

  async function canvasNodeIds(): Promise<string[]> {
    const row = await canvasRow();
    const nodes = (row?.nodes_json ?? []) as Array<{ id: string }>;
    return nodes.map(node => String(node.id)).sort();
  }

  async function ownerCount(): Promise<number> {
    return prisma.generation_canvas_node_owners.count({ where: { project_id: BigInt(PROJECT_ID) } });
  }

  async function outputState(submissionId: string, outputKey: string) {
    const submission = await prisma.generation_canvas_submissions.findUnique({
      where: { project_id_submission_id: { project_id: BigInt(PROJECT_ID), submission_id: submissionId } },
    });
    if (outputKey === TARGET_OUTPUT_KEY) {
      return submission ? { state: submission.target_state, revision: Number(submission.target_revision) } : null;
    }
    const output = await prisma.generation_canvas_outputs.findUnique({
      where: {
        generation_canvas_submission_id_output_key: {
          generation_canvas_submission_id: submission!.id,
          output_key: outputKey,
        },
      },
    });
    return output ? { state: output.state, revision: Number(output.revision) } : null;
  }

  async function receiptOf(commandId: string) {
    return prisma.command_idempotency.findUnique({
      where: { project_id_operation_idempotency_key: { project_id: BigInt(PROJECT_ID), operation: "SAVE_CANVAS_RECOVERY_V1", idempotency_key: commandId } },
    });
  }

  async function seedTwoPresentCards() {
    const jobA = await accept(acceptance(UUID_A, NODE_A));
    const jobB = await accept(acceptance(UUID_B, NODE_B));
    await succeedJob(jobA.generation_job_id, "\"7\"");
    await succeedJob(jobB.generation_job_id, "\"7\"");
    const base = await save({
      commandId: CMD("00001"),
      version: null,
      nodes: [markerNode(NODE_A, UUID_A, TARGET_OUTPUT_KEY), markerNode(NODE_B, UUID_B, TARGET_OUTPUT_KEY)],
      changes: [],
    });
    const fanned = await save({
      commandId: CMD("00002"),
      version: base.version,
      nodes: [markerNode(NODE_A, UUID_A, PRIMARY_OUTPUT_KEY), markerNode(NODE_B, UUID_B, PRIMARY_OUTPUT_KEY)],
      changes: [
        { id: recoveryItemId(UUID_A, TARGET_OUTPUT_KEY), rev: 1, action: "replaceTarget" },
        { id: recoveryItemId(UUID_A, PRIMARY_OUTPUT_KEY), rev: 0, action: "apply" },
        { id: recoveryItemId(UUID_B, TARGET_OUTPUT_KEY), rev: 1, action: "replaceTarget" },
        { id: recoveryItemId(UUID_B, PRIMARY_OUTPUT_KEY), rev: 0, action: "apply" },
      ],
    });
    return { fanned };
  }

  beforeAll(async () => {
    prisma = getPrismaClient(databaseUrl!);
    const adapter = await new PrismaMariaDb(buildPoolConfig(databaseUrl!)).connect();
    raw = adapter.underlyingDriver();
    await prisma.project.create({ data: { id: BigInt(PROJECT_ID), owner_id: BigInt(USER_ID), name: "ikjlpc" } });
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

  it("★ 1. 伪造输出项标记：凭空身份 / 克隆真实身份 / 声明夹带克隆 → 422 且整笔回滚", async () => {
    const { fanned } = await seedTwoPresentCards();
    const ownersBefore = await ownerCount();
    await expectRejection(save({
      commandId: CMD("10001"), version: fanned.version,
      nodes: [markerNode(NODE_A, UUID_A, PRIMARY_OUTPUT_KEY), markerNode(NODE_B, UUID_B, PRIMARY_OUTPUT_KEY), markerNode(NODE_X, UUID_X, PRIMARY_OUTPUT_KEY)],
      changes: [],
    }));
    await expectRejection(save({
      commandId: CMD("10002"), version: fanned.version,
      nodes: [markerNode(NODE_A, UUID_A, PRIMARY_OUTPUT_KEY), markerNode(NODE_B, UUID_B, PRIMARY_OUTPUT_KEY), markerNode(NODE_X, UUID_A, PRIMARY_OUTPUT_KEY)],
      changes: [],
    }));
    await expectRejection(save({
      commandId: CMD("10003"), version: fanned.version,
      nodes: [markerNode(NODE_A, UUID_A, PRIMARY_OUTPUT_KEY), markerNode(NODE_B, UUID_B, PRIMARY_OUTPUT_KEY), markerNode(NODE_X, UUID_B, PRIMARY_OUTPUT_KEY)],
      changes: [{ id: recoveryItemId(UUID_B, PRIMARY_OUTPUT_KEY), rev: 1, action: "apply" }],
    }));
    expect((await canvasRow())?.version).toBe(fanned.version);
    expect(await canvasNodeIds()).toEqual([NODE_A, NODE_B]);
    expect(await outputState(UUID_A, PRIMARY_OUTPUT_KEY)).toEqual({ state: "present", revision: 1 });
    expect(await outputState(UUID_B, PRIMARY_OUTPUT_KEY)).toEqual({ state: "present", revision: 1 });
    expect(await ownerCount()).toBe(ownersBefore);
    expect(await receiptOf(CMD("10001"))).toBeNull();
    expect(await receiptOf(CMD("10002"))).toBeNull();
    expect(await receiptOf(CMD("10003"))).toBeNull();
  });

  it("★ 2. removed 输出项重现：remove 后标记卡重现且无 restore → 422；显式 restore 重现合法", async () => {
    const { fanned } = await seedTwoPresentCards();
    const removed = await save({
      commandId: CMD("20001"), version: fanned.version,
      nodes: [markerNode(NODE_B, UUID_B, PRIMARY_OUTPUT_KEY)],
      changes: [{ id: recoveryItemId(UUID_A, PRIMARY_OUTPUT_KEY), rev: 1, action: "remove" }],
    });
    expect(await outputState(UUID_A, PRIMARY_OUTPUT_KEY)).toEqual({ state: "removed", revision: 2 });
    const ownersAfterRemove = await ownerCount();
    await expectRejection(save({
      commandId: CMD("20002"), version: removed.version,
      nodes: [markerNode(NODE_A, UUID_A, PRIMARY_OUTPUT_KEY), markerNode(NODE_B, UUID_B, PRIMARY_OUTPUT_KEY)],
      changes: [],
    }));
    expect((await canvasRow())?.version).toBe(removed.version);
    expect(await canvasNodeIds()).toEqual([NODE_B]);
    expect(await outputState(UUID_A, PRIMARY_OUTPUT_KEY)).toEqual({ state: "removed", revision: 2 });
    expect(await ownerCount()).toBe(ownersAfterRemove);
    expect(await receiptOf(CMD("20002"))).toBeNull();
    const restored = await save({
      commandId: CMD("20003"), version: removed.version,
      nodes: [markerNode(NODE_A, UUID_A, PRIMARY_OUTPUT_KEY), markerNode(NODE_B, UUID_B, PRIMARY_OUTPUT_KEY)],
      changes: [{ id: recoveryItemId(UUID_A, PRIMARY_OUTPUT_KEY), rev: 2, action: "restore" }],
    });
    expect(restored.recoveryReceipt.changes[0]).toMatchObject({ state: "present", revision: 3 });
    expect(await canvasNodeIds()).toEqual([NODE_A, NODE_B]);
  });

  it("★ 3. $target 反向：无受理行的占位伪造与 removed 终态重现 → 422；pending 占位放置合法", async () => {
    const jobC = await accept(acceptance(UUID_C, NODE_C));
    await failJob(jobC.generation_job_id);
    const placed = await save({
      commandId: CMD("30001"), version: null,
      nodes: [markerNode(NODE_C, UUID_C, TARGET_OUTPUT_KEY)],
      changes: [],
    });
    expect(placed.version).toBe(0);
    await expectRejection(save({
      commandId: CMD("30002"), version: placed.version,
      nodes: [markerNode(NODE_C, UUID_C, TARGET_OUTPUT_KEY), markerNode(NODE_X, UUID_X, TARGET_OUTPUT_KEY)],
      changes: [],
    }));
    const removed = await save({
      commandId: CMD("30003"), version: placed.version,
      nodes: [],
      changes: [{ id: recoveryItemId(UUID_C, TARGET_OUTPUT_KEY), rev: 1, action: "remove" }],
    });
    expect(await outputState(UUID_C, TARGET_OUTPUT_KEY)).toEqual({ state: "removed", revision: 2 });
    await expectRejection(save({
      commandId: CMD("30004"), version: removed.version,
      nodes: [markerNode(NODE_C, UUID_C, TARGET_OUTPUT_KEY)],
      changes: [],
    }));
    expect((await canvasRow())?.version).toBe(removed.version);
    expect(await canvasNodeIds()).toEqual([]);
    expect(await outputState(UUID_C, TARGET_OUTPUT_KEY)).toEqual({ state: "removed", revision: 2 });
    expect(await receiptOf(CMD("30002"))).toBeNull();
    expect(await receiptOf(CMD("30004"))).toBeNull();
  });

  it("★ 4. 无声明路径身份克隆：pending $target 占位与多结果虚拟输出的克隆 → 422 且整笔回滚", async () => {
    const jobC = await accept(acceptance(UUID_C, NODE_C, "video_scene_split"));
    await succeedSceneSplitJob(jobC.generation_job_id, [
      { index: 1, assetId: "701" },
      { index: 2, assetId: "702" },
    ]);
    const seg1 = multiResultNodeId(UUID_C, "segment:1");
    const placed = await save({
      commandId: CMD("40001"), version: null,
      nodes: [markerNode(seg1, UUID_C, "segment:1", "701")],
      changes: [],
    });
    await expectRejection(save({
      commandId: CMD("40002"), version: placed.version,
      nodes: [markerNode(seg1, UUID_C, "segment:1", "701"), markerNode(NODE_X, UUID_C, "segment:1", "701")],
      changes: [],
    }));
    const targetPlaced = await save({
      commandId: CMD("40003"), version: placed.version,
      nodes: [markerNode(seg1, UUID_C, "segment:1", "701"), markerNode(NODE_C, UUID_C, TARGET_OUTPUT_KEY)],
      changes: [],
    });
    await expectRejection(save({
      commandId: CMD("40004"), version: targetPlaced.version,
      nodes: [
        markerNode(seg1, UUID_C, "segment:1", "701"),
        markerNode(NODE_C, UUID_C, TARGET_OUTPUT_KEY),
        markerNode(NODE_X, UUID_C, TARGET_OUTPUT_KEY),
      ],
      changes: [],
    }));
    expect((await canvasRow())?.version).toBe(targetPlaced.version);
    expect(await canvasNodeIds()).toEqual([seg1, NODE_C].sort());
    expect(await outputState(UUID_C, TARGET_OUTPUT_KEY)).toEqual({ state: "pending", revision: 1 });
    expect(await receiptOf(CMD("40002"))).toBeNull();
    expect(await receiptOf(CMD("40004"))).toBeNull();
  });

  it("★ 5. 同 id 重复带标记卡与畸形 protocolVersion 标记 → 422 且整笔回滚", async () => {
    const jobC = await accept(acceptance(UUID_C, NODE_C, "video_scene_split"));
    await succeedSceneSplitJob(jobC.generation_job_id, [
      { index: 1, assetId: "701" },
      { index: 2, assetId: "702" },
    ]);
    const seg1 = multiResultNodeId(UUID_C, "segment:1");
    const seg2 = multiResultNodeId(UUID_C, "segment:2");
    const placed = await save({
      commandId: CMD("50001"), version: null,
      nodes: [markerNode(seg1, UUID_C, "segment:1", "701")],
      changes: [],
    });
    await expectRejection(save({
      commandId: CMD("50002"), version: placed.version,
      nodes: [markerNode(seg1, UUID_C, "segment:1", "701"), markerNode(seg1, UUID_C, "segment:1", "701")],
      changes: [],
    }));
    await expectRejection(save({
      commandId: CMD("50003"), version: placed.version,
      nodes: [
        markerNode(seg1, UUID_C, "segment:1", "701"),
        { id: seg1, type: "mediaNode", position: { x: 1, y: 2 }, data: { assetId: "701" } },
      ],
      changes: [],
    }));
    await expectRejection(save({
      commandId: CMD("50004"), version: placed.version,
      nodes: [
        markerNode(seg1, UUID_C, "segment:1", "701"),
        {
          id: seg2,
          type: "mediaNode",
          position: { x: 1, y: 2 },
          data: { generationRecovery: { protocolVersion: 2, submissionId: UUID_C, outputKey: "segment:2" }, assetId: "702" },
        },
      ],
      changes: [],
    }));
    expect((await canvasRow())?.version).toBe(placed.version);
    expect(await canvasNodeIds()).toEqual([seg1]);
    expect(await receiptOf(CMD("50002"))).toBeNull();
    expect(await receiptOf(CMD("50003"))).toBeNull();
    expect(await receiptOf(CMD("50004"))).toBeNull();
  });

  it("★ 6. $target replaced 终态重现：fanned 后占位卡重现 → 422 且整笔回滚", async () => {
    const jobC = await accept(acceptance(UUID_C, NODE_C, "video_scene_split"));
    await succeedSceneSplitJob(jobC.generation_job_id, [
      { index: 1, assetId: "701" },
      { index: 2, assetId: "702" },
    ]);
    const seg1 = multiResultNodeId(UUID_C, "segment:1");
    const seg2 = multiResultNodeId(UUID_C, "segment:2");
    const fanned = await save({
      commandId: CMD("60001"), version: null,
      nodes: [markerNode(seg1, UUID_C, "segment:1", "701"), markerNode(seg2, UUID_C, "segment:2", "702")],
      changes: [
        { id: recoveryItemId(UUID_C, TARGET_OUTPUT_KEY), rev: 1, action: "replaceTarget" },
        { id: recoveryItemId(UUID_C, "segment:1"), rev: 0, action: "apply" },
        { id: recoveryItemId(UUID_C, "segment:2"), rev: 0, action: "apply" },
      ],
    });
    await expectRejection(save({
      commandId: CMD("60002"), version: fanned.version,
      nodes: [
        markerNode(seg1, UUID_C, "segment:1", "701"),
        markerNode(seg2, UUID_C, "segment:2", "702"),
        markerNode(NODE_C, UUID_C, TARGET_OUTPUT_KEY),
      ],
      changes: [],
    }));
    expect((await canvasRow())?.version).toBe(fanned.version);
    expect(await canvasNodeIds()).toEqual([seg1, seg2].sort());
    expect(await outputState(UUID_C, TARGET_OUTPUT_KEY)).toEqual({ state: "replaced", revision: 2 });
    expect(await receiptOf(CMD("60002"))).toBeNull();
  });

  it("★ 7. $target transferred 终态重现：接管后旧占位卡重现 → 422 且整笔回滚", async () => {
    await accept(acceptance(UUID_A, NODE_A));
    await accept(acceptance(UUID_B, NODE_A, "image", 1));
    expect(await outputState(UUID_A, TARGET_OUTPUT_KEY)).toEqual({ state: "transferred", revision: 2 });
    await expectRejection(save({
      commandId: CMD("70001"), version: null,
      nodes: [markerNode(NODE_A, UUID_A, TARGET_OUTPUT_KEY)],
      changes: [],
    }));
    expect(await canvasRow()).toBeNull();
    expect(await outputState(UUID_A, TARGET_OUTPUT_KEY)).toEqual({ state: "transferred", revision: 2 });
    expect(await receiptOf(CMD("70001"))).toBeNull();
  });
});
