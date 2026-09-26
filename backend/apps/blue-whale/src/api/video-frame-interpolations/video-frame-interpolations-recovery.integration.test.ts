// IKHSFE【后端】PR !820 整改：插帧任务与目标卡关联的持久化恢复——服务级集成测试
// （真实隔离 MySQL，IKHSFE_DATABASE_URL 门控；先例：canvases/generation-retry.integration.test.ts
// 的真 NestFactory + 生产控制器模式）。
// 覆盖验收 4 的四个场景：受理后断开客户端（不读创建响应直接重查）、重新查询、多个历史任务
// （最新者为当前关联、旧任务翻终态不覆盖）、越权访问（他人项目 / 他人同节点任务不可见）；
// 另覆盖验收 2 的入队失败兜底任务可查回与凭证不外泄。
// 服务端可观测结果 = HTTP 响应 + 隔离库 generation_jobs 行（不止 mock 断言）：唯一的桩是
// RocketMQ 投递边界（vi.mock generation-queue，controller 单测同款边界），DB 与业务链路全真实。
import "reflect-metadata";
import { Module } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { json } from "express";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { VideoFrameInterpolationsController } from "./video-frame-interpolations.controller.js";
import { AssetService } from "@lib/shared/assets/assets.service.js";
import { PrismaService } from "@lib/shared/prisma/prisma.service.js";
import { ProjectService } from "@lib/shared/project/project.service.js";
import { VideoFrameInterpolationsService } from "@lib/shared/video-frame-interpolations/video-frame-interpolations.service.js";

vi.mock("@lib/shared/generation/generation-queue.js", () => ({
  enqueueVideoFrameInterpolationJob: vi.fn(),
}));
vi.mock("@lib/infra/logging/blue-whale-logger.js", () => ({
  logger: { error: vi.fn() },
}));

const { enqueueVideoFrameInterpolationJob } = await import(
  "@lib/shared/generation/generation-queue.js"
);

const OWNER = "987654";
const STRANGER = "987655"; // 越权用户（同实例另一 New API 用户）

describe.skipIf(!process.env.IKHSFE_DATABASE_URL)(
  "Video frame interpolation recovery (IKHSFE)",
  () => {
    const prisma = new PrismaService();
    const projects = new ProjectService(prisma);
    let app: Awaited<ReturnType<typeof NestFactory.create>>;
    let base = "";
    const previousDatabase = process.env.DATABASE_URL;

    beforeAll(async () => {
      process.env.DATABASE_URL = process.env.IKHSFE_DATABASE_URL;
      vi.mocked(enqueueVideoFrameInterpolationJob).mockResolvedValue(undefined);
      const assets = new AssetService(prisma, {} as never); // storage 仅上传链路使用，本测试不触达
      Reflect.defineMetadata(
        "design:paramtypes",
        [PrismaService, ProjectService, AssetService],
        VideoFrameInterpolationsService,
      );
      Reflect.defineMetadata(
        "design:paramtypes",
        [VideoFrameInterpolationsService],
        VideoFrameInterpolationsController,
      );
      class HarnessModule {}
      Module({
        controllers: [VideoFrameInterpolationsController],
        providers: [
          { provide: PrismaService, useValue: prisma },
          { provide: ProjectService, useValue: projects },
          { provide: AssetService, useValue: assets },
          { provide: VideoFrameInterpolationsService, useValue: new VideoFrameInterpolationsService(prisma, projects, assets) },
        ],
      })(HarnessModule);
      app = await NestFactory.create(HarnessModule, { logger: false, bodyParser: false });
      app.use(json({ limit: "16mb" }));
      app.setGlobalPrefix("api");
      // 按 x-test-user 切换身份（默认项目主人），越权用例用 STRANGER 走同一真实链路。
      app.use((req: { user: unknown; headers: Record<string, string | string[] | undefined> }, _res: unknown, next: () => void) => {
        const header = req.headers["x-test-user"];
        const userId = Array.isArray(header) ? header[0] : header;
        req.user = { userId: userId ?? OWNER };
        next();
      });
      await app.listen(0, "127.0.0.1");
      base = await app.getUrl();
    }, 30_000);

    afterAll(async () => {
      await app?.close();
      if (previousDatabase === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = previousDatabase;
      await prisma.client.$disconnect();
    });

    async function createVideoAsset(projectId: string) {
      const row = await prisma.client.assets.create({
        data: {
          user_id: BigInt(OWNER),
          project_id: BigInt(projectId),
          type: "video",
          url: "https://example.com/ikhsfe-src.mp4",
          width: 1920,
          height: 1080,
          size: BigInt(2048),
        },
      });
      return row.id.toString();
    }

    /** 创建插帧任务（真实 HTTP POST）；headers 可带 Authorization（凭证冻结用例）与身份切换。 */
    async function createInterpolation(
      projectId: string,
      targetNodeId: string,
      options: { authorization?: string; userId?: string } = {},
    ) {
      const response = await fetch(`${base}/api/projects/${projectId}/video-frame-interpolations`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(options.authorization ? { authorization: options.authorization } : {}),
          ...(options.userId ? { "x-test-user": options.userId } : {}),
        },
        body: JSON.stringify({
          source_asset_id: await createVideoAsset(projectId),
          target_node_id: targetNodeId,
          fps: 60,
        }),
      });
      return response.json();
    }

    /** 恢复查询（真实 HTTP GET current）。 */
    async function queryCurrent(
      projectId: string,
      targetNodeId: string,
      options: { userId?: string } = {},
    ) {
      const response = await fetch(
        `${base}/api/projects/${projectId}/video-frame-interpolations/current?target_node_id=${encodeURIComponent(targetNodeId)}`,
        { headers: options.userId ? { "x-test-user": options.userId } : {} },
      );
      return { status: response.status, body: await response.json() };
    }

    async function readJob(jobId: string) {
      const row = await prisma.client.generation_jobs.findUnique({ where: { id: BigInt(jobId) } });
      return row ? { ...row, input: row.input as Record<string, unknown> } : null;
    }

    it("受理后断开客户端：不读创建响应，仅凭项目 + 目标节点即可查回刚受理的任务（权威关联在服务端）", async () => {
      const projectId = (await projects.create(OWNER, "IKHSFE 断链恢复")).id.toString();
      // 模拟浏览器没拿到创建响应：POST 完成但不从响应取任何字段。
      await createInterpolation(projectId, "node-recover");
      const serverRow = await prisma.client.generation_jobs.findFirstOrThrow({
        where: { project_id: BigInt(projectId), type: "video_frame_interpolation" },
        orderBy: { id: "desc" },
      });

      const { body } = await queryCurrent(projectId, "node-recover");
      expect(body.code).toBe(200);
      expect(body.data).toMatchObject({
        job_id: serverRow.id.toString(),
        status: "queued",
        progress: 0,
      });
      expect(typeof body.data.created_at).toBe("string");
    });

    it("多个历史任务：最新创建者为当前关联；旧任务迟到翻终态不覆盖更新关联", async () => {
      const projectId = (await projects.create(OWNER, "IKHSFE 历史任务")).id.toString();
      await createInterpolation(projectId, "node-multi"); // 第 1 条
      await createInterpolation(projectId, "node-multi"); // 第 2 条
      await createInterpolation(projectId, "node-multi"); // 第 3 条（最新）
      const rows = await prisma.client.generation_jobs.findMany({
        where: { project_id: BigInt(projectId), type: "video_frame_interpolation" },
        orderBy: { id: "asc" },
      });
      expect(rows).toHaveLength(3);

      const latest = () => queryCurrent(projectId, "node-multi").then((r) => r.body.data);
      expect((await latest()).job_id).toBe(rows[2]!.id.toString());

      // 旧任务「迟到成功」（第 1 条直改库置 succeeded）：当前关联仍是最新那条。
      await prisma.client.generation_jobs.update({
        where: { id: rows[0]!.id },
        data: { status: "succeeded" },
      });
      expect((await latest()).job_id).toBe(rows[2]!.id.toString());

      // 最新任务自己翻终态后依然可查回（状态原样投影，判定不受终态影响）。
      await prisma.client.generation_jobs.update({
        where: { id: rows[2]!.id },
        data: { status: "succeeded", progress: 100 },
      });
      expect(await latest()).toMatchObject({
        job_id: rows[2]!.id.toString(),
        status: "succeeded",
        progress: 100,
      });
    });

    it("不同卡的任务互不串联：各自查回各自的 job；无任务节点返回 data=null", async () => {
      const projectId = (await projects.create(OWNER, "IKHSFE 卡隔离")).id.toString();
      await createInterpolation(projectId, "node-a");
      await createInterpolation(projectId, "node-b");
      await createInterpolation(projectId, "node-a");

      const rows = await prisma.client.generation_jobs.findMany({
        where: { project_id: BigInt(projectId), type: "video_frame_interpolation" },
        orderBy: { id: "asc" },
      });
      const byTarget = new Map(rows.map((r) => [(r.input as Record<string, unknown>).target_node_id, r.id.toString()]));
      const a = (await queryCurrent(projectId, "node-a")).body.data;
      const b = (await queryCurrent(projectId, "node-b")).body.data;
      expect(a.job_id).toBe(byTarget.get("node-a"));
      expect(b.job_id).toBe(byTarget.get("node-b"));
      expect(a.job_id).not.toBe(b.job_id);

      const none = (await queryCurrent(projectId, "node-never-created")).body;
      expect(none.code).toBe(200);
      expect(none.data).toBeNull();
    });

    it("跨项目不串联：另一项目里的同名目标节点任务不混入本项目查询", async () => {
      const projectOne = (await projects.create(OWNER, "IKHSFE 项目一")).id.toString();
      const projectTwo = (await projects.create(OWNER, "IKHSFE 项目二")).id.toString();
      await createInterpolation(projectOne, "node-same-name");
      await createInterpolation(projectTwo, "node-same-name");
      const rowsTwo = await prisma.client.generation_jobs.findMany({
        where: { project_id: BigInt(projectTwo), type: "video_frame_interpolation" },
      });
      expect(rowsTwo).toHaveLength(1);

      const one = (await queryCurrent(projectOne, "node-same-name")).body.data;
      const rowOne = await prisma.client.generation_jobs.findFirstOrThrow({
        where: { project_id: BigInt(projectOne), type: "video_frame_interpolation" },
      });
      expect(one.job_id).toBe(rowOne.id.toString());
      expect(one.job_id).not.toBe(rowsTwo[0]!.id.toString());
    });

    it("越权访问：他人项目 404 口径不泄露；他人无法用同名节点串到我的任务", async () => {
      const mine = (await projects.create(OWNER, "IKHSFE 我的项目")).id.toString();
      await createInterpolation(mine, "node-private");
      const myRow = await prisma.client.generation_jobs.findFirstOrThrow({
        where: { project_id: BigInt(mine), type: "video_frame_interpolation" },
      });

      // 陌生人查我的项目：资源不存在口径（HTTP 200 信封 code=100301，与家族 404 口径一致）。
      const stranger = await queryCurrent(mine, "node-private", { userId: STRANGER });
      expect(stranger.body.code).not.toBe(200);
      expect(stranger.body.code).toBe(100301);
      expect(stranger.body.data).toBeNull();

      // 陌生人自己的项目里同节点名：查不到我的任务（user_id 过滤）。
      const strangerProject = (await projects.create(STRANGER, "IKHSFE 陌生人项目")).id.toString();
      const strangerOwn = await queryCurrent(strangerProject, "node-private", { userId: STRANGER });
      expect(strangerOwn.body.code).toBe(200);
      expect(strangerOwn.body.data).toBeNull();

      // 我的任务不受上述探测影响，仍可查回。
      const still = (await queryCurrent(mine, "node-private")).body.data;
      expect(still.job_id).toBe(myRow.id.toString());
    });

    it("入队失败也能查到失败任务：enqueue 拒绝 → job 落库 failed → 恢复查询原样呈现", async () => {
      vi.mocked(enqueueVideoFrameInterpolationJob).mockRejectedValueOnce(new Error("rocketmq down"));
      const projectId = (await projects.create(OWNER, "IKHSFE 入队失败")).id.toString();
      const created = await createInterpolation(projectId, "node-enqueue-failed");
      expect(created.code).toBe(200); // 入队失败仍返回 200（家族口径：job 已持久化）
      const jobId = created.data.job_id as string;

      // 等兜底 markFailed 落库（服务端可观测：DB 行终态 + stored_error 码）。
      await vi.waitFor(async () => {
        const row = await readJob(jobId);
        expect(row?.status).toBe("failed");
        expect((row?.error as Record<string, unknown>)?.code).toBe("enqueue_failed");
      });

      const { body } = await queryCurrent(projectId, "node-enqueue-failed");
      expect(body.code).toBe(200);
      expect(body.data).toMatchObject({ job_id: jobId, status: "failed" });
    });

    it("凭证不外泄：sk- 冻结进 job input（服务端可观测），恢复查询响应全文不含凭证", async () => {
      const projectId = (await projects.create(OWNER, "IKHSFE 凭证")).id.toString();
      const created = await createInterpolation(projectId, "node-credential", {
        authorization: "Bearer sk-ikhsfe-live-token",
      });
      const row = await readJob(created.data.job_id as string);
      expect(row?.input.provider_credential).toBe("sk-ikhsfe-live-token"); // 冻结在服务端

      const { body } = await queryCurrent(projectId, "node-credential");
      expect(body.code).toBe(200);
      expect(JSON.stringify(body)).not.toContain("provider_credential");
      expect(JSON.stringify(body)).not.toContain("sk-ikhsfe-live-token");
    });
  },
  60_000,
);
