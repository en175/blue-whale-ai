// IKJLTS（PR981-REVIEW2-20261003-R2）：显式 apply/restore 的结果资产必须核对可信产物。
//
// 与 ikjku2-canvas-recovery.integration.test.ts 同款门控（独立容器隔离）：
//   docker run -d --name ikjlts-mysql -e MYSQL_ROOT_PASSWORD=ikjlts \
//     -e MYSQL_DATABASE=bw_gate_ikjlts -p 3314:3306 mysql:8
//   cd backend && DATABASE_URL='mysql://root:ikjlts@127.0.0.1:3314/bw_gate_ikjlts' \
//     pnpm exec prisma db push --accept-data-loss
//   IKJLTS_DATABASE_URL='mysql://root:ikjlts@127.0.0.1:3314/bw_gate_ikjlts' \
//     pnpm exec vitest run backend/libs/shared/persistence/ikjlts-canvas-recovery.integration.test.ts
// 未配置该变量时整组跳过；跳过不算通过。（QU 容器在 3307，勿动。）
//
// 验收场景（IKJLTS brief）：
//   1. ★ 一对一伪造：任务产物清单 ["11"]，replaceTarget+apply(primary) 文档资产 999
//      → 422 整笔回滚（画布版本/恢复项/节点归属/回执零部分写入）；修复前 999 落库
//   2. ★ 一对一合法：文档资产=产物 11 → 200；画布回读、恢复查询与产物一致
//   3. ★ 已持久输出重复 apply 换资产 999 → 422（present 幂等也核对）
//   4. ★ 多结果（场景切分 segment）伪造 999 / 跨项错挂他项产物 → 422；合法 → 200
//   5. ★ restore 恢复卡资产伪造 → 422；合法 → 200
//   6. ★ 公开保存入口 CanvasService.save（recoveryProtocolVersion）伪造 → code 422；
//      合法 → code 200 落库可恢复
//   7. ★ 一对一 primary restore 伪造：文档资产 999（任务产物清单 ["11"]）→ 422 整笔
//      拒绝零部分写入（画布版本/输出行/回执不动）
//   8. ★ 一对一 primary restore 合法：资产=产物 11 → 200 present，文档卡回归

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
  listCanvasRecoveryPage,
  lockCanvasRecoveryForAcceptance,
  resolveCanvasRecoveryItems,
  writeCanvasRecoveryRows,
  type CanvasRecoveryAcceptance,
} from "./generation-canvas-recovery-repo.js";
import { saveCanvasWithRecovery } from "./canvas-recovery-save.js";
import { multiResultNodeId } from "./canvas-recovery-multi-output.js";
import { createJobWithinTx } from "./generation-command-repo.js";
import { CanvasService } from "@lib/shared/canvas/canvas.service.js";
import type { PrismaClient } from "@prisma/client";

const databaseUrl = process.env.IKJLTS_DATABASE_URL;

describe.skipIf(!databaseUrl)("显式 apply/restore 核对可信产物资产（IKJLTS）", () => {
  let prisma: PrismaClient;
  let raw: Pool;

  const PROJECT_ID = "950001";
  const USER_ID = "950009";
  const UUID_A = "4d5e6f7a-0000-4000-8000-00000000a001";
  const UUID_B = "4d5e6f7a-0000-4000-8000-00000000b002";
  const CMD = (suffix: string) => `4d5e6f7a-0000-4000-8000-0000000${suffix}`;

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

  function acceptance(submissionId: string, node: string, taskType = "image"): CanvasRecoveryAcceptance {
    return {
      projectId: PROJECT_ID,
      userId: USER_ID,
      binding: binding(submissionId, node, 0),
      operation: "generation.create",
      requestHash: `hash-${submissionId}`,
      idempotencyKey: submissionId,
      taskType,
    };
  }

  /** 完整受理（与 ikjku2 同构）：锁序核对 + job 行 + 关联行 + 幂等行。 */
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
        actionIdentity: `ikjlts-${acceptanceInput.binding.submission_id}`,
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

  /** 场景切分 job 置成功 + 写契约终态日志（与 ikjjqy 同款）。 */
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

  beforeAll(async () => {
    prisma = getPrismaClient(databaseUrl!);
    const adapter = await new PrismaMariaDb(buildPoolConfig(databaseUrl!)).connect();
    raw = adapter.underlyingDriver();
    await prisma.project.create({ data: { id: BigInt(PROJECT_ID), owner_id: BigInt(USER_ID), name: "ikjlts" } });
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

  /** 一对一种子：受理 → 产物 ["11"] → 占位入库（previous 有 $target 标记卡）。 */
  async function seedOneToOne() {
    const job = await accept(acceptance(UUID_A, "ikjlts-node-a"));
    await succeedJob(job.generation_job_id, '["11"]');
    const base = await save({
      commandId: CMD("00001"),
      version: null,
      nodes: [markerNode("ikjlts-node-a", UUID_A, TARGET_OUTPUT_KEY, "11")],
      changes: [],
    });
    return { base, jobId: job.generation_job_id };
  }

  /** 场景切分种子：受理 → 两段产物 701/702（投影 segment:1 / segment:2）。 */
  async function seedSceneSplit(node: string, submissionId = UUID_A) {
    const created = await accept(acceptance(submissionId, node, "video_scene_split"), {
      type: "video_scene_split",
      input: { source_asset_id: "5", target_node_id: node, granularity: "fine" },
    });
    await succeedSceneSplitJob(created.generation_job_id, [
      { index: 1, assetId: "701" },
      { index: 2, assetId: "702" },
    ]);
    return created;
  }

  it("★ 1. 一对一伪造：replaceTarget+apply(primary) 文档资产 999 → 422 整笔回滚（修复前 999 落库）", async () => {
    const { base } = await seedOneToOne();
    // 审查复现场景：显式合法动作声明，文档资产伪造为 999（不在产物清单 ["11"]）。
    await expectRejection(save({
      commandId: CMD("10001"),
      version: base.version,
      nodes: [markerNode("ikjlts-node-a", UUID_A, PRIMARY_OUTPUT_KEY, "999")],
      changes: [
        { id: recoveryItemId(UUID_A, TARGET_OUTPUT_KEY), rev: 1, action: "replaceTarget" },
        { id: recoveryItemId(UUID_A, PRIMARY_OUTPUT_KEY), rev: 0, action: "apply" },
      ],
    }));
    // 整笔回滚：画布版本不递增、文档仍为占位、$target 状态未推进、无 primary 输出行、
    // owner 仍挂 $target、无幂等回执行。
    const row = await canvasRow();
    expect(row?.version).toBe(base.version);
    const nodes = (row?.nodes_json ?? []) as Array<{ id: string; data: Record<string, unknown> }>;
    expect(nodes).toHaveLength(1);
    expect((nodes[0]!.data.generationRecovery as Record<string, unknown>).outputKey).toBe(TARGET_OUTPUT_KEY);
    expect(nodes[0]!.data.assetId).toBe("11");
    const submission = await submissionRow(UUID_A);
    expect(submission?.target_state).toBe("pending");
    expect(Number(submission?.target_revision)).toBe(1);
    expect(await outputRow(UUID_A, PRIMARY_OUTPUT_KEY)).toBeNull();
    const owner = await prisma.generation_canvas_node_owners.findUnique({
      where: { project_id_node_id: { project_id: BigInt(PROJECT_ID), node_id: "ikjlts-node-a" } },
    });
    expect(owner?.output_key).toBe(TARGET_OUTPUT_KEY);
    expect(await prisma.command_idempotency.count({
      where: { project_id: BigInt(PROJECT_ID), operation: "SAVE_CANVAS_RECOVERY_V1", idempotency_key: CMD("10001") },
    })).toBe(0);
  });

  it("★ 2. 一对一合法：文档资产=产物 11 → 200；画布回读与恢复查询一致", async () => {
    const { base } = await seedOneToOne();
    const saved = await save({
      commandId: CMD("20001"),
      version: base.version,
      nodes: [markerNode("ikjlts-node-a", UUID_A, PRIMARY_OUTPUT_KEY, "11")],
      changes: [
        { id: recoveryItemId(UUID_A, TARGET_OUTPUT_KEY), rev: 1, action: "replaceTarget" },
        { id: recoveryItemId(UUID_A, PRIMARY_OUTPUT_KEY), rev: 0, action: "apply" },
      ],
    });
    expect(saved.version).toBe(base.version + 1);
    expect(saved.recoveryReceipt.changes).toEqual(expect.arrayContaining([
      expect.objectContaining({ state: "replaced", revision: 2 }),
      expect.objectContaining({ state: "present", revision: 1, nodeBindingRevision: 1 }),
    ]));
    // MySQL 回读：资产 11 落库、primary present、恢复查询与文档一致。
    const row = await canvasRow();
    const nodes = (row?.nodes_json ?? []) as Array<{ data: Record<string, unknown> }>;
    expect(nodes[0]!.data.assetId).toBe("11");
    expect(await outputRow(UUID_A, PRIMARY_OUTPUT_KEY)).toMatchObject({ state: "present", revision: 1 });
    const resolved = await resolveCanvasRecoveryItems(prisma, PROJECT_ID, [
      recoveryItemId(UUID_A, PRIMARY_OUTPUT_KEY),
    ]);
    expect(resolved[0]!.items[0]).toMatchObject({ output_key: PRIMARY_OUTPUT_KEY, state: "present", revision: 1 });
  });

  it("★ 3. 已持久输出重复 apply 换资产 999 → 422 且版本不递增", async () => {
    const { base } = await seedOneToOne();
    const fanned = await save({
      commandId: CMD("30001"),
      version: base.version,
      nodes: [markerNode("ikjlts-node-a", UUID_A, PRIMARY_OUTPUT_KEY, "11")],
      changes: [
        { id: recoveryItemId(UUID_A, TARGET_OUTPUT_KEY), rev: 1, action: "replaceTarget" },
        { id: recoveryItemId(UUID_A, PRIMARY_OUTPUT_KEY), rev: 0, action: "apply" },
      ],
    });
    // present 幂等重复 apply 合法的前提是资产仍是可信产物；换成 999 → 拒绝。
    await expectRejection(save({
      commandId: CMD("30002"),
      version: fanned.version,
      nodes: [markerNode("ikjlts-node-a", UUID_A, PRIMARY_OUTPUT_KEY, "999")],
      changes: [{ id: recoveryItemId(UUID_A, PRIMARY_OUTPUT_KEY), rev: 1, action: "apply" }],
    }));
    expect((await canvasRow())?.version).toBe(fanned.version);
    expect(await outputRow(UUID_A, PRIMARY_OUTPUT_KEY)).toMatchObject({ state: "present", revision: 1 });
    const nodes = ((await canvasRow())?.nodes_json ?? []) as Array<{ data: Record<string, unknown> }>;
    expect(nodes[0]!.data.assetId).toBe("11");
  });

  it("★ 4. 多结果伪造：segment 资产 999 或跨项错挂他项产物 → 422 整笔回滚；合法 → 200", async () => {
    const created = await seedSceneSplit("ikjlts-scene-1");
    void created;
    const seg1 = multiResultNodeId(UUID_A, "segment:1");
    const seg2 = multiResultNodeId(UUID_A, "segment:2");
    const fanout = (asset1: string, asset2: string, commandId: string) => save({
      commandId,
      version: null,
      nodes: [markerNode(seg1, UUID_A, "segment:1", asset1), markerNode(seg2, UUID_A, "segment:2", asset2)],
      changes: [
        { id: recoveryItemId(UUID_A, TARGET_OUTPUT_KEY), rev: 1, action: "replaceTarget" },
        { id: recoveryItemId(UUID_A, "segment:1"), rev: 0, action: "apply" },
        { id: recoveryItemId(UUID_A, "segment:2"), rev: 0, action: "apply" },
      ],
    });
    // 伪造 999：不在产物清单（701/702）→ 整笔拒绝。
    await expectRejection(fanout("701", "999", CMD("40001")));
    // 跨项错挂：segment:1 的卡挂 segment:2 的产物（702）→ 错误输出身份，同样拒绝。
    await expectRejection(fanout("702", "702", CMD("40002")));
    // 整笔回滚：无输出行、无画布、无回执行、$target 未推进。
    expect(await prisma.generation_canvas_outputs.count({})).toBe(0);
    expect(await prisma.canvas.count({ where: { project_id: BigInt(PROJECT_ID) } })).toBe(0);
    expect(await submissionRow(UUID_A)).toMatchObject({ target_state: "pending" });
    expect(await prisma.command_idempotency.count({
      where: { project_id: BigInt(PROJECT_ID), operation: "SAVE_CANVAS_RECOVERY_V1" },
    })).toBe(0);
    // 合法：各段挂各自产物 → 成功落库。
    const saved = await fanout("701", "702", CMD("40003"));
    expect(saved.recoveryReceipt.changes).toEqual(expect.arrayContaining([
      expect.objectContaining({ state: "replaced", revision: 2 }),
      expect.objectContaining({ recoveryItemId: recoveryItemId(UUID_A, "segment:1"), state: "present", revision: 1, nodeBindingRevision: 1 }),
      expect.objectContaining({ recoveryItemId: recoveryItemId(UUID_A, "segment:2"), state: "present", revision: 1, nodeBindingRevision: 1 }),
    ]));
    const row = await canvasRow();
    const assets = ((row?.nodes_json ?? []) as Array<{ data: Record<string, unknown> }>)
      .map(node => String(node.data.assetId)).sort();
    expect(assets).toEqual(["701", "702"]);
  });

  it("★ 5. restore 恢复卡资产伪造 → 422；合法 restore → 200", async () => {
    await seedSceneSplit("ikjlts-scene-2", UUID_B);
    const seg1 = multiResultNodeId(UUID_B, "segment:1");
    const seg2 = multiResultNodeId(UUID_B, "segment:2");
    // 首次保存前显式删 segment:2（文档只带 seg1）。
    const removed = await save({
      commandId: CMD("50001"),
      version: null,
      nodes: [markerNode(seg1, UUID_B, "segment:1", "701")],
      changes: [{ id: recoveryItemId(UUID_B, "segment:2"), rev: 0, action: "remove" }],
    });
    expect(removed.recoveryReceipt.changes[0]).toMatchObject({ state: "removed", revision: 1 });
    // restore 时文档卡资产伪造 999 → 拒绝。
    await expectRejection(save({
      commandId: CMD("50002"),
      version: removed.version,
      nodes: [markerNode(seg1, UUID_B, "segment:1", "701"), markerNode(seg2, UUID_B, "segment:2", "999")],
      changes: [{ id: recoveryItemId(UUID_B, "segment:2"), rev: 1, action: "restore" }],
    }));
    expect(await outputRow(UUID_B, "segment:2")).toMatchObject({ state: "removed", revision: 1 });
    expect((await canvasRow())?.version).toBe(removed.version);
    // 合法 restore：资产=产物 702 → present。
    const restored = await save({
      commandId: CMD("50003"),
      version: removed.version,
      nodes: [markerNode(seg1, UUID_B, "segment:1", "701"), markerNode(seg2, UUID_B, "segment:2", "702")],
      changes: [{ id: recoveryItemId(UUID_B, "segment:2"), rev: 1, action: "restore" }],
    });
    expect(restored.recoveryReceipt.changes[0]).toMatchObject({ state: "present", revision: 2, nodeBindingRevision: 1 });
    expect(await outputRow(UUID_B, "segment:2")).toMatchObject({ state: "present", revision: 2 });
  });

  it("★ 6. 公开保存入口：CanvasService.save 伪造资产 → code 422；合法 → code 200 落库可恢复", async () => {
    const job = await accept(acceptance(UUID_A, "ikjlts-node-open"));
    await succeedJob(job.generation_job_id, '["11"]');
    const service = new CanvasService(
      { client: prisma } as never,
      { findOwnedById: async () => ({}) } as never,
    );
    const base = await service.save(USER_ID, PROJECT_ID, {
      viewport: "{}",
      nodes: JSON.stringify([markerNode("ikjlts-node-open", UUID_A, TARGET_OUTPUT_KEY, "11")]),
      edges: "[]",
      expectedVersion: null,
      recoveryProtocolVersion: 1,
      commandId: CMD("60001"),
      recoveryChanges: [],
    }) as { code: number; data: { version: number } };
    expect(base.code).toBe(200);
    const baseVersion = (base.data as unknown as { version: number }).version;
    // 公开入口伪造：文档资产 999 → 信封 code 422、零部分写入。
    const forged = await service.save(USER_ID, PROJECT_ID, {
      viewport: "{}",
      nodes: JSON.stringify([markerNode("ikjlts-node-open", UUID_A, PRIMARY_OUTPUT_KEY, "999")]),
      edges: "[]",
      expectedVersion: baseVersion,
      recoveryProtocolVersion: 1,
      commandId: CMD("60002"),
      recoveryChanges: [
        { recoveryItemId: recoveryItemId(UUID_A, TARGET_OUTPUT_KEY), expectedRevision: 1, action: "replaceTarget" },
        { recoveryItemId: recoveryItemId(UUID_A, PRIMARY_OUTPUT_KEY), expectedRevision: 0, action: "apply" },
      ],
    }) as { code: number; msg: string; data: { reason: string } };
    expect(forged.code).toBe(422);
    expect(forged.data.reason).toBe(RECOVERY_REASONS.documentMismatch);
    expect((await canvasRow())?.version).toBe(baseVersion);
    expect(await outputRow(UUID_A, PRIMARY_OUTPUT_KEY)).toBeNull();
    // 公开入口合法：文档资产 11 → code 200、落库、恢复查询可见。
    const applied = await service.save(USER_ID, PROJECT_ID, {
      viewport: "{}",
      nodes: JSON.stringify([markerNode("ikjlts-node-open", UUID_A, PRIMARY_OUTPUT_KEY, "11")]),
      edges: "[]",
      expectedVersion: baseVersion,
      recoveryProtocolVersion: 1,
      commandId: CMD("60003"),
      recoveryChanges: [
        { recoveryItemId: recoveryItemId(UUID_A, TARGET_OUTPUT_KEY), expectedRevision: 1, action: "replaceTarget" },
        { recoveryItemId: recoveryItemId(UUID_A, PRIMARY_OUTPUT_KEY), expectedRevision: 0, action: "apply" },
      ],
    }) as { code: number; data: { version: number } };
    expect(applied.code).toBe(200);
    expect((applied.data as unknown as { version: number }).version).toBe(baseVersion + 1);
    expect(await outputRow(UUID_A, PRIMARY_OUTPUT_KEY)).toMatchObject({ state: "present", revision: 1 });
    const page = await listCanvasRecoveryPage(prisma, PROJECT_ID, 50, null);
    const record = page.records.find(item => item.submission_id === UUID_A)!;
    expect(record.items.find(item => item.output_key === PRIMARY_OUTPUT_KEY)?.state).toBe("present");
  });

  /** 一对一 primary 已移除种子（PR981-REVIEW2-Spec a3）：受理产物 ["11"] → 占位入库 →
   *  replaceTarget+apply(11)（primary 落行 present/1，owner 切 primary）→ remove（文档撤卡）。
   *  primary 输出行 removed/2，owner 保持本提交 primary 供 restore。 */
  async function seedOneToOneRemoved() {
    const { base } = await seedOneToOne();
    const applied = await save({
      commandId: CMD("70001"),
      version: base.version,
      nodes: [markerNode("ikjlts-node-a", UUID_A, PRIMARY_OUTPUT_KEY, "11")],
      changes: [
        { id: recoveryItemId(UUID_A, TARGET_OUTPUT_KEY), rev: 1, action: "replaceTarget" },
        { id: recoveryItemId(UUID_A, PRIMARY_OUTPUT_KEY), rev: 0, action: "apply" },
      ],
    });
    const removed = await save({
      commandId: CMD("70002"),
      version: applied.version,
      nodes: [],
      changes: [{ id: recoveryItemId(UUID_A, PRIMARY_OUTPUT_KEY), rev: 1, action: "remove" }],
    });
    expect(removed.recoveryReceipt.changes[0]).toMatchObject({ state: "removed", revision: 2 });
    return { removed };
  }

  it("★ 7. 一对一 primary restore 伪造：文档资产 999 → 422 整笔回滚零部分写入", async () => {
    const { removed } = await seedOneToOneRemoved();
    // primary 的可信产物取任务产物清单（["11"]），restore 回卡资产伪造 999 → 拒绝。
    await expectRejection(save({
      commandId: CMD("70003"),
      version: removed.version,
      nodes: [markerNode("ikjlts-node-a", UUID_A, PRIMARY_OUTPUT_KEY, "999")],
      changes: [{ id: recoveryItemId(UUID_A, PRIMARY_OUTPUT_KEY), rev: 2, action: "restore" }],
    }));
    // 整笔回滚：输出行仍 removed/2、画布版本不递增、文档仍空、无回执行。
    expect(await outputRow(UUID_A, PRIMARY_OUTPUT_KEY)).toMatchObject({ state: "removed", revision: 2 });
    expect((await canvasRow())?.version).toBe(removed.version);
    expect(((await canvasRow())?.nodes_json ?? []) as unknown[]).toHaveLength(0);
    expect(await prisma.command_idempotency.count({
      where: { project_id: BigInt(PROJECT_ID), operation: "SAVE_CANVAS_RECOVERY_V1", idempotency_key: CMD("70003") },
    })).toBe(0);
  });

  it("★ 8. 一对一 primary restore 合法：资产=产物 11 → 200 present 文档卡回归", async () => {
    const { removed } = await seedOneToOneRemoved();
    const restored = await save({
      commandId: CMD("70004"),
      version: removed.version,
      nodes: [markerNode("ikjlts-node-a", UUID_A, PRIMARY_OUTPUT_KEY, "11")],
      changes: [{ id: recoveryItemId(UUID_A, PRIMARY_OUTPUT_KEY), rev: 2, action: "restore" }],
    });
    expect(restored.version).toBe(removed.version + 1);
    expect(restored.recoveryReceipt.changes[0]).toMatchObject({ state: "present", revision: 3, nodeBindingRevision: 1 });
    expect(await outputRow(UUID_A, PRIMARY_OUTPUT_KEY)).toMatchObject({ state: "present", revision: 3 });
    const nodes = ((await canvasRow())?.nodes_json ?? []) as Array<{ data: Record<string, unknown> }>;
    expect(nodes[0]!.data.assetId).toBe("11");
    // restore 不改归属：owner 仍是本提交 primary。
    const owner = await prisma.generation_canvas_node_owners.findUnique({
      where: { project_id_node_id: { project_id: BigInt(PROJECT_ID), node_id: "ikjlts-node-a" } },
    });
    expect(owner?.output_key).toBe(PRIMARY_OUTPUT_KEY);
  });
});
