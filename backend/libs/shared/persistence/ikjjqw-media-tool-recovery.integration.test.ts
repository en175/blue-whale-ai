// IKJJQW（IKIXK9-SPEC-20261002 B 节）：单结果媒体工具接入恢复协议 v1 的真 MySQL 验证。
//
// 与 ikjjqu-canvas-recovery.integration.test.ts 同款门控：需要本地 MySQL（本票用 3308，勿动 QU 的 3307）：
//   # 容器与建库（一次）：
//   docker run -d --name ikjjqw-mysql -e MYSQL_ROOT_PASSWORD=ikjjqw \
//     -e MYSQL_DATABASE=bw_gate_ikjjqw -p 3308:3306 mysql:8
//   cd backend && DATABASE_URL='mysql://root:ikjjqw@127.0.0.1:3308/bw_gate_ikjjqw' \
//     npx prisma db push --accept-data-loss
//   # 跑测试：
//   IKJJQW_DATABASE_URL='mysql://root:ikjjqw@127.0.0.1:3308/bw_gate_ikjjqw' \
//     pnpm exec vitest run backend/libs/shared/persistence/ikjjqw-media-tool-recovery.integration.test.ts
// 未配置该变量时整组跳过；跳过不算通过。
//
// 验收场景（工单第 6 条，11 个接入类型表驱动，各四查）：
//   1. 受理回执丢失后查询（恢复页找回已受理任务）
//   2. 完成未落卡（succeeded + 无 outputs 行 → 恢复页返回 pending/0 的 primary 虚拟项）
//   3. 重试幂等（通用重试带 canvas_binding → 新 job + 新关联；同 submission_id 重放同 job）
//   4. 归属冲突不预扣（承接版本过期 → 409 在任务写入前，零 job 零关联）
//   5. 重试拒绝迁移（无受理关联的原任务带 canvas_binding 重试 → 422 明确拒绝）
import { PrismaMariaDb } from "@prisma/adapter-mariadb";
import type { Pool } from "mariadb";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildPoolConfig, getPrismaClient } from "./db.js";
import { RECOVERY_REASONS, type CanvasBinding } from "@lib/contracts";
import { listCanvasRecoveryPage } from "./generation-canvas-recovery-repo.js";
import { createGenerationCommandRepo } from "./generation-command-repo.js";
import { createHash } from "node:crypto";
import type { PrismaClient } from "@prisma/client";

import { ImageErasuresService } from "@lib/shared/image-erasures/image-erasures.service.js";
import { VideoSubtitleErasuresService } from "@lib/shared/video-subtitle-erasures/video-subtitle-erasures.service.js";
import { MediaExtractionsService } from "@lib/shared/media-extractions/media-extractions.service.js";
import { AudioTrimsService } from "@lib/shared/audio-trims/audio-trims.service.js";
import { AudioSpeedsService } from "@lib/shared/audio-speeds/audio-speeds.service.js";
import { VideoMattingsService } from "@lib/shared/video-mattings/video-mattings.service.js";
import { ImageCutoutsService } from "@lib/shared/image-cutouts/image-cutouts.service.js";
import { ImageOutpaintsService } from "@lib/shared/image-outpaints/image-outpaints.service.js";
import { ImageEnhancementsService } from "@lib/shared/image-enhancements/image-enhancements.service.js";
import { VideoEnhancementsService } from "@lib/shared/video-enhancements/video-enhancements.service.js";
import { VideoFrameInterpolationsService } from "@lib/shared/video-frame-interpolations/video-frame-interpolations.service.js";
import type { AssetStorageService } from "@lib/shared/assets/storage.service.js";

const databaseUrl = process.env.IKJJQW_DATABASE_URL;

/** 各工具最小合规资产形状（service 层校验用；权限/归属校验由 stub 恒返回通过）。 */
function assetOf(kind: "image" | "video" | "audio") {
  const base = { url: "https://tos.example.com/uploads/9/x/a.bin", storage_key: null, mime: null, size: 1_000_000n, width: null, height: null, duration_ms: null };
  if (kind === "image") return { ...base, type: "image", url: "https://tos.example.com/uploads/9/x/a.png", mime: "image/png", width: 1080, height: 1920 };
  if (kind === "video") return { ...base, type: "video", url: "https://tos.example.com/uploads/9/x/a.mp4", mime: "video/mp4", width: 1080, height: 1920, duration_ms: 60_000 };
  return { ...base, type: "audio", url: "https://tos.example.com/uploads/9/x/a.mp3", mime: "audio/mp3", duration_ms: 60_000 };
}

/** 11 个单结果媒体工具的受理形态（入口验收清单的测试化身）。 */
const TOOLS = [
  { name: "擦除", op: "image_erase.create", path: "/image-erasures", kind: "image" as const,
    make: (c: unknown) => new ImageErasuresService({ client: c } as never, { findOwnedById: async () => ({ id: 1n }) } as never, { findOwnedSource: async () => assetOf("image") } as never),
    body: () => ({ source_asset_id: "88", target_node_id: "node-1", erase_scene: "full_screen_text_erase" }) },
  { name: "去字幕", op: "video_subtitle_erase.create", path: "/video-subtitle-erasures", kind: "video" as const,
    make: (c: unknown) => new VideoSubtitleErasuresService({ client: c } as never, { findOwnedById: async () => ({ id: 1n }) } as never, { findOwnedSource: async () => assetOf("video") } as never),
    body: () => ({ source_asset_id: "88", target_node_id: "node-1", detect_mode: "subtitle_smart", erase_boxes: [] }) },
  { name: "音视频分离", op: "media_extract.create", path: "/media-extractions", kind: "video" as const,
    make: (c: unknown) => new MediaExtractionsService({ client: c } as never, { findOwnedById: async () => ({ id: 1n }) } as never, { findOwnedSource: async () => assetOf("video") } as never),
    body: () => ({ source_asset_id: "88" }) },
  { name: "截取", op: "audio_trim.create", path: "/audio-trims", kind: "audio" as const,
    make: (c: unknown) => new AudioTrimsService({ client: c } as never, { findOwnedById: async () => ({ id: 1n }) } as never, { findOwnedSource: async () => ({ ...assetOf("audio"), storage_key: "uploads/9/x/a.mp3" }) } as never),
    body: () => ({ source_asset_id: "88", start_time: 1, end_time: 2 }) },
  { name: "调速", op: "audio_speed.create", path: "/audio-speeds", kind: "audio" as const,
    make: (c: unknown) => new AudioSpeedsService({ client: c } as never, { findOwnedById: async () => ({ id: 1n }) } as never, { findOwnedSource: async () => assetOf("audio") } as never),
    body: () => ({ source_asset_id: "88", speed: 1.5 }) },
  { name: "抠像", op: "video_matting.create", path: "/video-mattings", kind: "video" as const,
    make: (c: unknown) => new VideoMattingsService({ client: c } as never, { findOwnedById: async () => ({ id: 1n }) } as never, { findOwnedSource: async () => assetOf("video") } as never),
    // 抠像的幂等承载是 client_token（= submission_id），不是 Idempotency-Key 头。
    body: (submissionId: string) => ({ source_asset_id: "88", target_node_id: "node-1", mode: "portrait", client_token: submissionId }) },
  { name: "抠图", op: "image_cutout.create", path: "/image-cutouts", kind: "image" as const,
    make: (c: unknown) => new ImageCutoutsService({ client: c } as never, { findOwnedById: async () => ({ id: 1n }) } as never, { findOwnedSource: async () => assetOf("image") } as never),
    body: () => ({ source_asset_id: "88", target_node_id: "node-1", cutout_scene: "general" }) },
  { name: "扩图", op: "image_outpaint.create", path: "/image-outpaints", kind: "image" as const,
    make: (c: unknown) => new ImageOutpaintsService({ client: c } as never, { findOwnedById: async () => ({ id: 1n }) } as never, { findOwnedSource: async () => assetOf("image") } as never, { uploads: null } as unknown as AssetStorageService),
    body: () => ({ source_asset_id: "88", target_node_id: "node-1", expand_top: 0.1, expand_bottom: 0, expand_left: 0, expand_right: 0 }) },
  { name: "图像高清", op: "image_enhance.create", path: "/image-enhancements", kind: "image" as const,
    make: (c: unknown) => new ImageEnhancementsService({ client: c } as never, { findOwnedById: async () => ({ id: 1n }) } as never, { findOwnedSource: async () => assetOf("image") } as never),
    body: () => ({ source_asset_id: "88", target_node_id: "node-1", version_tier: "pro", multiple: 2, generative_enhance_mode: "generative_first", enable_correct_color: false }) },
  { name: "视频 HD", op: "video_enhance.create", path: "/video-enhancements", kind: "video" as const,
    make: (c: unknown) => new VideoEnhancementsService({ client: c } as never, { findOwnedById: async () => ({ id: 1n }) } as never, { findOwnedSource: async () => assetOf("video") } as never),
    body: () => ({ source_asset_id: "88", target_node_id: "node-1", resolution: "1080p" }) },
  { name: "插帧", op: "video_frame_interpolation.create", path: "/video-frame-interpolations", kind: "video" as const,
    make: (c: unknown) => new VideoFrameInterpolationsService({ client: c } as never, { findOwnedById: async () => ({ id: 1n }) } as never, { findOwnedSource: async () => assetOf("video") } as never),
    body: () => ({ source_asset_id: "88", target_node_id: "node-1" }) },
] as const;

const PROJECT_ID = "920001";
const USER_ID = "920009";

function submissionId(seed: number): string {
  // 确定性小写 UUID（每用例唯一即可，v4 形态合法：段长 8-4-4-4-12）。
  const hex = seed.toString(16).padStart(12, "0").slice(-12);
  return `${hex.slice(0, 8)}-1111-4222-8333-${hex.slice(4)}0000`;
}

function bindingOf(sid: string, node: string, revision: number): CanvasBinding {
  return {
    protocol_version: 1,
    submission_id: sid,
    target_node_id: node,
    expected_binding_revision: revision,
    recovery_seed: {
      target: { role: "result-placeholder", x: 0, y: 0, width: 100, height: 100, name: "" },
      sources: [],
    },
  };
}

/** 各工具 service 的受理调用（video-mattings 无头、其余走 Idempotency-Key 头）。 */
async function submit(
  tool: (typeof TOOLS)[number],
  prisma: PrismaClient,
  sid: string,
  node: string,
  revision = 0,
) {
  const service = tool.make(prisma) as {
    create: (userId: string, projectId: string, body: Record<string, unknown>, internal?: unknown, key?: string) => Promise<{ code: number; msg?: string; data?: unknown }>;
  };
  const body = tool.body(sid);
  return service.create(
    USER_ID,
    PROJECT_ID,
    { ...body, canvas_binding: bindingOf(sid, node, revision) },
    {},
    tool.name === "抠像" ? undefined : sid,
  );
}

describe.skipIf(!databaseUrl)("单结果媒体工具恢复协议真库验证（IKJJQW）", () => {
  let prisma: PrismaClient;
  let raw: Pool;

  beforeAll(async () => {
    prisma = getPrismaClient(databaseUrl!);
    const adapter = await new PrismaMariaDb(buildPoolConfig(databaseUrl!)).connect();
    raw = adapter.underlyingDriver();
    await prisma.project.create({ data: { id: BigInt(PROJECT_ID), owner_id: BigInt(USER_ID), name: "ikjjqw" } });
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
    await prisma.generation_jobs.deleteMany({ where: { project_id: BigInt(PROJECT_ID) } });
  });

  const retryHash = (sid: string) =>
    createHash("sha256").update(`POST:generation.retry:/projects/${PROJECT_ID}/generation-jobs/x/retry:${sid}`).digest("hex");

  /** 通用重试（generation-command-repo.retryJob）带 canvas_binding——与 handle-retry 同参形态。 */
  async function retryWithBinding(originalJobId: string, sid: string, node: string, revision: number) {
    return createGenerationCommandRepo(prisma).retryJob(
      originalJobId,
      PROJECT_ID,
      USER_ID,
      sid,
      retryHash(sid),
      undefined,
      {
        projectId: PROJECT_ID,
        userId: USER_ID,
        binding: bindingOf(sid, node, revision),
        operation: "generation.retry",
        requestHash: retryHash(sid),
        idempotencyKey: sid,
        taskType: "",
      },
    );
  }

  for (const tool of TOOLS) {
    describe(`${tool.name}（${tool.op}）`, () => {
      it("★ 1. 受理回执丢失后查询：恢复页找回已受理任务", async () => {
        const sid = submissionId(101 + TOOLS.indexOf(tool));
        const result = await submit(tool, prisma, sid, "node-1");
        expect(result.code).toBe(200);
        const data = result.data as { job_id: string; canvas_binding: Record<string, unknown> };
        expect(data.canvas_binding).toMatchObject({
          protocol_version: 1,
          submission_id: sid,
          target_node_id: "node-1",
          binding_revision: 1,
          job_id: data.job_id,
          is_current: true,
        });
        // 回执丢失后：恢复页按项目找回该提交（含运行中 job 投影）。
        const page = await listCanvasRecoveryPage(prisma, PROJECT_ID, 50, null);
        expect(page.records).toHaveLength(1);
        expect(page.records[0]).toMatchObject({
          submission_id: sid,
          target_node_id: "node-1",
          task_type: expect.any(String),
          is_current: true,
        });
        expect(page.records[0]!.job).toMatchObject({ job_id: data.job_id, status: "queued" });
      });

      it("★ 2. 完成未落卡：恢复页返回 pending/0 的 primary 虚拟项", async () => {
        const sid = submissionId(201 + TOOLS.indexOf(tool));
        const result = await submit(tool, prisma, sid, "node-2");
        expect(result.code).toBe(200);
        const jobId = (result.data as { job_id: string }).job_id;
        await raw.query(
          "UPDATE generation_jobs SET status='succeeded', output_asset_ids=CAST('[\"9001\"]' AS JSON) WHERE id = ?",
          [Number(jobId)],
        );
        const page = await listCanvasRecoveryPage(prisma, PROJECT_ID, 50, null);
        expect(page.records[0]!.job).toMatchObject({ status: "succeeded" });
        const primary = page.records[0]!.items.find((item) => item.output_key === "primary");
        expect(primary).toMatchObject({
          state: "pending",
          revision: 0,
          node_id: "node-2",
        });
      });

      it("★ 3. 重试幂等：带 canvas_binding 建新意图，同 submission_id 重放同 job", async () => {
        const sid = submissionId(301 + TOOLS.indexOf(tool));
        const created = await submit(tool, prisma, sid, "node-3");
        expect(created.code).toBe(200);
        const jobId = (created.data as { job_id: string }).job_id;
        await raw.query("UPDATE generation_jobs SET status='failed' WHERE id = ?", [Number(jobId)]);

        const retrySid = submissionId(401 + TOOLS.indexOf(tool));
        const retry = await retryWithBinding(jobId, retrySid, "node-3", 1);
        expect(retry && "generation_job_id" in retry).toBe(true);
        const retryJobId = (retry as { generation_job_id: string }).generation_job_id;
        expect(retryJobId).not.toBe(jobId);
        // 新关联随重试事务落库；owner 版本推进到 2。
        const page = await listCanvasRecoveryPage(prisma, PROJECT_ID, 50, null);
        expect(page.records.map((r) => r.submission_id)).toContain(retrySid);
        const owner = await prisma.generation_canvas_node_owners.findUnique({
          where: { project_id_node_id: { project_id: BigInt(PROJECT_ID), node_id: "node-3" } },
        });
        expect(owner?.binding_revision).toBe(2);

        // 同 submission_id 同摘要重试重放同一 job（重试幂等）。
        const replay = await retryWithBinding(jobId, retrySid, "node-3", 1);
        expect((replay as { generation_job_id: string }).generation_job_id).toBe(retryJobId);
        expect(await prisma.generation_jobs.count({ where: { project_id: BigInt(PROJECT_ID) } })).toBe(2);
      });

      it("★ 4. 归属冲突不预扣：承接版本过期 → 409 在任务写入前", async () => {
        const first = await submit(tool, prisma, submissionId(501 + TOOLS.indexOf(tool)), "node-4");
        expect(first.code).toBe(200);
        const jobsBefore = await prisma.generation_jobs.count({ where: { project_id: BigInt(PROJECT_ID) } });
        // 第二意图携带过期版本（实际已是 1）→ 409 canvas_binding_conflict，零 job 零关联零预扣行。
        const second = await submit(tool, prisma, submissionId(601 + TOOLS.indexOf(tool)), "node-4", 0);
        expect(second.code).toBe(409);
        expect(second.data).toMatchObject({ reason: RECOVERY_REASONS.bindingConflict, currentBindingRevision: 1 });
        expect(await prisma.generation_jobs.count({ where: { project_id: BigInt(PROJECT_ID) } })).toBe(jobsBefore);
        expect(await prisma.generation_canvas_submissions.count({ where: { project_id: BigInt(PROJECT_ID) } })).toBe(1);
      });

      it("★ 5. 重试拒绝迁移：无受理关联的原任务带 canvas_binding → 422", async () => {
        // 直接落一个无关联 job（历史任务形态：不携 canvas_binding 建行）。
        const legacy = await prisma.generation_jobs.create({
          data: {
            user_id: BigInt(USER_ID),
            project_id: BigInt(PROJECT_ID),
            type: "image",
            source: "dock",
            status: "failed",
            progress: 0,
            input: { prompt: "legacy" },
            next_action_at: new Date(Date.now() - 60_000),
          },
        });
        const retry = await retryWithBinding(legacy.id.toString(), submissionId(701 + TOOLS.indexOf(tool)), "node-x", 0);
        expect(retry).toMatchObject({
          kind: "recovery_contract_error",
          envelope: {
            code: 422,
            data: { reason: RECOVERY_REASONS.documentMismatch },
          },
        });
        expect(await prisma.generation_jobs.count({ where: { project_id: BigInt(PROJECT_ID) } })).toBe(1);
      });
    });
  }
});
