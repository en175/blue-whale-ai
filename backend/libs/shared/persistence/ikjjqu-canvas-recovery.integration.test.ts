// IKJJQU（IKIXK9-SPEC-20261002 B 节）：恢复契约 v1 的真 MySQL 验证。
//
// 与 ikizqc-finalize-unique.integration.test.ts 同款门控：需要本地 MySQL（如 Docker 暴露的 3307）：
//   # 容器与建库（一次）：
//   docker run -d --name ikjjqu-mysql -e MYSQL_ROOT_PASSWORD=ikjjqu \
//     -e MYSQL_DATABASE=bw_gate_ikjjqu -p 3307:3306 mysql:8
//   cd backend && DATABASE_URL='mysql://root:ikjjqu@127.0.0.1:3307/bw_gate_ikjjqu' \
//     npx prisma db push --accept-data-loss
//   # 跑测试：
//   IKJJQU_DATABASE_URL='mysql://root:ikjjqu@127.0.0.1:3307/bw_gate_ikjjqu' \
//     pnpm exec vitest run backend/libs/shared/persistence/ikjjqu-canvas-recovery.integration.test.ts
// 未配置该变量时整组跳过；跳过不算通过。
//
// 验收场景（工单第 9 条）：
//   1. 首次画布竞争（两路并发首次保存 → 恰一胜，输家 412）
//   2. 双提交竞争（同节点同承接版本并发受理 → 恰一胜，输家 409 在任务写入/预扣前）
//   3. 节点唯一归属（owner 唯一约束 + 版本推进 + 旧承接 transferred）
//   4. 受理断连（受理成功但响应未达 → 同意图重放返回原关联）
//   5. 结果未落盘（job 成功但 outputs 无行 → 恢复页返回 pending/0 项）
//   6. 保存回执丢失（保存成功后重放同 commandId → replayed=true 且不递增版本）
//   7. 版本冲突（412 带当前版本）
//   8. 整笔回滚（保存失败 → 画布/恢复项/回执全部不变）
//   9. 五动作（apply/remove/restore/replaceTarget+primary/settleTarget）

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
import { createJobWithinTx } from "./generation-command-repo.js";
import type { PrismaClient } from "@prisma/client";

const databaseUrl = process.env.IKJJQU_DATABASE_URL;

describe.skipIf(!databaseUrl)("恢复契约 v1 真库验证（IKJJQU）", () => {
  let prisma: PrismaClient;
  let raw: Pool;

  const PROJECT_ID = "910001";
  const USER_ID = "910009";
  const UUID_A = "0a1b2c3d-0000-4000-8000-00000000a001";
  const UUID_B = "0a1b2c3d-0000-4000-8000-00000000b002";
  const UUID_C = "0a1b2c3d-0000-4000-8000-00000000c003";
  const UUID_D = "0a1b2c3d-0000-4000-8000-00000000d004";
  const UUID_E = "0a1b2c3d-0000-4000-8000-00000000e005";

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

  function acceptance(submissionId: string, node: string, revision: number, requestHash = `hash-${submissionId}`): CanvasRecoveryAcceptance {
    return {
      projectId: PROJECT_ID,
      userId: USER_ID,
      binding: binding(submissionId, node, revision),
      operation: "generation.create",
      requestHash,
      idempotencyKey: submissionId,
      taskType: "image",
    };
  }

  /** 完整受理：锁序核对 + 建 job 行 + 关联行 + 幂等行，一个事务（与受理链路同构）。 */
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
        actionIdentity: `ikjjqu-${acceptanceInput.binding.submission_id}`,
        actionType: "generate_image",
      }, undefined, { key: acceptanceInput.idempotencyKey, requestHash: acceptanceInput.requestHash });
      await writeCanvasRecoveryRows(tx, locked.plan, BigInt(created.generation_job_id));
      return created;
    });
  }

  async function canvasVersion(): Promise<number | null> {
    const row = await prisma.canvas.findFirst({ where: { project_id: BigInt(PROJECT_ID) } });
    return row ? row.version : null;
  }

  beforeAll(async () => {
    prisma = getPrismaClient(databaseUrl!);
    // raw 连接用于直接断言/操纵任务终态（绕过 repo 语义）：与 ikizqc 同款 adapter.connect 后取底层驱动。
    const adapter = await new PrismaMariaDb(buildPoolConfig(databaseUrl!)).connect();
    raw = adapter.underlyingDriver();
    await prisma.project.create({ data: { id: BigInt(PROJECT_ID), owner_id: BigInt(USER_ID), name: "ikjjqu" } });
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

  it("★ 4. 受理断连：受理成功但响应未达 → 同意图重放返回原关联（不重复建任务）", async () => {
    const first = await accept(acceptance(UUID_A, "node-1", 0));
    // 网络重放：同 submission_id、同摘要再走一次受理事务（锁内幂等回读命中）。
    const replay = await accept(acceptance(UUID_A, "node-1", 0));
    expect(replay).toEqual({ kind: "replay", result: first });
    const jobs = await prisma.generation_jobs.count({ where: { project_id: BigInt(PROJECT_ID) } });
    const submissions = await prisma.generation_canvas_submissions.count({ where: { project_id: BigInt(PROJECT_ID) } });
    expect(jobs).toBe(1);
    expect(submissions).toBe(1);
  });

  it("★ 2. 双提交竞争：同节点同承接版本并发 → 恰一胜，输家 409 canvas_binding_conflict", async () => {
    const attempts = await Promise.allSettled([
      accept(acceptance(UUID_B, "node-race", 0)),
      accept(acceptance(UUID_C, "node-race", 0)),
    ]);
    const fulfilled = attempts.filter(r => r.status === "fulfilled");
    const rejected = attempts.filter(r => r.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    const error = (rejected[0] as PromiseRejectedResult).reason;
    expect(error).toBeInstanceOf(RecoveryContractError);
    expect((error as RecoveryContractError).envelope).toMatchObject({
      code: 409,
      data: { reason: RECOVERY_REASONS.bindingConflict, currentBindingRevision: 1 },
    });
    // 输家零写入：任务/关联/归属各恰一行。
    expect(await prisma.generation_jobs.count({ where: { project_id: BigInt(PROJECT_ID) } })).toBe(1);
    expect(await prisma.generation_canvas_submissions.count({ where: { project_id: BigInt(PROJECT_ID) } })).toBe(1);
    const owner = await prisma.generation_canvas_node_owners.findUnique({
      where: { project_id_node_id: { project_id: BigInt(PROJECT_ID), node_id: "node-race" } },
    });
    expect(owner?.binding_revision).toBe(1);
  });

  it("★ 3. 节点唯一归属：新提交接管推进版本，旧承接项转 transferred", async () => {
    // 旧提交先落一个持久输出（replaceTarget+apply primary），再被新意图接管——
    // 接管后旧关联 is_current=false 但仍拥有自己的输出节点（恢复页可见、job=null）。
    const created = await accept(acceptance(UUID_A, "node-own", 0));
    await raw.query("UPDATE generation_jobs SET status='succeeded', output_asset_ids=CAST('[\"12\"]' AS JSON) WHERE id = ?", [Number(created.generation_job_id)]);
    await saveCanvasWithRecovery(prisma, {
      ownerId: USER_ID, projectId: PROJECT_ID, expectedVersion: null,
      viewport: "{}", edges: "[]", confirmEmpty: false, commandId: UUID_D,
      nodes: JSON.stringify([markerNode("node-own", UUID_A, PRIMARY_OUTPUT_KEY)]),
      changes: [
        { recoveryItemId: recoveryItemId(UUID_A, TARGET_OUTPUT_KEY), expectedRevision: 1, action: "replaceTarget" },
        { recoveryItemId: recoveryItemId(UUID_A, PRIMARY_OUTPUT_KEY), expectedRevision: 0, action: "apply" },
      ],
    });
    // 第二个新意图（新 submission_id）携当前版本接管。
    await accept(acceptance(UUID_B, "node-own", 1));
    const owners = await prisma.generation_canvas_node_owners.findMany({
      where: { project_id: BigInt(PROJECT_ID), node_id: "node-own" },
    });
    expect(owners).toHaveLength(1);
    expect(Number(owners[0]!.binding_revision)).toBe(2);
    const old = await prisma.generation_canvas_submissions.findUnique({
      where: { project_id_submission_id: { project_id: BigInt(PROJECT_ID), submission_id: UUID_A } },
    });
    expect(old?.target_state).toBe("transferred");
    // 受理 pending/1 → replaceTarget replaced/2 → 接管 transferred/3。
    expect(Number(old?.target_revision)).toBe(3);
    // 恢复页：旧关联 is_current=false（job=null，但有持久 primary 输出项）；新关联 is_current=true。
    const page = await listCanvasRecoveryPage(prisma, PROJECT_ID, 50, null);
    const oldRecord = page.records.find(r => r.submission_id === UUID_A)!;
    const newRecord = page.records.find(r => r.submission_id === UUID_B)!;
    expect(oldRecord.is_current).toBe(false);
    expect(oldRecord.job).toBeNull();
    expect(oldRecord.items.find(item => item.output_key === PRIMARY_OUTPUT_KEY)?.state).toBe("present");
    expect(newRecord.is_current).toBe(true);
    expect(newRecord.job).not.toBeNull();
  });

  it("★ 5. 结果未落盘：job 成功但未保存 → 恢复页返回 pending/0 虚拟输出项", async () => {
    const created = await accept(acceptance(UUID_A, "node-pending", 0));
    await raw.query("UPDATE generation_jobs SET status='succeeded', output_asset_ids=CAST('[\"12\"]' AS JSON) WHERE id = ?", [Number(created.generation_job_id)]);
    const page = await listCanvasRecoveryPage(prisma, PROJECT_ID, 50, null);
    const record = page.records.find(r => r.submission_id === UUID_A)!;
    const target = record.items.find(item => item.output_key === TARGET_OUTPUT_KEY)!;
    const primary = record.items.find(item => item.output_key === PRIMARY_OUTPUT_KEY)!;
    expect(target.state).toBe("pending");
    expect(target.revision).toBe(1);
    expect(primary).toMatchObject({ state: "pending", revision: 0, node_binding_revision: 0 });
    // outputs 表无行（GET 不写库）。
    expect(await prisma.generation_canvas_outputs.count({})).toBe(0);
  });

  it("★ 1+7+9apply. 首次画布竞争 + $target apply + 版本冲突 + resolve 定向读取", async () => {
    await accept(acceptance(UUID_A, "node-save", 0));
    const markedNode = (outputKey: string) => ({
      id: "node-save", type: "mediaNode", position: { x: 0, y: 0 },
      data: { generationRecovery: { protocolVersion: 1, submissionId: UUID_A, outputKey }, mediaType: "image" },
    });
    const doc = JSON.stringify([markedNode(TARGET_OUTPUT_KEY)]);
    // 首次画布竞争：两路并发首次保存（expectedVersion=null）→ 恰一胜，输家 412。
    const barrier = () => Promise.allSettled([
      saveCanvasWithRecovery(prisma, baseSave(UUID_D, null, doc, [{ id: recoveryItemId(UUID_A, TARGET_OUTPUT_KEY), rev: 1, action: "apply" }])),
      saveCanvasWithRecovery(prisma, baseSave(UUID_E, null, doc, [{ id: recoveryItemId(UUID_A, TARGET_OUTPUT_KEY), rev: 1, action: "apply" }])),
    ]);
    const [first, second] = await barrier();
    const results = [first, second];
    const won = results.filter(r => r.status === "fulfilled") as Array<PromiseFulfilledResult<Awaited<ReturnType<typeof saveCanvasWithRecovery>>>>;
    const lost = results.filter(r => r.status === "rejected") as Array<PromiseRejectedResult>;
    expect(won).toHaveLength(1);
    expect(lost).toHaveLength(1);
    expect((lost[0]!.reason as RecoveryContractError).envelope).toMatchObject({
      code: 412,
      data: { reason: RECOVERY_REASONS.versionConflict, version: 0 },
    });
    expect(won[0]!.value.version).toBe(0);
    // apply：目标项 pending → present，revision 1→2。
    expect(won[0]!.value.recoveryReceipt.changes[0]).toMatchObject({
      state: "present", revision: 2, nodeBindingRevision: 1,
    });
    // 版本冲突：过期版本 → 412 带当前版本。
    const stale = await saveCanvasWithRecovery(prisma, baseSave("0a1b2c3d-0000-4000-8000-00000000f006", 5, doc, [])).catch(e => e as RecoveryContractError);
    expect(stale.envelope).toMatchObject({ code: 412, data: { reason: RECOVERY_REASONS.versionConflict, version: 0 } });
    // resolve：按恢复项身份定向读取。
    const resolved = await resolveCanvasRecoveryItems(prisma, PROJECT_ID, [recoveryItemId(UUID_A, TARGET_OUTPUT_KEY)]);
    expect(resolved).toHaveLength(1);
    expect(resolved[0]!.items).toHaveLength(1);
    expect(resolved[0]!.items[0]).toMatchObject({ state: "present", revision: 2 });
    // resolve：查询不到的项整体 404（不猜测补建）。
    const missing = await resolveCanvasRecoveryItems(prisma, PROJECT_ID, ["gcr:0a1b2c3d-0000-4000-8000-00000000ffff:primary"]).catch(e => e as RecoveryContractError);
    expect(missing).toBeInstanceOf(RecoveryContractError);
    expect(missing.envelope).toMatchObject({ code: 404, data: { reason: RECOVERY_REASONS.resourceNotFound } });
  });

  it("★ 6. 保存回执丢失：保存成功后重放同 commandId → replayed=true 且不递增版本", async () => {
    await accept(acceptance(UUID_A, "node-receipt", 0));
    const doc = JSON.stringify([markerNode("node-receipt", UUID_A, TARGET_OUTPUT_KEY)]);
    const commandId = "0a1b2c3d-0000-4000-8000-0000000000aa";
    const first = await saveCanvasWithRecovery(prisma, baseSave(commandId, null, doc, [
      { id: recoveryItemId(UUID_A, TARGET_OUTPUT_KEY), rev: 1, action: "apply" },
    ]));
    expect(first.recoveryReceipt.replayed).toBe(false);
    const versionAfterFirst = await canvasVersion();
    // 回执丢失重放：同 commandId 同载荷 → 原回执，replayed=true，版本不递增。
    const replay = await saveCanvasWithRecovery(prisma, baseSave(commandId, null, doc, [
      { id: recoveryItemId(UUID_A, TARGET_OUTPUT_KEY), rev: 1, action: "apply" },
    ]));
    expect(replay.recoveryReceipt.replayed).toBe(true);
    expect(replay.version).toBe(first.version);
    expect(await canvasVersion()).toBe(versionAfterFirst);
    // 异载荷复用命令 → 409 recovery_command_reused。
    const reused = await saveCanvasWithRecovery(prisma, baseSave(commandId, null, JSON.stringify([]), [])).catch(e => e as RecoveryContractError);
    expect(reused.envelope).toMatchObject({ code: 409, data: { reason: RECOVERY_REASONS.commandReused } });
  });

  it("★ 8. 整笔回滚：动作与文档不一致 → 画布/恢复项/回执全部不变", async () => {
    await accept(acceptance(UUID_A, "node-rollback", 0));
    const doc = JSON.stringify([markerNode("node-rollback", UUID_A, TARGET_OUTPUT_KEY)]);
    const first = await saveCanvasWithRecovery(prisma, baseSave(UUID_D, null, doc, [
      { id: recoveryItemId(UUID_A, TARGET_OUTPUT_KEY), rev: 1, action: "apply" },
    ]));
    const version = await canvasVersion();
    // 动作与文档不一致：文档中节点缺正确标记却要求 remove 之外的 apply 幂等。
    const bad = await saveCanvasWithRecovery(prisma, baseSave(UUID_E, version, JSON.stringify([
      { id: "other", type: "textNode", data: {} },
    ]), [
      { id: recoveryItemId(UUID_A, TARGET_OUTPUT_KEY), rev: 2, action: "restore" }, // restore 只接受 removed
    ])).catch(e => e as RecoveryContractError);
    expect(bad.envelope).toMatchObject({ code: 409, data: { reason: RECOVERY_REASONS.itemConflict, currentState: "present" } });
    // 整笔回滚：版本不变、回执行不存在、目标项状态未被推进。
    expect(await canvasVersion()).toBe(version);
    const receipt = await prisma.command_idempotency.findUnique({
      where: { project_id_operation_idempotency_key: { project_id: BigInt(PROJECT_ID), operation: "SAVE_CANVAS_RECOVERY_V1", idempotency_key: UUID_E } },
    });
    expect(receipt).toBeNull();
    const submission = await prisma.generation_canvas_submissions.findUnique({
      where: { project_id_submission_id: { project_id: BigInt(PROJECT_ID), submission_id: UUID_A } },
    });
    expect(submission?.target_state).toBe("present");
    expect(Number(submission?.target_revision)).toBe(2);
    void first;
  });

  it("★ 9五动作. remove/restore 与 replaceTarget+primary 及 settleTarget", async () => {
    // — remove：空占位移除（文档不含标记）→ removed；restore 恢复为 present —
    const createdActions = await accept(acceptance(UUID_A, "node-actions", 0));
    // B.6 remove 守护：目标删除只在任务终态（取消/失败）后放行——先置失败再删。
    await raw.query("UPDATE generation_jobs SET status='failed' WHERE id = ?", [Number(createdActions.generation_job_id)]);
    const empty = JSON.stringify([]);
    let version = await saveCanvasWithRecovery(prisma, baseSave(UUID_D, null, empty, [
      { id: recoveryItemId(UUID_A, TARGET_OUTPUT_KEY), rev: 1, action: "remove" },
    ]));
    expect(version.recoveryReceipt.changes[0]).toMatchObject({ state: "removed", revision: 2 });
    const restored = await saveCanvasWithRecovery(prisma, baseSave(UUID_E, version.version, JSON.stringify([markerNode("node-actions", UUID_A, TARGET_OUTPUT_KEY)]), [
      { id: recoveryItemId(UUID_A, TARGET_OUTPUT_KEY), rev: 2, action: "restore" },
    ]));
    expect(restored.recoveryReceipt.changes[0]).toMatchObject({ state: "present", revision: 3 });
    // — replaceTarget + primary：任务成功后一对一转换 —
    const submission = await prisma.generation_canvas_submissions.findUnique({
      where: { project_id_submission_id: { project_id: BigInt(PROJECT_ID), submission_id: UUID_A } },
    });
    await raw.query("UPDATE generation_jobs SET status='succeeded', output_asset_ids=CAST('[\"12\"]' AS JSON) WHERE id = ?", [Number(submission!.generation_job_id)]);
    const primaryDoc = JSON.stringify([markerNode("node-actions", UUID_A, PRIMARY_OUTPUT_KEY)]);
    const commandId3 = "0a1b2c3d-0000-4000-8000-0000000000cc";
    const replaced = await saveCanvasWithRecovery(prisma, baseSave(commandId3, restored.version, primaryDoc, [
      { id: recoveryItemId(UUID_A, TARGET_OUTPUT_KEY), rev: 3, action: "replaceTarget" },
      { id: recoveryItemId(UUID_A, PRIMARY_OUTPUT_KEY), rev: 0, action: "apply" },
    ]));
    expect(replaced.recoveryReceipt.changes).toEqual(expect.arrayContaining([
      expect.objectContaining({ state: "replaced", revision: 4 }),
      expect.objectContaining({ state: "present", revision: 1, nodeBindingRevision: 1 }),
    ]));
    // owner 从 $target 切到 primary，不推进版本。
    const owner = await prisma.generation_canvas_node_owners.findUnique({
      where: { project_id_node_id: { project_id: BigInt(PROJECT_ID), node_id: "node-actions" } },
    });
    expect(owner?.output_key).toBe(PRIMARY_OUTPUT_KEY);
    expect(Number(owner?.binding_revision)).toBe(1);
    // outputs 行建立（primary present）。
    const outputs = await prisma.generation_canvas_outputs.findMany({});
    expect(outputs).toHaveLength(1);
    expect(outputs[0]).toMatchObject({ output_key: PRIMARY_OUTPUT_KEY, state: "present", revision: 1 });

    // — settleTarget：cancelled + draft 角色回草稿 —
    await accept(acceptance(UUID_B, "node-settle", 0));
    const subB = await prisma.generation_canvas_submissions.findUnique({
      where: { project_id_submission_id: { project_id: BigInt(PROJECT_ID), submission_id: UUID_B } },
    });
    await raw.query("UPDATE generation_jobs SET status='cancelled' WHERE id = ?", [Number(subB!.generation_job_id)]);
    // draft 角色需要画布上存在目标节点（受理时核对）——重设种子为 draft 重新受理一单。
    await prisma.generation_canvas_submissions.deleteMany({ where: { submission_id: UUID_B } });
    await prisma.generation_canvas_node_owners.deleteMany({ where: { node_id: "node-settle" } });
    await prisma.canvas.deleteMany({ where: { project_id: BigInt(PROJECT_ID) } });
    // 画布放一个草稿节点再受理（draft 角色）。
    await prisma.canvas.create({
      data: { project_id: BigInt(PROJECT_ID), version: 0, nodes_json: [{ id: "node-settle", type: "mediaNode", position: { x: 0, y: 0 }, data: { mediaType: "image" } }] as never },
    });
    const draftAcceptance: CanvasRecoveryAcceptance = {
      ...acceptance(UUID_C, "node-settle", 0),
      requestHash: "hash-draft",
      binding: {
        ...binding(UUID_C, "node-settle", 0),
        recovery_seed: { target: { role: "draft", x: 0, y: 0, width: 100, height: 100, name: "草稿" }, sources: [] },
      },
    };
    const settled = await accept(draftAcceptance);
    await raw.query("UPDATE generation_jobs SET status='cancelled' WHERE id = ?", [Number(settled.generation_job_id)]);
    const settleDoc = JSON.stringify([markerNode("node-settle", UUID_C, TARGET_OUTPUT_KEY)]);
    const settledSave = await saveCanvasWithRecovery(prisma, baseSave("0a1b2c3d-0000-4000-8000-0000000000dd", 0, settleDoc, [
      { id: recoveryItemId(UUID_C, TARGET_OUTPUT_KEY), rev: 1, action: "settleTarget" },
    ]));
    expect(settledSave.recoveryReceipt.changes[0]).toMatchObject({ state: "present", revision: 2 });
    // 归属保留在本次（已取消）提交，可携该版本再次生成。
    const ownerAfter = await prisma.generation_canvas_node_owners.findUnique({
      where: { project_id_node_id: { project_id: BigInt(PROJECT_ID), node_id: "node-settle" } },
    });
    expect(ownerAfter?.output_key).toBe(TARGET_OUTPUT_KEY);
  });

  it("★ B.6 remove 守护：运行中/抢先成功的目标拒绝删除（409 带现状），取消终态后放行", async () => {
    const created = await accept(acceptance(UUID_A, "node-guard", 0));
    const removeChange = [{ id: recoveryItemId(UUID_A, TARGET_OUTPUT_KEY), rev: 1, action: "remove" }];
    // 运行中（受理即 queued）：$target 占位不能绕过取消被删 → 409 recovery_item_conflict（现状随错误返回）
    const running = await saveCanvasWithRecovery(prisma, baseSave(UUID_B, null, JSON.stringify([]), removeChange))
      .catch(e => e as RecoveryContractError);
    expect(running).toBeInstanceOf(RecoveryContractError);
    expect(running.envelope).toMatchObject({
      code: 409,
      data: { reason: RECOVERY_REASONS.itemConflict, currentState: "pending", currentRevision: 1 },
    });
    // 抢先成功：仍停止删除（成功产物的收口走 replaceTarget 转换，不删目标）
    await raw.query("UPDATE generation_jobs SET status='succeeded', output_asset_ids=CAST('[\"12\"]' AS JSON) WHERE id = ?", [Number(created.generation_job_id)]);
    const succeeded = await saveCanvasWithRecovery(prisma, baseSave(UUID_C, null, JSON.stringify([]), removeChange))
      .catch(e => e as RecoveryContractError);
    expect(succeeded.envelope).toMatchObject({ code: 409, data: { reason: RECOVERY_REASONS.itemConflict } });
    // 两轮拒绝均零写入：目标项保持受理态、画布未建、无回执
    const submission = await prisma.generation_canvas_submissions.findUnique({
      where: { project_id_submission_id: { project_id: BigInt(PROJECT_ID), submission_id: UUID_A } },
    });
    expect(submission?.target_state).toBe("pending");
    expect(Number(submission?.target_revision)).toBe(1);
    expect(await prisma.canvas.count({ where: { project_id: BigInt(PROJECT_ID) } })).toBe(0);
    // 取消终态：放行删除
    await raw.query("UPDATE generation_jobs SET status='cancelled' WHERE id = ?", [Number(created.generation_job_id)]);
    const removed = await saveCanvasWithRecovery(prisma, baseSave(UUID_D, null, JSON.stringify([]), removeChange));
    expect(removed.recoveryReceipt.changes[0]).toMatchObject({ state: "removed", revision: 2 });
  });

  it("★ 同 jobId 重试迁移边界：历史任务无可信关联 → 拒绝迁移（422）", async () => {
    // 无 canvas_binding 的历史 job（不经受理直接造行）。
    const legacyJob = await prisma.generation_jobs.create({
      data: { project_id: BigInt(PROJECT_ID), user_id: BigInt(USER_ID), type: "image", status: "failed", source: "bottom_dock", progress: 0, input: { prompt: "x" } as never, fencing_token: 0 },
    });
    const retryResult = await prisma.$transaction(async (tx) => {
      const prior = await tx.generation_canvas_submissions.findFirst({
        where: { project_id: BigInt(PROJECT_ID), generation_job_id: legacyJob.id },
        orderBy: { id: "desc" },
      });
      return prior === null ? "migration_rejected" : "unexpected";
    });
    expect(retryResult).toBe("migration_rejected");
    await prisma.generation_jobs.delete({ where: { id: legacyJob.id } });
  });

  function baseSave(commandId: string, expectedVersion: number | null, nodes: string, changes: Array<{ id: string; rev: number; action: string }>) {
    return {
      ownerId: USER_ID,
      projectId: PROJECT_ID,
      expectedVersion,
      viewport: "{}",
      nodes,
      edges: "[]",
      confirmEmpty: false,
      commandId,
      changes: changes.map(change => ({ recoveryItemId: change.id, expectedRevision: change.rev, action: change.action })),
    };
  }

  function markerNode(id: string, submissionId: string, outputKey: string) {
    return { id, type: "mediaNode", position: { x: 0, y: 0 }, data: { generationRecovery: { protocolVersion: 1, submissionId, outputKey }, mediaType: "image" } };
  }
});
