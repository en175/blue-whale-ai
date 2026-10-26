























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
import type { PrismaClient } from "@prisma/client";

const databaseUrl = process.env.IKJKU8_DATABASE_URL;

describe.skipIf(!databaseUrl)("恢复保存回执丢失可安全重放（IKJKU8）", () => {
  let prisma: PrismaClient;
  let raw: Pool;

  const PROJECT_ID = "940001";
  const USER_ID = "940009";
  const NODE_A = "ikjku8-node-a";
  const UUID_A = "3c4d5e6f-0000-4000-8000-00000000a001";
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

  function acceptance(submissionId: string, node: string): CanvasRecoveryAcceptance {
    return {
      projectId: PROJECT_ID,
      userId: USER_ID,
      binding: binding(submissionId, node, 0),
      operation: "generation.create",
      requestHash: `hash-${submissionId}`,
      idempotencyKey: submissionId,
      taskType: "image",
    };
  }

  async function accept(acceptanceInput: CanvasRecoveryAcceptance) {
    return prisma.$transaction(async (tx) => {
      const locked = await lockCanvasRecoveryForAcceptance(tx, acceptanceInput);
      if (locked.kind !== "plan") return locked;
      const created = await createJobWithinTx(tx, {
        projectId: acceptanceInput.projectId,
        userId: acceptanceInput.userId,
        type: "image",
        expectedOutputCount: 1,
        input: { prompt: "whale" },
        actionIdentity: `ikjku8-${acceptanceInput.binding.submission_id}`,
        actionType: "generate_image",
      }, undefined, { key: acceptanceInput.idempotencyKey, requestHash: acceptanceInput.requestHash });
      await writeCanvasRecoveryRows(tx, locked.plan, BigInt(created.generation_job_id));
      return created;
    });
  }

  function markerNode(
    id: string,
    submissionId: string,
    outputKey: string,
    overrides: { name?: string } = {},
  ) {
    return {
      id,
      type: "mediaNode",
      position: { x: 1, y: 2 },
      data: {
        generationRecovery: { protocolVersion: 1, submissionId, outputKey },
        assetId: "7",
        ...(overrides.name !== undefined ? { name: overrides.name } : {}),
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

  async function expectCommandReused(promise: Promise<unknown>) {
    return promise.then(
      () => { throw new Error("应按 commandReused 拒绝"); },
      (error: unknown) => {
        expect(error).toBeInstanceOf(RecoveryContractError);
        expect((error as RecoveryContractError).envelope).toMatchObject({
          code: 409, data: { reason: RECOVERY_REASONS.commandReused },
        });
      },
    );
  }

  async function canvasVersion(): Promise<number | null> {
    const row = await prisma.canvas.findFirst({ where: { project_id: BigInt(PROJECT_ID) } });
    return row ? row.version : null;
  }

  async function idempotencyRows(): Promise<number> {
    return prisma.command_idempotency.count({ where: { project_id: BigInt(PROJECT_ID) } });
  }



  async function seedLostReceiptSave() {
    const job = await accept(acceptance(UUID_A, NODE_A));
    await raw.query(
      "UPDATE generation_jobs SET status='succeeded', output_asset_ids=CAST(? AS JSON) WHERE id = ?",
      ['["7"]', Number(job.generation_job_id)],
    );
    const base = await save({
      commandId: CMD("00001"),
      version: null,
      nodes: [markerNode(NODE_A, UUID_A, TARGET_OUTPUT_KEY)],
      changes: [],
    });

    const lost = await save({
      commandId: CMD("00002"),
      version: base.version,
      nodes: [markerNode(NODE_A, UUID_A, PRIMARY_OUTPUT_KEY)],
      changes: [
        { id: recoveryItemId(UUID_A, TARGET_OUTPUT_KEY), rev: 1, action: "replaceTarget" },
        { id: recoveryItemId(UUID_A, PRIMARY_OUTPUT_KEY), rev: 0, action: "apply" },
      ],
    });
    return { base, lost };
  }

  beforeAll(async () => {
    prisma = getPrismaClient(databaseUrl!);
    const adapter = await new PrismaMariaDb(buildPoolConfig(databaseUrl!)).connect();
    raw = adapter.underlyingDriver();
    await prisma.project.create({ data: { id: BigInt(PROJECT_ID), owner_id: BigInt(USER_ID), name: "ikjku8" } });
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

  it("★ 1. 丢回执后原样重发：replayed=true 回放原回执，状态和版本不重复推进", async () => {
    const { base, lost } = await seedLostReceiptSave();
    expect(lost.recoveryReceipt.replayed).toBe(false);
    const rowsAfterFirst = await idempotencyRows();


    const replayed = await save({
      commandId: CMD("00002"),
      version: base.version,
      nodes: [markerNode(NODE_A, UUID_A, PRIMARY_OUTPUT_KEY)],
      changes: [
        { id: recoveryItemId(UUID_A, TARGET_OUTPUT_KEY), rev: 1, action: "replaceTarget" },
        { id: recoveryItemId(UUID_A, PRIMARY_OUTPUT_KEY), rev: 0, action: "apply" },
      ],
    });
    expect(replayed.recoveryReceipt.replayed).toBe(true);
    expect(replayed.version).toBe(lost.version);
    expect(replayed.recoveryReceipt.changes).toEqual(lost.recoveryReceipt.changes);

    expect(await canvasVersion()).toBe(lost.version);
    expect(await idempotencyRows()).toBe(rowsAfterFirst);
  });

  it("2. 重放带旧 If-Match 不触发 412——幂等回读先于版本检查（服务端版本已推进仍安全重放）", async () => {
    const { base, lost } = await seedLostReceiptSave();


    expect(base.version).not.toBe(lost.version);
    const replayed = await save({
      commandId: CMD("00002"),
      version: base.version,
      nodes: [markerNode(NODE_A, UUID_A, PRIMARY_OUTPUT_KEY)],
      changes: [
        { id: recoveryItemId(UUID_A, TARGET_OUTPUT_KEY), rev: 1, action: "replaceTarget" },
        { id: recoveryItemId(UUID_A, PRIMARY_OUTPUT_KEY), rev: 0, action: "apply" },
      ],
    });
    expect(replayed.recoveryReceipt.replayed).toBe(true);
  });

  it("3. 同 commandId 换载荷或换 If-Match → 409 commandReused（调用方必须保留原载荷与版本）", async () => {
    const { base } = await seedLostReceiptSave();

    await expectCommandReused(save({
      commandId: CMD("00002"),
      version: base.version,
      nodes: [markerNode(NODE_A, UUID_A, PRIMARY_OUTPUT_KEY, { name: "编辑后" })],
      changes: [
        { id: recoveryItemId(UUID_A, TARGET_OUTPUT_KEY), rev: 1, action: "replaceTarget" },
        { id: recoveryItemId(UUID_A, PRIMARY_OUTPUT_KEY), rev: 0, action: "apply" },
      ],
    }));

    await expectCommandReused(save({
      commandId: CMD("00002"),
      version: base.version + 1,
      nodes: [markerNode(NODE_A, UUID_A, PRIMARY_OUTPUT_KEY)],
      changes: [
        { id: recoveryItemId(UUID_A, TARGET_OUTPUT_KEY), rev: 1, action: "replaceTarget" },
        { id: recoveryItemId(UUID_A, PRIMARY_OUTPUT_KEY), rev: 0, action: "apply" },
      ],
    }));
  });

  it("4. 重放命中后新命令保存照常推进版本（重放不阻塞后续）", async () => {
    const { base, lost } = await seedLostReceiptSave();
    const replayed = await save({
      commandId: CMD("00002"),
      version: base.version,
      nodes: [markerNode(NODE_A, UUID_A, PRIMARY_OUTPUT_KEY)],
      changes: [
        { id: recoveryItemId(UUID_A, TARGET_OUTPUT_KEY), rev: 1, action: "replaceTarget" },
        { id: recoveryItemId(UUID_A, PRIMARY_OUTPUT_KEY), rev: 0, action: "apply" },
      ],
    });
    expect(replayed.recoveryReceipt.replayed).toBe(true);

    const next = await save({
      commandId: CMD("00003"),
      version: lost.version,
      nodes: [markerNode(NODE_A, UUID_A, PRIMARY_OUTPUT_KEY, { name: "后续编辑" })],
      changes: [],
    });
    expect(next.version).toBe(lost.version + 1);
    expect(next.recoveryReceipt.replayed).toBe(false);
  });
});
