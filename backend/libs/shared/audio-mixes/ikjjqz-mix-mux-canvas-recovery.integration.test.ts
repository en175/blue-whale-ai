
























import "reflect-metadata";
import { PrismaMariaDb } from "@prisma/adapter-mariadb";
import type { Pool } from "mariadb";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  PRIMARY_OUTPUT_KEY,
  RECOVERY_REASONS,
  TARGET_OUTPUT_KEY,
  recoveryItemId,
  type CanvasBinding,
} from "@lib/contracts";
import { listCanvasRecoveryPage, resolveCanvasRecoveryItems } from "@lib/shared/persistence/index.js";
import { buildPoolConfig, getPrismaClient } from "@lib/shared/persistence/db.js";
import { saveCanvasWithRecovery } from "@lib/shared/persistence/canvas-recovery-save.js";
import { AudioMixesService } from "./audio-mixes.service.js";
import { AudioVideoMuxesService } from "../audio-video-muxes/audio-video-muxes.service.js";
import type { PrismaService } from "../prisma/prisma.service.js";
import type { PrismaClient } from "@prisma/client";

const databaseUrl = process.env.IKJJQZ_DATABASE_URL;

describe.skipIf(!databaseUrl)("混合/合成提交归属真库验证（IKJJQZ）", () => {
  let prisma: PrismaClient;
  let raw: Pool;
  let mixes: AudioMixesService;
  let muxes: AudioVideoMuxesService;

  const PROJECT_ID = "920001";
  const USER_ID = "920009";
  const S1 = "1a2b3c4d-0000-4000-8000-000000000001";
  const S2 = "1a2b3c4d-0000-4000-8000-000000000002";
  const S3 = "1a2b3c4d-0000-4000-8000-000000000003";
  const S4 = "1a2b3c4d-0000-4000-8000-000000000004";
  const S5 = "1a2b3c4d-0000-4000-8000-000000000005";
  const S6 = "1a2b3c4d-0000-4000-8000-000000000006";
  const S7 = "1a2b3c4d-0000-4000-8000-000000000007";
  const S8 = "1a2b3c4d-0000-4000-8000-000000000008";
  const S9 = "1a2b3c4d-0000-4000-8000-000000000009";
  const S10 = "1a2b3c4d-0000-4000-8000-00000000000a";

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


  async function seedCanvas(nodeIds: string[]) {
    await prisma.project_canvas.deleteMany({ where: { project_id: BigInt(PROJECT_ID) } });
    await prisma.project_canvas.create({
      data: {
        project_id: BigInt(PROJECT_ID),
        version: 0,
        nodes_json: nodeIds.map(id => ({
          id, type: "mediaNode", position: { x: 0, y: 0 },
          data: { mediaType: "audio", assetId: "31" },
        })) as never,
      },
    });
  }

  async function createMixJob(bindingArg: CanvasBinding, key: string) {
    const result = await mixes.create(USER_ID, PROJECT_ID, {
      source_node_id: bindingArg.target_node_id,
      inputs: [
        { asset_id: "11", node_id: bindingArg.target_node_id },
        { asset_id: "12" },
      ],
      output_format: "mp3",
      canvas_binding: bindingArg,
    }, { idempotencyKey: key });
    return result;
  }

  async function createMuxJob(bindingArg: CanvasBinding, key: string) {
    return muxes.create(USER_ID, PROJECT_ID, {
      audio: { assetId: "21", nodeId: bindingArg.target_node_id },
      video: { assetId: "22", nodeId: "video-node" },
      is_audio_reserve: true,
      sync: "none",
      canvas_binding: bindingArg,
    }, { idempotencyKey: key });
  }

  async function markJobFailed(jobId: string) {
    await raw.query(
      "UPDATE generation_jobs SET status='failed', error=CAST('{\"message\":\"x\"}' AS JSON) WHERE id = ?",
      [Number(jobId)],
    );
  }

  async function recoveryPage() {
    const page = await listCanvasRecoveryPage(prisma, PROJECT_ID, 100, null);
    return page.records;
  }

  beforeAll(async () => {
    prisma = getPrismaClient(databaseUrl!);
    const adapter = await new PrismaMariaDb(buildPoolConfig(databaseUrl!)).connect();
    raw = adapter.underlyingDriver();
    await prisma.project.create({ data: { id: BigInt(PROJECT_ID), owner_id: BigInt(USER_ID), name: "ikjjqz" } });

    const prismaService = { client: prisma } as unknown as PrismaService;
    const project = { findOwnedById: vi.fn(async () => ({ id: BigInt(PROJECT_ID) })) };
    const mixAssets = {
      findOwnedSource: vi.fn(async (id: string) => ({
        project_id: BigInt(PROJECT_ID), type: "audio", url: `https://store.test/${id}.mp3`,
        storage_key: `uploads/9/audio/${id}.mp3`, duration_ms: 1000,
      })),
    };
    const muxAssets = {
      findOwnedSource: vi.fn(async (id: string) => ({
        project_id: BigInt(PROJECT_ID), type: id === "22" ? "video" : "audio",
        url: `https://store.test/${id}.mp4`, storage_key: `uploads/9/${id}.mp4`,
        duration_ms: 5000,
      })),
    };
    const storage = { uploads: { inspectObject: vi.fn(async (key: string) => ({ size: 10, publicUrl: `https://store.test/${key}` })) } };
    vi.stubGlobal("fetch", vi.fn(async () => new Response("x", { status: 206 })));
    mixes = new AudioMixesService(prismaService, project as never, mixAssets as never, storage as never, { jobBilling: async () => undefined, release: async () => {} } as never);
    muxes = new AudioVideoMuxesService(prismaService, project as never, muxAssets as never, storage as never, { jobBilling: async () => undefined, release: async () => {} } as never);
  });

  afterAll(async () => {
    if (!prisma) return;
    vi.unstubAllGlobals();
    await prisma.project.deleteMany({ where: { id: BigInt(PROJECT_ID) } });
    await raw.end();
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await prisma.generation_canvas_node_owners.deleteMany({ where: { project_id: BigInt(PROJECT_ID) } });
    await prisma.generation_canvas_outputs.deleteMany({});
    await prisma.generation_canvas_submissions.deleteMany({ where: { project_id: BigInt(PROJECT_ID) } });
    await prisma.command_idempotency.deleteMany({ where: { project_id: BigInt(PROJECT_ID) } });
    await prisma.project_canvas.deleteMany({ where: { project_id: BigInt(PROJECT_ID) } });
    await prisma.generation_output_slots.deleteMany({ where: { project_id: BigInt(PROJECT_ID) } });
    await prisma.generation_job_logs.deleteMany({});
    await prisma.cost_reservations.deleteMany({});
    await prisma.generation_jobs.deleteMany({ where: { project_id: BigInt(PROJECT_ID) } });
    await prisma.assets.deleteMany({ where: { user_id: BigInt(USER_ID) } });
    await prisma.project_asset.deleteMany({ where: { project_id: BigInt(PROJECT_ID) } });
    await seedCanvas(["mix-node", "mux-node", "legacy-mix-node", "legacy-mux-node", "settle-node", "other-node"]);
  });

  it("★1 创建受理（mix/mux）：submission pending/1 + owner v1 + 响应视图；重放返回原关联", async () => {
    const mixResult = await createMixJob(binding(S1, "mix-node", 0), S1);
    expect(mixResult).toMatchObject({
      code: 200,
      data: { status: "queued", replayed: false, canvas_binding: { submission_id: S1, target_node_id: "mix-node", binding_revision: 1, is_current: true } },
    });
    const mixJobId = mixResult.data!.job_id!;
    const muxResult = await createMuxJob(binding(S2, "mux-node", 0), S2);
    expect(muxResult).toMatchObject({
      code: 200,
      data: { canvas_binding: { submission_id: S2, target_node_id: "mux-node", binding_revision: 1, is_current: true, job_id: muxResult.data!.job_id } },
    });

    const mixJob = await prisma.generation_jobs.findUniqueOrThrow({ where: { id: BigInt(mixJobId) } });
    expect(mixJob.input).not.toHaveProperty("canvas_binding");
    expect((mixJob.input as { source_node_id?: string }).source_node_id).toBe("mix-node");

    const replayedMix = await createMixJob(binding(S1, "mix-node", 0), S1);
    expect(replayedMix).toMatchObject({ code: 200, data: { job_id: mixJobId, replayed: true, canvas_binding: { submission_id: S1 } } });
    expect(await prisma.generation_canvas_submissions.count({ where: { project_id: BigInt(PROJECT_ID) } })).toBe(2);
    expect(await prisma.generation_jobs.count({ where: { project_id: BigInt(PROJECT_ID) } })).toBe(2);
  });

  it("★2 专属重试（mix）：新 job 接管归属；原 job 保持 failed", async () => {
    const created = await createMixJob(binding(S3, "mix-node", 0), S3);
    const jobId = created.data!.job_id!;
    await markJobFailed(jobId);
    const retried = await mixes.retry(USER_ID, PROJECT_ID, jobId, S4, undefined, binding(S4, "mix-node", 1));
    const retriedJobId = retried.data!.job_id!;
    expect(retriedJobId).not.toBe(jobId);
    expect(retried).toMatchObject({
      code: 200,
      data: { status: "queued", replayed: false, canvas_binding: { submission_id: S4, binding_revision: 2, is_current: true } },
    });

    const owner = await prisma.generation_canvas_node_owners.findUniqueOrThrow({
      where: { project_id_node_id: { project_id: BigInt(PROJECT_ID), node_id: "mix-node" } },
    });
    const newSubmission = await prisma.generation_canvas_submissions.findUniqueOrThrow({
      where: { project_id_submission_id: { project_id: BigInt(PROJECT_ID), submission_id: S4 } },
    });
    const oldSubmission = await prisma.generation_canvas_submissions.findUniqueOrThrow({
      where: { project_id_submission_id: { project_id: BigInt(PROJECT_ID), submission_id: S3 } },
    });
    expect(Number(owner.binding_revision)).toBe(2);
    expect(owner.generation_canvas_submission_id).toBe(newSubmission.id);
    expect(newSubmission).toMatchObject({ target_state: "pending", generation_job_id: BigInt(retriedJobId) });
    expect(oldSubmission).toMatchObject({ target_state: "transferred" });
    expect(Number(oldSubmission.target_revision)).toBe(2);
    const original = await prisma.generation_jobs.findUniqueOrThrow({ where: { id: BigInt(jobId) } });
    expect(original.status).toBe("failed");
    const retryJob = await prisma.generation_jobs.findUniqueOrThrow({ where: { id: BigInt(retriedJobId) } });
    expect(retryJob).toMatchObject({ status: "queued", retry_count: 0, retry_of_job_id: BigInt(jobId) });

    expect(await prisma.generation_canvas_submissions.count({ where: { project_id: BigInt(PROJECT_ID) } })).toBe(2);



    const records = await recoveryPage();
    expect(records.some(record => record.submission_id === S3)).toBe(false);
    const newRecord = records.find(record => record.submission_id === S4);
    expect(newRecord).toMatchObject({ is_current: true, job_id: retriedJobId });
    expect((newRecord!.job as { status?: string }).status).toBe("queued");
    const [resolvedOld] = await resolveCanvasRecoveryItems(prisma, PROJECT_ID, [
      recoveryItemId(S3, TARGET_OUTPUT_KEY),
    ]);
    expect(resolvedOld.items[0]).toMatchObject({ state: "transferred", revision: 2 });
    expect(resolvedOld.job).toBeNull();
  });

  it("★3 专属重试（mux）：新 job 接管归属；原 job 保持 failed", async () => {

    await prisma.assets.createMany({
      data: [
        { id: 21n, user_id: BigInt(USER_ID), project_id: BigInt(PROJECT_ID), type: "audio", url: "https://store.test/21.mp4" },
        { id: 22n, user_id: BigInt(USER_ID), project_id: BigInt(PROJECT_ID), type: "video", url: "https://store.test/22.mp4" },
      ],
    });
    const created = await createMuxJob(binding(S5, "mux-node", 0), S5);
    const jobId = created.data!.job_id!;
    await markJobFailed(jobId);
    const retried = await muxes.retry(USER_ID, PROJECT_ID, jobId, S6, binding(S6, "mux-node", 1));
    const retriedJobId = retried.data!.job_id!;
    expect(retriedJobId).not.toBe(jobId);
    expect(retried).toMatchObject({
      code: 200,
      data: { status: "queued", canvas_binding: { submission_id: S6, binding_revision: 2, is_current: true } },
    });
    const owner = await prisma.generation_canvas_node_owners.findUniqueOrThrow({
      where: { project_id_node_id: { project_id: BigInt(PROJECT_ID), node_id: "mux-node" } },
    });
    expect(Number(owner.binding_revision)).toBe(2);
    const oldSubmission = await prisma.generation_canvas_submissions.findUniqueOrThrow({
      where: { project_id_submission_id: { project_id: BigInt(PROJECT_ID), submission_id: S5 } },
    });
    expect(oldSubmission.target_state).toBe("transferred");
    const original = await prisma.generation_jobs.findUniqueOrThrow({ where: { id: BigInt(jobId) } });
    expect(original.status).toBe("failed");
    const retryJob = await prisma.generation_jobs.findUniqueOrThrow({ where: { id: BigInt(retriedJobId) } });
    expect(retryJob).toMatchObject({ status: "queued", retry_of_job_id: BigInt(jobId) });

    const [resolved] = await resolveCanvasRecoveryItems(prisma, PROJECT_ID, [
      recoveryItemId(S5, TARGET_OUTPUT_KEY),
    ]);
    expect(resolved.items[0]).toMatchObject({ state: "transferred", revision: 2 });
  });

  it("★4 改绑拒绝：专属重试目标与原受理关联不符 → 422 且零写入", async () => {
    const created = await createMixJob(binding(S7, "mix-node", 0), S7);
    const jobId = created.data!.job_id!;
    await markJobFailed(jobId);
    const rejected = await mixes.retry(USER_ID, PROJECT_ID, jobId, S8, undefined, binding(S8, "other-node", 0));
    expect(rejected).toMatchObject({
      code: 422,
      data: { reason: RECOVERY_REASONS.documentMismatch },
    });

    expect(await prisma.generation_canvas_submissions.count({ where: { project_id: BigInt(PROJECT_ID) } })).toBe(1);
    const owner = await prisma.generation_canvas_node_owners.findUniqueOrThrow({
      where: { project_id_node_id: { project_id: BigInt(PROJECT_ID), node_id: "mix-node" } },
    });
    expect(Number(owner.binding_revision)).toBe(1);
    const job = await prisma.generation_jobs.findUniqueOrThrow({ where: { id: BigInt(jobId) } });
    expect(job).toMatchObject({ status: "failed", retry_count: 0 });
  });

  it("★5 历史任务首次加入新协议：只接受冻结可信原卡（mix=source_node_id / mux=audio.nodeId）", async () => {

    const legacyMix = await prisma.generation_jobs.create({ data: {
      project_id: BigInt(PROJECT_ID), user_id: BigInt(USER_ID), type: "audio_mix", source: "dock",
      status: "failed", progress: 0, input: {
        source_node_id: "legacy-mix-node", inputs: [{ asset_id: "11", url: "https://our-tos/11.flac" }],
      } as never, fencing_token: 0,
    } });
    const accepted = await mixes.retry(USER_ID, PROJECT_ID, legacyMix.id.toString(), S9, undefined, binding(S9, "legacy-mix-node", 0));
    expect(accepted).toMatchObject({ code: 200, data: { canvas_binding: { submission_id: S9, binding_revision: 1, is_current: true } } });

    const legacyMix2 = await prisma.generation_jobs.create({ data: {
      project_id: BigInt(PROJECT_ID), user_id: BigInt(USER_ID), type: "audio_mix", source: "dock",
      status: "failed", progress: 0, input: {
        source_node_id: "legacy-mix-node", inputs: [{ asset_id: "11", url: "https://our-tos/11.flac" }],
      } as never, fencing_token: 0,
    } });
    const rejected = await mixes.retry(USER_ID, PROJECT_ID, legacyMix2.id.toString(), S10, undefined, binding(S10, "other-node", 0));
    expect(rejected).toMatchObject({ code: 422, data: { reason: RECOVERY_REASONS.documentMismatch } });

    const legacyMux = await prisma.generation_jobs.create({ data: {
      project_id: BigInt(PROJECT_ID), user_id: BigInt(USER_ID), type: "audio_video_mux", source: "dock",
      status: "failed", progress: 0, input: {
        audio: { assetId: "21" }, video: { assetId: "22" }, estimated_duration_ms: null, submit_attempt: 1,
      } as never, fencing_token: 0,
    } });
    const muxRejected = await muxes.retry(USER_ID, PROJECT_ID, legacyMux.id.toString(), S1, binding(S1, "legacy-mux-node", 0));
    expect(muxRejected).toMatchObject({ code: 422, data: { reason: RECOVERY_REASONS.documentMismatch } });
  });

  it("★6 真实事务并发：同卡并发重试（不同提交意图）只成功一次，输家 409 在任务重置前", async () => {
    const created = await createMixJob(binding(S2, "mix-node", 0), S2);
    const jobId = created.data!.job_id!;
    await markJobFailed(jobId);
    const attempts = await Promise.allSettled([
      mixes.retry(USER_ID, PROJECT_ID, jobId, S3, undefined, binding(S3, "mix-node", 1)),
      mixes.retry(USER_ID, PROJECT_ID, jobId, S4, undefined, binding(S4, "mix-node", 1)),
    ]);
    const fulfilled = attempts.filter(attempt => attempt.status === "fulfilled");
    const values = fulfilled.map(attempt => (attempt as PromiseFulfilledResult<{ code: number; data?: { reason?: string } }>).value);
    const winners = values.filter(value => value.code === 200);
    const losers = values.filter(value => value.code === 409);
    expect(winners).toHaveLength(1);
    expect(losers).toHaveLength(1);

    const winnerJobId = String(winners[0]!.data!.job_id);
    const original = await prisma.generation_jobs.findUniqueOrThrow({ where: { id: BigInt(jobId) } });
    expect(original.status).toBe("failed");
    const retryJob = await prisma.generation_jobs.findUniqueOrThrow({ where: { id: BigInt(winnerJobId) } });
    expect(retryJob).toMatchObject({ status: "queued", retry_of_job_id: BigInt(jobId) });
    expect(await prisma.generation_canvas_submissions.count({ where: { project_id: BigInt(PROJECT_ID) } })).toBe(2);
    const owner = await prisma.generation_canvas_node_owners.findUniqueOrThrow({
      where: { project_id_node_id: { project_id: BigInt(PROJECT_ID), node_id: "mix-node" } },
    });
    expect(Number(owner.binding_revision)).toBe(2);

    expect(await prisma.command_idempotency.count({
      where: { project_id: BigInt(PROJECT_ID), operation: "audio_mix.retry" },
    })).toBe(1);
  });

  it("★7 恢复查询：处理中刷新返回任务状态；完成未落卡返回 pending/0 虚拟 primary 项", async () => {
    const created = await createMixJob(binding(S5, "mix-node", 0), S5);
    const jobId = created.data!.job_id!;

    let records = await recoveryPage();
    let record = records.find(row => row.submission_id === S5)!;
    expect(record).toMatchObject({ task_type: "audio_mix", is_current: true });
    expect((record.job as { status?: string }).status).toBe("queued");

    await raw.query(
      "UPDATE generation_jobs SET status='succeeded', output_asset_ids=CAST('[\"77\"]' AS JSON) WHERE id = ?",
      [Number(jobId)],
    );
    records = await recoveryPage();
    record = records.find(row => row.submission_id === S5)!;
    const primary = record.items.find(item => item.output_key === PRIMARY_OUTPUT_KEY);
    expect(primary).toMatchObject({ state: "pending", revision: 0, node_binding_revision: 0 });
    expect(await prisma.generation_canvas_outputs.count({})).toBe(0);
  });

  it("★8 权威 cancelled 后 settleTarget 回草稿保留归属；随后再次生成推进版本", async () => {

    await seedCanvas(["settle-node"]);
    const created = await createMixJob({
      ...binding(S6, "settle-node", 0),
      recovery_seed: { target: { role: "existing-media", x: 0, y: 0, width: 100, height: 100, name: "原素材" }, sources: [] },
    }, S6);
    const jobId = created.data!.job_id!;
    await raw.query("UPDATE generation_jobs SET status='cancelled' WHERE id = ?", [Number(jobId)]);
    const settleDoc = JSON.stringify([{
      id: "settle-node", type: "mediaNode", position: { x: 0, y: 0 },
      data: { mediaType: "audio", assetId: "31", generationRecovery: { protocolVersion: 1, submissionId: S6, outputKey: TARGET_OUTPUT_KEY } },
    }]);
    const settled = await saveCanvasWithRecovery(prisma, {
      ownerId: USER_ID, projectId: PROJECT_ID, expectedVersion: 0,
      viewport: "{}", nodes: settleDoc, edges: "[]", confirmEmpty: false,
      commandId: "2a2b3c4d-0000-4000-8000-00000000000b",
      changes: [{ recoveryItemId: recoveryItemId(S6, TARGET_OUTPUT_KEY), expectedRevision: 1, action: "settleTarget" }],
    });
    expect(settled.recoveryReceipt.changes[0]).toMatchObject({ state: "present", revision: 2 });

    const owner = await prisma.generation_canvas_node_owners.findUniqueOrThrow({
      where: { project_id_node_id: { project_id: BigInt(PROJECT_ID), node_id: "settle-node" } },
    });
    expect(Number(owner.binding_revision)).toBe(1);

    await markJobFailed(jobId);
    const again = await mixes.retry(USER_ID, PROJECT_ID, jobId, S7, undefined, binding(S7, "settle-node", 1));
    expect(again).toMatchObject({ code: 200, data: { canvas_binding: { submission_id: S7, binding_revision: 2, is_current: true } } });
    const ownerAfter = await prisma.generation_canvas_node_owners.findUniqueOrThrow({
      where: { project_id_node_id: { project_id: BigInt(PROJECT_ID), node_id: "settle-node" } },
    });
    expect(Number(ownerAfter.binding_revision)).toBe(2);
    const settledSubmission = await prisma.generation_canvas_submissions.findUniqueOrThrow({
      where: { project_id_submission_id: { project_id: BigInt(PROJECT_ID), submission_id: S6 } },
    });
    expect(settledSubmission.target_state).toBe("transferred");
  });

  it("★9 专属重试回执丢失重放：同 submission 再重试返回同一新 job，不重复推进版本", async () => {
    const created = await createMixJob(binding(S8, "mix-node", 0), S8);
    const jobId = created.data!.job_id!;
    await markJobFailed(jobId);
    const first = await mixes.retry(USER_ID, PROJECT_ID, jobId, S9, undefined, binding(S9, "mix-node", 1));
    const firstRetryJobId = first.data!.job_id!;
    expect(first).toMatchObject({ code: 200, data: { replayed: false, canvas_binding: { submission_id: S9 } } });
    expect(firstRetryJobId).not.toBe(jobId);

    const replay = await mixes.retry(USER_ID, PROJECT_ID, jobId, S9, undefined, binding(S9, "mix-node", 1));
    expect(replay).toMatchObject({ code: 200, data: { job_id: firstRetryJobId, replayed: true, canvas_binding: { submission_id: S9 } } });
    const original = await prisma.generation_jobs.findUniqueOrThrow({ where: { id: BigInt(jobId) } });
    expect(original.status).toBe("failed");
    const retryJob = await prisma.generation_jobs.findUniqueOrThrow({ where: { id: BigInt(firstRetryJobId) } });
    expect(retryJob).toMatchObject({ status: "queued", retry_count: 0, retry_of_job_id: BigInt(jobId) });
    expect(await prisma.generation_canvas_submissions.count({ where: { project_id: BigInt(PROJECT_ID) } })).toBe(2);
    const owner = await prisma.generation_canvas_node_owners.findUniqueOrThrow({
      where: { project_id_node_id: { project_id: BigInt(PROJECT_ID), node_id: "mix-node" } },
    });
    expect(Number(owner.binding_revision)).toBe(2);
  });

  it("★10 绑定校验：Idempotency-Key 与 submission_id 不一致 / 非法载荷 → 400", async () => {
    const badKey = await mixes.retry(USER_ID, PROJECT_ID, "1", "not-a-uuid-key", undefined, binding(S1, "mix-node", 0));
    expect(badKey).toMatchObject({ code: 400, data: { reason: RECOVERY_REASONS.invalidPayload } });
    const badPayload = await muxes.retry(USER_ID, PROJECT_ID, "1", S2, { protocol_version: 2 });
    expect(badPayload).toMatchObject({ code: 400, data: { reason: RECOVERY_REASONS.invalidPayload } });
    const createMismatch = await mixes.create(USER_ID, PROJECT_ID, {
      source_node_id: "mix-node",
      inputs: [{ asset_id: "11", node_id: "mix-node" }, { asset_id: "12" }],
      canvas_binding: binding(S1, "mix-node", 0),
    }, { idempotencyKey: "different-key" });
    expect(createMismatch).toMatchObject({ code: 400, data: { reason: RECOVERY_REASONS.invalidPayload } });
    const createNoKey = await muxes.create(USER_ID, PROJECT_ID, {
      audio: { assetId: "21", nodeId: "mux-node" }, video: { assetId: "22" },
      canvas_binding: binding(S1, "mux-node", 0),
    }, {});
    expect(createNoKey).toMatchObject({ code: 400, data: { reason: RECOVERY_REASONS.invalidPayload } });
  });

  it("★11 绑定版本冲突：expected 过期 → 409 canvas_binding_conflict 且零写入", async () => {
    const created = await createMixJob(binding(S1, "mix-node", 0), S1);
    const jobId = created.data!.job_id!;
    await markJobFailed(jobId);

    const stale = await mixes.retry(USER_ID, PROJECT_ID, jobId, S2, undefined, binding(S2, "mix-node", 0));
    expect(stale).toMatchObject({
      code: 409,
      data: { reason: RECOVERY_REASONS.bindingConflict, currentBindingRevision: 1 },
    });
    const job = await prisma.generation_jobs.findUniqueOrThrow({ where: { id: BigInt(jobId) } });
    expect(job).toMatchObject({ status: "failed", retry_count: 0 });
    expect(await prisma.generation_canvas_submissions.count({ where: { project_id: BigInt(PROJECT_ID) } })).toBe(1);
  });
});
