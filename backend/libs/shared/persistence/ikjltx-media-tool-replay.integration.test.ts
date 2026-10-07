// IKJLTX（PR981 二轮审查 R5 / IKIXK9-SPEC-20261002 B.3）：媒体工具「原意图幂等回读先于
// 素材等可变状态」的真 MySQL 验证——公开服务入口 + 真实数据库（素材与权限查询为受控替身，
// 幂等/任务/关联/成本行全部走真实库）。
//
// 与 ikjjqw-media-tool-recovery.integration.test.ts 同款门控：需要本地 MySQL（本票用 3309，
// 勿动 QU 的 3307 / QW 的 3308）：
//   # 容器与建库（一次）：
//   docker run -d --name ikjltx-mysql -e MYSQL_ROOT_PASSWORD=ikjltx \
//     -e MYSQL_DATABASE=bw_gate_ikjltx -p 3309:3306 mysql:8
//   cd backend && DATABASE_URL='mysql://root:ikjltx@127.0.0.1:3309/bw_gate_ikjltx' \
//     npx prisma db push --accept-data-loss
//   # 跑测试：
//   IKJLTX_DATABASE_URL='mysql://root:ikjltx@127.0.0.1:3309/bw_gate_ikjltx' \
//     pnpm exec vitest run backend/libs/shared/persistence/ikjltx-media-tool-replay.integration.test.ts
// 未配置该变量时整组跳过；跳过不算通过。
//
// 验收场景（AC2/AC3，11 个走共享受理段的入口表驱动）：
//   1. 素材删除后同载荷重放：返回原任务与原关联，零新增任务、零重复副作用（无预扣口径：
//      cost_reservations 恒零行——本票 11 个入口全部免费口径；有预扣入口 audio-mixes /
//      audio-video-muxes / vocal-splits / video-scene-splits 不走共享段，不在本票范围）。
//   2. 同键异载荷重放：幂等冲突（100409），零写入。
//   3. 重放不把旧关联设为当前：节点被新意图接管后重放旧意图，原任务返回、当前关联不变。
// 另含 video-mattings legacy client_token 形态与跨项目隔离的真实库面。
import { PrismaMariaDb } from "@prisma/adapter-mariadb";
import type { Pool } from "mariadb";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
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

const databaseUrl = process.env.IKJLTX_DATABASE_URL;

const PROJECT_ID = "930001";
const OTHER_PROJECT_ID = "930002";
const USER_ID = "930009";

/** 各工具最小合规资产形状（service 层校验用；权限校验由 stub 恒返回通过）。 */
function assetOf(kind: "image" | "video" | "audio") {
  const base = { url: "https://tos.example.com/uploads/9/x/a.bin", storage_key: null, mime: null, size: 1_000_000n, width: null, height: null, duration_ms: null };
  if (kind === "image") return { ...base, type: "image", url: "https://tos.example.com/uploads/9/x/a.png", mime: "image/png", width: 1080, height: 1920 };
  if (kind === "video") return { ...base, type: "video", url: "https://tos.example.com/uploads/9/x/a.mp4", mime: "video/mp4", width: 1080, height: 1920, duration_ms: 60_000 };
  return { ...base, type: "audio", url: "https://tos.example.com/uploads/9/x/a.mp3", mime: "audio/mp3", duration_ms: 60_000 };
}

/** 11 个单结果媒体工具的受理形态（与 ikjjqw 集成测试同源清单；make 收素材替身，
 *  用例内可切换「素材在/素材已删除」）。 */
const TOOLS = [
  { name: "擦除", op: "image_erase.create", kind: "image" as const,
    make: (c: unknown, assets: unknown) => new ImageErasuresService({ client: c } as never, { findOwnedById: async () => ({ id: 1n }) } as never, assets as never),
    body: () => ({ source_asset_id: "88", target_node_id: "node-1", erase_scene: "full_screen_text_erase" }) },
  { name: "去字幕", op: "video_subtitle_erase.create", kind: "video" as const,
    make: (c: unknown, assets: unknown) => new VideoSubtitleErasuresService({ client: c } as never, { findOwnedById: async () => ({ id: 1n }) } as never, assets as never),
    body: () => ({ source_asset_id: "88", target_node_id: "node-1", detect_mode: "subtitle_smart", erase_boxes: [] }) },
  { name: "音视频分离", op: "media_extract.create", kind: "video" as const,
    make: (c: unknown, assets: unknown) => new MediaExtractionsService({ client: c } as never, { findOwnedById: async () => ({ id: 1n }) } as never, assets as never),
    body: () => ({ source_asset_id: "88" }) },
  { name: "截取", op: "audio_trim.create", kind: "audio" as const,
    make: (c: unknown, assets: unknown) => new AudioTrimsService({ client: c } as never, { findOwnedById: async () => ({ id: 1n }) } as never, assets as never),
    body: () => ({ source_asset_id: "88", start_time: 1, end_time: 2 }) },
  { name: "调速", op: "audio_speed.create", kind: "audio" as const,
    make: (c: unknown, assets: unknown) => new AudioSpeedsService({ client: c } as never, { findOwnedById: async () => ({ id: 1n }) } as never, assets as never),
    body: () => ({ source_asset_id: "88", speed: 1.5 }) },
  { name: "抠像", op: "video_matting.create", kind: "video" as const,
    make: (c: unknown, assets: unknown) => new VideoMattingsService({ client: c } as never, { findOwnedById: async () => ({ id: 1n }) } as never, assets as never),
    // 抠像的幂等承载是 client_token（= submission_id），不是 Idempotency-Key 头。
    body: (submissionId: string) => ({ source_asset_id: "88", target_node_id: "node-1", mode: "portrait", client_token: submissionId }) },
  { name: "抠图", op: "image_cutout.create", kind: "image" as const,
    make: (c: unknown, assets: unknown) => new ImageCutoutsService({ client: c } as never, { findOwnedById: async () => ({ id: 1n }) } as never, assets as never),
    body: () => ({ source_asset_id: "88", target_node_id: "node-1", cutout_scene: "general" }) },
  { name: "扩图", op: "image_outpaint.create", kind: "image" as const,
    make: (c: unknown, assets: unknown) => new ImageOutpaintsService({ client: c } as never, { findOwnedById: async () => ({ id: 1n }) } as never, assets as never, { uploads: null } as unknown as AssetStorageService),
    body: () => ({ source_asset_id: "88", target_node_id: "node-1", expand_top: 0.1, expand_bottom: 0, expand_left: 0, expand_right: 0 }) },
  { name: "图像高清", op: "image_enhance.create", kind: "image" as const,
    make: (c: unknown, assets: unknown) => new ImageEnhancementsService({ client: c } as never, { findOwnedById: async () => ({ id: 1n }) } as never, assets as never),
    body: () => ({ source_asset_id: "88", target_node_id: "node-1", version_tier: "pro", multiple: 2, generative_enhance_mode: "generative_first", enable_correct_color: false }) },
  { name: "视频 HD", op: "video_enhance.create", kind: "video" as const,
    make: (c: unknown, assets: unknown) => new VideoEnhancementsService({ client: c } as never, { findOwnedById: async () => ({ id: 1n }) } as never, assets as never),
    body: () => ({ source_asset_id: "88", target_node_id: "node-1", resolution: "1080p" }) },
  { name: "插帧", op: "video_frame_interpolation.create", kind: "video" as const,
    make: (c: unknown, assets: unknown) => new VideoFrameInterpolationsService({ client: c } as never, { findOwnedById: async () => ({ id: 1n }) } as never, assets as never),
    body: () => ({ source_asset_id: "88", target_node_id: "node-1" }) },
] as const;

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

/** 受控素材替身：受理时素材在（返回合规资产），置 visible=false 后模拟素材已删除。 */
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

/** 各工具 service 的受理调用（video-mattings 无头、其余走 Idempotency-Key 头）。 */
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
      await prisma.generation_canvas_node_owners.deleteMany({ where: { project_id: BigInt(pid) } });
      await prisma.generation_canvas_submissions.deleteMany({ where: { project_id: BigInt(pid) } });
      await prisma.command_idempotency.deleteMany({ where: { project_id: BigInt(pid) } });
      await prisma.canvas.deleteMany({ where: { project_id: BigInt(pid) } });
      await prisma.generation_output_slots.deleteMany({ where: { project_id: BigInt(pid) } });
      await prisma.generation_jobs.deleteMany({ where: { project_id: BigInt(pid) } });
    }
    await prisma.generation_canvas_outputs.deleteMany({});
    await prisma.generation_job_logs.deleteMany({});
    await prisma.cost_reservations.deleteMany({});
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
        const idemAfterAccept = await prisma.command_idempotency.count({ where: { project_id: BigInt(PROJECT_ID) } });

        // 素材删除（替身切换）后同载荷同 submission_id 重放：修复前此处被 100301 拒绝。
        stub.visible = false;
        const replay = await call();
        expect(replay.code).toBe(200);
        expect((replay.data as { job_id: string }).job_id).toBe(jobId);
        expect((replay.data as { canvas_binding?: { submission_id: string; is_current: boolean } }).canvas_binding).toMatchObject({
          submission_id: sid,
          job_id: jobId,
          is_current: true,
        });
        // 零新增任务、零重复副作用（关联/幂等行不增），无预扣口径成本预留恒零。
        expect(await prisma.generation_jobs.count({ where: { project_id: BigInt(PROJECT_ID) } })).toBe(jobsAfterAccept);
        expect(await prisma.generation_canvas_submissions.count({ where: { project_id: BigInt(PROJECT_ID) } })).toBe(subsAfterAccept);
        expect(await prisma.command_idempotency.count({ where: { project_id: BigInt(PROJECT_ID) } })).toBe(idemAfterAccept);
        expect(await prisma.cost_reservations.count({})).toBe(0);
      });

      it("★ 2. 同键异载荷重放判幂等冲突（100409），零写入", async () => {
        const sid = submissionId(301 + TOOLS.indexOf(tool));
        const first = await submit(tool, prisma, sid, "node-2");
        expect(first.code).toBe(200);
        const jobsAfterAccept = await prisma.generation_jobs.count({ where: { project_id: BigInt(PROJECT_ID) } });

        // 同 submission_id 换载荷：擦除换遮罩场景没有通用差异键，统一以 target_node_id 漂移
        // 之外的载荷差异表达——改 cutout/分辨率等键太工具特定，这里换 canvas_binding 内容
        // （expected_binding_revision 参与 requestHash，载荷摘要必变）。
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
        // 新意图 B 接管 node-3（binding revision 0→1 后，B 以 revision 1 受理）。
        const secondB = await submit(tool, prisma, sidB, "node-3", { revision: 1 });
        expect(secondB.code).toBe(200);

        // 素材删除后重放 A：返回原任务 A，但其关联已非当前（B 仍持有当前关联）。
        const replayA = await submit(tool, prisma, sidA, "node-3", { assetVisible: () => false });
        expect(replayA.code).toBe(200);
        expect((replayA.data as { job_id: string }).job_id).toBe(jobA);
        const bindingView = (replayA.data as { canvas_binding?: { is_current: boolean } }).canvas_binding;
        expect(bindingView?.is_current).toBe(false);
        const owner = await prisma.generation_canvas_node_owners.findUnique({
          where: { project_id_node_id: { project_id: BigInt(PROJECT_ID), node_id: "node-3" } },
        });
        // 当前关联仍是 B（submission_id 维度）：owner 版本未被重放推进。
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

      // 同用户在另一项目以同 submission_id 提交：幂等按 project 隔离，不回读原任务。
      const other = await service.create(USER_ID, OTHER_PROJECT_ID, { ...body, canvas_binding: bindingOf(sid, "node-x", 0) }, {}, sid);
      expect(other.code).toBe(200);
      expect((other.data as { job_id: string }).job_id).not.toBe(jobId);
    });
  });
});
