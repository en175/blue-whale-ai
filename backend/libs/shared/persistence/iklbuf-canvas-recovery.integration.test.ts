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

const databaseUrl = process.env.IKLBUF_DATABASE_URL;

describe.skipIf(!databaseUrl)("陈旧标记推进到持有者同提交的产物键（IKLBUF）", () => {
  let prisma: PrismaClient;
  let raw: Pool;

  const PROJECT_ID = "940002";
  const USER_ID = "940010";
  const NODE = "iklbuf-node";
  const UUID_A = "7d1a2b3c-0000-4000-8000-00000000a001";
  const UUID_B = "7d1a2b3c-0000-4000-8000-00000000b002";
  const UUID_C = "7d1a2b3c-0000-4000-8000-00000000c003";
  const CMD = (suffix: string) => `7d1a2b3c-0000-4000-8000-0000000${suffix}`;

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

  async function acceptJob(args: { submissionId: string; node: string; revision?: number }) {
    return prisma.$transaction(async (tx) => {
      const locked = await lockCanvasRecoveryForAcceptance(tx, acceptance(args.submissionId, args.node, args.revision ?? 0));
      if (locked.kind !== "plan") throw new Error(`受理未成计划：${locked.kind}`);
      const created = await createJobWithinTx(tx, {
        projectId: PROJECT_ID,
        userId: USER_ID,
        type: "image",
        expectedOutputCount: 1,
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
    const owner = await prisma.generation_canvas_node_owners.findUnique({
      where: { project_id_node_id: { project_id: BigInt(PROJECT_ID), node_id: nodeId } },
    });
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
    );
  });
});
