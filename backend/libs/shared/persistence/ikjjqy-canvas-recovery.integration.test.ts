

























import { PrismaMariaDb } from "@prisma/adapter-mariadb";
import type { Pool } from "mariadb";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildPoolConfig, getPrismaClient } from "./db.js";
import {
  IDEMPOTENCY_KEY_REUSED_CODE,
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
import { createCanvasRepo } from "./canvas-repo.js";
import { multiResultNodeId } from "./canvas-recovery-multi-output.js";
import { createJobWithinTx } from "./generation-command-repo.js";
import { VideoSceneSplitsService } from "@lib/shared/video-scene-splits/video-scene-splits.service.js";
import { VocalSplitsService } from "@lib/shared/vocal-splits/vocal-splits.service.js";
import type { Prisma, PrismaClient } from "@prisma/client";

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


  async function succeedSceneSplitJob(jobId: string, segments: Array<{ index: number; assetId: string }>, payload?: Prisma.InputJsonValue) {
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
        payload: payload ?? {
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

  });

  afterAll(async () => {
    if (!prisma) return;
    await prisma.assets.deleteMany({ where: { user_id: { in: [BigInt(USER_ID), BigInt(USER_ID) + 1n] } } });
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
    await prisma.assets.deleteMany({ where: { user_id: { in: [BigInt(USER_ID), BigInt(USER_ID) + 1n] } } });
    await prisma.generation_jobs.deleteMany({ where: { project_id: BigInt(PROJECT_ID) } });
  });

  it("★ 1. 场景切分受理：canvas_binding 接线（client_token=submission_id）+ 重放返回原关联", async () => {
    const service = new VideoSceneSplitsService(
      { client: prisma } as never,
      { findOwnedById: async () => ({}) } as never,
      { findOwnedSource: async () => ({ type: "video", duration_ms: 60_000 }) } as never,
      { probe: null } as never,
      { jobBilling: async () => undefined, release: async () => {} } as never,
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

    expect(await prisma.generation_canvas_submissions.count({ where: { project_id: BigInt(PROJECT_ID) } })).toBe(1);
    const owner = await prisma.generation_canvas_node_owners.findUnique({
      where: { project_id_node_id: { project_id: BigInt(PROJECT_ID), node_id: "scene-node-1" } },
    });
    expect(owner && Number(owner.binding_revision)).toBe(1);

    const replay = await service.create(USER_ID, PROJECT_ID, {
      source_asset_id: "88",
      target_node_id: "scene-node-1",
      granularity: "standard",
      client_token: UUID_A,
      canvas_binding: binding(UUID_A, "scene-node-1", 0),
    });
    expect(replay.data?.job_id).toBe(first.data?.job_id);
    expect(await prisma.generation_jobs.count({ where: { project_id: BigInt(PROJECT_ID) } })).toBe(1);

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
    }, ` \t${UUID_A}\n`);
    expect(first.code).toBe(200);
    expect(first.data).toMatchObject({
      status: "queued",
      canvas_binding: { submission_id: UUID_A, binding_revision: 1, is_current: true },
    });
    expect(await prisma.generation_canvas_submissions.count({ where: { project_id: BigInt(PROJECT_ID) } })).toBe(1);

    const replay = await service.create(USER_ID, PROJECT_ID, {
      source_asset_id: "88", scene: "drama", output_format: "aac",
      canvas_binding: binding(UUID_A, "vocal-node-1", 0),
    }, UUID_A);
    expect(replay.data?.job_id).toBe(first.data?.job_id);
    expect(await prisma.generation_jobs.count({ where: { project_id: BigInt(PROJECT_ID) } })).toBe(1);

    const paddedReplay = await service.create(USER_ID, PROJECT_ID, {
      source_asset_id: "88", scene: "drama", output_format: "aac",
      canvas_binding: binding(UUID_A, "vocal-node-1", 0),
    }, ` ${UUID_A} `);
    expect(paddedReplay.code).toBe(200);
    expect(paddedReplay.data?.job_id).toBe(first.data?.job_id);

    const conflict = await service.create(USER_ID, PROJECT_ID, {
      source_asset_id: "88", scene: "music", output_format: "aac",
      canvas_binding: binding(UUID_A, "vocal-node-1", 0),
    }, UUID_A);
    expect(conflict.code).toBe(IDEMPOTENCY_KEY_REUSED_CODE);
    expect(await prisma.generation_jobs.count({ where: { project_id: BigInt(PROJECT_ID) } })).toBe(1);

    const mismatch = await service.create(USER_ID, PROJECT_ID, {
      source_asset_id: "88", canvas_binding: binding(UUID_B, "n", 0),
    }, UUID_C);
    expect(mismatch.code).toBe(400);

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

    for (const node of [seg1, seg2]) {
      const owner = await prisma.generation_canvas_node_owners.findUnique({
        where: { project_id_node_id: { project_id: BigInt(PROJECT_ID), node_id: node } },
      });
      expect(owner && Number(owner.binding_revision)).toBe(1);
    }

    const resolved = await resolveCanvasRecoveryItems(prisma, PROJECT_ID, [
      recoveryItemId(UUID_A, "segment:1"),
    ]);
    expect(resolved).toHaveLength(1);
    expect(resolved[0]!.submission_id).toBe(UUID_A);
    expect(resolved[0]!.items.map(item => item.output_key)).toEqual(["segment:1"]);
  });

  it("任务 3416 日志恢复四段、原子替换占位并保存删除，三次回读不复活", async () => {
    const canvasRepo = createCanvasRepo(prisma);
    const created = await acceptJob({
      submissionId: UUID_A, node: "scene-node-3416", revision: 0,
      type: "video_scene_split",
      input: { source_asset_id: "8166", target_node_id: "scene-node-3416", granularity: "standard" },
    });
    if (!("generation_job_id" in created)) throw new Error("受理失败");
    const payload = {
      duration: 30.08,
      segments: [
        { segment_index: 1, start_time: 0, end_time: 2.0416667, segment_asset_id: "8215" },
        { segment_index: 2, start_time: 2.0416667, end_time: 3.5, segment_asset_id: "8216" },
        { segment_index: 3, start_time: 3.5, end_time: 4.75, segment_asset_id: "8217" },
        { segment_index: 4, start_time: 4.75, end_time: 30.041666, segment_asset_id: "8218" },
      ],
      asset_ids: ["8215", "8216", "8217", "8218"],
    };
    await succeedSceneSplitJob(created.generation_job_id,
      payload.segments.map(segment => ({ index: segment.segment_index, assetId: segment.segment_asset_id })), payload);
    const page = await listCanvasRecoveryPage(prisma, PROJECT_ID, 50, null);
    const record = page.records.find(item => item.submission_id === UUID_A)!;
    expect(record.items.map(item => [item.output_key, item.asset_id, item.state, item.revision])).toEqual([
      ["$target", null, "pending", 1],
      ["segment:1", "8215", "pending", 0],
      ["segment:2", "8216", "pending", 0],
      ["segment:3", "8217", "pending", 0],
      ["segment:4", "8218", "pending", 0],
    ]);
    const source = { id: "source-8166", type: "mediaNode", position: { x: 100, y: 200 }, data: { assetId: "8166" } };
    const segmentNodes = payload.segments.map(segment => markerNode(
      multiResultNodeId(UUID_A, `segment:${segment.segment_index}`), UUID_A,
      `segment:${segment.segment_index}`, segment.segment_asset_id,
    ));
    segmentNodes[2]!.position = { x: 1500, y: 700 };
    const nodes = [source, ...segmentNodes];
    await expectRejection(save({
      commandId: UUID_B, version: null, nodes: [source],
      changes: [{ id: recoveryItemId(UUID_A, "$target"), rev: 1, action: "remove" }],
    }), 409, RECOVERY_REASONS.itemConflict);
    await expectRejection(save({
      commandId: UUID_C, version: null, nodes: [source, segmentNodes[0]!],
      changes: [
        { id: recoveryItemId(UUID_A, "$target"), rev: 1, action: "replaceTarget" },
        { id: recoveryItemId(UUID_A, "segment:1"), rev: 0, action: "apply" },
      ],
    }), 422, RECOVERY_REASONS.documentMismatch);
    expect((await listCanvasRecoveryPage(prisma, PROJECT_ID, 50, null)).records).toEqual(page.records);
    expect(await canvasRepo.getByProject(PROJECT_ID)).toMatchObject({ id: null, version: null, nodes: null });

    const saved = await save({
      commandId: UUID_D, version: null, nodes,
      changes: [
        { id: recoveryItemId(UUID_A, "$target"), rev: 1, action: "replaceTarget" },
        ...record.items.filter(item => item.output_key !== "$target")
          .map(item => ({ id: item.recovery_item_id, rev: item.revision, action: "apply" })),
      ],
    });
    expect(saved.recoveryReceipt.changes.map(item => [item.state, item.revision])).toEqual([
      ["replaced", 2], ["present", 1], ["present", 1], ["present", 1], ["present", 1],
    ]);
    const remainingNodes = nodes.filter(node => node.id !== multiResultNodeId(UUID_A, "segment:2"));
    const removed = await save({
      commandId: UUID_E, version: saved.version, nodes: remainingNodes,
      changes: [{ id: recoveryItemId(UUID_A, "segment:2"), rev: 1, action: "remove" }],
    });
    expect(removed.recoveryReceipt.changes).toEqual([
      expect.objectContaining({ recoveryItemId: recoveryItemId(UUID_A, "segment:2"), state: "removed", revision: 2 }),
    ]);
    for (let refresh = 0; refresh < 3; refresh += 1) {
      const recovery = await listCanvasRecoveryPage(prisma, PROJECT_ID, 50, null);
      expect(recovery.records[0]!.items.map(item => [item.output_key, item.asset_id, item.state, item.revision])).toEqual([
        ["$target", null, "replaced", 2], ["segment:1", "8215", "present", 1], ["segment:2", "8216", "removed", 2],
        ["segment:3", "8217", "present", 1], ["segment:4", "8218", "present", 1],
      ]);
      const document = await canvasRepo.getByProject(PROJECT_ID);
      expect(JSON.parse(document.nodes ?? "null")).toEqual(remainingNodes);
      expect(document.version).toBe(removed.version);
      const resolved = await resolveCanvasRecoveryItems(prisma, PROJECT_ID, [recoveryItemId(UUID_A, "segment:2")]);
      expect(resolved[0]!.items).toEqual([expect.objectContaining({ state: "removed", revision: 2 })]);
    }
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
      nodes: [markerNode(seg1, UUID_A, "segment:1", "701")],
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

    let version = await save({
      commandId: UUID_D, version: null, nodes: [markerNode(seg1, UUID_A, "segment:1", "701")],
      changes: [{ id: recoveryItemId(UUID_A, "segment:2"), rev: 0, action: "remove" }],
    });
    expect(version.recoveryReceipt.changes[0]).toMatchObject({ state: "removed", revision: 1, nodeBindingRevision: 1 });

    const owner = await prisma.generation_canvas_node_owners.findUnique({
      where: { project_id_node_id: { project_id: BigInt(PROJECT_ID), node_id: multiResultNodeId(UUID_A, "segment:2") } },
    });
    expect(owner && Number(owner.binding_revision)).toBe(1);

    version = await save({
      commandId: UUID_E, version: version.version,
      nodes: [markerNode(seg1, UUID_A, "segment:1", "701"), markerNode(multiResultNodeId(UUID_A, "segment:2"), UUID_A, "segment:2", "702")],
      changes: [{ id: recoveryItemId(UUID_A, "segment:2"), rev: 1, action: "restore" }],
    });
    expect(version.recoveryReceipt.changes[0]).toMatchObject({ state: "present", revision: 2, nodeBindingRevision: 1 });

    await expectRejection(
      save({
        commandId: UUID_F, version: version.version,
        nodes: [markerNode(seg1, UUID_A, "segment:1", "701")],
        changes: [{ id: recoveryItemId(UUID_A, "segment:2"), rev: 1, action: "remove" }],
      }) as never,
      409, RECOVERY_REASONS.itemConflict,
    );

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

    await acceptJob({
      submissionId: UUID_B, node: "scene-node-6", revision: 1,
      type: "video_scene_split",
      input: { source_asset_id: "5", target_node_id: "scene-node-6", granularity: "coarse" },
    });
    const old = await prisma.generation_canvas_submissions.findUnique({
      where: { project_id_submission_id: { project_id: BigInt(PROJECT_ID), submission_id: UUID_A } },
    });
    expect(old?.target_state).toBe("transferred");

    const page = await listCanvasRecoveryPage(prisma, PROJECT_ID, 50, null);
    const oldRecord = page.records.find(item => item.submission_id === UUID_A)!;
    expect(oldRecord.is_current).toBe(false);
    expect(oldRecord.job).toBeNull();
    expect(oldRecord.items.filter(item => item.state === "present").map(item => item.output_key))
      .toEqual(["segment:1", "segment:2"]);

    const version = await prisma.canvas.findFirst({ where: { project_id: BigInt(PROJECT_ID) } });
    await save({
      commandId: UUID_E, version: version!.version,
      nodes: [markerNode(seg1, UUID_A, "segment:1", "701")],
      changes: [{ id: recoveryItemId(UUID_A, "segment:2"), rev: 1, action: "remove" }],
    });

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

    await raw.query("UPDATE generation_jobs SET status='succeeded' WHERE id = ?", [Number(created.generation_job_id)]);
    await expectRejection(
      save({
        commandId: UUID_D, version: null, nodes: [],
        changes: [{ id: recoveryItemId(UUID_A, TARGET_OUTPUT_KEY), rev: 1, action: "settleTarget" }],
      }) as never,
      422, RECOVERY_REASONS.documentMismatch,
    );

    const submission = await prisma.generation_canvas_submissions.findUnique({
      where: { project_id_submission_id: { project_id: BigInt(PROJECT_ID), submission_id: UUID_A } },
    });
    expect(submission?.target_state).toBe("pending");
  });

  it.each(["failed", "cancelled"])("场景切分 %s 占位仍可删除且恢复查询保留删除状态", async (status) => {
    const created = await acceptJob({
      submissionId: UUID_A, node: "scene-terminal", revision: 0,
      type: "video_scene_split",
      input: { source_asset_id: "8166", target_node_id: "scene-terminal", granularity: "standard" },
    });
    if (!("generation_job_id" in created)) throw new Error("受理失败");
    await raw.query("UPDATE generation_jobs SET status=? WHERE id=?", [status, Number(created.generation_job_id)]);
    const source = { id: "source-8166", type: "mediaNode", position: { x: 100, y: 200 }, data: { assetId: "8166" } };
    const saved = await save({
      commandId: UUID_D, version: null, nodes: [source],
      changes: [{ id: recoveryItemId(UUID_A, "$target"), rev: 1, action: "remove" }],
    });
    expect(saved.recoveryReceipt.changes).toEqual([
      expect.objectContaining({ recoveryItemId: recoveryItemId(UUID_A, "$target"), state: "removed", revision: 2 }),
    ]);
    const page = await listCanvasRecoveryPage(prisma, PROJECT_ID, 50, null);
    expect(page.records[0]!.items).toEqual([
      expect.objectContaining({ output_key: "$target", state: "removed", revision: 2 }),
    ]);
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
          { id: recoveryItemId(UUID_A, "segment:2"), rev: 9, action: "apply" },
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

    await raw.query(
      "UPDATE generation_jobs SET status='succeeded', output_asset_ids=CAST('[\"801\",\"802\"]' AS JSON) WHERE id = ?",
      [Number(created.generation_job_id)],
    );
    const page = await listCanvasRecoveryPage(prisma, PROJECT_ID, 50, null);
    const record = page.records.find(item => item.submission_id === UUID_A)!;

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

  async function outputsOfSubmission(submissionId: string) {
    const submission = await prisma.generation_canvas_submissions.findUnique({
      where: { project_id_submission_id: { project_id: BigInt(PROJECT_ID), submission_id: submissionId } },
    });
    return prisma.generation_canvas_outputs.findMany({
      where: { generation_canvas_submission_id: submission!.id },
      orderBy: { output_key: "asc" },
    });
  }

  async function acceptSceneSplit3416() {
    const created = await acceptJob({
      submissionId: UUID_A, node: "scene-node-3416", revision: 0,
      type: "video_scene_split",
      input: { source_asset_id: "8166", target_node_id: "scene-node-3416", granularity: "standard" },
    });
    if (!("generation_job_id" in created)) throw new Error("受理失败");
    const payload = {
      duration: 30.08,
      segments: [
        { segment_index: 1, start_time: 0, end_time: 2.0416667, segment_asset_id: "8215" },
        { segment_index: 2, start_time: 2.0416667, end_time: 3.5, segment_asset_id: "8216" },
        { segment_index: 3, start_time: 3.5, end_time: 4.75, segment_asset_id: "8217" },
        { segment_index: 4, start_time: 4.75, end_time: 30.041666, segment_asset_id: "8218" },
      ],
    };
    await succeedSceneSplitJob(created.generation_job_id,
      payload.segments.map(segment => ({ index: segment.segment_index, assetId: segment.segment_asset_id })), payload);
    const source = { id: "source-8166", type: "mediaNode", position: { x: 100, y: 200 }, data: { assetId: "8166" } };
    const segmentNodes = payload.segments.map(segment => markerNode(
      multiResultNodeId(UUID_A, `segment:${segment.segment_index}`), UUID_A,
      `segment:${segment.segment_index}`, segment.segment_asset_id,
    ));
    return { source, segmentNodes };
  }

  it("★ 14. 保存新输出行写入服务端校验的 asset_id，后续更新不丢失", async () => {
    const { source, segmentNodes } = await acceptSceneSplit3416();
    const page = await listCanvasRecoveryPage(prisma, PROJECT_ID, 50, null);
    const record = page.records.find(item => item.submission_id === UUID_A)!;
    const saved = await save({
      commandId: UUID_D, version: null, nodes: [source, ...segmentNodes],
      changes: [
        { id: recoveryItemId(UUID_A, TARGET_OUTPUT_KEY), rev: 1, action: "replaceTarget" },
        ...record.items.filter(item => item.output_key !== TARGET_OUTPUT_KEY)
          .map(item => ({ id: item.recovery_item_id, rev: item.revision, action: "apply" })),
      ],
    });
    const assetTuples = async () => (await outputsOfSubmission(UUID_A))
      .map(row => [row.output_key, row.asset_id === null ? null : row.asset_id.toString(), row.state]);
    expect(await assetTuples()).toEqual([
      ["segment:1", "8215", "present"],
      ["segment:2", "8216", "present"],
      ["segment:3", "8217", "present"],
      ["segment:4", "8218", "present"],
    ]);

    const kept = segmentNodes.filter(node => node.id !== multiResultNodeId(UUID_A, "segment:2"));
    const removed = await save({
      commandId: UUID_E, version: saved.version, nodes: [source, ...kept],
      changes: [{ id: recoveryItemId(UUID_A, "segment:2"), rev: 1, action: "remove" }],
    });
    expect(await assetTuples()).toEqual([
      ["segment:1", "8215", "present"],
      ["segment:2", "8216", "removed"],
      ["segment:3", "8217", "present"],
      ["segment:4", "8218", "present"],
    ]);

    await save({
      commandId: UUID_F, version: removed.version, nodes: [source, ...segmentNodes],
      changes: [{ id: recoveryItemId(UUID_A, "segment:2"), rev: 2, action: "restore" }],
    });
    expect(await assetTuples()).toEqual([
      ["segment:1", "8215", "present"],
      ["segment:2", "8216", "present"],
      ["segment:3", "8217", "present"],
      ["segment:4", "8218", "present"],
    ]);
  });

  it("★ 15. 存量输出行 asset_id=null：按 output_key/segment_index 还原（乱序不改对应），GET 不写库", async () => {
    const created = await acceptJob({
      submissionId: UUID_A, node: "scene-node-legacy", revision: 0,
      type: "video_scene_split",
      input: { source_asset_id: "8166", target_node_id: "scene-node-legacy", granularity: "standard" },
    });
    if (!("generation_job_id" in created)) throw new Error("受理失败");
    const shuffled = [
      { segment_index: 3, start_time: 3.5, end_time: 4.75, segment_asset_id: "8217" },
      { segment_index: 1, start_time: 0, end_time: 2.0416667, segment_asset_id: "8215" },
      { segment_index: 4, start_time: 4.75, end_time: 30.041666, segment_asset_id: "8218" },
      { segment_index: 2, start_time: 2.0416667, end_time: 3.5, segment_asset_id: "8216" },
    ];
    await succeedSceneSplitJob(created.generation_job_id,
      shuffled.map(segment => ({ index: segment.segment_index, assetId: segment.segment_asset_id })),
      { duration: 30.08, segments: shuffled });
    const source = { id: "source-8166", type: "mediaNode", position: { x: 100, y: 200 }, data: { assetId: "8166" } };
    const segmentNodes = shuffled.map(segment => markerNode(
      multiResultNodeId(UUID_A, `segment:${segment.segment_index}`), UUID_A,
      `segment:${segment.segment_index}`, segment.segment_asset_id,
    ));
    const page = await listCanvasRecoveryPage(prisma, PROJECT_ID, 50, null);
    const record = page.records.find(item => item.submission_id === UUID_A)!;
    await save({
      commandId: UUID_D, version: null, nodes: [source, ...segmentNodes],
      changes: [
        { id: recoveryItemId(UUID_A, TARGET_OUTPUT_KEY), rev: 1, action: "replaceTarget" },
        ...record.items.filter(item => item.output_key !== TARGET_OUTPUT_KEY)
          .map(item => ({ id: item.recovery_item_id, rev: item.revision, action: "apply" })),
      ],
    });
    const submission = await prisma.generation_canvas_submissions.findUnique({
      where: { project_id_submission_id: { project_id: BigInt(PROJECT_ID), submission_id: UUID_A } },
    });
    await raw.query(
      "UPDATE generation_canvas_outputs SET asset_id = NULL WHERE generation_canvas_submission_id = ?",
      [Number(submission!.id)],
    );
    const before = await outputsOfSubmission(UUID_A);
    expect(before.map(row => row.asset_id)).toEqual([null, null, null, null]);

    const readAssetTuples = async () => (await listCanvasRecoveryPage(prisma, PROJECT_ID, 50, null))
      .records.find(item => item.submission_id === UUID_A)!.items
      .filter(item => item.output_key !== TARGET_OUTPUT_KEY)
      .map(item => [item.output_key, item.asset_id])
      .sort((a, b) => String(a[0]).localeCompare(String(b[0]), "en", { numeric: true }));
    expect(await readAssetTuples()).toEqual([
      ["segment:1", "8215"], ["segment:2", "8216"], ["segment:3", "8217"], ["segment:4", "8218"],
    ]);
    expect(await outputsOfSubmission(UUID_A)).toEqual(before);

    const resolved = await resolveCanvasRecoveryItems(prisma, PROJECT_ID, [recoveryItemId(UUID_A, "segment:2")]);
    expect(resolved[0]!.items).toEqual([expect.objectContaining({ output_key: "segment:2", asset_id: "8216" })]);
    expect(await outputsOfSubmission(UUID_A)).toEqual(before);
  });

  it("★ 16. 关联冲突或无法验证时保持不可确认，不借用其他素材", async () => {
    const scene = await acceptJob({
      submissionId: UUID_A, node: "scene-node-conflict", revision: 0,
      type: "video_scene_split",
      input: { source_asset_id: "5", target_node_id: "scene-node-conflict", granularity: "fine" },
    });
    if (!("generation_job_id" in scene)) throw new Error("受理失败");
    await succeedSceneSplitJob(scene.generation_job_id, [
      { index: 1, assetId: "701" },
      { index: 2, assetId: "702" },
    ]);
    const img = await acceptJob({
      submissionId: UUID_B, node: "img-node-legacy", revision: 0,
      type: "image",
      input: { prompt: "whale" },
    });
    if (!("generation_job_id" in img)) throw new Error("受理失败");
    await raw.query(
      "UPDATE generation_jobs SET status='succeeded', output_asset_ids=CAST('[\"911\",\"912\"]' AS JSON) WHERE id = ?",
      [Number(img.generation_job_id)],
    );
    const imgSubmission = await prisma.generation_canvas_submissions.findUnique({
      where: { project_id_submission_id: { project_id: BigInt(PROJECT_ID), submission_id: UUID_B } },
    });
    await prisma.generation_canvas_outputs.create({
      data: {
        generation_canvas_submission_id: imgSubmission!.id,
        output_key: "primary",
        node_id: "img-node-legacy",
        asset_id: null,
        state: "present",
        revision: 1,
      },
    });

    const readItem = async (submissionId: string, outputKey: string) => {
      const page = await listCanvasRecoveryPage(prisma, PROJECT_ID, 50, null);
      return page.records.find(item => item.submission_id === submissionId)!
        .items.find(item => item.output_key === outputKey)!;
    };
    expect((await readItem(UUID_B, "primary")).asset_id).toBeNull();

    const sceneSubmission = await prisma.generation_canvas_submissions.findUnique({
      where: { project_id_submission_id: { project_id: BigInt(PROJECT_ID), submission_id: UUID_A } },
    });
    await prisma.generation_canvas_outputs.createMany({
      data: ["segment:1", "segment:2"].map((outputKey, index) => ({
        generation_canvas_submission_id: sceneSubmission!.id,
        output_key: outputKey,
        node_id: multiResultNodeId(UUID_A, outputKey),
        asset_id: null,
        state: "present",
        revision: 1,
      })),
    });
    await prisma.generation_job_logs.deleteMany({ where: { generation_job_id: BigInt(scene.generation_job_id) } });
    const before = await outputsOfSubmission(UUID_A);
    expect((await readItem(UUID_A, "segment:1")).asset_id).toBeNull();
    expect((await readItem(UUID_A, "segment:2")).asset_id).toBeNull();
    expect(await outputsOfSubmission(UUID_A)).toEqual(before);
    const resolved = await resolveCanvasRecoveryItems(prisma, PROJECT_ID, [recoveryItemId(UUID_A, "segment:1")]);
    expect(resolved[0]!.items).toEqual([expect.objectContaining({ output_key: "segment:1", asset_id: null })]);
  });

  it("★ 17. 读取区分服务端确认软删除与暂时不可确认（归属/缺行不算删除）", async () => {
    await prisma.assets.createMany({
      data: [
        { id: 8215n, user_id: BigInt(USER_ID), type: "video", url: "https://example.test/8215.mp4" },
        { id: 8216n, user_id: BigInt(USER_ID), type: "video", url: "https://example.test/8216.mp4", is_delete: true, deleted_at: new Date() },
        { id: 8218n, user_id: BigInt(USER_ID) + 1n, type: "video", url: "https://example.test/8218.mp4" },
      ],
    });
    const { source, segmentNodes } = await acceptSceneSplit3416();
    const readTuples = async () => (await listCanvasRecoveryPage(prisma, PROJECT_ID, 50, null))
      .records.find(item => item.submission_id === UUID_A)!.items
      .map(item => [item.output_key, item.asset_id, item.asset_deleted])
      .sort((a, b) => String(a[0]).localeCompare(String(b[0]), "en", { numeric: true }));
    expect(await readTuples()).toEqual([
      ["$target", null, null],
      ["segment:1", "8215", false],
      ["segment:2", "8216", true],
      ["segment:3", "8217", null],
      ["segment:4", "8218", null],
    ]);

    const page = await listCanvasRecoveryPage(prisma, PROJECT_ID, 50, null);
    const record = page.records.find(item => item.submission_id === UUID_A)!;
    await save({
      commandId: UUID_D, version: null, nodes: [source, ...segmentNodes],
      changes: [
        { id: recoveryItemId(UUID_A, TARGET_OUTPUT_KEY), rev: 1, action: "replaceTarget" },
        ...record.items.filter(item => item.output_key !== TARGET_OUTPUT_KEY)
          .map(item => ({ id: item.recovery_item_id, rev: item.revision, action: "apply" })),
      ],
    });
    expect(await readTuples()).toEqual([
      ["$target", null, null],
      ["segment:1", "8215", false],
      ["segment:2", "8216", true],
      ["segment:3", "8217", null],
      ["segment:4", "8218", null],
    ]);
    const resolved = await resolveCanvasRecoveryItems(prisma, PROJECT_ID, [recoveryItemId(UUID_A, "segment:2")]);
    expect(resolved[0]!.items).toEqual([
      expect.objectContaining({ output_key: "segment:2", asset_id: "8216", asset_deleted: true }),
    ]);
  });

  it("★ 18. 首次保存前删除的输出行同样写入受信 asset_id", async () => {
    const created = await acceptJob({
      submissionId: UUID_A, node: "scene-node-remove-first", revision: 0,
      type: "video_scene_split",
      input: { source_asset_id: "5", target_node_id: "scene-node-remove-first", granularity: "fine" },
    });
    if (!("generation_job_id" in created)) throw new Error("受理失败");
    await succeedSceneSplitJob(created.generation_job_id, [
      { index: 1, assetId: "9015" },
      { index: 2, assetId: "9016" },
    ]);
    const seg1 = multiResultNodeId(UUID_A, "segment:1");
    await save({
      commandId: UUID_D, version: null,
      nodes: [markerNode(seg1, UUID_A, "segment:1", "9015")],
      changes: [{ id: recoveryItemId(UUID_A, "segment:2"), rev: 0, action: "remove" }],
    });
    expect((await outputsOfSubmission(UUID_A)).map(row => [row.output_key, row.asset_id?.toString() ?? null, row.state]))
      .toEqual([["segment:2", "9016", "removed"]]);
  });

  it("★ 19. 单段场景切分：输出行写入段资产，读取的软删事实随资产状态变化", async () => {
    await prisma.assets.create({
      data: { id: 8415n, user_id: BigInt(USER_ID), type: "video", url: "https://example.test/8415.mp4" },
    });
    const created = await acceptJob({
      submissionId: UUID_A, node: "scene-node-single", revision: 0,
      type: "video_scene_split",
      input: { source_asset_id: "8166", target_node_id: "scene-node-single", granularity: "standard" },
    });
    if (!("generation_job_id" in created)) throw new Error("受理失败");
    await succeedSceneSplitJob(created.generation_job_id, [{ index: 1, assetId: "8415" }]);
    const readItems = async () => (await listCanvasRecoveryPage(prisma, PROJECT_ID, 50, null))
      .records.find(item => item.submission_id === UUID_A)!.items
      .map(item => [item.output_key, item.asset_id, item.asset_deleted]);
    expect(await readItems()).toEqual([
      [TARGET_OUTPUT_KEY, null, null],
      ["segment:1", "8415", false],
    ]);
    const source = { id: "source-8166", type: "mediaNode", position: { x: 100, y: 200 }, data: { assetId: "8166" } };
    await save({
      commandId: UUID_D, version: null,
      nodes: [source, markerNode(multiResultNodeId(UUID_A, "segment:1"), UUID_A, "segment:1", "8415")],
      changes: [
        { id: recoveryItemId(UUID_A, TARGET_OUTPUT_KEY), rev: 1, action: "replaceTarget" },
        { id: recoveryItemId(UUID_A, "segment:1"), rev: 0, action: "apply" },
      ],
    });
    expect((await outputsOfSubmission(UUID_A)).map(row => [row.output_key, row.asset_id?.toString() ?? null]))
      .toEqual([["segment:1", "8415"]]);
    expect(await readItems()).toEqual([
      [TARGET_OUTPUT_KEY, null, null],
      ["segment:1", "8415", false],
    ]);
    await prisma.assets.update({ where: { id: 8415n }, data: { is_delete: true, deleted_at: new Date() } });
    expect(await readItems()).toEqual([
      [TARGET_OUTPUT_KEY, null, null],
      ["segment:1", "8415", true],
    ]);
  });

  it("★ 20. 人声分离：track: 键按 job.output_asset_ids 写入对应轨道资产，读取的软删事实一一对应", async () => {
    await prisma.assets.createMany({
      data: [
        { id: 8511n, user_id: BigInt(USER_ID), type: "audio", url: "https://example.test/8511.flac" },
        { id: 8512n, user_id: BigInt(USER_ID), type: "audio", url: "https://example.test/8512.flac" },
      ],
    });
    const created = await acceptJob({
      submissionId: UUID_A, node: "vocal-node-tracks", revision: 0,
      type: "vocal_split",
      input: { source_asset_id: "5", scene: "audio", output_format: "aac" },
    });
    if (!("generation_job_id" in created)) throw new Error("受理失败");
    await raw.query(
      "UPDATE generation_jobs SET status='succeeded', output_asset_ids=CAST('[\"8511\",\"8512\"]' AS JSON) WHERE id = ?",
      [Number(created.generation_job_id)],
    );
    const readItems = async () => (await listCanvasRecoveryPage(prisma, PROJECT_ID, 50, null))
      .records.find(item => item.submission_id === UUID_A)!.items
      .map(item => [item.output_key, item.asset_id, item.asset_deleted])
      .sort((a, b) => String(a[0]).localeCompare(String(b[0])));
    expect(await readItems()).toEqual([
      [TARGET_OUTPUT_KEY, null, null],
      ["track:background", "8512", false],
      ["track:voice", "8511", false],
    ]);
    const trackKeys = ["voice", "background"];
    const assetIdOf = (track: string) => (track === "voice" ? "8511" : "8512");
    await save({
      commandId: UUID_D, version: null,
      nodes: trackKeys.map(track => markerNode(
        multiResultNodeId(UUID_A, `track:${track}`), UUID_A, `track:${track}`, assetIdOf(track),
      )),
      changes: [
        { id: recoveryItemId(UUID_A, TARGET_OUTPUT_KEY), rev: 1, action: "replaceTarget" },
        ...trackKeys.map(track => ({ id: recoveryItemId(UUID_A, `track:${track}`), rev: 0, action: "apply" })),
      ],
    });
    expect((await outputsOfSubmission(UUID_A)).map(row => [row.output_key, row.asset_id?.toString() ?? null]))
      .toEqual([["track:background", "8512"], ["track:voice", "8511"]]);
    await prisma.assets.update({ where: { id: 8512n }, data: { is_delete: true, deleted_at: new Date() } });
    expect(await readItems()).toEqual([
      [TARGET_OUTPUT_KEY, null, null],
      ["track:background", "8512", true],
      ["track:voice", "8511", false],
    ]);
  });

  it("★ 21. 部分软删：转换遗漏已删段 → 422 零写入；只声明存活段可原子保存并稳定回读", async () => {
    await prisma.assets.createMany({
      data: [
        { id: 8615n, user_id: BigInt(USER_ID), type: "video", url: "https://example.test/8615.mp4" },
        { id: 8616n, user_id: BigInt(USER_ID), type: "video", url: "https://example.test/8616.mp4", is_delete: true, deleted_at: new Date() },
      ],
    });
    const created = await acceptJob({
      submissionId: UUID_A, node: "scene-node-iknbks", revision: 0,
      type: "video_scene_split",
      input: { source_asset_id: "8166", target_node_id: "scene-node-iknbks", granularity: "standard" },
    });
    if (!("generation_job_id" in created)) throw new Error("受理失败");
    await succeedSceneSplitJob(created.generation_job_id, [
      { index: 1, assetId: "8615" },
      { index: 2, assetId: "8616" },
    ]);
    const readItems = async () => (await listCanvasRecoveryPage(prisma, PROJECT_ID, 50, null))
      .records.find(item => item.submission_id === UUID_A)!.items
      .map(item => [item.output_key, item.asset_id, item.asset_deleted, item.state, item.revision]);
    expect(await readItems()).toEqual([
      [TARGET_OUTPUT_KEY, null, null, "pending", 1],
      ["segment:1", "8615", false, "pending", 0],
      ["segment:2", "8616", true, "pending", 0],
    ]);

    const source = { id: "source-8166", type: "mediaNode", position: { x: 100, y: 200 }, data: { assetId: "8166" } };
    const placeholder = {
      id: "scene-node-iknbks", type: "mediaNode", position: { x: 958, y: 0 },
      data: { fileName: "场景切分 · 标准", mediaType: "video" },
    };
    const survivor = markerNode(multiResultNodeId(UUID_A, "segment:1"), UUID_A, "segment:1", "8615");

    await expectRejection(save({
      commandId: UUID_B, version: null, nodes: [source, survivor],
      changes: [
        { id: recoveryItemId(UUID_A, TARGET_OUTPUT_KEY), rev: 1, action: "replaceTarget" },
        { id: recoveryItemId(UUID_A, "segment:1"), rev: 0, action: "apply" },
      ],
    }), 422, RECOVERY_REASONS.documentMismatch);
    expect(await prisma.generation_canvas_outputs.count({})).toBe(0);
    expect(await prisma.canvas.count({ where: { project_id: BigInt(PROJECT_ID) } })).toBe(0);
    expect(await readItems()).toEqual([
      [TARGET_OUTPUT_KEY, null, null, "pending", 1],
      ["segment:1", "8615", false, "pending", 0],
      ["segment:2", "8616", true, "pending", 0],
    ]);

    const nodes = [source, placeholder, survivor];
    const saved = await save({
      commandId: UUID_D, version: null, nodes,
      changes: [{ id: recoveryItemId(UUID_A, "segment:1"), rev: 0, action: "apply" }],
    });
    expect(saved.recoveryReceipt.changes).toEqual([
      expect.objectContaining({ recoveryItemId: recoveryItemId(UUID_A, "segment:1"), state: "present", revision: 1 }),
    ]);
    expect((await outputsOfSubmission(UUID_A)).map(row => [row.output_key, row.asset_id?.toString() ?? null, row.state]))
      .toEqual([["segment:1", "8615", "present"]]);
    expect((await prisma.assets.findUnique({ where: { id: 8616n } }))!.is_delete).toBe(true);

    for (let refresh = 0; refresh < 3; refresh += 1) {
      expect(await readItems()).toEqual([
        [TARGET_OUTPUT_KEY, null, null, "pending", 1],
        ["segment:1", "8615", false, "present", 1],
      ]);
      expect((await outputsOfSubmission(UUID_A)).map(row => [row.output_key, row.state]))
        .toEqual([["segment:1", "present"]]);
      const document = await createCanvasRepo(prisma).getByProject(PROJECT_ID);
      expect(JSON.parse(document.nodes ?? "null")).toEqual(JSON.parse(JSON.stringify(nodes)));
      expect(document.version).toBe(saved.version);
      const resolved = await resolveCanvasRecoveryItems(prisma, PROJECT_ID, [recoveryItemId(UUID_A, "segment:2")]);
      expect(resolved[0]!.items).toEqual([]);
    }
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
