import { clearEffectiveRecoveryOwners, findEffectiveRecoveryOwner } from "./recovery-owner-test-helpers.js";
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
import { createJobWithinTx } from "./generation-command-repo.js";
import { outputSlotNodeId, slotOutputKey } from "./canvas-recovery-multi-output.js";
import type { PrismaClient } from "@prisma/client";

const databaseUrl = process.env.IKPD88_DATABASE_URL;

describe.skipIf(!databaseUrl)("画布恢复保存以对齐取代校验（IKPD88 / IKPD8E / IKPD8H）", () => {
  let prisma: PrismaClient;
  let raw: Pool;

  const PROJECT_ID = "940100";
  const USER_ID = "940110";
  const NODE = "ikpd88-node";
  const CARD = "ikpd88-card";
  const UUID_A = "9a1b2c3d-0000-4000-8000-00000000a001";
  const UUID_B = "9a1b2c3d-0000-4000-8000-00000000b002";
  const CMD = (suffix: string) => `9a1b2c3d-0000-4000-8000-0000000${suffix}`;

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

  function acceptance(submissionId: string, node: string, revision = 0): CanvasRecoveryAcceptance {
    return {
      projectId: PROJECT_ID,
      userId: USER_ID,
      binding: binding(submissionId, node, revision),
      operation: "generation.create",
      requestHash: `hash-${submissionId}`,
      idempotencyKey: submissionId,
      taskType: "image",
    };
  }

  async function acceptJob(args: { submissionId: string; node: string; revision?: number; expectedOutputCount?: number }) {
    return prisma.$transaction(async (tx) => {
      const locked = await lockCanvasRecoveryForAcceptance(tx, acceptance(args.submissionId, args.node, args.revision ?? 0));
      if (locked.kind !== "plan") throw new Error(`受理未成计划：${locked.kind}`);
      const created = await createJobWithinTx(tx, {
        projectId: PROJECT_ID,
        userId: USER_ID,
        type: "image",
        expectedOutputCount: args.expectedOutputCount ?? 1,
        input: { prompt: "whale" },
        actionIdentity: `ikpd88-${args.submissionId}`,
        actionType: "generate_image",
      }, undefined, { key: args.submissionId, requestHash: `hash-${args.submissionId}` });
      await writeCanvasRecoveryRows(tx, locked.plan, BigInt(created.generation_job_id));
      return created;
    });
  }

  async function succeed(jobId: bigint, assets: string[]) {
    await raw.query(
      "UPDATE generation_jobs SET status='succeeded', output_asset_ids=CAST(? AS JSON) WHERE id = ?",
      [JSON.stringify(assets), Number(jobId)],
    );
  }

  function markerNode(
    id: string,
    submissionId: string,
    outputKey: string,
    overrides: { assetId?: string } = {},
  ) {
    return {
      id,
      type: "mediaNode",
      position: { x: 1, y: 2 },
      data: {
        generationRecovery: { protocolVersion: 1, submissionId, outputKey },
        assetId: overrides.assetId ?? "7",
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
      confirmEmpty: args.nodes.length === 0,
      commandId: args.commandId,
      changes: args.changes.map(change => ({
        recoveryItemId: change.id,
        expectedRevision: change.rev,
        action: change.action,
      })),
    });
  }

  async function submissionRow(submissionId: string) {
    const row = await prisma.generation_canvas_submissions.findUnique({
      where: { project_id_submission_id: { project_id: BigInt(PROJECT_ID), submission_id: submissionId } },
    });
    if (row === null) throw new Error("提交不存在");
    return row;
  }

  async function submissionState(submissionId: string) {
    return (await submissionRow(submissionId)).target_state;
  }

  async function ownerOf(nodeId: string) {
    const owner = await findEffectiveRecoveryOwner(prisma, BigInt(PROJECT_ID), nodeId);
    if (owner === null) return null;
    const submission = await prisma.generation_canvas_submissions.findUnique({ where: { id: owner.generation_canvas_submission_id } });
    return { submissionId: submission?.submission_id ?? null, outputKey: owner.output_key };
  }

  async function outputsOf(submissionId: string) {
    const submission = await submissionRow(submissionId);
    const rows = await prisma.generation_canvas_outputs.findMany({
      where: { generation_canvas_submission_id: submission.id },
      orderBy: { output_key: "asc" },
    });
    return rows.map(row => ({
      outputKey: row.output_key,
      nodeId: row.node_id,
      state: row.state,
      assetId: row.asset_id === null ? null : row.asset_id.toString(),
    }));
  }

  async function expectEnvelope(promise: Promise<unknown>, code: number, reason: string) {
    return promise.then(
      () => { throw new Error("应拒绝"); },
      (error: unknown) => {
        expect(error).toBeInstanceOf(RecoveryContractError);
        expect((error as RecoveryContractError).envelope).toMatchObject({ code, data: { reason } });
        return (error as RecoveryContractError).envelope;
      },
    );
  }

  beforeAll(async () => {
    prisma = getPrismaClient(databaseUrl!);
    const adapter = await new PrismaMariaDb(buildPoolConfig(databaseUrl!)).connect();
    raw = adapter.underlyingDriver();
    await prisma.project.create({ data: { id: BigInt(PROJECT_ID), owner_id: BigInt(USER_ID), name: "ikpd88" } });
  });

  afterAll(async () => {
    if (!prisma) return;
    await prisma.project.deleteMany({ where: { id: BigInt(PROJECT_ID) } });
    await raw.end();
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await clearEffectiveRecoveryOwners(prisma, BigInt(PROJECT_ID));
    await prisma.generation_canvas_outputs.deleteMany({});
    await prisma.generation_canvas_submissions.deleteMany({ where: { project_id: BigInt(PROJECT_ID) } });
    await prisma.project_command_receipts.deleteMany({ where: { project_id: BigInt(PROJECT_ID) } });
    await prisma.project_canvas.deleteMany({ where: { project_id: BigInt(PROJECT_ID) } });
    await prisma.generation_output_slots.deleteMany({ where: { project_id: BigInt(PROJECT_ID) } });
    await prisma.generation_job_logs.deleteMany({});
    await prisma.billing_cost_reservations.deleteMany({});
    await prisma.generation_jobs.deleteMany({ where: { project_id: BigInt(PROJECT_ID) } });
  });

  it("★ 1. 432/1541 形状：replaceTarget 只声明 $target，单输出由服务端补齐", async () => {
    const created = await acceptJob({ submissionId: UUID_A, node: NODE });
    await succeed(BigInt(created.generation_job_id), ["700"]);
    const base = await save({
      commandId: CMD("00001"),
      version: null,
      nodes: [markerNode(NODE, UUID_A, TARGET_OUTPUT_KEY)],
      changes: [],
    });

    const promoted = await save({
      commandId: CMD("00002"),
      version: base.version,
      nodes: [markerNode(NODE, UUID_A, PRIMARY_OUTPUT_KEY, { assetId: "700" })],
      changes: [{ id: recoveryItemId(UUID_A, TARGET_OUTPUT_KEY), rev: 1, action: "replaceTarget" }],
    });

    expect(promoted.version).toBe(base.version + 1);
    expect(await submissionState(UUID_A)).toBe("replaced");
    expect(await outputsOf(UUID_A)).toEqual([
      { outputKey: PRIMARY_OUTPUT_KEY, nodeId: NODE, state: "present", assetId: "700" },
    ]);
    expect(await ownerOf(NODE)).toEqual({ submissionId: UUID_A, outputKey: PRIMARY_OUTPUT_KEY });
  });

  it("★ 2. 多输出：replaceTarget 不逐条声明 slot，服务端补齐全部输出并建归属", async () => {
    const created = await acceptJob({ submissionId: UUID_A, node: CARD, expectedOutputCount: 2 });
    const jobId = BigInt(created.generation_job_id);
    const slots = await prisma.generation_output_slots.findMany({
      where: { generation_job_id: jobId },
      orderBy: { slot_index: "asc" },
    });
    await prisma.generation_output_slots.update({ where: { id: slots[0]!.id }, data: { status: "succeeded", asset_id: 601n } });
    await prisma.generation_output_slots.update({ where: { id: slots[1]!.id }, data: { status: "succeeded", asset_id: 602n } });
    await succeed(jobId, ["601", "602"]);

    const base = await save({
      commandId: CMD("10001"),
      version: null,
      nodes: [markerNode(CARD, UUID_A, TARGET_OUTPUT_KEY)],
      changes: [],
    });

    await save({
      commandId: CMD("10002"),
      version: base.version,
      nodes: [markerNode(CARD, UUID_A, TARGET_OUTPUT_KEY)],
      changes: [{ id: recoveryItemId(UUID_A, TARGET_OUTPUT_KEY), rev: 1, action: "replaceTarget" }],
    });

    const slotKey0 = slotOutputKey(slots[0]!.id);
    const slotKey1 = slotOutputKey(slots[1]!.id);
    expect(await outputsOf(UUID_A)).toEqual([
      { outputKey: slotKey0, nodeId: outputSlotNodeId(slots[0]!.id), state: "present", assetId: "601" },
      { outputKey: slotKey1, nodeId: outputSlotNodeId(slots[1]!.id), state: "present", assetId: "602" },
    ]);
    expect(await ownerOf(outputSlotNodeId(slots[0]!.id))).toEqual({ submissionId: UUID_A, outputKey: slotKey0 });
    expect(await ownerOf(outputSlotNodeId(slots[1]!.id))).toEqual({ submissionId: UUID_A, outputKey: slotKey1 });
  });

  it("★ 3. 1541 形状：普通写节点带产物但输出未落盘 → 保存时自动补齐", async () => {
    const created = await acceptJob({ submissionId: UUID_A, node: NODE });
    await succeed(BigInt(created.generation_job_id), ["700"]);
    await raw.query(
      "UPDATE generation_canvas_submissions SET target_state='replaced' WHERE project_id=? AND submission_id=?",
      [PROJECT_ID, UUID_A],
    );
    const seed = await prisma.project_canvas.create({
      data: {
        project_id: BigInt(PROJECT_ID),
        version: 5,
        viewport_json: {},
        nodes_json: [markerNode(NODE, UUID_A, PRIMARY_OUTPUT_KEY, { assetId: "700" })],
        edges_json: [],
      },
    });

    const saved = await save({
      commandId: CMD("20001"),
      version: seed.version,
      nodes: [markerNode(NODE, UUID_A, PRIMARY_OUTPUT_KEY, { assetId: "700" })],
      changes: [],
    });

    expect(saved.version).toBe(seed.version + 1);
    expect(await outputsOf(UUID_A)).toEqual([
      { outputKey: PRIMARY_OUTPUT_KEY, nodeId: NODE, state: "present", assetId: "700" },
    ]);
    expect(await ownerOf(NODE)).toEqual({ submissionId: UUID_A, outputKey: PRIMARY_OUTPUT_KEY });
  });

  it("★ 4. 归属冲突返回 409，并带节点定位", async () => {
    const first = await acceptJob({ submissionId: UUID_A, node: NODE });
    await succeed(BigInt(first.generation_job_id), ["700"]);
    const base = await save({
      commandId: CMD("30001"),
      version: null,
      nodes: [markerNode(NODE, UUID_A, TARGET_OUTPUT_KEY)],
      changes: [],
    });
    await acceptJob({ submissionId: UUID_B, node: NODE, revision: 1 });

    const envelope = await expectEnvelope(
      save({
        commandId: CMD("30002"),
        version: base.version,
        nodes: [markerNode(NODE, UUID_A, PRIMARY_OUTPUT_KEY, { assetId: "700" })],
        changes: [{ id: recoveryItemId(UUID_A, PRIMARY_OUTPUT_KEY), rev: 0, action: "apply" }],
      }),
      409,
      RECOVERY_REASONS.itemConflict,
    );
    expect(envelope.data).toMatchObject({ nodeId: NODE, submissionId: UUID_A, outputKey: PRIMARY_OUTPUT_KEY });
  });

  it("★ 5. 守护未松：改受保护节点但未声明、资产被换走 → 422", async () => {
    const created = await acceptJob({ submissionId: UUID_A, node: NODE });
    await succeed(BigInt(created.generation_job_id), ["700"]);
    const base = await save({
      commandId: CMD("40001"),
      version: null,
      nodes: [markerNode(NODE, UUID_A, PRIMARY_OUTPUT_KEY, { assetId: "700" })],
      changes: [],
    });

    await expectEnvelope(
      save({
        commandId: CMD("40002"),
        version: base.version,
        nodes: [markerNode(NODE, UUID_A, PRIMARY_OUTPUT_KEY, { assetId: "999" })],
        changes: [],
      }),
      422,
      RECOVERY_REASONS.documentMismatch,
    );
  });

  it("★ 6. 对齐前资产与可信产物不一致 → 422 带节点定位，且零写入", async () => {
    const created = await acceptJob({ submissionId: UUID_A, node: NODE });
    await succeed(BigInt(created.generation_job_id), ["700"]);
    await raw.query(
      "UPDATE generation_canvas_submissions SET target_state='replaced' WHERE project_id=? AND submission_id=?",
      [PROJECT_ID, UUID_A],
    );
    const seed = await prisma.project_canvas.create({
      data: {
        project_id: BigInt(PROJECT_ID),
        version: 1,
        viewport_json: {},
        nodes_json: [markerNode(NODE, UUID_A, PRIMARY_OUTPUT_KEY, { assetId: "999" })],
        edges_json: [],
      },
    });

    const envelope = await expectEnvelope(
      save({
        commandId: CMD("50001"),
        version: seed.version,
        nodes: [markerNode(NODE, UUID_A, PRIMARY_OUTPUT_KEY, { assetId: "999" })],
        changes: [],
      }),
      422,
      RECOVERY_REASONS.documentMismatch,
    );
    expect(envelope.data).toMatchObject({ nodeId: NODE, submissionId: UUID_A, outputKey: PRIMARY_OUTPUT_KEY });
    expect(await outputsOf(UUID_A)).toEqual([]);
  });
});
