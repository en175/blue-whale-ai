// IKJKU8（PR981-REVIEW-20261003-F8）：恢复保存回执丢失可安全重放的真 MySQL 验证。
//
// 与 ikjku2-canvas-recovery.integration.test.ts 同款门控，独立容器（ikjku8-mysql:3313，
// 与 ikjku2 容器隔离——两文件 beforeEach 都全表清理，共库并行会互踩）：
//   # 容器与建库（一次）：
//   docker run -d --name ikjku8-mysql -e MYSQL_ROOT_PASSWORD=ikjku8 \
//     -e MYSQL_DATABASE=bw_gate_ikjku8 -p 3313:3306 mysql:8
//   cd backend && DATABASE_URL='mysql://root:ikjku8@127.0.0.1:3313/bw_gate_ikjku8' \
//     pnpm exec prisma db push --accept-data-loss
//   # 跑测试（仓库根）：
//   IKJKU8_DATABASE_URL='mysql://root:ikjku8@127.0.0.1:3313/bw_gate_ikjku8' \
//     pnpm exec vitest run backend/libs/shared/persistence/ikjku8-canvas-recovery.integration.test.ts
// 未配置该变量时整组跳过；跳过不算通过。
//
// 验收场景（IKJKU8 brief；发送侧重放行为见 web/src/pages/CanvasPage/recoverySaveReplay.test.tsx，
// 本文件补齐服务端半边：同身份同摘要幂等回读先于版本检查、回放原紧凑回执不重复推进）：
//   1. ★ 保存成功但客户端丢回执 → 同 commandId/同载荷/同 If-Match 原样重发 → replayed=true
//      原回执（版本、changes 与首次一致），库版本与幂等行不重复推进
//   2. 重放使用旧 If-Match 不触发 412（幂等回读先于版本检查——这正是回执丢失场景
//      版本已推进后仍能安全重放的前提）
//   3. 同 commandId 不同载荷 / 不同 If-Match 版本 → 409 commandReused（调用方必须保留
//      原载荷与原 If-Match，前端 planRecoverySave 的作废条件与之对齐）
//   4. 重放命中后新命令保存照常推进版本（重放不阻塞后续保存）

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

  /** 前置：受理 A 并成功扇出——被丢失回执的那笔恢复保存命令（cmd-lost）已完成但客户端未收到。 */
  async function seedLostReceiptSave() {
    const job = await accept(acceptance(UUID_A, NODE_A));
    await raw.query(
      "UPDATE generation_jobs SET status='succeeded', output_asset_ids=CAST(? AS JSON) WHERE id = ?",
      ['["11"]', Number(job.generation_job_id)],
    );
    const base = await save({
      commandId: CMD("00001"),
      version: null,
      nodes: [markerNode(NODE_A, UUID_A, TARGET_OUTPUT_KEY)],
      changes: [],
    });
    // 一对一扇出（replaceTarget + apply primary）：这就是「保存成功但回执丢失」的那笔命令
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

    // 客户端丢回执后原样重试：同 commandId + 同载荷 + 同 If-Match（旧版本 base.version）
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
    expect(replayed.version).toBe(lost.version); // 原版本
    expect(replayed.recoveryReceipt.changes).toEqual(lost.recoveryReceipt.changes); // 原紧凑回执
    // 状态与版本不重复推进：画布版本停在首次保存后的值，幂等行不重复落
    expect(await canvasVersion()).toBe(lost.version);
    expect(await idempotencyRows()).toBe(rowsAfterFirst);
  });

  it("2. 重放带旧 If-Match 不触发 412——幂等回读先于版本检查（服务端版本已推进仍安全重放）", async () => {
    const { base, lost } = await seedLostReceiptSave();
    // 首次保存已把画布版本推进到 lost.version；重发仍带旧 If-Match（base.version）。
    // 若版本检查先于幂等回读，这里必然 412——用户故事 38 的安全重放正依赖回读优先。
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
    // 载荷变了（节点改名）：不得冒用旧命令
    await expectCommandReused(save({
      commandId: CMD("00002"),
      version: base.version,
      nodes: [markerNode(NODE_A, UUID_A, PRIMARY_OUTPUT_KEY, { name: "编辑后" })],
      changes: [
        { id: recoveryItemId(UUID_A, TARGET_OUTPUT_KEY), rev: 1, action: "replaceTarget" },
        { id: recoveryItemId(UUID_A, PRIMARY_OUTPUT_KEY), rev: 0, action: "apply" },
      ],
    }));
    // If-Match 版本变了（版本已对齐服务端）：同身份同载荷不同版本同样拒绝
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
    // 后续普通编辑（新命令，无动作）按当前版本正常推进
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
