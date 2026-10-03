// IKJKU2（PR981-REVIEW-20261003-F3）：新协议保存守护未声明受保护卡的真 MySQL 验证。
//
// 与 ikjjqu-canvas-recovery.integration.test.ts 同款门控：需要本地 MySQL（端口 3312）：
//   # 容器与建库（一次）：
//   docker run -d --name ikjku2-mysql -e MYSQL_ROOT_PASSWORD=ikjku2 \
//     -e MYSQL_DATABASE=bw_gate_ikjku2 -p 3312:3306 mysql:8
//   cd backend && DATABASE_URL='mysql://root:ikjku2@127.0.0.1:3312/bw_gate_ikjku2' \
//     pnpm exec prisma db push --accept-data-loss
//   # 跑测试：
//   IKJKU2_DATABASE_URL='mysql://root:ikjku2@127.0.0.1:3312/bw_gate_ikjku2' \
//     pnpm exec vitest run backend/libs/shared/persistence/ikjku2-canvas-recovery.integration.test.ts
// 未配置该变量时整组跳过；跳过不算通过。（QU 容器在 3307，勿动。）
//
// 验收场景（IKJKU2 brief）：
//   1. 合法 apply B 同时省略 present A → 422；整笔回滚（版本不递增、A 状态/文档/回执不变）；
//      拒绝后恢复查询（generation-recovery/resolve）与文档一致
//   2. 剥除标记 / 非法改绑 / 改资产 / 改类型（无动作）→ 422
//   3. 清空（未带 confirmEmpty）与多选删除绕过 → 422
//   4. removed 终态：显式 remove 后缺席合法；restore 恢复后缺席再次受守护
//   5. 合法路径回归：普通编辑、重复 apply 不省略、未入库 pending 占位省略（受理后未保存）
//   6. 方案应用绕过（PR981 复审 F3）：真实 applyPreview 入口只追加不省略受保护卡；
//      其落库前置守护（guardLegacyCanvasWrite，与旧协议整文档写共用）对省略受保护卡的
//      写拒绝 428 recovery_protocol_required，零写入（applyPreview 落库不经
//      saveCanvasWithRecovery，走 repo.saveIfVersion，守护在 canvas.service.ts 同源调用）

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

  /** 完整受理（与 ikjjqu 同构）：锁序核对 + job 行 + 关联行 + 幂等行。 */
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
    return prisma.canvas.findFirst({ where: { project_id: BigInt(PROJECT_ID) } });
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

  /** 前置：受理 A、B 并双扇出为 present（画布两卡、previous 有两张标记卡）。
   *  IKJLTS：产物清单与 markerNode 默认 assetId 对齐（apply 需核对可信产物）。 */
  async function seedTwoPresentCards() {
    const jobA = await accept(acceptance(UUID_A, NODE_A));
    const jobB = await accept(acceptance(UUID_B, NODE_B));
    await succeedJob(jobA.generation_job_id, "\"7\"");
    await succeedJob(jobB.generation_job_id, "\"7\"");
    // 首次保存：双占位入库（无动作普通保存）。
    const base = await save({
      commandId: CMD("00001"),
      version: null,
      nodes: [markerNode(NODE_A, UUID_A, TARGET_OUTPUT_KEY), markerNode(NODE_B, UUID_B, TARGET_OUTPUT_KEY)],
      changes: [],
    });
    // 双扇出：各自 replaceTarget + apply primary（A、B 落为 present 结果卡）。
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
    await prisma.generation_canvas_node_owners.deleteMany({ where: { project_id: BigInt(PROJECT_ID) } });
    await prisma.generation_canvas_outputs.deleteMany({});
    await prisma.generation_canvas_submissions.deleteMany({ where: { project_id: BigInt(PROJECT_ID) } });
    await prisma.command_idempotency.deleteMany({ where: { project_id: BigInt(PROJECT_ID) } });
    await prisma.canvas.deleteMany({ where: { project_id: BigInt(PROJECT_ID) } });
    await prisma.generation_output_slots.deleteMany({ where: { project_id: BigInt(PROJECT_ID) } });
    await prisma.generation_job_logs.deleteMany({});
    await prisma.cost_reservations.deleteMany({});
    await prisma.generation_jobs.deleteMany({ where: { project_id: BigInt(PROJECT_ID) } });
    await prisma.prompt_preview_snapshots.deleteMany({ where: { project_id: BigInt(PROJECT_ID) } });
  });

  it("★ 1. 合法 apply B 同时省略 present A → 422，整笔回滚且恢复查询与文档一致", async () => {
    const { fanned } = await seedTwoPresentCards();
    // B 的重复 apply 是无副作用合法动作（present 幂等）；省略 A 是未声明删除。
    await expectRejection(save({
      commandId: CMD("10001"),
      version: fanned.version,
      nodes: [markerNode(NODE_B, UUID_B, PRIMARY_OUTPUT_KEY)], // A 缺席
      changes: [{ id: recoveryItemId(UUID_B, PRIMARY_OUTPUT_KEY), rev: 1, action: "apply" }],
    }));
    // 整笔回滚：版本不递增、文档仍含 A、A 状态不变、回执未落。
    const row = await canvasRow();
    expect(row?.version).toBe(fanned.version);
    expect(await canvasNodeIds()).toEqual([NODE_A, NODE_B]);
    expect(await outputState(UUID_A, PRIMARY_OUTPUT_KEY)).toEqual({ state: "present", revision: 1 });
    expect(await outputState(UUID_B, PRIMARY_OUTPUT_KEY)).toEqual({ state: "present", revision: 1 });
    expect(await prisma.command_idempotency.findUnique({
      where: { project_id_operation_idempotency_key: { project_id: BigInt(PROJECT_ID), operation: "SAVE_CANVAS_RECOVERY_V1", idempotency_key: CMD("10001") } },
    })).toBeNull();
    // 拒绝后恢复查询读到的状态与文档一致（A/B 均 present，画布上两卡俱在）。
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
    // 剥除标记：A 节点不带 generationRecovery。
    const stripped = { ...markerNode(NODE_A, UUID_A, PRIMARY_OUTPUT_KEY) };
    delete (stripped.data as Record<string, unknown>).generationRecovery;
    await expectRejection(save({
      commandId: CMD("20001"), version: fanned.version,
      nodes: [stripped as Record<string, unknown>, cardB], changes: [],
    }));
    // 非法改绑：A 节点标记冒 B 的身份。
    await expectRejection(save({
      commandId: CMD("20002"), version: fanned.version,
      nodes: [markerNode(NODE_A, UUID_B, PRIMARY_OUTPUT_KEY), cardB], changes: [],
    }));
    // 结果资产被改变：assetId 7 → 9。
    await expectRejection(save({
      commandId: CMD("20003"), version: fanned.version,
      nodes: [markerNode(NODE_A, UUID_A, PRIMARY_OUTPUT_KEY, { assetId: "9" }), cardB], changes: [],
    }));
    // 承接类型被改变：mediaNode → textNode。
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
    // 整份清空且未确认。
    await expectRejection(save({
      commandId: CMD("30001"), version: fanned.version, nodes: [], changes: [],
    }));
    // 多选删除：只留一张无关普通卡，A、B 全部省略且无动作。
    await expectRejection(save({
      commandId: CMD("30002"), version: fanned.version,
      nodes: [{ id: "plain-card", type: "textNode", position: { x: 0, y: 0 }, data: {} }], changes: [],
    }));
    expect((await canvasRow())?.version).toBe(fanned.version);
    expect(await canvasNodeIds()).toEqual([NODE_A, NODE_B]);
  });

  it("★ 4. removed 终态：显式 remove 后缺席合法；restore 恢复后缺席再次受守护", async () => {
    const { fanned } = await seedTwoPresentCards();
    // 显式 remove A（一对一 primary 已落行，直接 remove）。
    const removed = await save({
      commandId: CMD("40001"), version: fanned.version,
      nodes: [markerNode(NODE_B, UUID_B, PRIMARY_OUTPUT_KEY)],
      changes: [{ id: recoveryItemId(UUID_A, PRIMARY_OUTPUT_KEY), rev: 1, action: "remove" }],
    });
    expect(removed.recoveryReceipt.changes[0]).toMatchObject({ state: "removed", revision: 2 });
    expect(await outputState(UUID_A, PRIMARY_OUTPUT_KEY)).toEqual({ state: "removed", revision: 2 });
    // removed 项的文档缺席是合法终态：后续普通保存不再拦截，版本照常递增。
    const quiet = await save({
      commandId: CMD("40002"), version: removed.version,
      nodes: [markerNode(NODE_B, UUID_B, PRIMARY_OUTPUT_KEY, { name: "改名" })], changes: [],
    });
    expect(quiet.version).toBe(removed.version + 1);
    // restore 恢复 A 为 present。
    const restored = await save({
      commandId: CMD("40003"), version: quiet.version,
      nodes: [markerNode(NODE_A, UUID_A, PRIMARY_OUTPUT_KEY), markerNode(NODE_B, UUID_B, PRIMARY_OUTPUT_KEY)],
      changes: [{ id: recoveryItemId(UUID_A, PRIMARY_OUTPUT_KEY), rev: 2, action: "restore" }],
    });
    expect(restored.recoveryReceipt.changes[0]).toMatchObject({ state: "present", revision: 3 });
    // 恢复 present 后再次省略 A → 回到守护（422）。
    await expectRejection(save({
      commandId: CMD("40004"), version: restored.version,
      nodes: [markerNode(NODE_B, UUID_B, PRIMARY_OUTPUT_KEY)], changes: [],
    }));
    expect((await canvasRow())?.version).toBe(restored.version);
  });

  it("★ 5. 合法路径回归：普通编辑、重复 apply 不省略、未入库 pending 占位省略", async () => {
    const { fanned } = await seedTwoPresentCards();
    // 受保护卡名称/位置/尺寸普通编辑（无动作）。
    const edited = await save({
      commandId: CMD("50001"), version: fanned.version,
      nodes: [
        markerNode(NODE_A, UUID_A, PRIMARY_OUTPUT_KEY, { name: "改名", position: { x: 9, y: 9 }, size: { width: 320, height: 240 } }),
        markerNode(NODE_B, UUID_B, PRIMARY_OUTPUT_KEY),
      ],
      changes: [],
    });
    expect(edited.version).toBe(fanned.version + 1);
    // 合法重复 apply B（幂等无副作用）且 A 原样在文档。
    const reapplied = await save({
      commandId: CMD("50002"), version: edited.version,
      nodes: [markerNode(NODE_A, UUID_A, PRIMARY_OUTPUT_KEY), markerNode(NODE_B, UUID_B, PRIMARY_OUTPUT_KEY)],
      changes: [{ id: recoveryItemId(UUID_B, PRIMARY_OUTPUT_KEY), rev: 1, action: "apply" }],
    });
    expect(reapplied.version).toBe(edited.version + 1);
    expect(reapplied.recoveryReceipt.changes[0]).toMatchObject({ state: "present", revision: 1 });
    // 受理新任务 C 但占位从未入库（previous 无标记卡）：省略其占位的保存合法
    //（ikjjqy 场景 6/8 形态——pending 占位以显式动作收口，不以文档在场强制）。
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
    // 预种方案快照：applyPreview 命中 getPromptSnapshot 即不外呼 agent 服务。
    const source = { sessionId: "ikjku2-session-1", revisionId: "rev-1", shotNo: 1 };
    await prisma.prompt_preview_snapshots.create({
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
    // 真实方案应用入口：受理成功、版本正常递增，受保护卡 A/B 原样保留（不被应用省略）。
    const applied = await canvasService.applyPreview(USER_ID, PROJECT_ID, {
      source, position: { x: 50, y: 60 },
    }) as { code: number; data?: { canvas?: { version?: number } } };
    expect(applied.code).toBe(200);
    const row = await canvasRow();
    expect(row?.version).toBe(fanned.version + 1);
    const nodes = (row?.nodes_json ?? []) as Array<{ id: string; type: string; data: Record<string, unknown> }>;
    expect(nodes).toHaveLength(3); // A、B + 新方案卡
    for (const id of [NODE_A, NODE_B]) {
      const node = nodes.find(item => item.id === id)!;
      expect(node.type).toBe("mediaNode");
      expect(node.data.generationRecovery).toBeDefined();
      expect(node.data.assetId).toBe("7");
    }
    expect(await outputState(UUID_A, PRIMARY_OUTPUT_KEY)).toEqual({ state: "present", revision: 1 });
    expect(await outputState(UUID_B, PRIMARY_OUTPUT_KEY)).toEqual({ state: "present", revision: 1 });
    // 方案应用落库前置的同一守护（guardLegacyCanvasWrite）：省略受保护卡的写 → 428 拒绝。
    // 与既有省略场景（★1）同款断言面：零写入（版本不递增、文档不变、A 状态不变）。
    const version = row!.version;
    const guarded = await canvasService.save(USER_ID, PROJECT_ID, {
      viewport: "{}",
      nodes: JSON.stringify([markerNode(NODE_B, UUID_B, PRIMARY_OUTPUT_KEY)]), // 省略 A
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
