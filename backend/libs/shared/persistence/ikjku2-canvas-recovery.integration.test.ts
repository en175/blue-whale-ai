import { clearEffectiveRecoveryOwners, effectiveCanvasRow } from "./recovery-owner-test-helpers.js";

























import { PrismaMariaDb } from "@prisma/adapter-mariadb";
import type { Pool } from "mariadb";
import { createHash } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildPoolConfig, getPrismaClient } from "./db.js";
import {
  RECOVERY_REASONS,
  TARGET_OUTPUT_KEY,
  PRIMARY_OUTPUT_KEY,
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
import { createJobWithinTx } from "./generation-command-repo.js";
import { CanvasService } from "@lib/shared/canvas/canvas.service.js";
import type { PrismaClient } from "@prisma/client";

const databaseUrl = process.env.IKJKU2_DATABASE_URL;

describe.skipIf(!databaseUrl)("新协议保存守护未声明受保护卡（IKJKU2）", () => {
  let prisma: PrismaClient;
  let raw: Pool;

  const PROJECT_ID = "930001";
  const USER_ID = "930009";
  const NODE_A = "ikjku2-node-a";
  const NODE_B = "ikjku2-node-b";
  const NODE_C = "ikjku2-node-c";
  const UUID_A = "2b3c4d5e-0000-4000-8000-00000000a001";
  const UUID_B = "2b3c4d5e-0000-4000-8000-00000000b002";
  const UUID_C = "2b3c4d5e-0000-4000-8000-00000000c003";
  const CMD = (suffix: string) => `2b3c4d5e-0000-4000-8000-0000000${suffix}`;

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
        actionIdentity: `ikjku2-${acceptanceInput.binding.submission_id}`,
        actionType: "generate_image",
      }, undefined, { key: acceptanceInput.idempotencyKey, requestHash: acceptanceInput.requestHash });
      await writeCanvasRecoveryRows(tx, locked.plan, BigInt(created.generation_job_id));
      return created;
    });
  }

  async function succeedJob(jobId: string, assetIds: string) {
    await raw.query(
      "UPDATE generation_jobs SET status='succeeded', output_asset_ids=CAST(? AS JSON) WHERE id = ?",
      [`[${assetIds}]`, Number(jobId)],
    );
  }

  function markerNode(
    id: string,
    submissionId: string,
    outputKey: string,
    overrides: { type?: string; assetId?: unknown; name?: string; position?: { x: number; y: number }; size?: { width: number; height: number } } = {},
  ) {
    return {
      id,
      type: overrides.type ?? "mediaNode",
      position: overrides.position ?? { x: 1, y: 2 },
      ...(overrides.size ? { width: overrides.size.width, height: overrides.size.height } : {}),
      data: {
        generationRecovery: { protocolVersion: 1, submissionId, outputKey },
        assetId: overrides.assetId ?? "7",
        ...(overrides.name !== undefined ? { name: overrides.name } : {}),
      },
    };
  }

  function save(args: {
    commandId: string;
    version: number | null;
    nodes: Array<Record<string, unknown>>;
    changes: Array<{ id: string; rev: number; action: string }>;
    confirmEmpty?: boolean;
  }) {
    return saveCanvasWithRecovery(prisma, {
      ownerId: USER_ID,
      projectId: PROJECT_ID,
      expectedVersion: args.version,
      viewport: "{}",
      nodes: JSON.stringify(args.nodes),
      edges: "[]",
      confirmEmpty: args.confirmEmpty ?? false,
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
    return effectiveCanvasRow(prisma, PROJECT_ID);
  }

  async function canvasNodeIds(): Promise<string[]> {
    const row = await canvasRow();
    const nodes = (row?.nodes_json ?? []) as Array<{ id: string }>;
    return nodes.map(node => String(node.id)).sort();
  }

  async function outputState(submissionId: string, outputKey: string) {
    const submission = await prisma.generation_canvas_submissions.findUnique({
      where: { project_id_submission_id: { project_id: BigInt(PROJECT_ID), submission_id: submissionId } },
    });
    const output = await prisma.generation_canvas_outputs.findUnique({
      where: {
        generation_canvas_submission_id_output_key: {
          generation_canvas_submission_id: submission!.id,
          output_key: outputKey,
        },
      },
    });
    return output ? { state: output.state, revision: Number(output.revision) } : null;
  }



  async function seedTwoPresentCards() {
    const jobA = await accept(acceptance(UUID_A, NODE_A));
    const jobB = await accept(acceptance(UUID_B, NODE_B));
    await succeedJob(jobA.generation_job_id, "\"7\"");
    await succeedJob(jobB.generation_job_id, "\"7\"");

    const base = await save({
      commandId: CMD("00001"),
      version: null,
      nodes: [markerNode(NODE_A, UUID_A, TARGET_OUTPUT_KEY), markerNode(NODE_B, UUID_B, TARGET_OUTPUT_KEY)],
      changes: [],
    });

    const fanned = await save({
      commandId: CMD("00002"),
      version: base.version,
      nodes: [markerNode(NODE_A, UUID_A, PRIMARY_OUTPUT_KEY), markerNode(NODE_B, UUID_B, PRIMARY_OUTPUT_KEY)],
      changes: [
        { id: recoveryItemId(UUID_A, TARGET_OUTPUT_KEY), rev: 1, action: "replaceTarget" },
        { id: recoveryItemId(UUID_A, PRIMARY_OUTPUT_KEY), rev: 0, action: "apply" },
        { id: recoveryItemId(UUID_B, TARGET_OUTPUT_KEY), rev: 1, action: "replaceTarget" },
        { id: recoveryItemId(UUID_B, PRIMARY_OUTPUT_KEY), rev: 0, action: "apply" },
      ],
    });
    return { fanned, jobA, jobB };
  }

  beforeAll(async () => {
    prisma = getPrismaClient(databaseUrl!);
    const adapter = await new PrismaMariaDb(buildPoolConfig(databaseUrl!)).connect();
    raw = adapter.underlyingDriver();
    await prisma.project.create({ data: { id: BigInt(PROJECT_ID), owner_id: BigInt(USER_ID), name: "ikjku2" } });
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
    await prisma.project_prompt_preview_snapshots.deleteMany({ where: { project_id: BigInt(PROJECT_ID) } });
  });

  it("★ 1. 合法 apply B 同时省略 present A → 422，整笔回滚且恢复查询与文档一致", async () => {
    const { fanned } = await seedTwoPresentCards();

    await expectRejection(save({
      commandId: CMD("10001"),
      version: fanned.version,
      nodes: [markerNode(NODE_B, UUID_B, PRIMARY_OUTPUT_KEY)],
      changes: [{ id: recoveryItemId(UUID_B, PRIMARY_OUTPUT_KEY), rev: 1, action: "apply" }],
    }));

    const row = await canvasRow();
    expect(row?.version).toBe(fanned.version);
    expect(await canvasNodeIds()).toEqual([NODE_A, NODE_B]);
    expect(await outputState(UUID_A, PRIMARY_OUTPUT_KEY)).toEqual({ state: "present", revision: 1 });
    expect(await outputState(UUID_B, PRIMARY_OUTPUT_KEY)).toEqual({ state: "present", revision: 1 });
    expect(await prisma.project_command_receipts.findUnique({
      where: { project_id_operation_idempotency_key: { project_id: BigInt(PROJECT_ID), operation: "SAVE_CANVAS_RECOVERY_V1", idempotency_key: CMD("10001") } },
    })).toBeNull();

    const page = await listCanvasRecoveryPage(prisma, PROJECT_ID, 50, null);
    const presentKeys = page.records
      .filter(record => record.submission_id === UUID_A || record.submission_id === UUID_B)
      .flatMap(record => record.items.map(item => [record.submission_id, item.output_key, item.state] as const))
      .filter(([, , state]) => state === "present")
      .map(([sid, key]) => `${sid.slice(-4)}:${key}`);
    expect(presentKeys).toEqual(["a001:primary", "b002:primary"]);
    const resolved = await resolveCanvasRecoveryItems(prisma, PROJECT_ID, [
      recoveryItemId(UUID_A, PRIMARY_OUTPUT_KEY),
    ]);
    expect(resolved[0]!.items[0]).toMatchObject({ output_key: PRIMARY_OUTPUT_KEY, state: "present", revision: 1 });
  });

  it("★ 2. 剥除标记 / 非法改绑 / 改资产 / 改类型（无动作）→ 422 且版本不递增", async () => {
    const { fanned } = await seedTwoPresentCards();
    const cardB = markerNode(NODE_B, UUID_B, PRIMARY_OUTPUT_KEY);

    const stripped = { ...markerNode(NODE_A, UUID_A, PRIMARY_OUTPUT_KEY) };
    delete (stripped.data as Record<string, unknown>).generationRecovery;
    await expectRejection(save({
      commandId: CMD("20001"), version: fanned.version,
      nodes: [stripped as Record<string, unknown>, cardB], changes: [],
    }));

    await expectRejection(save({
      commandId: CMD("20002"), version: fanned.version,
      nodes: [markerNode(NODE_A, UUID_B, PRIMARY_OUTPUT_KEY), cardB], changes: [],
    }));

    await expectRejection(save({
      commandId: CMD("20003"), version: fanned.version,
      nodes: [markerNode(NODE_A, UUID_A, PRIMARY_OUTPUT_KEY, { assetId: "9" }), cardB], changes: [],
    }));

    await expectRejection(save({
      commandId: CMD("20004"), version: fanned.version,
      nodes: [markerNode(NODE_A, UUID_A, PRIMARY_OUTPUT_KEY, { type: "textNode" }), cardB], changes: [],
    }));
    expect((await canvasRow())?.version).toBe(fanned.version);
    expect(await canvasNodeIds()).toEqual([NODE_A, NODE_B]);
    expect(await outputState(UUID_A, PRIMARY_OUTPUT_KEY)).toEqual({ state: "present", revision: 1 });
  });

  it("★ 3. 清空（未带 confirmEmpty）与多选删除绕过 → 422", async () => {
    const { fanned } = await seedTwoPresentCards();

    await expectRejection(save({
      commandId: CMD("30001"), version: fanned.version, nodes: [], changes: [],
    }));

    await expectRejection(save({
      commandId: CMD("30002"), version: fanned.version,
      nodes: [{ id: "plain-card", type: "textNode", position: { x: 0, y: 0 }, data: {} }], changes: [],
    }));
    expect((await canvasRow())?.version).toBe(fanned.version);
    expect(await canvasNodeIds()).toEqual([NODE_A, NODE_B]);
  });

  it("★ 4. removed 终态：显式 remove 后缺席合法；restore 恢复后缺席再次受守护", async () => {
    const { fanned } = await seedTwoPresentCards();

    const removed = await save({
      commandId: CMD("40001"), version: fanned.version,
      nodes: [markerNode(NODE_B, UUID_B, PRIMARY_OUTPUT_KEY)],
      changes: [{ id: recoveryItemId(UUID_A, PRIMARY_OUTPUT_KEY), rev: 1, action: "remove" }],
    });
    expect(removed.recoveryReceipt.changes[0]).toMatchObject({ state: "removed", revision: 2 });
    expect(await outputState(UUID_A, PRIMARY_OUTPUT_KEY)).toEqual({ state: "removed", revision: 2 });

    const quiet = await save({
      commandId: CMD("40002"), version: removed.version,
      nodes: [markerNode(NODE_B, UUID_B, PRIMARY_OUTPUT_KEY, { name: "改名" })], changes: [],
    });
    expect(quiet.version).toBe(removed.version + 1);

    const restored = await save({
      commandId: CMD("40003"), version: quiet.version,
      nodes: [markerNode(NODE_A, UUID_A, PRIMARY_OUTPUT_KEY), markerNode(NODE_B, UUID_B, PRIMARY_OUTPUT_KEY)],
      changes: [{ id: recoveryItemId(UUID_A, PRIMARY_OUTPUT_KEY), rev: 2, action: "restore" }],
    });
    expect(restored.recoveryReceipt.changes[0]).toMatchObject({ state: "present", revision: 3 });

    await expectRejection(save({
      commandId: CMD("40004"), version: restored.version,
      nodes: [markerNode(NODE_B, UUID_B, PRIMARY_OUTPUT_KEY)], changes: [],
    }));
    expect((await canvasRow())?.version).toBe(restored.version);
  });

  it("★ 5. 合法路径回归：普通编辑、重复 apply 不省略、未入库 pending 占位省略", async () => {
    const { fanned } = await seedTwoPresentCards();

    const edited = await save({
      commandId: CMD("50001"), version: fanned.version,
      nodes: [
        markerNode(NODE_A, UUID_A, PRIMARY_OUTPUT_KEY, { name: "改名", position: { x: 9, y: 9 }, size: { width: 320, height: 240 } }),
        markerNode(NODE_B, UUID_B, PRIMARY_OUTPUT_KEY),
      ],
      changes: [],
    });
    expect(edited.version).toBe(fanned.version + 1);

    const reapplied = await save({
      commandId: CMD("50002"), version: edited.version,
      nodes: [markerNode(NODE_A, UUID_A, PRIMARY_OUTPUT_KEY), markerNode(NODE_B, UUID_B, PRIMARY_OUTPUT_KEY)],
      changes: [{ id: recoveryItemId(UUID_B, PRIMARY_OUTPUT_KEY), rev: 1, action: "apply" }],
    });
    expect(reapplied.version).toBe(edited.version + 1);
    expect(reapplied.recoveryReceipt.changes[0]).toMatchObject({ state: "present", revision: 1 });


    await accept(acceptance(UUID_C, NODE_C));
    const withoutPlaceholder = await save({
      commandId: CMD("50003"), version: reapplied.version,
      nodes: [markerNode(NODE_A, UUID_A, PRIMARY_OUTPUT_KEY), markerNode(NODE_B, UUID_B, PRIMARY_OUTPUT_KEY)],
      changes: [],
    });
    expect(withoutPlaceholder.version).toBe(reapplied.version + 1);
  });

  it("★ 6. 方案应用绕过：真实 applyPreview 只追加不省略受保护卡；其写守护拒绝省略（428 零写入）", async () => {
    const { fanned } = await seedTwoPresentCards();

    const source = { sessionId: "ikjku2-session-1", revisionId: "rev-1", shotNo: 1 };
    await prisma.project_prompt_preview_snapshots.create({
      data: {
        project_id: BigInt(PROJECT_ID),
        source_key: createHash("sha256")
          .update(JSON.stringify([source.sessionId, source.revisionId, source.shotNo]))
          .digest("hex"),
        source_json: source,
        title: "夜色街角",
        text: "夜色中的街角",
        content_json: { title: "夜色街角", text: "夜色中的街角", promptMentions: [], promptMaterials: [] },
      },
    });
    const canvasService = new CanvasService(
      { client: prisma } as never,
      { findOwnedById: async () => ({}) } as never,
    );

    const applied = await canvasService.applyPreview(USER_ID, PROJECT_ID, {
      source, position: { x: 50, y: 60 },
    }) as { code: number; data?: { canvas?: { version?: number } } };
    expect(applied.code).toBe(200);
    const row = await canvasRow();
    expect(row?.version).toBe(fanned.version + 1);
    const nodes = (row?.nodes_json ?? []) as Array<{ id: string; type: string; data: Record<string, unknown> }>;
    expect(nodes).toHaveLength(3);
    for (const id of [NODE_A, NODE_B]) {
      const node = nodes.find(item => item.id === id)!;
      expect(node.type).toBe("mediaNode");
      expect(node.data.generationRecovery).toBeDefined();
      expect(node.data.assetId).toBe("7");
    }
    expect(await outputState(UUID_A, PRIMARY_OUTPUT_KEY)).toEqual({ state: "present", revision: 1 });
    expect(await outputState(UUID_B, PRIMARY_OUTPUT_KEY)).toEqual({ state: "present", revision: 1 });


    const version = row!.version;
    const guarded = await canvasService.save(USER_ID, PROJECT_ID, {
      viewport: "{}",
      nodes: JSON.stringify([markerNode(NODE_B, UUID_B, PRIMARY_OUTPUT_KEY)]),
      edges: "[]",
      expectedVersion: version,
    }) as { code: number; data: { reason: string } };
    expect(guarded.code).toBe(428);
    expect(guarded.data.reason).toBe(RECOVERY_REASONS.protocolRequired);
    expect((await canvasRow())?.version).toBe(version);
    expect(await canvasNodeIds()).toHaveLength(3);
    expect(await outputState(UUID_A, PRIMARY_OUTPUT_KEY)).toEqual({ state: "present", revision: 1 });
  });
});
