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

const databaseUrl = process.env.IKLBUF_DATABASE_URL;

describe.skipIf(!databaseUrl)("陈旧标记推进到持有者同提交的产物键（IKLBUF）", () => {
  let prisma: PrismaClient;
  let raw: Pool;

  const PROJECT_ID = "940002";
  const USER_ID = "940010";
  const NODE = "iklbuf-node";
  const CARD = "iklbuf-card";
  const UUID_A = "7d1a2b3c-0000-4000-8000-00000000a001";
  const UUID_B = "7d1a2b3c-0000-4000-8000-00000000b002";
  const UUID_C = "7d1a2b3c-0000-4000-8000-00000000c003";
  const CMD = (suffix: string) => `7d1a2b3c-0000-4000-8000-0000000${suffix}`;
  const TAMPERED_MSG = "未声明的受保护项被改动，须以显式恢复动作变更";

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
        actionIdentity: `iklbuf-${args.submissionId}`,
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

  async function expectEnvelope(promise: Promise<unknown>, code: number, reason: string, msg?: string) {
    return promise.then(
      () => { throw new Error("应拒绝"); },
      (error: unknown) => {
        expect(error).toBeInstanceOf(RecoveryContractError);
        expect((error as RecoveryContractError).envelope).toMatchObject({ code, data: { reason } });
        if (msg !== undefined) {
          expect((error as RecoveryContractError).envelope.msg).toBe(msg);
        }
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

  async function seedPromotedCard() {
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
      changes: [
        { id: recoveryItemId(UUID_A, TARGET_OUTPUT_KEY), rev: 1, action: "replaceTarget" },
        { id: recoveryItemId(UUID_A, PRIMARY_OUTPUT_KEY), rev: 0, action: "apply" },
      ],
    });
    return promoted;
  }

  async function takeoverByB() {
    const promoted = await seedPromotedCard();
    const second = await acceptJob({ submissionId: UUID_B, node: NODE, revision: 1 });
    return { promoted, jobB: BigInt(second.generation_job_id) };
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
    const slotNode0 = outputSlotNodeId(slots[0]!.id);
    const base = await save({
      commandId: CMD("50001"),
      version: null,
      nodes: [markerNode(CARD, UUID_A, TARGET_OUTPUT_KEY)],
      changes: [],
    });
    const placed = await save({
      commandId: CMD("50002"),
      version: base.version,
      nodes: [
        markerNode(CARD, UUID_A, TARGET_OUTPUT_KEY),
        markerNode(slotNode0, UUID_A, slotKey0, { assetId: "601" }),
      ],
      changes: [{ id: recoveryItemId(UUID_A, slotKey0), rev: 0, action: "apply" }],
    });
    return { placed, slotKey0, slotNode0 };
  }

  beforeAll(async () => {
    prisma = getPrismaClient(databaseUrl!);
    const adapter = await new PrismaMariaDb(buildPoolConfig(databaseUrl!)).connect();
    raw = adapter.underlyingDriver();
    await prisma.project.create({ data: { id: BigInt(PROJECT_ID), owner_id: BigInt(USER_ID), name: "iklbuf" } });
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

  it("★ 1. 文档标记停在上一提交、持有者在新提交的 $target，来件推进到该提交的 primary → 保存成功", async () => {
    const { promoted, jobB } = await takeoverByB();
    expect(await submissionState(UUID_A)).toBe("transferred");
    expect(await ownerOf(NODE)).toEqual({ submissionId: UUID_B, outputKey: TARGET_OUTPUT_KEY });

    await succeed(jobB, ["800"]);

    const advanced = await save({
      commandId: CMD("10001"),
      version: promoted.version,
      nodes: [markerNode(NODE, UUID_B, PRIMARY_OUTPUT_KEY, { assetId: "800" })],
      changes: [
        { id: recoveryItemId(UUID_B, TARGET_OUTPUT_KEY), rev: 1, action: "replaceTarget" },
        { id: recoveryItemId(UUID_B, PRIMARY_OUTPUT_KEY), rev: 0, action: "apply" },
      ],
    });
    expect(advanced.version).toBe(promoted.version + 1);
    expect(await submissionState(UUID_B)).toBe("replaced");
    expect(await ownerOf(NODE)).toEqual({ submissionId: UUID_B, outputKey: PRIMARY_OUTPUT_KEY });
  });

  it("★ 2. 守护未松：来件仍是那条陈旧标记、资产被换走 → 422", async () => {
    const { promoted } = await takeoverByB();

    await expectEnvelope(
      save({
        commandId: CMD("20001"),
        version: promoted.version,
        nodes: [markerNode(NODE, UUID_A, PRIMARY_OUTPUT_KEY, { assetId: "999" })],
        changes: [],
      }),
      422,
      RECOVERY_REASONS.documentMismatch,
      TAMPERED_MSG,
    );
  });

  it("★ 3. 守护未松：来件标记既非旧标记、也非持有者、且未声明 → 422", async () => {
    const { promoted } = await takeoverByB();

    await expectEnvelope(
      save({
        commandId: CMD("30001"),
        version: promoted.version,
        nodes: [markerNode(NODE, UUID_C, PRIMARY_OUTPUT_KEY, { assetId: "700" })],
        changes: [],
      }),
      422,
      RECOVERY_REASONS.documentMismatch,
      TAMPERED_MSG,
    );
  });

  it("★ 4. 多输出节点不放宽：陈旧槽位标记的资产被换走 → 422", async () => {
    const { placed, slotKey0, slotNode0 } = await seedSlotCard();

    await expectEnvelope(
      save({
        commandId: CMD("40001"),
        version: placed.version,
        nodes: [
          markerNode(CARD, UUID_A, TARGET_OUTPUT_KEY),
          markerNode(slotNode0, UUID_A, slotKey0, { assetId: "999" }),
        ],
        changes: [],
      }),
      422,
      RECOVERY_REASONS.documentMismatch,
      TAMPERED_MSG,
    );
  });
});
