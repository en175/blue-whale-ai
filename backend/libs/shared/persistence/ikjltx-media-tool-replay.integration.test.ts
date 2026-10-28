import { clearEffectiveRecoveryOwners, findEffectiveRecoveryOwner } from "./recovery-owner-test-helpers.js";























import { PrismaMariaDb } from "@prisma/adapter-mariadb";
import type { Pool } from "mariadb";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { buildPoolConfig, getPrismaClient } from "./db.js";
import type { CanvasBinding } from "@lib/contracts";

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
import type { PrismaClient } from "@prisma/client";

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

const databaseUrl = process.env.IKJLTX_DATABASE_URL;

const PROJECT_ID = "930001";
const OTHER_PROJECT_ID = "930002";
const USER_ID = "930009";


function assetOf(kind: "image" | "video" | "audio") {
  const base = { url: "https://tos.example.com/uploads/9/x/a.bin", storage_key: null, mime: null, size: 1_000_000n, width: null, height: null, duration_ms: null };
  if (kind === "image") return { ...base, type: "image", url: "https://tos.example.com/uploads/9/x/a.png", mime: "image/png", width: 1080, height: 1920 };
  if (kind === "video") return { ...base, type: "video", url: "https://tos.example.com/uploads/9/x/a.mp4", mime: "video/mp4", width: 1080, height: 1920, duration_ms: 60_000 };
  return { ...base, type: "audio", url: "https://tos.example.com/uploads/9/x/a.mp3", mime: "audio/mp3", duration_ms: 60_000 };
}



const TOOLS = [
  { name: "擦除", op: "image_erase.create", kind: "image" as const,
    make: (c: unknown, assets: unknown) => new ImageErasuresService({ client: c } as never, { findOwnedById: async () => ({ id: 1n }) } as never, assets as never, { jobBilling: async () => undefined, release: async () => {} } as never),
    body: () => ({ source_asset_id: "88", target_node_id: "node-1", erase_scene: "full_screen_text_erase" }) },
  { name: "去字幕", op: "video_subtitle_erase.create", kind: "video" as const,
    make: (c: unknown, assets: unknown) => new VideoSubtitleErasuresService({ client: c } as never, { findOwnedById: async () => ({ id: 1n }) } as never, assets as never, { probe: null } as never, { jobBilling: async () => undefined, release: async () => {} } as never),
    body: () => ({ source_asset_id: "88", target_node_id: "node-1", detect_mode: "subtitle_smart", erase_boxes: [] }) },
  { name: "音视频分离", op: "media_extract.create", kind: "video" as const,
    make: (c: unknown, assets: unknown) => new MediaExtractionsService({ client: c } as never, { findOwnedById: async () => ({ id: 1n }) } as never, assets as never, { probe: null } as never, { jobBilling: async () => undefined, release: async () => {} } as never),
    body: () => ({ source_asset_id: "88" }) },
  { name: "截取", op: "audio_trim.create", kind: "audio" as const,
    make: (c: unknown, assets: unknown) => new AudioTrimsService({ client: c } as never, { findOwnedById: async () => ({ id: 1n }) } as never, assets as never, { probe: null } as never, { jobBilling: async () => undefined, release: async () => {} } as never),
    body: () => ({ source_asset_id: "88", start_time: 1, end_time: 2 }) },
  { name: "调速", op: "audio_speed.create", kind: "audio" as const,
    make: (c: unknown, assets: unknown) => new AudioSpeedsService({ client: c } as never, { findOwnedById: async () => ({ id: 1n }) } as never, assets as never, { probe: null } as never, { jobBilling: async () => undefined, release: async () => {} } as never),
    body: () => ({ source_asset_id: "88", speed: 1.5 }) },
  { name: "抠像", op: "video_matting.create", kind: "video" as const,
    make: (c: unknown, assets: unknown) => new VideoMattingsService({ client: c } as never, { findOwnedById: async () => ({ id: 1n }) } as never, assets as never, { probe: null } as never, { jobBilling: async () => undefined, release: async () => {} } as never),

    body: (submissionId: string) => ({ source_asset_id: "88", target_node_id: "node-1", mode: "portrait", client_token: submissionId }) },
  { name: "抠图", op: "image_cutout.create", kind: "image" as const,
    make: (c: unknown, assets: unknown) => new ImageCutoutsService({ client: c } as never, { findOwnedById: async () => ({ id: 1n }) } as never, assets as never, { jobBilling: async () => undefined, release: async () => {} } as never),
    body: () => ({ source_asset_id: "88", target_node_id: "node-1", cutout_scene: "general" }) },
  { name: "扩图", op: "image_outpaint.create", kind: "image" as const,
    make: (c: unknown, assets: unknown) => new ImageOutpaintsService({ client: c } as never, { findOwnedById: async () => ({ id: 1n }) } as never, assets as never, { uploads: null } as unknown as AssetStorageService, { jobBilling: async () => undefined, release: async () => {} } as never),
    body: () => ({ source_asset_id: "88", target_node_id: "node-1", expand_top: 0.1, expand_bottom: 0, expand_left: 0, expand_right: 0 }) },
  { name: "图像高清", op: "image_enhance.create", kind: "image" as const,
    make: (c: unknown, assets: unknown) => new ImageEnhancementsService({ client: c } as never, { findOwnedById: async () => ({ id: 1n }) } as never, assets as never, { jobBilling: async () => undefined, release: async () => {} } as never),
    body: () => ({ source_asset_id: "88", target_node_id: "node-1", version_tier: "pro", multiple: 2, generative_enhance_mode: "generative_first", enable_correct_color: false }) },
  { name: "视频 HD", op: "video_enhance.create", kind: "video" as const,
    make: (c: unknown, assets: unknown) => new VideoEnhancementsService({ client: c } as never, { findOwnedById: async () => ({ id: 1n }) } as never, assets as never, { probe: null } as never, { jobBilling: async () => undefined, release: async () => {} } as never),
    body: () => ({ source_asset_id: "88", target_node_id: "node-1", resolution: "1080p" }) },
  { name: "插帧", op: "video_frame_interpolation.create", kind: "video" as const,
    make: (c: unknown, assets: unknown) => new VideoFrameInterpolationsService({ client: c } as never, { findOwnedById: async () => ({ id: 1n }) } as never, assets as never, { probe: null } as never, { jobBilling: async () => undefined, release: async () => {} } as never),
    body: () => ({ source_asset_id: "88", target_node_id: "node-1" }) },
] as const;

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


function ownedSourceStub(kind: "image" | "video" | "audio") {
  const stub = { visible: true };
  return {
    get visible() {
      return stub.visible;
    },
    set visible(v: boolean) {
      stub.visible = v;
    },
    findOwnedSource: async () => (stub.visible ? assetOf(kind) : null),
  };
}

type CreateResult = { code: number; msg?: string | null; data?: unknown };


async function submit(
  tool: (typeof TOOLS)[number],
  prisma: PrismaClient,
  sid: string,
  node: string,
  opts: { revision?: number; assetVisible?: () => boolean } = {},
): Promise<CreateResult> {
  const visible = opts.assetVisible ?? (() => true);
  const service = tool.make(prisma, {
    findOwnedSource: async () => (visible() ? assetOf(tool.kind) : null),
  }) as {
    create: (userId: string, projectId: string, body: Record<string, unknown>, internal?: unknown, key?: string) => Promise<CreateResult>;
  };
  const body = tool.body(sid);
  return service.create(
    USER_ID,
    PROJECT_ID,
    { ...body, canvas_binding: bindingOf(sid, node, opts.revision ?? 0) },
    {},
    tool.name === "抠像" ? undefined : sid,
  );
}

describe.skipIf(!databaseUrl)("媒体工具已受理意图重放真库验证（IKJLTX）", () => {
  let prisma: PrismaClient;
  let raw: Pool;

  beforeAll(async () => {
    prisma = getPrismaClient(databaseUrl!);
    const adapter = await new PrismaMariaDb(buildPoolConfig(databaseUrl!)).connect();
    raw = adapter.underlyingDriver();
    await prisma.project.create({ data: { id: BigInt(PROJECT_ID), owner_id: BigInt(USER_ID), name: "ikjltx" } });
    await prisma.project.create({ data: { id: BigInt(OTHER_PROJECT_ID), owner_id: BigInt(USER_ID), name: "ikjltx-other" } });
  });

  afterAll(async () => {
    if (!prisma) return;
    await prisma.project.deleteMany({ where: { id: { in: [BigInt(PROJECT_ID), BigInt(OTHER_PROJECT_ID)] } } });
    await raw.end();
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    for (const pid of [PROJECT_ID, OTHER_PROJECT_ID]) {
      await clearEffectiveRecoveryOwners(prisma, BigInt(pid));
      await prisma.generation_canvas_submissions.deleteMany({ where: { project_id: BigInt(pid) } });
      await prisma.project_command_receipts.deleteMany({ where: { project_id: BigInt(pid) } });
      await prisma.project_canvas.deleteMany({ where: { project_id: BigInt(pid) } });
      await prisma.generation_output_slots.deleteMany({ where: { project_id: BigInt(pid) } });
      await prisma.generation_jobs.deleteMany({ where: { project_id: BigInt(pid) } });
    }
    await prisma.generation_canvas_outputs.deleteMany({});
    await prisma.generation_job_logs.deleteMany({});
    await prisma.billing_cost_reservations.deleteMany({});
  });

  for (const tool of TOOLS) {
    describe(`${tool.name}（${tool.op}）`, () => {
      it("★ 1. 素材删除后同载荷重放返回原任务与原关联，零新增任务零重复副作用（无预扣）", async () => {
        const sid = submissionId(101 + TOOLS.indexOf(tool));
        const stub = ownedSourceStub(tool.kind);
        const service = tool.make(prisma, stub) as {
          create: (userId: string, projectId: string, body: Record<string, unknown>, internal?: unknown, key?: string) => Promise<CreateResult>;
        };
        const body = tool.body(sid);
        const call = () =>
          service.create(USER_ID, PROJECT_ID, { ...body, canvas_binding: bindingOf(sid, "node-1", 0) }, {}, tool.name === "抠像" ? undefined : sid);

        const first = await call();
        expect(first.code).toBe(200);
        const jobId = (first.data as { job_id: string }).job_id;
        const jobsAfterAccept = await prisma.generation_jobs.count({ where: { project_id: BigInt(PROJECT_ID) } });
        const subsAfterAccept = await prisma.generation_canvas_submissions.count({ where: { project_id: BigInt(PROJECT_ID) } });
        const idemAfterAccept = await prisma.project_command_receipts.count({ where: { project_id: BigInt(PROJECT_ID) } });


        stub.visible = false;
        const replay = await call();
        expect(replay.code).toBe(200);
        expect((replay.data as { job_id: string }).job_id).toBe(jobId);
        expect((replay.data as { canvas_binding?: { submission_id: string; is_current: boolean } }).canvas_binding).toMatchObject({
          submission_id: sid,
          job_id: jobId,
          is_current: true,
        });

        expect(await prisma.generation_jobs.count({ where: { project_id: BigInt(PROJECT_ID) } })).toBe(jobsAfterAccept);
        expect(await prisma.generation_canvas_submissions.count({ where: { project_id: BigInt(PROJECT_ID) } })).toBe(subsAfterAccept);
        expect(await prisma.project_command_receipts.count({ where: { project_id: BigInt(PROJECT_ID) } })).toBe(idemAfterAccept);
        expect(await prisma.billing_cost_reservations.count({})).toBe(0);
      });

      it("★ 2. 同键异载荷重放判幂等冲突（100409），零写入", async () => {
        const sid = submissionId(301 + TOOLS.indexOf(tool));
        const first = await submit(tool, prisma, sid, "node-2");
        expect(first.code).toBe(200);
        const jobsAfterAccept = await prisma.generation_jobs.count({ where: { project_id: BigInt(PROJECT_ID) } });




        const visible = () => true;
        const service = tool.make(prisma, { findOwnedSource: async () => (visible() ? assetOf(tool.kind) : null) }) as {
          create: (userId: string, projectId: string, body: Record<string, unknown>, internal?: unknown, key?: string) => Promise<CreateResult>;
        };
        const body = tool.body(sid);
        const conflict = await service.create(
          USER_ID,
          PROJECT_ID,
          { ...body, canvas_binding: bindingOf(sid, "node-2", 3) },
          {},
          tool.name === "抠像" ? undefined : sid,
        );
        expect(conflict.code).toBe(100409);
        expect(await prisma.generation_jobs.count({ where: { project_id: BigInt(PROJECT_ID) } })).toBe(jobsAfterAccept);
      });

      it("★ 3. 重放不把旧关联设为当前：节点被新意图接管后重放旧意图，原任务返回、当前关联不变", async () => {
        const sidA = submissionId(501 + TOOLS.indexOf(tool));
        const sidB = submissionId(601 + TOOLS.indexOf(tool));
        const firstA = await submit(tool, prisma, sidA, "node-3");
        expect(firstA.code).toBe(200);
        const jobA = (firstA.data as { job_id: string }).job_id;

        const secondB = await submit(tool, prisma, sidB, "node-3", { revision: 1 });
        expect(secondB.code).toBe(200);


        const replayA = await submit(tool, prisma, sidA, "node-3", { assetVisible: () => false });
        expect(replayA.code).toBe(200);
        expect((replayA.data as { job_id: string }).job_id).toBe(jobA);
        const bindingView = (replayA.data as { canvas_binding?: { is_current: boolean } }).canvas_binding;
        expect(bindingView?.is_current).toBe(false);
        const owner = await findEffectiveRecoveryOwner(prisma, BigInt(PROJECT_ID), "node-3");

        expect(owner?.binding_revision).toBe(2);
        expect(await prisma.generation_canvas_submissions.count({ where: { project_id: BigInt(PROJECT_ID) } })).toBe(2);
      });
    });
  }

  describe("video-mattings legacy client_token 形态（无 canvas_binding）", () => {
    it("素材删除后同 token 同载荷重放返回原任务（老路径同享先回读顺序）", async () => {
      const tool = TOOLS.find((t) => t.name === "抠像")!;
      const sid = submissionId(901);
      const stub = ownedSourceStub("video");
      const service = tool.make(prisma, stub) as {
        create: (userId: string, projectId: string, body: Record<string, unknown>, internal?: unknown) => Promise<CreateResult>;
      };
      const body = { source_asset_id: "88", target_node_id: "node-9", mode: "portrait", client_token: sid };
      const first = await service.create(USER_ID, PROJECT_ID, { ...body });
      expect(first.code).toBe(200);
      const jobId = (first.data as { job_id: string }).job_id;
      const jobsAfterAccept = await prisma.generation_jobs.count({ where: { project_id: BigInt(PROJECT_ID) } });

      stub.visible = false;
      const replay = await service.create(USER_ID, PROJECT_ID, { ...body });
      expect(replay.code).toBe(200);
      expect((replay.data as { job_id: string }).job_id).toBe(jobId);
      expect((replay.data as { canvas_binding?: unknown }).canvas_binding).toBeUndefined();
      expect(await prisma.generation_jobs.count({ where: { project_id: BigInt(PROJECT_ID) } })).toBe(jobsAfterAccept);
    });

    it("同 token 异载荷重放沿用既有冲突码（100302）", async () => {
      const tool = TOOLS.find((t) => t.name === "抠像")!;
      const sid = submissionId(902);
      const service = tool.make(prisma, ownedSourceStub("video")) as {
        create: (userId: string, projectId: string, body: Record<string, unknown>, internal?: unknown) => Promise<CreateResult>;
      };
      const first = await service.create(USER_ID, PROJECT_ID, {
        source_asset_id: "88", target_node_id: "node-9", mode: "portrait", client_token: sid,
      });
      expect(first.code).toBe(200);
      const conflict = await service.create(USER_ID, PROJECT_ID, {
        source_asset_id: "88", target_node_id: "node-9", mode: "greenscreen", client_token: sid,
      });
      expect(conflict.code).toBe(100302);
    });
  });

  describe("跨项目隔离", () => {
    it("他项目的同键幂等行不可见：跨项目重放不回原任务，按新意图正常受理", async () => {
      const tool = TOOLS[0]!;
      const sid = submissionId(951);
      const service = tool.make(prisma, ownedSourceStub("image")) as {
        create: (userId: string, projectId: string, body: Record<string, unknown>, internal?: unknown, key?: string) => Promise<CreateResult>;
      };
      const body = tool.body(sid);
      const first = await service.create(USER_ID, PROJECT_ID, { ...body, canvas_binding: bindingOf(sid, "node-x", 0) }, {}, sid);
      expect(first.code).toBe(200);
      const jobId = (first.data as { job_id: string }).job_id;


      const other = await service.create(USER_ID, OTHER_PROJECT_ID, { ...body, canvas_binding: bindingOf(sid, "node-x", 0) }, {}, sid);
      expect(other.code).toBe(200);
      expect((other.data as { job_id: string }).job_id).not.toBe(jobId);
    });
  });
});
