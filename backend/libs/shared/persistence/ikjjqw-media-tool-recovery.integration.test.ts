import { clearEffectiveRecoveryOwners, findEffectiveRecoveryOwner } from "./recovery-owner-test-helpers.js";



















import { PrismaMariaDb } from "@prisma/adapter-mariadb";
import type { Pool } from "mariadb";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
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

vi.mock("@lib/shared/generation/generation-queue.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@lib/shared/generation/generation-queue.js")>();
  return {
    ...actual,
    enqueueImageEraseJob: vi.fn(),
    enqueueImageCutoutJob: vi.fn(),
    enqueueImageOutpaintJob: vi.fn(),
    enqueueImageEnhanceJob: vi.fn(),
    enqueueVideoEnhanceJob: vi.fn(),
    enqueueVideoFrameInterpolationJob: vi.fn(),
    enqueueVideoMattingJob: vi.fn(),
    enqueueVideoSubtitleEraseJob: vi.fn(),
    enqueueVideoSceneSplitJob: vi.fn(),
  };
});

const databaseUrl = process.env.IKJJQW_DATABASE_URL;


function assetOf(kind: "image" | "video" | "audio") {
  const base = { url: "https://tos.example.com/uploads/9/x/a.bin", storage_key: null, mime: null, size: 1_000_000n, width: null, height: null, duration_ms: null };
  if (kind === "image") return { ...base, type: "image", url: "https://tos.example.com/uploads/9/x/a.png", mime: "image/png", width: 1080, height: 1920 };
  if (kind === "video") return { ...base, type: "video", url: "https://tos.example.com/uploads/9/x/a.mp4", mime: "video/mp4", width: 1080, height: 1920, duration_ms: 60_000 };
  return { ...base, type: "audio", url: "https://tos.example.com/uploads/9/x/a.mp3", mime: "audio/mp3", duration_ms: 60_000 };
}


const TOOLS = [
  { name: "擦除", op: "image_erase.create", path: "/image-erasures", kind: "image" as const,
    make: (c: unknown) => new ImageErasuresService({ client: c } as never, { findOwnedById: async () => ({ id: 1n }) } as never, { findOwnedSource: async () => assetOf("image") } as never, { jobBilling: async () => undefined, release: async () => {} } as never),
    body: () => ({ source_asset_id: "88", target_node_id: "node-1", erase_scene: "full_screen_text_erase" }) },
  { name: "去字幕", op: "video_subtitle_erase.create", path: "/video-subtitle-erasures", kind: "video" as const,
    make: (c: unknown) => new VideoSubtitleErasuresService({ client: c } as never, { findOwnedById: async () => ({ id: 1n }) } as never, { findOwnedSource: async () => assetOf("video") } as never, { probe: null } as never, { jobBilling: async () => undefined, release: async () => {} } as never),
    body: () => ({ source_asset_id: "88", target_node_id: "node-1", detect_mode: "subtitle_smart", erase_boxes: [] }) },
  { name: "音视频分离", op: "media_extract.create", path: "/media-extractions", kind: "video" as const,
    make: (c: unknown) => new MediaExtractionsService({ client: c } as never, { findOwnedById: async () => ({ id: 1n }) } as never, { findOwnedSource: async () => assetOf("video") } as never, { probe: null } as never, { jobBilling: async () => undefined, release: async () => {} } as never),
    body: () => ({ source_asset_id: "88" }) },
  { name: "截取", op: "audio_trim.create", path: "/audio-trims", kind: "audio" as const,
    make: (c: unknown) => new AudioTrimsService({ client: c } as never, { findOwnedById: async () => ({ id: 1n }) } as never, { findOwnedSource: async () => ({ ...assetOf("audio"), storage_key: "uploads/9/x/a.mp3" }) } as never, { probe: null } as never, { jobBilling: async () => undefined, release: async () => {} } as never),
    body: () => ({ source_asset_id: "88", start_time: 1, end_time: 2 }) },
  { name: "调速", op: "audio_speed.create", path: "/audio-speeds", kind: "audio" as const,
    make: (c: unknown) => new AudioSpeedsService({ client: c } as never, { findOwnedById: async () => ({ id: 1n }) } as never, { findOwnedSource: async () => assetOf("audio") } as never, { probe: null } as never, { jobBilling: async () => undefined, release: async () => {} } as never),
    body: () => ({ source_asset_id: "88", speed: 1.5 }) },
  { name: "抠像", op: "video_matting.create", path: "/video-mattings", kind: "video" as const,
    make: (c: unknown) => new VideoMattingsService({ client: c } as never, { findOwnedById: async () => ({ id: 1n }) } as never, { findOwnedSource: async () => assetOf("video") } as never, { probe: null } as never, { jobBilling: async () => undefined, release: async () => {} } as never),

    body: (submissionId: string) => ({ source_asset_id: "88", target_node_id: "node-1", mode: "portrait", client_token: submissionId }) },
  { name: "抠图", op: "image_cutout.create", path: "/image-cutouts", kind: "image" as const,
    make: (c: unknown) => new ImageCutoutsService({ client: c } as never, { findOwnedById: async () => ({ id: 1n }) } as never, { findOwnedSource: async () => assetOf("image") } as never, { jobBilling: async () => undefined, release: async () => {} } as never),
    body: () => ({ source_asset_id: "88", target_node_id: "node-1", cutout_scene: "general" }) },
  { name: "扩图", op: "image_outpaint.create", path: "/image-outpaints", kind: "image" as const,
    make: (c: unknown) => new ImageOutpaintsService({ client: c } as never, { findOwnedById: async () => ({ id: 1n }) } as never, { findOwnedSource: async () => assetOf("image") } as never, { uploads: null } as unknown as AssetStorageService, { jobBilling: async () => undefined, release: async () => {} } as never),
    body: () => ({ source_asset_id: "88", target_node_id: "node-1", expand_top: 0.1, expand_bottom: 0, expand_left: 0, expand_right: 0 }) },
  { name: "图像高清", op: "image_enhance.create", path: "/image-enhancements", kind: "image" as const,
    make: (c: unknown) => new ImageEnhancementsService({ client: c } as never, { findOwnedById: async () => ({ id: 1n }) } as never, { findOwnedSource: async () => assetOf("image") } as never, { jobBilling: async () => undefined, release: async () => {} } as never),
    body: () => ({ source_asset_id: "88", target_node_id: "node-1", version_tier: "pro", multiple: 2, generative_enhance_mode: "generative_first", enable_correct_color: false }) },
  { name: "视频 HD", op: "video_enhance.create", path: "/video-enhancements", kind: "video" as const,
    make: (c: unknown) => new VideoEnhancementsService({ client: c } as never, { findOwnedById: async () => ({ id: 1n }) } as never, { findOwnedSource: async () => assetOf("video") } as never, { probe: null } as never, { jobBilling: async () => undefined, release: async () => {} } as never),
    body: () => ({ source_asset_id: "88", target_node_id: "node-1", resolution: "1080p" }) },
  { name: "插帧", op: "video_frame_interpolation.create", path: "/video-frame-interpolations", kind: "video" as const,
    make: (c: unknown) => new VideoFrameInterpolationsService({ client: c } as never, { findOwnedById: async () => ({ id: 1n }) } as never, { findOwnedSource: async () => assetOf("video") } as never, { probe: null } as never, { jobBilling: async () => undefined, release: async () => {} } as never),
    body: () => ({ source_asset_id: "88", target_node_id: "node-1" }) },
] as const;

const PROJECT_ID = "920001";
const USER_ID = "920009";

function submissionId(seed: number): string {

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
    await clearEffectiveRecoveryOwners(prisma, BigInt(PROJECT_ID));
    await prisma.generation_canvas_outputs.deleteMany({});
    await prisma.generation_canvas_submissions.deleteMany({ where: { project_id: BigInt(PROJECT_ID) } });
    await prisma.project_command_receipts.deleteMany({ where: { project_id: BigInt(PROJECT_ID) } });
    await prisma.project_canvas.deleteMany({ where: { project_id: BigInt(PROJECT_ID) } });
    await prisma.project_edges.deleteMany({ where: { project_id: BigInt(PROJECT_ID) } });
    await prisma.project_nodes.deleteMany({ where: { project_id: BigInt(PROJECT_ID) } });
    await prisma.generation_output_slots.deleteMany({ where: { project_id: BigInt(PROJECT_ID) } });
    await prisma.generation_job_logs.deleteMany({});
    await prisma.generation_jobs.deleteMany({ where: { project_id: BigInt(PROJECT_ID) } });
  });

  const retryHash = (sid: string) =>
    createHash("sha256").update(`POST:generation.retry:/projects/${PROJECT_ID}/generation-jobs/x/retry:${sid}`).digest("hex");


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

        const page = await listCanvasRecoveryPage(prisma, PROJECT_ID, 50, null);
        expect(page.records.map((r) => r.submission_id)).toContain(retrySid);
        const owner = await findEffectiveRecoveryOwner(prisma, BigInt(PROJECT_ID), "node-3");
        expect(owner?.binding_revision).toBe(2);


        const replay = await retryWithBinding(jobId, retrySid, "node-3", 1);
        expect((replay as { generation_job_id: string }).generation_job_id).toBe(retryJobId);
        expect(await prisma.generation_jobs.count({ where: { project_id: BigInt(PROJECT_ID) } })).toBe(2);
      });

      it("★ 4. 归属冲突不预扣：承接版本过期 → 409 在任务写入前", async () => {
        const first = await submit(tool, prisma, submissionId(501 + TOOLS.indexOf(tool)), "node-4");
        expect(first.code).toBe(200);
        const jobsBefore = await prisma.generation_jobs.count({ where: { project_id: BigInt(PROJECT_ID) } });

        const second = await submit(tool, prisma, submissionId(601 + TOOLS.indexOf(tool)), "node-4", 0);
        expect(second.code).toBe(409);
        expect(second.data).toMatchObject({ reason: RECOVERY_REASONS.bindingConflict, currentBindingRevision: 1 });
        expect(await prisma.generation_jobs.count({ where: { project_id: BigInt(PROJECT_ID) } })).toBe(jobsBefore);
        expect(await prisma.generation_canvas_submissions.count({ where: { project_id: BigInt(PROJECT_ID) } })).toBe(1);
      });

      it("★ 5. 重试拒绝迁移：无受理关联的原任务带 canvas_binding → 422", async () => {

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
