


import { randomUUID } from "node:crypto";

import { PrismaMariaDb } from "@prisma/adapter-mariadb";
import type { PrismaClient } from "@prisma/client";
import type { Pool } from "mariadb";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { PRIMARY_OUTPUT_KEY, RECOVERY_REASONS, SAVE_CANVAS_RECOVERY_OPERATION, TARGET_OUTPUT_KEY, recoveryItemId } from "@lib/contracts";
import { CanvasService } from "@lib/shared/canvas/canvas.service.js";

import { buildPoolConfig, getPrismaClient } from "./db.js";
import { createJobWithinTx } from "./generation-command-repo.js";
import { lockCanvasRecoveryForAcceptance, writeCanvasRecoveryRows } from "./generation-canvas-recovery-repo.js";

const databaseUrl = process.env.IKJLXE_DATABASE_URL;

describe.skipIf(!databaseUrl)("首次 primary 必须原子转换目标（IKJLXE）", () => {
  let prisma: PrismaClient;
  let raw: Pool;
  let service: CanvasService;
  const PROJECT_ID = "970101";
  const USER_ID = "970009";
  const ASSET_ID = "970111";
  const SUBMISSION_ID = "6f7a8b9c-0000-4000-8000-00000000a001";
  const NODE_ID = "ikjlxe-primary";

  const resultNode = () => ({
    id: NODE_ID, type: "mediaNode", position: { x: 1, y: 2 },
    data: {
      fileName: "结果卡", assetId: ASSET_ID,
      generationRecovery: { protocolVersion: 1, submissionId: SUBMISSION_ID, outputKey: PRIMARY_OUTPUT_KEY },
    },
  });
  const apply = () => ({ recoveryItemId: recoveryItemId(SUBMISSION_ID, PRIMARY_OUTPUT_KEY), expectedRevision: 0, action: "apply" });
  const replace = () => ({ recoveryItemId: recoveryItemId(SUBMISSION_ID, TARGET_OUTPUT_KEY), expectedRevision: 1, action: "replaceTarget" });

  function save(nodes: Array<Record<string, unknown>>, version: number | null, changes: ReturnType<typeof apply>[], commandId = randomUUID()) {
    return service.save(USER_ID, PROJECT_ID, {
      viewport: "{}", nodes: JSON.stringify(nodes), edges: "[]", expectedVersion: version,
      recoveryProtocolVersion: 1, commandId, recoveryChanges: changes, confirmEmpty: true,
    });
  }

  async function seed(mode: "missing" | "unmarked") {
    if (mode === "unmarked") {
      await prisma.project_canvas.create({ data: {
        project_id: BigInt(PROJECT_ID), viewport_json: {}, edges_json: [],
        nodes_json: [{ id: NODE_ID, type: "mediaNode", position: { x: 0, y: 0 }, data: { fileName: "已保存原卡" } }],
      } });
    }
    const job = await prisma.$transaction(async tx => {
      const locked = await lockCanvasRecoveryForAcceptance(tx, {
        projectId: PROJECT_ID, userId: USER_ID, operation: "generation.create",
        requestHash: "ikjlxe-accept", idempotencyKey: SUBMISSION_ID, taskType: "image",
        binding: {
          protocol_version: 1, submission_id: SUBMISSION_ID, target_node_id: NODE_ID, expected_binding_revision: 0,
          recovery_seed: { target: { role: "result-placeholder", x: 0, y: 0, width: 100, height: 100, name: "" }, sources: [] },
        },
      });
      if (locked.kind !== "plan") throw new Error("测试受理应产生新关联");
      const created = await createJobWithinTx(tx, {
        projectId: PROJECT_ID, userId: USER_ID, type: "image", expectedOutputCount: 1,
        input: { prompt: "whale" }, actionIdentity: `ikjlxe-${SUBMISSION_ID}`, actionType: "generate_image",
      }, undefined, { key: SUBMISSION_ID, requestHash: "ikjlxe-accept" });
      await writeCanvasRecoveryRows(tx, locked.plan, BigInt(created.generation_job_id));
      return created;
    });
    await prisma.user_assets.create({ data: {
      id: BigInt(ASSET_ID), project_id: BigInt(PROJECT_ID), user_id: BigInt(USER_ID),
      generation_job_id: BigInt(job.generation_job_id), type: "image", url: "https://example.test/ikjlxe.png",
    } });
    await raw.query("UPDATE generation_jobs SET status='succeeded', output_asset_ids=CAST(? AS JSON) WHERE id=?", [JSON.stringify([ASSET_ID]), job.generation_job_id]);
    return mode === "unmarked" ? 0 : null;
  }

  async function snapshot() {
    const project_id = BigInt(PROJECT_ID);
    const submissions = await prisma.generation_canvas_submissions.findMany({ where: { project_id } });
    return {
      canvas: await prisma.project_canvas.findUnique({ where: { project_id } }),
      submissions,
      outputs: await prisma.generation_canvas_outputs.findMany({ where: { generation_canvas_submission_id: { in: submissions.map(row => row.id) } } }),
      owners: await prisma.generation_canvas_node_owners.findMany({ where: { project_id } }),
      assets: await prisma.user_assets.findMany({ where: { project_id } }),
      links: await prisma.project_asset.findMany({ where: { project_id } }),
      receipts: await prisma.command_idempotency.findMany({ where: { project_id, operation: SAVE_CANVAS_RECOVERY_OPERATION } }),
    };
  }

  beforeAll(async () => {
    prisma = getPrismaClient(databaseUrl!);
    raw = (await new PrismaMariaDb(buildPoolConfig(databaseUrl!)).connect()).underlyingDriver();
    service = new CanvasService({ client: prisma } as never, { findOwnedById: async () => ({}) } as never);
    await prisma.project.create({ data: { id: BigInt(PROJECT_ID), owner_id: BigInt(USER_ID), name: "ikjlxe" } });
  });
  beforeEach(async () => {
    const project_id = BigInt(PROJECT_ID);
    const submissions = await prisma.generation_canvas_submissions.findMany({ where: { project_id }, select: { id: true } });
    await prisma.generation_canvas_node_owners.deleteMany({ where: { project_id } });
    await prisma.generation_canvas_outputs.deleteMany({ where: { generation_canvas_submission_id: { in: submissions.map(row => row.id) } } });
    await prisma.generation_canvas_submissions.deleteMany({ where: { project_id } });
    await prisma.command_idempotency.deleteMany({ where: { project_id } });
    await prisma.project_asset.deleteMany({ where: { project_id } });
    await prisma.user_assets.deleteMany({ where: { project_id } });
    await prisma.project_canvas.deleteMany({ where: { project_id } });
    await prisma.generation_jobs.deleteMany({ where: { project_id } });
  });
  afterAll(async () => {
    await prisma.project.deleteMany({ where: { id: BigInt(PROJECT_ID) } });
    await raw.end();
    await prisma.$disconnect();
  });

  it.each(["missing", "unmarked"] as const)("%s 画布首次单独 apply 被整笔拒绝，随后成对转换成功", async mode => {
    const version = await seed(mode);
    const before = await snapshot();
    const rejected = await save([resultNode()], version, [apply()]);
    console.log("IKJLXE 首次保存", JSON.stringify({ mode, result: rejected }));
    expect(rejected).toMatchObject({ code: 422, data: { reason: RECOVERY_REASONS.documentMismatch } });
    expect(await snapshot()).toEqual(before);
    const applied = await save([resultNode()], version, mode === "missing" ? [replace(), apply()] : [apply(), replace()]);
    expect(applied).toMatchObject({ code: 200, data: { version: mode === "missing" ? 0 : 1, recoveryReceipt: { changes: expect.arrayContaining([
      { state: "replaced", revision: 2, nodeBindingRevision: 1 },
      { state: "present", revision: 1, nodeBindingRevision: 1 },
    ].map(change => expect.objectContaining(change))) } } });
    const after = await snapshot();
    expect(after.canvas?.nodes_json).toEqual([resultNode()]);
    expect(after.submissions[0]).toMatchObject({ target_state: "replaced", target_revision: 2 });
    expect(after.outputs[0]).toMatchObject({ output_key: PRIMARY_OUTPUT_KEY, state: "present", revision: 1 });
    expect(after.owners[0]).toMatchObject({ output_key: PRIMARY_OUTPUT_KEY, binding_revision: 1 });
    expect(after.receipts).toHaveLength(1);
  });

  it("同文档重复 apply 保持所有行与版本，新命令回执可重放，普通编辑继续保存", async () => {
    await seed("missing");
    expect(await save([resultNode()], null, [replace(), apply()])).toMatchObject({ code: 200, data: { version: 0 } });
    const before = await snapshot();
    const commandId = randomUUID();
    const repeat = { ...apply(), expectedRevision: 1 };
    const repeated = await save([resultNode()], 0, [repeat], commandId);
    console.log("IKJLXE 同状态重放", JSON.stringify(repeated));
    expect(repeated).toMatchObject({ code: 200, data: { version: 0, recoveryReceipt: { commandId, replayed: false, changes: [
      { recoveryItemId: recoveryItemId(SUBMISSION_ID, PRIMARY_OUTPUT_KEY), state: "present", revision: 1, nodeBindingRevision: 1 },
    ] } } });
    const after = await snapshot();
    expect({ ...after, receipts: [] }).toEqual({ ...before, receipts: [] });
    expect(after.receipts).toHaveLength(2);
    const replayed = await save([resultNode()], 0, [repeat], commandId);
    expect(replayed).toMatchObject({ code: 200, data: { version: 0, recoveryReceipt: { commandId, replayed: true } } });
    expect(await snapshot()).toEqual(after);
    expect(await save([resultNode()], 5, [repeat])).toMatchObject({ code: 412, data: { reason: RECOVERY_REASONS.versionConflict } });
    const edited = resultNode();
    edited.data.fileName = "我编辑的结果卡";
    edited.position = { x: 30, y: 40 };
    expect(await save([edited], 0, [repeat])).toMatchObject({ code: 200, data: { version: 1 } });
    edited.position = { x: 50, y: 60 };
    expect(await save([edited], 1, [])).toMatchObject({ code: 200, data: { version: 2 } });
    const saved = await snapshot();
    expect(saved.canvas?.nodes_json).toEqual([edited]);
    expect(saved.outputs[0]).toMatchObject({ state: "present", revision: 1 });
  });
});
