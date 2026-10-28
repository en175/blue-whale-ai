import { clearEffectiveRecoveryOwners, findEffectiveRecoveryOwner } from "./recovery-owner-test-helpers.js";
import { PrismaMariaDb } from "@prisma/adapter-mariadb";
import type { Pool } from "mariadb";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildPoolConfig, getPrismaClient } from "./db.js";
import {
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

const databaseUrl = process.env.IKKBL9_DATABASE_URL;

describe.skipIf(!databaseUrl)("受保护项判据锚定节点持有者（IKKBL9）", () => {
  let prisma: PrismaClient;
  let raw: Pool;

  const PROJECT_ID = "940001";
  const USER_ID = "940009";
  const NODE_A = "ikkbl9-node-a";
  const CARD = "ikkbl9-card";
  const STRAY = "ikkbl9-stray";
  const UUID_A = "3c4d5e6f-0000-4000-8000-00000000a001";
  const UUID_B = "3c4d5e6f-0000-4000-8000-00000000b002";
  const UUID_C = "3c4d5e6f-0000-4000-8000-00000000c003";
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

  async function acceptJob(args: {
    submissionId: string;
    node: string;
    revision?: number;
    expectedOutputCount?: number;
  }) {
    return prisma.$transaction(async (tx) => {
      const locked = await lockCanvasRecoveryForAcceptance(tx, acceptance(args.submissionId, args.node, args.revision ?? 0));
      if (locked.kind !== "plan") throw new Error(`受理未成计划：${locked.kind}`);
      const created = await createJobWithinTx(tx, {
        projectId: PROJECT_ID,
        userId: USER_ID,
        type: "image",
        expectedOutputCount: args.expectedOutputCount ?? 1,
        input: { prompt: "whale" },
        actionIdentity: `ikkbl9-${args.submissionId}`,
        actionType: "generate_image",
      }, undefined, { key: args.submissionId, requestHash: `hash-${args.submissionId}` });
      await writeCanvasRecoveryRows(tx, locked.plan, BigInt(created.generation_job_id));
      return created;
    });
  }

  async function cancelJob(jobId: bigint) {
    await raw.query("UPDATE generation_jobs SET status='cancelled' WHERE id = ?", [Number(jobId)]);
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

  async function expectEnvelope(promise: Promise<unknown>, code: number, reason: string) {
    return promise.then(
      () => { throw new Error("应拒绝"); },
      (error: unknown) => {
        expect(error).toBeInstanceOf(RecoveryContractError);
        expect((error as RecoveryContractError).envelope).toMatchObject({ code, data: { reason } });
      },
    );
  }

  async function submissionState(submissionId: string) {
    const row = await prisma.generation_canvas_submissions.findUnique({
      where: { project_id_submission_id: { project_id: BigInt(PROJECT_ID), submission_id: submissionId } },
    });
    return row?.target_state ?? null;
  }

  async function ownerOf(nodeId: string) {
    const owner = await findEffectiveRecoveryOwner(prisma, BigInt(PROJECT_ID), nodeId);
    if (owner === null) return null;
    const submission = await prisma.generation_canvas_submissions.findUnique({ where: { id: owner.generation_canvas_submission_id } });
    return { submissionId: submission?.submission_id ?? null, outputKey: owner.output_key };
  }

  async function seedTargetCard() {
    const created = await acceptJob({ submissionId: UUID_A, node: NODE_A });
    const base = await save({
      commandId: CMD("00001"),
      version: null,
      nodes: [markerNode(NODE_A, UUID_A, TARGET_OUTPUT_KEY)],
      changes: [],
    });
    return { base, jobA: BigInt(created.generation_job_id) };
  }

  async function takeoverTargetCard() {
    const seeded = await seedTargetCard();
    const second = await acceptJob({ submissionId: UUID_B, node: NODE_A, revision: 1 });
    return { ...seeded, jobB: BigInt(second.generation_job_id) };
  }

  async function seedSlotCard() {
    const created = await acceptJob({ submissionId: UUID_A, node: CARD, expectedOutputCount: 2 });
    const jobId = BigInt(created.generation_job_id);
    const slots = await prisma.generation_output_slots.findMany({
      where: { generation_job_id: jobId },
      orderBy: { slot_index: "asc" },
    });
    await prisma.generation_output_slots.update({ where: { id: slots[0]!.id }, data: { status: "succeeded", asset_id: 601n } });
    await prisma.generation_output_slots.update({ where: { id: slots[1]!.id }, data: { status: "succeeded", asset_id: 602n } });
    await raw.query(
      "UPDATE generation_jobs SET status='succeeded', output_asset_ids=CAST(? AS JSON) WHERE id = ?",
      [JSON.stringify(["601", "602"]), Number(jobId)],
    );
    const slotKey0 = slotOutputKey(slots[0]!.id);
    const slotKey1 = slotOutputKey(slots[1]!.id);
    const slotNode0 = outputSlotNodeId(slots[0]!.id);
    const slotNode1 = outputSlotNodeId(slots[1]!.id);
    const base = await save({
      commandId: CMD("00010"),
      version: null,
      nodes: [markerNode(CARD, UUID_A, TARGET_OUTPUT_KEY)],
      changes: [],
    });
    const placed = await save({
      commandId: CMD("00011"),
      version: base.version,
      nodes: [
        markerNode(CARD, UUID_A, TARGET_OUTPUT_KEY),
        markerNode(slotNode0, UUID_A, slotKey0, { assetId: "601" }),
        markerNode(slotNode1, UUID_A, slotKey1, { assetId: "602" }),
      ],
      changes: [
        { id: recoveryItemId(UUID_A, slotKey0), rev: 0, action: "apply" },
        { id: recoveryItemId(UUID_A, slotKey1), rev: 0, action: "apply" },
      ],
    });
    return { placed, slotKey0, slotKey1, slotNode0, slotNode1 };
  }
  beforeAll(async () => {
    prisma = getPrismaClient(databaseUrl!);
    const adapter = await new PrismaMariaDb(buildPoolConfig(databaseUrl!)).connect();
    raw = adapter.underlyingDriver();
    await prisma.project.create({ data: { id: BigInt(PROJECT_ID), owner_id: BigInt(USER_ID), name: "ikkbl9" } });
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
    await prisma.project_edges.deleteMany({ where: { project_id: BigInt(PROJECT_ID) } });
    await prisma.project_nodes.deleteMany({ where: { project_id: BigInt(PROJECT_ID) } });
    await prisma.generation_output_slots.deleteMany({ where: { project_id: BigInt(PROJECT_ID) } });
    await prisma.generation_job_logs.deleteMany({});
    await prisma.billing_cost_reservations.deleteMany({});
    await prisma.generation_jobs.deleteMany({ where: { project_id: BigInt(PROJECT_ID) } });
  });

  it("★ 1. 目标节点被新提交接管：文档旧标记陈旧，来件已推进到持有者 → 保存成功", async () => {
    const { base } = await takeoverTargetCard();
    expect(await submissionState(UUID_A)).toBe("transferred");
    expect(await ownerOf(NODE_A)).toEqual({ submissionId: UUID_B, outputKey: TARGET_OUTPUT_KEY });

    const advanced = await save({
      commandId: CMD("10001"),
      version: base.version,
      nodes: [markerNode(NODE_A, UUID_B, TARGET_OUTPUT_KEY)],
      changes: [],
    });
    expect(advanced.version).toBe(base.version + 1);
    expect(await submissionState(UUID_B)).toBe("pending");
  });

  it("★ 2. 陈旧节点的缺席仍受守护：不声明持有者 → 422；声明持有者 → 放行", async () => {
    const { base, jobB } = await takeoverTargetCard();

    await expectEnvelope(
      save({ commandId: CMD("20001"), version: base.version, nodes: [], changes: [] }),
      422,
      RECOVERY_REASONS.documentMismatch,
    );
    await expectEnvelope(
      save({
        commandId: CMD("20002"), version: base.version, nodes: [],
        changes: [{ id: recoveryItemId(UUID_A, TARGET_OUTPUT_KEY), rev: 2, action: "remove" }],
      }),
      409,
      RECOVERY_REASONS.itemConflict,
    );

    await cancelJob(jobB);
    const cleared = await save({
      commandId: CMD("20003"), version: base.version, nodes: [],
      changes: [{ id: recoveryItemId(UUID_B, TARGET_OUTPUT_KEY), rev: 1, action: "remove" }],
    });
    expect(cleared.version).toBe(base.version + 1);
    expect(await submissionState(UUID_B)).toBe("removed");
  });

  it("★ 3. slot 节点跨提交共享：旧槽位标记陈旧，来件已推进到持有者 → 保存成功", async () => {
    const { placed, slotKey0, slotKey1, slotNode0, slotNode1 } = await seedSlotCard();
    expect(await ownerOf(slotNode0)).toEqual({ submissionId: UUID_A, outputKey: slotKey0 });

    const second = await acceptJob({ submissionId: UUID_B, node: slotNode0, revision: 1 });
    expect(second.generation_job_id).toBeTruthy();
    expect(await submissionState(UUID_A)).toBe("transferred");
    expect(await ownerOf(slotNode0)).toEqual({ submissionId: UUID_B, outputKey: TARGET_OUTPUT_KEY });
    expect(await ownerOf(slotNode1)).toEqual({ submissionId: UUID_A, outputKey: slotKey1 });

    const advanced = await save({
      commandId: CMD("30001"),
      version: placed.version,
      nodes: [
        markerNode(CARD, UUID_A, TARGET_OUTPUT_KEY),
        markerNode(slotNode0, UUID_B, TARGET_OUTPUT_KEY),
        markerNode(slotNode1, UUID_A, slotKey1, { assetId: "602" }),
      ],
      changes: [],
    });
    expect(advanced.version).toBe(placed.version + 1);
  });

  it("★ 4. 守护未松：来件既非旧标记也非当前持有者 → 422", async () => {
    const { base } = await takeoverTargetCard();

    await expectEnvelope(
      save({
        commandId: CMD("40001"), version: base.version,
        nodes: [markerNode(NODE_A, UUID_C, TARGET_OUTPUT_KEY)],
        changes: [],
      }),
      422,
      RECOVERY_REASONS.documentMismatch,
    );

    await expectEnvelope(
      save({
        commandId: CMD("40002"), version: base.version,
        nodes: [{ id: STRAY, type: "textNode", position: { x: 0, y: 0 }, data: {} }],
        changes: [],
      }),
      422,
      RECOVERY_REASONS.documentMismatch,
    );
  });
});
