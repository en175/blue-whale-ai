// IKJJR0（IKIXK9-SPEC-20261002 B 节）：成片（storyboard-preview）与重生样片
// （regenerate-sample，经 generation.create 统一受理）接入恢复契约 v1 的真 MySQL 验证。
//
// 与 ikjjqu-canvas-recovery.integration.test.ts 同款门控：需要本地 MySQL（端口 3311）：
//   # 容器与建库（一次）：
//   docker run -d --name ikjjr0-mysql -e MYSQL_ROOT_PASSWORD=ikjjr0 \
//     -e MYSQL_DATABASE=bw_gate_ikjjr0 -p 3311:3306 mysql:8
//   cd backend && DATABASE_URL='mysql://root:ikjjr0@127.0.0.1:3311/bw_gate_ikjjr0' \
//     npx prisma db push --accept-data-loss
//   # 跑测试：
//   IKJJR0_DATABASE_URL='mysql://root:ikjjr0@127.0.0.1:3311/bw_gate_ikjjr0' \
//     pnpm exec vitest run backend/libs/shared/persistence/ikjjr0-canvas-recovery.integration.test.ts
// 未配置该变量时整组跳过；跳过不算通过。（QU 容器在 3307，勿动。）
//
// 验收场景（工单第 6 条，接口与真实事务）：
//   成片（storyboard-preview 真实 repo 事务）：
//     S1 受理：canvas_binding → submission/owner/job/preview/幂等行同事务落库
//     S2 报价（能力/余额）变化后的已受理重放：原关联返回，不重做当前状态校验
//     S3 并发同意图：恰一 applied，另一路锁内回读重放（受理回执未到的并发面），零重复行
//     S4 并发冲突不预扣：同节点旧版本 → 409 canvas_binding_conflict，零写入零成本预留
//     S5 draft 角色：快照按服务端画布捕获；角色与画布不符 → 400
//   重生样片（regenerate → generation.create 统一受理，真实 createJob + 计费装配）：
//     R1 旧卡保留及独立新目标恢复：新意图绑新节点，旧 job/关联原样，恢复页双记录
//     R2 并发冲突不预扣：hold 恰一次，败者零 job 零关联
//     R3 预扣失败：hold 抛错 → 整体失败零残留，不误发 release
//     R4 预扣失败补偿：hold 成功后事务失败 → release(jobId)，零残留
//     R5 旧承接版本抢占旧成片节点 → 409，不覆盖旧承接

import { PrismaMariaDb } from "@prisma/adapter-mariadb";
import type { Pool } from "mariadb";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildPoolConfig, getPrismaClient } from "./db.js";
import {
  RECOVERY_REASONS,
  type CanvasBinding,
} from "@lib/contracts";
import {
  RecoveryContractError,
  listCanvasRecoveryPage,
  type CanvasRecoveryAcceptance,
} from "./generation-canvas-recovery-repo.js";
import { createStoryboardPreviewRepo } from "./storyboard-preview-repo.js";
import { createGenerationCommandRepo } from "./generation-command-repo.js";
import { capabilityDigestFromModelCapability } from "./capability-digest.js";
import type { PrismaClient } from "@prisma/client";

const databaseUrl = process.env.IKJJR0_DATABASE_URL;

describe.skipIf(!databaseUrl)("成片与重生样片恢复契约 v1 真库验证（IKJJR0）", () => {
  let prisma: PrismaClient;
  let raw: Pool;

  const PROJECT_ID = "920001";
  const USER_ID = "920009";
  const SCENE_CARD_ID = "920100";

  function binding(submissionId: string, node: string, revision = 0, role: CanvasBinding["recovery_seed"]["target"]["role"] = "result-placeholder"): CanvasBinding {
    return {
      protocol_version: 1,
      submission_id: submissionId,
      target_node_id: node,
      expected_binding_revision: revision,
      recovery_seed: {
        target: { role, x: 10, y: 20, width: 300, height: 200, name: "分镜卡" },
        sources: [],
      },
    };
  }

  // ── 成片（storyboard-preview）夹具 ──────────────────────────────────────────

  const CAPABILITY_VALUES = {
    supported_sizes: [{ id: "2k", api_value: "2k" }],
    supported_aspect_ratios: ["16:9"],
    supported_durations: null,
    supported_formats: [],
    default_size: "2k",
    default_format: null,
    default_aspect_ratio: "16:9",
    default_duration: null,
  };

  async function seedCapability(version = 5) {
    await prisma.generation_model_capability.create({
      data: {
        provider_id: "volc",
        model_id: "seedream-4",
        capability_type: "image",
        model_label: "Seedream 4",
        supported_sizes: CAPABILITY_VALUES.supported_sizes as never,
        supported_aspect_ratios: CAPABILITY_VALUES.supported_aspect_ratios as never,
        supported_formats: CAPABILITY_VALUES.supported_formats as never,
        default_size: CAPABILITY_VALUES.default_size,
        default_aspect_ratio: CAPABILITY_VALUES.default_aspect_ratio,
        features: { quantity_max: 4 } as never,
        channel: "volc-image-seedream",
        version,
      },
    });
    return {
      schema_version: 1 as const,
      capability_type: "image" as const,
      model_id: "seedream-4",
      provider_id: "volc",
      row_version: version,
      digest: capabilityDigestFromModelCapability(CAPABILITY_VALUES as never),
    };
  }

  function storyboardInput(args: {
    key: string;
    requestHash: string;
    canvasRecovery?: CanvasRecoveryAcceptance;
    baseVersion?: number;
    quotaSufficient?: boolean;
  }) {
    return {
      userId: USER_ID,
      projectId: PROJECT_ID,
      sceneCardId: SCENE_CARD_ID,
      idempotencyKey: args.key,
      requestHash: args.requestHash,
      base_scene_card_version: args.baseVersion ?? 1,
      parameters: { model_id: "seedream-4", size: "2k", aspect_ratio: "16:9", count: 4 },
      capability_snapshot_version: currentSnapshot,
      provider_credential: "sk-ikjjr0",
      quotaCheck: async () => ({ sufficient: args.quotaSufficient ?? true }),
      ...(args.canvasRecovery ? { canvasRecovery: args.canvasRecovery } : {}),
    };
  }

  let currentSnapshot: Awaited<ReturnType<typeof seedCapability>>;
  const storyboardRepo = () => createStoryboardPreviewRepo(prisma);

  function storyboardAcceptance(
    submissionId: string,
    node: string,
    requestHash: string,
    revision = 0,
    role: CanvasBinding["recovery_seed"]["target"]["role"] = "result-placeholder",
  ): CanvasRecoveryAcceptance {
    return {
      projectId: PROJECT_ID,
      userId: USER_ID,
      binding: binding(submissionId, node, revision, role),
      operation: "scene_card.storyboard_preview",
      requestHash,
      idempotencyKey: submissionId,
      taskType: "image",
    };
  }

  // ── 重生样片（generation.create 统一受理）夹具 ──────────────────────────────

  function regenerateAcceptance(submissionId: string, node: string, revision = 0): CanvasRecoveryAcceptance {
    return {
      projectId: PROJECT_ID,
      userId: USER_ID,
      binding: binding(submissionId, node, revision),
      operation: "generation.create",
      requestHash: `rehash-${submissionId}`,
      idempotencyKey: submissionId,
      taskType: "video",
    };
  }

  /** 重生样片的实际受理面：createJob + 计费装配（与 regenerate-sample 控制器同一 repo 调用形态）。 */
  async function regenerateCreate(
    acceptance: CanvasRecoveryAcceptance,
    billing: { hold: (jobId: number) => Promise<void>; release: (jobId: number, reason: string) => Promise<void> },
  ) {
    const repo = createGenerationCommandRepo(prisma);
    return repo.createJob(
      {
        projectId: acceptance.projectId,
        userId: acceptance.userId,
        type: "video",
        expectedOutputCount: 1,
        input: { prompt: "人物走过街角", model_id: "doubao-seedance-2-5-260628", resolution: "480p", sample_mode: true },
        actionIdentity: `ikjjr0-${acceptance.binding.submission_id.slice(0, 24)}`,
        actionType: "generate_video",
        videoStage: "sample",
        canvasRecovery: acceptance,
      },
      { billing, idempotency: { key: acceptance.idempotencyKey, requestHash: acceptance.requestHash } },
    );
  }

  beforeAll(async () => {
    prisma = getPrismaClient(databaseUrl!);
    const adapter = await new PrismaMariaDb(buildPoolConfig(databaseUrl!)).connect();
    raw = adapter.underlyingDriver();
    // 幂等清场（中断残留不挡重跑）。
    await prisma.project.deleteMany({ where: { id: BigInt(PROJECT_ID) } });
    await prisma.scene_cards.deleteMany({ where: { id: BigInt(SCENE_CARD_ID) } });
    await prisma.generation_model_capability.deleteMany({ where: { provider_id: "volc", model_id: "seedream-4" } });
    await prisma.project.create({ data: { id: BigInt(PROJECT_ID), owner_id: BigInt(USER_ID), name: "ikjjr0" } });
    await prisma.scene_cards.create({
      data: {
        id: BigInt(SCENE_CARD_ID),
        project_id: BigInt(PROJECT_ID),
        title: "街角",
        content_markdown: "人物走过街角",
        version: 1,
      },
    });
    currentSnapshot = await seedCapability();
  });

  afterAll(async () => {
    if (!prisma) return;
    await prisma.project.deleteMany({ where: { id: BigInt(PROJECT_ID) } });
    await prisma.scene_cards.deleteMany({ where: { id: BigInt(SCENE_CARD_ID) } });
    await prisma.generation_model_capability.deleteMany({ where: { provider_id: "volc", model_id: "seedream-4" } });
    await raw.end();
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    const pid = BigInt(PROJECT_ID);
    await prisma.generation_canvas_node_owners.deleteMany({ where: { project_id: pid } });
    await prisma.generation_canvas_outputs.deleteMany({});
    await prisma.generation_canvas_submissions.deleteMany({ where: { project_id: pid } });
    await prisma.command_idempotency.deleteMany({ where: { project_id: pid } });
    await prisma.canvas.deleteMany({ where: { project_id: pid } });
    await prisma.storyboard_previews.deleteMany({ where: { project_id: pid } });
    await prisma.generation_output_slots.deleteMany({ where: { project_id: pid } });
    await prisma.generation_job_logs.deleteMany({});
    await prisma.cost_reservations.deleteMany({});
    await prisma.generation_jobs.deleteMany({ where: { project_id: pid } });
    await prisma.project_events.deleteMany({ where: { project_id: pid } });
    await prisma.$queryRaw`DELETE FROM project_event_stream WHERE project_id = ${pid}`;
    // 复位受理前置（S2 会升版模拟「报价变化」，不能污染后续用例的 CAS/漂移基准）。
    await prisma.scene_cards.update({
      where: { id: BigInt(SCENE_CARD_ID) },
      data: { version: 1 },
    });
    await prisma.generation_model_capability.updateMany({
      where: { provider_id: "volc", model_id: "seedream-4" },
      data: { version: currentSnapshot.row_version },
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 成片（storyboard-preview）
  // ═══════════════════════════════════════════════════════════════════════════

  it("★ S1 成片受理：canvas_binding → submission/owner/job/preview/幂等行同事务落库", async () => {
    const requestHash = `sb-${"1".repeat(60)}`;
    const result = await storyboardRepo().createStoryboardPreview(
      storyboardInput({
        key: "0a1b2c3d-0000-4000-8000-0000000000a1",
        requestHash,
        canvasRecovery: storyboardAcceptance("0a1b2c3d-0000-4000-8000-0000000000a1", "scene-node-1", requestHash),
      }),
    );

    expect(result.kind).toBe("applied");
    // 关联行：pending/1、目标与版本、operation 命名空间。
    const submission = await prisma.generation_canvas_submissions.findUnique({
      where: {
        project_id_submission_id: {
          project_id: BigInt(PROJECT_ID),
          submission_id: "0a1b2c3d-0000-4000-8000-0000000000a1",
        },
      },
    });
    expect(submission).toMatchObject({
      operation: "scene_card.storyboard_preview",
      task_type: "image",
      target_node_id: "scene-node-1",
      binding_revision: 1,
      target_state: "pending",
      target_revision: 1,
      request_hash: requestHash,
    });
    // 节点归属行 + job 行与关联同事务。
    const owner = await prisma.generation_canvas_node_owners.findUnique({
      where: { project_id_node_id: { project_id: BigInt(PROJECT_ID), node_id: "scene-node-1" } },
    });
    expect(owner).toMatchObject({ binding_revision: 1, output_key: "$target" });
    expect(await prisma.generation_jobs.count({ where: { project_id: BigInt(PROJECT_ID) } })).toBe(1);
    // 绑定视图（is_current 现查 owner 表）。
    const view = await storyboardRepo().canvasBindingView(PROJECT_ID, "0a1b2c3d-0000-4000-8000-0000000000a1");
    expect(view).toMatchObject({ submission_id: "0a1b2c3d-0000-4000-8000-0000000000a1", binding_revision: 1, is_current: true });
  });

  it("★ S2 报价（能力/余额）变化后的已受理重放：原关联返回，不重做当前状态校验", async () => {
    const submissionId = "0a1b2c3d-0000-4000-8000-0000000000a2";
    const requestHash = `sb-${"2".repeat(60)}`;
    const base = storyboardInput({
      key: submissionId,
      requestHash,
      canvasRecovery: storyboardAcceptance(submissionId, "scene-node-2", requestHash),
    });
    const first = await storyboardRepo().createStoryboardPreview(base);
    expect(first.kind).toBe("applied");

    // 受理之后「报价面」变化：能力行升版（drift）+ 余额不足 + 场景卡改版。
    await prisma.generation_model_capability.updateMany({
      where: { provider_id: "volc", model_id: "seedream-4" },
      data: { version: { increment: 1 } },
    });
    await prisma.scene_cards.update({
      where: { id: BigInt(SCENE_CARD_ID) },
      data: { version: { increment: 1 } },
    });

    // 同次网络重放：同 Key 同 body → 原关联，不重做能力漂移/版本/余额校验。
    const replay = await storyboardRepo().createStoryboardPreview({
      ...base,
      quotaCheck: async () => ({ sufficient: false }),
    });
    expect(replay).toMatchObject({
      kind: "replayed",
      preview_id: (first as { preview_id: string }).preview_id,
      generation_job_id: (first as { generation_job_id: string }).generation_job_id,
    });
    // 不重复建：任务/预览/关联各一。
    expect(await prisma.generation_jobs.count({ where: { project_id: BigInt(PROJECT_ID) } })).toBe(1);
    expect(await prisma.storyboard_previews.count({ where: { project_id: BigInt(PROJECT_ID) } })).toBe(1);
    expect(await prisma.generation_canvas_submissions.count({ where: { project_id: BigInt(PROJECT_ID) } })).toBe(1);
  });

  it("★ S3 并发同意图：恰一 applied，另一路在任务写入/预扣前收敛（重放或 409），零重复", async () => {
    const submissionId = "0a1b2c3d-0000-4000-8000-0000000000a3";
    const requestHash = `sb-${"3".repeat(60)}`;
    const input = storyboardInput({
      key: submissionId,
      requestHash,
      canvasRecovery: storyboardAcceptance(submissionId, "scene-node-3", requestHash),
    });

    const attempts = await Promise.allSettled([
      storyboardRepo().createStoryboardPreview(input),
      storyboardRepo().createStoryboardPreview(input),
    ]);
    const applied = attempts.filter(r => r.status === "fulfilled" && (r as PromiseFulfilledResult<{ kind: string }>).value.kind === "applied");
    expect(applied).toHaveLength(1);
    // 败者两种合法收敛（B.3：均在任务写入与预扣前）：
    //  · 锁内幂等回读命中（事务快照含胜者提交）→ replayed；
    //  · REPEATABLE READ 下快照早于胜者提交、幂等行不可见 → 锁内归属版本比对 409
    //    （客户端随后任一次重发都会命中事务外快路径重放——S2 已证）。
    for (const attempt of attempts) {
      if (attempt.status === "rejected") {
        expect(attempt.reason).toBeInstanceOf(RecoveryContractError);
        expect((attempt.reason as RecoveryContractError).envelope.code).toBe(409);
      } else if (attempt.value.kind === "replayed") {
        expect(attempt.value.preview_id).toBe((applied[0] as PromiseFulfilledResult<{ preview_id: string }>).value.preview_id);
      } else {
        expect(attempt.value.kind).toBe("applied");
      }
    }
    // 零重复：job/preview/幂等/关联各恰一行（无论败者走哪条收敛）。
    expect(await prisma.generation_jobs.count({ where: { project_id: BigInt(PROJECT_ID) } })).toBe(1);
    expect(await prisma.storyboard_previews.count({ where: { project_id: BigInt(PROJECT_ID) } })).toBe(1);
    expect(await prisma.generation_canvas_submissions.count({ where: { project_id: BigInt(PROJECT_ID) } })).toBe(1);
    // 事后重发（受理回执未到的恢复面）：命中幂等 → 原关联，不再新建。
    const after = await storyboardRepo().createStoryboardPreview(input);
    expect(after.kind).toBe("replayed");
    expect(await prisma.generation_jobs.count({ where: { project_id: BigInt(PROJECT_ID) } })).toBe(1);
  });

  it("★ S4 并发冲突不预扣：同节点旧承接版本 → 409 canvas_binding_conflict，零写入零成本预留", async () => {
    const winnerHash = `sb-${"4".repeat(60)}`;
    const winner = await storyboardRepo().createStoryboardPreview(storyboardInput({
      key: "0a1b2c3d-0000-4000-8000-0000000000a4",
      requestHash: winnerHash,
      canvasRecovery: storyboardAcceptance("0a1b2c3d-0000-4000-8000-0000000000a4", "scene-node-4", winnerHash),
    }));
    expect(winner.kind).toBe("applied");

    // 新意图携过期版本 0 抢同节点 → 409；事务整体回滚（零 job/preview/幂等/成本预留）。
    const loserHash = `sb-${"5".repeat(60)}`;
    const loser = await storyboardRepo()
      .createStoryboardPreview(storyboardInput({
        key: "0a1b2c3d-0000-4000-8000-0000000000b5",
        requestHash: loserHash,
        canvasRecovery: storyboardAcceptance("0a1b2c3d-0000-4000-8000-0000000000b5", "scene-node-4", loserHash, 0),
      }))
      .catch(error => error as RecoveryContractError);
    expect(loser).toBeInstanceOf(RecoveryContractError);
    expect((loser as RecoveryContractError).envelope).toMatchObject({
      code: 409,
      data: { reason: RECOVERY_REASONS.bindingConflict, currentBindingRevision: 1 },
    });
    expect(await prisma.generation_jobs.count({ where: { project_id: BigInt(PROJECT_ID) } })).toBe(1);
    expect(await prisma.storyboard_previews.count({ where: { project_id: BigInt(PROJECT_ID) } })).toBe(1);
    expect(await prisma.generation_canvas_submissions.count({ where: { project_id: BigInt(PROJECT_ID) } })).toBe(1);
    expect(await prisma.cost_reservations.count({})).toBe(1); // 仅胜者一行
  });

  it("★ S5 draft 角色：快照按服务端画布捕获；角色与画布不符 → 400 invalid_recovery_payload", async () => {
    // 画布上有场景卡草稿节点（已保存）：draft 角色的原目标快照由服务端捕获。
    await prisma.canvas.create({
      data: {
        project_id: BigInt(PROJECT_ID),
        version: 3,
        nodes_json: [
          { id: "scene-draft-1", type: "mediaNode", position: { x: 1, y: 2 }, width: 300, height: 200, data: { mediaType: "image", title: "草稿" } },
        ] as never,
        edges_json: [] as never,
      },
    });
    const requestHash = `sb-${"6".repeat(60)}`;
    const applied = await storyboardRepo().createStoryboardPreview(storyboardInput({
      key: "0a1b2c3d-0000-4000-8000-0000000000a6",
      requestHash,
      canvasRecovery: storyboardAcceptance("0a1b2c3d-0000-4000-8000-0000000000a6", "scene-draft-1", requestHash, 0, "draft"),
    }));
    expect(applied.kind).toBe("applied");
    const submission = await prisma.generation_canvas_submissions.findUnique({
      where: { project_id_submission_id: { project_id: BigInt(PROJECT_ID), submission_id: "0a1b2c3d-0000-4000-8000-0000000000a6" } },
    });
    expect(submission?.previous_target_snapshot).toMatchObject({ id: "scene-draft-1", type: "mediaNode" });

    // draft 角色但节点不在服务端已保存画布上 → 400（不接受自报角色替代事实）。
    const badHash = `sb-${"7".repeat(60)}`;
    const rejected = await storyboardRepo()
      .createStoryboardPreview(storyboardInput({
        key: "0a1b2c3d-0000-4000-8000-0000000000b7",
        requestHash: badHash,
        canvasRecovery: storyboardAcceptance("0a1b2c3d-0000-4000-8000-0000000000b7", "ghost-node", badHash, 0, "draft"),
      }))
      .catch(error => error as RecoveryContractError);
    expect(rejected).toBeInstanceOf(RecoveryContractError);
    expect((rejected as RecoveryContractError).envelope).toMatchObject({
      code: 400,
      data: { reason: RECOVERY_REASONS.invalidPayload },
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // 重生样片（regenerate → generation.create 统一受理）
  // ═══════════════════════════════════════════════════════════════════════════

  it("★ R1 旧卡保留及独立新目标恢复：新意图绑新节点，旧 job/关联原样，恢复页双记录", async () => {
    const holdCalls: number[] = [];
    const billing = {
      hold: async (jobId: number) => { holdCalls.push(jobId); },
      release: async () => {},
    };
    // 旧样片/成片承接（node-final）先受理成功。
    const old = await regenerateCreate(regenerateAcceptance("0a1b2c3d-0000-4000-8000-0000000000c1", "node-final"), billing);
    expect(old).toMatchObject({ generation_job_id: expect.any(String) });
    const oldJobId = (old as { generation_job_id: string }).generation_job_id;

    // 失败成片后的重生样片：新意图、新目标节点（独立承接），同 create 面受理。
    const renewed = await regenerateCreate(regenerateAcceptance("0a1b2c3d-0000-4000-8000-0000000000c2", "node-regen"), billing);
    const renewedJobId = (renewed as { generation_job_id: string }).generation_job_id;
    expect(renewedJobId).not.toBe(oldJobId);

    // 旧卡保留：旧 job 行原样，旧关联仍持有自己节点（未被覆盖、未 transferred）。
    const oldJob = await prisma.generation_jobs.findUnique({ where: { id: BigInt(oldJobId) } });
    expect(oldJob).not.toBeNull();
    const oldSubmission = await prisma.generation_canvas_submissions.findUnique({
      where: { project_id_submission_id: { project_id: BigInt(PROJECT_ID), submission_id: "0a1b2c3d-0000-4000-8000-0000000000c1" } },
    });
    expect(oldSubmission?.target_state).toBe("pending");
    // 恢复页：两条关联各自 is_current=true，任务可读（受理回执未到也可恢复）。
    const page = await listCanvasRecoveryPage(prisma, PROJECT_ID, 50, null);
    expect(page.records).toHaveLength(2);
    for (const record of page.records) {
      expect(record.is_current).toBe(true);
      expect(record.job).not.toBeNull();
      expect(record.items[0]).toMatchObject({ output_key: "$target", state: "pending", revision: 1, node_binding_revision: 1 });
    }
    // 各绑各的节点，互不覆盖。
    const nodes = page.records.map(r => r.target_node_id).sort();
    expect(nodes).toEqual(["node-final", "node-regen"]);
  });

  it("★ R2 并发冲突不预扣：同节点同承接版本并发 → 恰一胜，hold 恰一次，败者零写入", async () => {
    const holds: number[] = [];
    const billing = {
      hold: async (jobId: number) => { holds.push(jobId); },
      release: async () => {},
    };
    const attempts = await Promise.allSettled([
      regenerateCreate(regenerateAcceptance("0a1b2c3d-0000-4000-8000-0000000000d1", "node-race"), billing),
      regenerateCreate(regenerateAcceptance("0a1b2c3d-0000-4000-8000-0000000000d2", "node-race"), billing),
    ]);
    const fulfilled = attempts.filter(r => r.status === "fulfilled");
    const rejected = attempts.filter(r => r.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(RecoveryContractError);
    // 冲突在任务写入与 billing.hold 前拒绝：恰一次预扣（胜者），败者零 job 零关联。
    expect(holds).toHaveLength(1);
    expect(await prisma.generation_jobs.count({ where: { project_id: BigInt(PROJECT_ID) } })).toBe(1);
    expect(await prisma.generation_canvas_submissions.count({ where: { project_id: BigInt(PROJECT_ID) } })).toBe(1);
    expect(await prisma.command_idempotency.count({ where: { project_id: BigInt(PROJECT_ID) } })).toBe(1);
  });

  it("★ R3 预扣失败（hold 抛错）→ 整体失败零残留，不误发 release（钱没冻上不返还）", async () => {
    const releases: number[] = [];
    const billing = {
      hold: async () => { throw new Error("billing unavailable"); },
      release: async (jobId: number) => { releases.push(jobId); },
    };
    const failed = await regenerateCreate(regenerateAcceptance("0a1b2c3d-0000-4000-8000-0000000000e1", "node-holdfail"), billing)
      .catch(error => error as Error);
    expect(failed).toBeInstanceOf(Error);
    expect(releases).toHaveLength(0);
    // 零残留：job/关联/归属/幂等/成本预留全无。
    expect(await prisma.generation_jobs.count({ where: { project_id: BigInt(PROJECT_ID) } })).toBe(0);
    expect(await prisma.generation_canvas_submissions.count({ where: { project_id: BigInt(PROJECT_ID) } })).toBe(0);
    expect(await prisma.generation_canvas_node_owners.count({ where: { project_id: BigInt(PROJECT_ID) } })).toBe(0);
    expect(await prisma.command_idempotency.count({ where: { project_id: BigInt(PROJECT_ID) } })).toBe(0);
    expect(await prisma.cost_reservations.count({})).toBe(0);
  });

  it("★ R4 预扣失败补偿：hold 成功后事务失败 → release(jobId)，零残留（资金不随库回滚丢）", async () => {
    // 预插同 (project, submission_id) 关联行：受理锁段全过、job 已建、hold 已成，
    // writeCanvasRecoveryRows 撞唯一约束 → 事务回滚 → 补偿 release。
    await prisma.generation_canvas_submissions.create({
      data: {
        project_id: BigInt(PROJECT_ID),
        user_id: BigInt(USER_ID),
        protocol_version: 1,
        submission_id: "0a1b2c3d-0000-4000-8000-0000000000f1",
        operation: "generation.create",
        request_hash: "occupied",
        generation_job_id: 999999n,
        task_type: "video",
        target_node_id: "node-compensate",
        binding_revision: 7,
        target_state: "pending",
        target_revision: 1,
      },
    });
    const holds: number[] = [];
    const releases: number[] = [];
    const billing = {
      hold: async (jobId: number) => { holds.push(jobId); },
      release: async (jobId: number) => { releases.push(jobId); },
    };

    const failed = await regenerateCreate(regenerateAcceptance("0a1b2c3d-0000-4000-8000-0000000000f1", "node-compensate", 0), billing)
      .catch(error => error as Error);
    expect(failed).toBeInstanceOf(Error);
    // 预扣发生过且只发生过一次，补偿按同一 jobId 返还。
    expect(holds).toHaveLength(1);
    expect(releases).toEqual(holds);
    // 库内零残留：没有第二个 job/幂等行/归属行（预插的关联行保留原样，未被改写）。
    expect(await prisma.generation_jobs.count({ where: { project_id: BigInt(PROJECT_ID) } })).toBe(0);
    expect(await prisma.command_idempotency.count({ where: { project_id: BigInt(PROJECT_ID) } })).toBe(0);
    expect(await prisma.generation_canvas_node_owners.count({ where: { project_id: BigInt(PROJECT_ID) } })).toBe(0);
  });

  it("★ R5 旧承接版本抢占旧成片节点 → 409，不覆盖旧承接（AC4）", async () => {
    const billing = { hold: async () => {}, release: async () => {} };
    const first = await regenerateCreate(regenerateAcceptance("0a1b2c3d-0000-4000-8000-000000001001", "node-old-final"), billing);
    expect(first).toMatchObject({ generation_job_id: expect.any(String) });

    // 新样片试图绑旧成片节点且版本过期（0 ≠ 当前 1）→ 409；旧承接不被覆盖。
    const conflict = await regenerateCreate(regenerateAcceptance("0a1b2c3d-0000-4000-8000-000000001002", "node-old-final", 0), billing)
      .catch(error => error as RecoveryContractError);
    expect(conflict).toBeInstanceOf(RecoveryContractError);
    expect((conflict as RecoveryContractError).envelope).toMatchObject({
      code: 409,
      data: { reason: RECOVERY_REASONS.bindingConflict, currentBindingRevision: 1 },
    });
    const owner = await prisma.generation_canvas_node_owners.findUnique({
      where: { project_id_node_id: { project_id: BigInt(PROJECT_ID), node_id: "node-old-final" } },
    });
    const ownerSubmission = await prisma.generation_canvas_submissions.findUnique({
      where: { id: owner!.generation_canvas_submission_id },
    });
    expect(ownerSubmission?.submission_id).toBe("0a1b2c3d-0000-4000-8000-000000001001");
  });
});
