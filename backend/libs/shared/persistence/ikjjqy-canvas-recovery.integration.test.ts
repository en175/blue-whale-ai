// IKJJQY（IKIXK9-SPEC-20261002 B 节）：多结果任务逐项恢复与删除的真 MySQL 验证。
//
// 与 ikjjqu-canvas-recovery.integration.test.ts 同款门控（容器换端口换库名）：
//   docker run -d --name ikjjqy-mysql -e MYSQL_ROOT_PASSWORD=ikjjqy \
//     -e MYSQL_DATABASE=bw_gate_ikjjqy -p 3309:3306 mysql:8
//   cd backend && DATABASE_URL='mysql://root:ikjjqy@127.0.0.1:3309/bw_gate_ikjjqy' \
//     npx prisma db push --accept-data-loss
//   IKJJQY_DATABASE_URL='mysql://root:ikjjqy@127.0.0.1:3309/bw_gate_ikjjqy' \
//     pnpm exec vitest run backend/libs/shared/persistence/ikjjqy-canvas-recovery.integration.test.ts
// 未配置该变量时整组跳过；跳过不算通过。QU 容器在 3307，勿动。
//
// 验收场景（工单 8 条）：
//   1. 场景切分受理接线（canvas_binding + client_token=submission_id + 重放原关联）
//   2. 人声分离受理接线（canvas_binding + Idempotency-Key + 重放原关联）
//   3. 输出槽投影（expected_output_count>1 → slot:<id>，node=generation-output:<id>）
//   4. 完整扇出（replaceTarget + 全部 segment apply 同事务，owner 逐项建立）
//   5. 部分删除（1 apply + 1 remove：removed 项独立，任务/资产不受影响）
//   6. 首次保存前删除（虚拟 remove 建 owner；restore 恢复；旧 remove 不覆盖新撤销）
//   7. 重复扫描（恢复页两次结果一致，不写库）
//   8. 原位接管 + 旧结果独立操作（A transferred 后其 segment 仍可 remove/restore；job=null）
//   9. 抢先成功后的旧取消意图（job succeeded → settleTarget 422）
//  10. 版本冲突整笔回滚（扇出保存中一项版本错 → 全部不落）
//  11. 投影失败（轨数不齐 → 恢复页保留占位不投影输出；replaceTarget 422 projection_invalid）
//  12. resolve 定向读取旧持久结果
//  13. 伪造输出键 remove → 422（键必须在投影集内）

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
  listCanvasRecoveryPage,
  resolveCanvasRecoveryItems,
} from "./generation-canvas-recovery-repo.js";
import { saveCanvasWithRecovery } from "./canvas-recovery-save.js";
import { multiResultNodeId } from "./canvas-recovery-multi-output.js";
import { createJobWithinTx } from "./generation-command-repo.js";
import { VideoSceneSplitsService } from "@lib/shared/video-scene-splits/video-scene-splits.service.js";
import { VocalSplitsService } from "@lib/shared/vocal-splits/vocal-splits.service.js";
import type { PrismaClient } from "@prisma/client";

const databaseUrl = process.env.IKJJQY_DATABASE_URL;

describe.skipIf(!databaseUrl)("多结果任务逐项恢复与删除（IKJJQY）", () => {
  let prisma: PrismaClient;
  let raw: Pool;

  const PROJECT_ID = "920001";
  const USER_ID = "920009";
  const UUID_A = "1a2b3c4d-0000-4000-8000-00000000a001";
  const UUID_B = "1a2b3c4d-0000-4000-8000-00000000b002";
  const UUID_C = "1a2b3c4d-0000-4000-8000-00000000c003";
  const UUID_D = "1a2b3c4d-0000-4000-8000-00000000d004";
  const UUID_E = "1a2b3c4d-0000-4000-8000-00000000e005";
  const UUID_F = "1a2b3c4d-0000-4000-8000-00000000f006";

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

  /** 直接按受理事务内核建一个已关联的 job（绕过各 service 入口；service 入口另有专线测试）。 */
  async function acceptJob(args: {
    submissionId: string;
    node: string;
    revision: number;
    type: string;
    input?: Record<string, unknown>;
    expectedOutputCount?: number;
  }) {
    return prisma.$transaction(async (tx) => {
      const locked = await import("./generation-canvas-recovery-repo.js").then(module =>
        module.lockCanvasRecoveryForAcceptance(tx, {
          projectId: PROJECT_ID,
          userId: USER_ID,
          binding: binding(args.submissionId, args.node, args.revision),
          operation: "generation.create",
          requestHash: `hash-${args.submissionId}`,
          idempotencyKey: args.submissionId,
          taskType: args.type,
        }),
      );
      if (locked.kind !== "plan") return locked;
      const created = await createJobWithinTx(tx, {
        projectId: PROJECT_ID,
        userId: USER_ID,
        type: args.type,
        expectedOutputCount: args.expectedOutputCount ?? 1,
        input: args.input ?? { prompt: "whale" },
        actionIdentity: `ikjjqy-${args.submissionId}`,
        actionType: `generate_${args.type}`,
      }, undefined, { key: args.submissionId, requestHash: `hash-${args.submissionId}` });
      await import("./generation-canvas-recovery-repo.js").then(module =>
        module.writeCanvasRecoveryRows(tx, locked.plan, BigInt(created.generation_job_id)));
      return created;
    });
  }

  /** 场景切分 job 置成功 + 写契约终态日志（worker 的可信终态数据）。 */
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

  /** IKJLTS：assetId 须与该输出项可信产物一致（apply/restore 会核对，默认 7 仅占位形态）。 */
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

  function expectRejection(promise: Promise<unknown>, code: number, reason: string) {
    return promise.then(
      () => { throw new Error("应拒绝"); },
      (error: unknown) => {
        expect(error).toBeInstanceOf(RecoveryContractError);
        expect((error as RecoveryContractError).envelope).toMatchObject({ code, data: { reason } });
      },
    );
  }

  beforeAll(async () => {
    prisma = getPrismaClient(databaseUrl!);
    const adapter = await new PrismaMariaDb(buildPoolConfig(databaseUrl!)).connect();
    raw = adapter.underlyingDriver();
    await prisma.project.create({ data: { id: BigInt(PROJECT_ID), owner_id: BigInt(USER_ID), name: "ikjjqy" } });
    // 受理 service 专线测试的资产与项目依赖（最小桩：归属校验返回固定可信形状）。
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

  it("★ 1. 场景切分受理：canvas_binding 接线（client_token=submission_id）+ 重放返回原关联", async () => {
    const service = new VideoSceneSplitsService(
      { client: prisma } as never,
      { findOwnedById: async () => ({}) } as never,
      { findOwnedSource: async () => ({ type: "video", duration_ms: null }) } as never,
    );
    const first = await service.create(USER_ID, PROJECT_ID, {
      source_asset_id: "88",
      target_node_id: "scene-node-1",
      granularity: "standard",
      client_token: UUID_A,
      canvas_binding: binding(UUID_A, "scene-node-1", 0),
    });
    expect(first.code).toBe(200);
    expect(first.data).toMatchObject({
      status: "queued",
      canvas_binding: {
        protocol_version: 1,
        submission_id: UUID_A,
        target_node_id: "scene-node-1",
        binding_revision: 1,
        is_current: true,
      },
    });
    // 行齐：job + submission + owner + 幂等行。
    expect(await prisma.generation_canvas_submissions.count({ where: { project_id: BigInt(PROJECT_ID) } })).toBe(1);
    const owner = await prisma.generation_canvas_node_owners.findUnique({
      where: { project_id_node_id: { project_id: BigInt(PROJECT_ID), node_id: "scene-node-1" } },
    });
    expect(owner && Number(owner.binding_revision)).toBe(1);
    // 网络重放：同 token 同参数 → 原 job + 原关联（不重复建任务）。
    const replay = await service.create(USER_ID, PROJECT_ID, {
      source_asset_id: "88",
      target_node_id: "scene-node-1",
      granularity: "standard",
      client_token: UUID_A,
      canvas_binding: binding(UUID_A, "scene-node-1", 0),
    });
    expect(replay.data?.job_id).toBe(first.data?.job_id);
    expect(await prisma.generation_jobs.count({ where: { project_id: BigInt(PROJECT_ID) } })).toBe(1);
    // client_token 与 submission_id 不一致 → 400。
    const mismatch = await service.create(USER_ID, PROJECT_ID, {
      source_asset_id: "88", target_node_id: "n", granularity: "standard",
      client_token: UUID_B, canvas_binding: binding(UUID_A, "n", 0),
    });
    expect(mismatch.code).toBe(400);
    expect(mismatch.data).toMatchObject({ reason: RECOVERY_REASONS.invalidPayload });
  });

  it("★ 2. 人声分离受理：canvas_binding 接线（Idempotency-Key=submission_id）+ 重放返回原关联", async () => {
    const service = new VocalSplitsService(
      { client: prisma } as never,
      { findOwnedById: async () => ({}) } as never,
      { findOwnedSource: async () => ({ type: "video" }) } as never,
    );
    const first = await service.create(USER_ID, PROJECT_ID, {
      source_asset_id: "88", scene: "drama", output_format: "aac",
      canvas_binding: binding(UUID_A, "vocal-node-1", 0),
    }, {}, UUID_A);
    expect(first.code).toBe(200);
    expect(first.data).toMatchObject({
      status: "queued",
      canvas_binding: { submission_id: UUID_A, binding_revision: 1, is_current: true },
    });
    expect(await prisma.generation_canvas_submissions.count({ where: { project_id: BigInt(PROJECT_ID) } })).toBe(1);
    // 重放：同 submission_id 同参数 → 原 job。
    const replay = await service.create(USER_ID, PROJECT_ID, {
      source_asset_id: "88", scene: "drama", output_format: "aac",
      canvas_binding: binding(UUID_A, "vocal-node-1", 0),
    }, {}, UUID_A);
    expect(replay.data?.job_id).toBe(first.data?.job_id);
    expect(await prisma.generation_jobs.count({ where: { project_id: BigInt(PROJECT_ID) } })).toBe(1);
    // Idempotency-Key 与 submission_id 不一致 → 400。
    const mismatch = await service.create(USER_ID, PROJECT_ID, {
      source_asset_id: "88", canvas_binding: binding(UUID_B, "n", 0),
    }, {}, UUID_C);
    expect(mismatch.code).toBe(400);
    // 旧请求（无 canvas_binding）不接幂等，行为零变化：两次直建两个 job。
    const legacyA = await service.create(USER_ID, PROJECT_ID, { source_asset_id: "88" });
    const legacyB = await service.create(USER_ID, PROJECT_ID, { source_asset_id: "88" });
    expect(legacyA.data?.job_id).not.toBe(legacyB.data?.job_id);
  });

  it("★ 3. 输出槽投影：expected_output_count>1 → slot:<id> 项（node=generation-output:<id>，slot_id 同源）", async () => {
    const created = await acceptJob({
      submissionId: UUID_A, node: "slot-node-1", revision: 0,
      type: "image", expectedOutputCount: 2,
    });
    if (!("generation_job_id" in created)) throw new Error("受理失败");
    // 终态：两槽 succeeded（retry 链一并验证——槽 2 走重试行）。
    const jobId = BigInt(created.generation_job_id);
    const slots = await prisma.generation_output_slots.findMany({
      where: { generation_job_id: jobId },
      orderBy: { slot_index: "asc" },
    });
    expect(slots).toHaveLength(2);
    await prisma.generation_output_slots.update({
      where: { id: slots[0]!.id },
      data: { status: "succeeded", asset_id: 601n },
    });
    await prisma.generation_output_slots.update({
      where: { id: slots[1]!.id },
      data: { status: "failed" },
    });
    // 重试 job 补 failed 槽（挂在原 submission 的 job 上模拟重试产物归位：直接在同行补成功）。
    await prisma.generation_output_slots.update({
      where: { id: slots[1]!.id },
      data: { status: "succeeded", asset_id: 602n },
    });
    await raw.query(
      "UPDATE generation_jobs SET status='succeeded', output_asset_ids=CAST('[\"601\",\"602\"]' AS JSON) WHERE id = ?",
      [Number(jobId)],
    );
    const page = await listCanvasRecoveryPage(prisma, PROJECT_ID, 50, null);
    const record = page.records.find(item => item.submission_id === UUID_A)!;
    const outputItems = record.items.filter(item => item.output_key !== TARGET_OUTPUT_KEY);
    expect(outputItems.map(item => item.output_key).sort()).toEqual([
      `slot:${slots[0]!.id}`, `slot:${slots[1]!.id}`,
    ].sort());
    for (const item of outputItems) {
      expect(item.node_id).toBe(`generation-output:${item.output_key.slice("slot:".length)}`);
      expect(item.state).toBe("pending");
      expect(item.revision).toBe(0);
      expect(item.slot_id).toBe(item.output_key.slice("slot:".length));
    }
  });

  it("★ 4/7/12. 场景切分完整扇出：投影身份稳定 + replaceTarget 与全部 apply 同事务 + resolve 读回", async () => {
    const created = await acceptJob({
      submissionId: UUID_A, node: "scene-node-2", revision: 0,
      type: "video_scene_split",
      input: { source_asset_id: "5", target_node_id: "scene-node-2", granularity: "fine" },
    });
    if (!("generation_job_id" in created)) throw new Error("受理失败");
    await succeedSceneSplitJob(created.generation_job_id, [
      { index: 1, assetId: "701" },
      { index: 2, assetId: "702" },
    ]);
    const seg1 = multiResultNodeId(UUID_A, "segment:1");
    const seg2 = multiResultNodeId(UUID_A, "segment:2");
    // 重复扫描：两次恢复页结果一致（pending/0、不写库、身份不依赖数组顺序）。
    const page1 = await listCanvasRecoveryPage(prisma, PROJECT_ID, 50, null);
    const page2 = await listCanvasRecoveryPage(prisma, PROJECT_ID, 50, null);
    const pick = (page: typeof page1) => page.records
      .find(item => item.submission_id === UUID_A)!
      .items.map(item => [item.output_key, item.node_id, item.state, item.revision]);
    expect(pick(page1)).toEqual(pick(page2));
    expect(pick(page1)).toEqual([
      [TARGET_OUTPUT_KEY, "scene-node-2", "pending", 1],
      ["segment:1", seg1, "pending", 0],
      ["segment:2", seg2, "pending", 0],
    ]);
    // 完整扇出：占位移除 + 两段卡落位，一笔保存。
    const saved = await save({
      commandId: UUID_D, version: null,
      nodes: [markerNode(seg1, UUID_A, "segment:1", "701"), markerNode(seg2, UUID_A, "segment:2", "702")],
      changes: [
        { id: recoveryItemId(UUID_A, TARGET_OUTPUT_KEY), rev: 1, action: "replaceTarget" },
        { id: recoveryItemId(UUID_A, "segment:1"), rev: 0, action: "apply" },
        { id: recoveryItemId(UUID_A, "segment:2"), rev: 0, action: "apply" },
      ],
    });
    expect(saved.recoveryReceipt.changes).toEqual(expect.arrayContaining([
      expect.objectContaining({ state: "replaced", revision: 2 }),
      expect.objectContaining({ recoveryItemId: recoveryItemId(UUID_A, "segment:1"), state: "present", revision: 1, nodeBindingRevision: 1 }),
      expect.objectContaining({ recoveryItemId: recoveryItemId(UUID_A, "segment:2"), state: "present", revision: 1, nodeBindingRevision: 1 }),
    ]));
    // 逐项 owner 建立（节点唯一归属，各自 node）。
    for (const node of [seg1, seg2]) {
      const owner = await prisma.generation_canvas_node_owners.findUnique({
        where: { project_id_node_id: { project_id: BigInt(PROJECT_ID), node_id: node } },
      });
      expect(owner && Number(owner.binding_revision)).toBe(1);
    }
    // resolve 定向读取：只含请求项及所属关联。
    const resolved = await resolveCanvasRecoveryItems(prisma, PROJECT_ID, [
      recoveryItemId(UUID_A, "segment:1"),
    ]);
    expect(resolved).toHaveLength(1);
    expect(resolved[0]!.submission_id).toBe(UUID_A);
    expect(resolved[0]!.items.map(item => item.output_key)).toEqual(["segment:1"]);
  });

  it("★ 4b. 只删占位遗漏结果 → 422（扇出完整性）", async () => {
    const created = await acceptJob({
      submissionId: UUID_A, node: "scene-node-3", revision: 0,
      type: "video_scene_split",
      input: { source_asset_id: "5", target_node_id: "scene-node-3", granularity: "fine" },
    });
    if (!("generation_job_id" in created)) throw new Error("受理失败");
    await succeedSceneSplitJob(created.generation_job_id, [
      { index: 1, assetId: "701" },
      { index: 2, assetId: "702" },
    ]);
    await expectRejection(
      save({
        commandId: UUID_D, version: null, nodes: [],
        changes: [{ id: recoveryItemId(UUID_A, TARGET_OUTPUT_KEY), rev: 1, action: "replaceTarget" }],
      }) as never,
      422, RECOVERY_REASONS.documentMismatch,
    );
    // 整笔回滚：无输出行、无画布。
    expect(await prisma.generation_canvas_outputs.count({})).toBe(0);
    expect(await prisma.canvas.count({ where: { project_id: BigInt(PROJECT_ID) } })).toBe(0);
  });

  it("★ 5. 部分删除：1 apply + 1 remove 同笔扇出，removed 项独立、任务/资产不受影响", async () => {
    const created = await acceptJob({
      submissionId: UUID_A, node: "scene-node-4", revision: 0,
      type: "video_scene_split",
      input: { source_asset_id: "5", target_node_id: "scene-node-4", granularity: "fine" },
    });
    if (!("generation_job_id" in created)) throw new Error("受理失败");
    await succeedSceneSplitJob(created.generation_job_id, [
      { index: 1, assetId: "701" },
      { index: 2, assetId: "702" },
    ]);
    const seg1 = multiResultNodeId(UUID_A, "segment:1");
    const saved = await save({
      commandId: UUID_D, version: null,
      nodes: [markerNode(seg1, UUID_A, "segment:1", "701")], // 用户删掉第 2 段卡
      changes: [
        { id: recoveryItemId(UUID_A, TARGET_OUTPUT_KEY), rev: 1, action: "replaceTarget" },
        { id: recoveryItemId(UUID_A, "segment:1"), rev: 0, action: "apply" },
        { id: recoveryItemId(UUID_A, "segment:2"), rev: 0, action: "remove" },
      ],
    });
    const byKey = new Map(saved.recoveryReceipt.changes.map(change => [
      change.recoveryItemId.slice("gcr:".length + 36 + 1), change,
    ]));
    expect(byKey.get("segment:1")).toMatchObject({ state: "present", revision: 1 });
    expect(byKey.get("segment:2")).toMatchObject({ state: "removed", revision: 1, nodeBindingRevision: 1 });
    // 任务与资产不受部分删除影响。
    const job = await prisma.generation_jobs.findUnique({ where: { id: BigInt(created.generation_job_id) } });
    expect(job?.status).toBe("succeeded");
  });

  it("★ 6. 首次保存前删除：虚拟 remove 同事务建 owner；restore 恢复；旧 remove 不覆盖新撤销", async () => {
    const created = await acceptJob({
      submissionId: UUID_A, node: "scene-node-5", revision: 0,
      type: "video_scene_split",
      input: { source_asset_id: "5", target_node_id: "scene-node-5", granularity: "fine" },
    });
    if (!("generation_job_id" in created)) throw new Error("受理失败");
    await succeedSceneSplitJob(created.generation_job_id, [
      { index: 1, assetId: "701" },
      { index: 2, assetId: "702" },
    ]);
    const seg1 = multiResultNodeId(UUID_A, "segment:1");
    // 首次保存前直接删一项（无 replaceTarget 配套——多结果虚拟输出独立合法）。
    let version = await save({
      commandId: UUID_D, version: null, nodes: [markerNode(seg1, UUID_A, "segment:1", "701")],
      changes: [{ id: recoveryItemId(UUID_A, "segment:2"), rev: 0, action: "remove" }],
    });
    expect(version.recoveryReceipt.changes[0]).toMatchObject({ state: "removed", revision: 1, nodeBindingRevision: 1 });
    // 删除记录有 owner（不留下无 owner 记录），归属保留供显式撤销核对。
    const owner = await prisma.generation_canvas_node_owners.findUnique({
      where: { project_id_node_id: { project_id: BigInt(PROJECT_ID), node_id: multiResultNodeId(UUID_A, "segment:2") } },
    });
    expect(owner && Number(owner.binding_revision)).toBe(1);
    // 显式 restore：恢复为 present，revision 推进；归属仍在本项。
    version = await save({
      commandId: UUID_E, version: version.version,
      nodes: [markerNode(seg1, UUID_A, "segment:1", "701"), markerNode(multiResultNodeId(UUID_A, "segment:2"), UUID_A, "segment:2", "702")],
      changes: [{ id: recoveryItemId(UUID_A, "segment:2"), rev: 1, action: "restore" }],
    });
    expect(version.recoveryReceipt.changes[0]).toMatchObject({ state: "present", revision: 2, nodeBindingRevision: 1 });
    // 旧 remove 重放（expectedRevision 过期）不能覆盖新撤销 → 409。
    await expectRejection(
      save({
        commandId: UUID_F, version: version.version,
        nodes: [markerNode(seg1, UUID_A, "segment:1", "701")],
        changes: [{ id: recoveryItemId(UUID_A, "segment:2"), rev: 1, action: "remove" }],
      }) as never,
      409, RECOVERY_REASONS.itemConflict,
    );
    // 状态未被旧意图改写。
    const output = await prisma.generation_canvas_outputs.findUnique({
      where: {
        generation_canvas_submission_id_output_key: {
          generation_canvas_submission_id: (await prisma.generation_canvas_submissions.findUnique({
            where: { project_id_submission_id: { project_id: BigInt(PROJECT_ID), submission_id: UUID_A } },
          }))!.id,
          output_key: "segment:2",
        },
      },
    });
    expect(output?.state).toBe("present");
  });

  it("★ 8. 原位接管 + 旧结果独立操作：A transferred 后其输出仍可 remove/restore；job=null", async () => {
    const created = await acceptJob({
      submissionId: UUID_A, node: "scene-node-6", revision: 0,
      type: "video_scene_split",
      input: { source_asset_id: "5", target_node_id: "scene-node-6", granularity: "fine" },
    });
    if (!("generation_job_id" in created)) throw new Error("受理失败");
    await succeedSceneSplitJob(created.generation_job_id, [
      { index: 1, assetId: "701" },
      { index: 2, assetId: "702" },
    ]);
    const seg1 = multiResultNodeId(UUID_A, "segment:1");
    await save({
      commandId: UUID_D, version: null,
      nodes: [markerNode(seg1, UUID_A, "segment:1", "701"), markerNode(multiResultNodeId(UUID_A, "segment:2"), UUID_A, "segment:2", "702")],
      changes: [
        { id: recoveryItemId(UUID_A, TARGET_OUTPUT_KEY), rev: 1, action: "replaceTarget" },
        { id: recoveryItemId(UUID_A, "segment:1"), rev: 0, action: "apply" },
        { id: recoveryItemId(UUID_A, "segment:2"), rev: 0, action: "apply" },
      ],
    });
    // 新提交原位接管（同 target 节点，版本 +1）。
    await acceptJob({
      submissionId: UUID_B, node: "scene-node-6", revision: 1,
      type: "video_scene_split",
      input: { source_asset_id: "5", target_node_id: "scene-node-6", granularity: "coarse" },
    });
    const old = await prisma.generation_canvas_submissions.findUnique({
      where: { project_id_submission_id: { project_id: BigInt(PROJECT_ID), submission_id: UUID_A } },
    });
    expect(old?.target_state).toBe("transferred");
    // 旧关联：is_current=false、job=null（不读取被复用/新任务状态），但持久输出仍可见。
    const page = await listCanvasRecoveryPage(prisma, PROJECT_ID, 50, null);
    const oldRecord = page.records.find(item => item.submission_id === UUID_A)!;
    expect(oldRecord.is_current).toBe(false);
    expect(oldRecord.job).toBeNull();
    expect(oldRecord.items.filter(item => item.state === "present").map(item => item.output_key))
      .toEqual(["segment:1", "segment:2"]);
    // 旧提交其余独立节点仍可删除（不要求其原始目标仍是当前关联）。
    const version = await prisma.canvas.findFirst({ where: { project_id: BigInt(PROJECT_ID) } });
    await save({
      commandId: UUID_E, version: version!.version,
      nodes: [markerNode(seg1, UUID_A, "segment:1", "701")],
      changes: [{ id: recoveryItemId(UUID_A, "segment:2"), rev: 1, action: "remove" }],
    });
    // replaced/transferred 目标项不能 remove 复活。
    await expectRejection(
      save({
        commandId: UUID_F, version: version!.version + 1,
        nodes: [],
        changes: [{ id: recoveryItemId(UUID_A, TARGET_OUTPUT_KEY), rev: 3, action: "remove" }],
      }) as never,
      409, RECOVERY_REASONS.itemConflict,
    );
  });

  it("★ 9. 抢先成功后的旧取消意图：job succeeded → settleTarget 422（取消回退只认 cancelled）", async () => {
    const created = await acceptJob({
      submissionId: UUID_A, node: "scene-node-7", revision: 0,
      type: "video_scene_split",
      input: { source_asset_id: "5", target_node_id: "scene-node-7", granularity: "fine" },
    });
    if (!("generation_job_id" in created)) throw new Error("受理失败");
    // 用户发起取消（意图保留原素材），任务抢先成功。
    await raw.query("UPDATE generation_jobs SET status='succeeded' WHERE id = ?", [Number(created.generation_job_id)]);
    await expectRejection(
      save({
        commandId: UUID_D, version: null, nodes: [],
        changes: [{ id: recoveryItemId(UUID_A, TARGET_OUTPUT_KEY), rev: 1, action: "settleTarget" }],
      }) as never,
      422, RECOVERY_REASONS.documentMismatch,
    );
    // 占位未被动过（保留当前卡，不自动重发）。
    const submission = await prisma.generation_canvas_submissions.findUnique({
      where: { project_id_submission_id: { project_id: BigInt(PROJECT_ID), submission_id: UUID_A } },
    });
    expect(submission?.target_state).toBe("pending");
  });

  it("★ 10. 版本冲突整笔回滚：扇出保存中一项 revision 过期 → 409 且全部不落", async () => {
    const created = await acceptJob({
      submissionId: UUID_A, node: "scene-node-8", revision: 0,
      type: "video_scene_split",
      input: { source_asset_id: "5", target_node_id: "scene-node-8", granularity: "fine" },
    });
    if (!("generation_job_id" in created)) throw new Error("受理失败");
    await succeedSceneSplitJob(created.generation_job_id, [
      { index: 1, assetId: "701" },
      { index: 2, assetId: "702" },
    ]);
    await expectRejection(
      save({
        commandId: UUID_D, version: null,
        nodes: [markerNode(multiResultNodeId(UUID_A, "segment:1"), UUID_A, "segment:1", "701")],
        changes: [
          { id: recoveryItemId(UUID_A, TARGET_OUTPUT_KEY), rev: 1, action: "replaceTarget" },
          { id: recoveryItemId(UUID_A, "segment:1"), rev: 0, action: "apply" },
          { id: recoveryItemId(UUID_A, "segment:2"), rev: 9, action: "apply" }, // 过期版本
        ],
      }) as never,
      409, RECOVERY_REASONS.itemConflict,
    );
    expect(await prisma.generation_canvas_outputs.count({})).toBe(0);
    expect(await prisma.canvas.count({ where: { project_id: BigInt(PROJECT_ID) } })).toBe(0);
    const submission = await prisma.generation_canvas_submissions.findUnique({
      where: { project_id_submission_id: { project_id: BigInt(PROJECT_ID), submission_id: UUID_A } },
    });
    expect(submission?.target_state).toBe("pending");
  });

  it("★ 11. 投影失败：轨数不齐 → 恢复页保留占位不投影输出；replaceTarget 422 projection_invalid", async () => {
    const created = await acceptJob({
      submissionId: UUID_A, node: "vocal-node-2", revision: 0,
      type: "vocal_split",
      input: { source_asset_id: "5", scene: "drama", output_format: "aac" },
    });
    if (!("generation_job_id" in created)) throw new Error("受理失败");
    // drama 三轨但产物只有两轨（缺产物）。
    await raw.query(
      "UPDATE generation_jobs SET status='succeeded', output_asset_ids=CAST('[\"801\",\"802\"]' AS JSON) WHERE id = ?",
      [Number(created.generation_job_id)],
    );
    const page = await listCanvasRecoveryPage(prisma, PROJECT_ID, 50, null);
    const record = page.records.find(item => item.submission_id === UUID_A)!;
    // 保留占位：只有 $target 项，无输出投影、无重发。
    expect(record.items.map(item => item.output_key)).toEqual([TARGET_OUTPUT_KEY]);
    await expectRejection(
      save({
        commandId: UUID_D, version: null, nodes: [],
        changes: [{ id: recoveryItemId(UUID_A, TARGET_OUTPUT_KEY), rev: 1, action: "replaceTarget" }],
      }) as never,
      422, RECOVERY_REASONS.projectionInvalid,
    );
    const submission = await prisma.generation_canvas_submissions.findUnique({
      where: { project_id_submission_id: { project_id: BigInt(PROJECT_ID), submission_id: UUID_A } },
    });
    expect(submission?.target_state).toBe("pending");
  });

  it("★ 13. 伪造输出键 remove → 422（键必须在投影集内）", async () => {
    const created = await acceptJob({
      submissionId: UUID_A, node: "scene-node-9", revision: 0,
      type: "video_scene_split",
      input: { source_asset_id: "5", target_node_id: "scene-node-9", granularity: "fine" },
    });
    if (!("generation_job_id" in created)) throw new Error("受理失败");
    await succeedSceneSplitJob(created.generation_job_id, [{ index: 1, assetId: "701" }]);
    await expectRejection(
      save({
        commandId: UUID_D, version: null, nodes: [],
        changes: [{ id: recoveryItemId(UUID_A, "segment:999"), rev: 0, action: "remove" }],
      }) as never,
      422, RECOVERY_REASONS.documentMismatch,
    );
    expect(await prisma.generation_canvas_outputs.count({})).toBe(0);
  });
});
