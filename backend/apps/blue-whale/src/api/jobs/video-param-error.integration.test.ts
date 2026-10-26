import "reflect-metadata";
import { Module } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CanvasService } from "@lib/shared/canvas/canvas.service.js";
import { JobsService } from "@lib/shared/jobs/jobs.service.js";
import { PrismaService } from "@lib/shared/prisma/prisma.service.js";
import { ProjectService } from "@lib/shared/project/project.service.js";
import { SnapshotService } from "@lib/shared/snapshot/snapshot.service.js";
import { ProjectsController } from "../projects/projects.controller.js";
import { JobsController } from "./jobs.controller.js";

describe.skipIf(!process.env.IKNB96_DATABASE_URL)("视频参数错误公开 HTTP 查询", () => {
  const prisma = new PrismaService();
  const projects = new ProjectService(prisma);
  const previousDatabase = process.env.DATABASE_URL;
  let app: Awaited<ReturnType<typeof NestFactory.create>>;
  let base: string;
  let projectId: string;
  let jobId: string;
  const message = "视频模式、比例或时长不符合要求，请重新编辑并确认视频模式、比例和时长后再提交";

  beforeAll(async () => {
    const url = process.env.IKNB96_DATABASE_URL!;
    const target = new URL(url);
    if (!["127.0.0.1", "localhost"].includes(target.hostname) || target.pathname !== "/iknb96_query_test") {
      throw new Error("要求本地独立 IKNB96 测试库");
    }
    process.env.DATABASE_URL = url;
    projectId = (await projects.create("9096", "视频参数错误验收")).id;
    const job = await prisma.client.generation_jobs.create({ data: {
      project_id: BigInt(projectId), user_id: 9096n, type: "video", status: "failed",
      error: {
        code: "task_type_param_constraint",
        message: "InvalidParameter.TaskTypeConstraint account=internal-account token=sk-private-token",
      },
    } });
    jobId = job.id.toString();
    Reflect.defineMetadata("design:paramtypes", [JobsService], JobsController);
    Reflect.defineMetadata("design:paramtypes", [ProjectService, CanvasService, SnapshotService, PrismaService], ProjectsController);
    class HarnessModule {}
    Module({
      controllers: [JobsController, ProjectsController],
      providers: [
        { provide: JobsService, useValue: new JobsService(prisma, projects) },
        { provide: ProjectService, useValue: projects },
        { provide: CanvasService, useValue: new CanvasService(prisma, projects) },
        { provide: SnapshotService, useValue: new SnapshotService(prisma) },
        { provide: PrismaService, useValue: prisma },
      ],
    })(HarnessModule);
    app = await NestFactory.create(HarnessModule, { logger: false });
    app.use((req: { user: unknown }, _res: unknown, next: () => void) => {
      req.user = { userId: "9096" };
      next();
    });
    app.setGlobalPrefix("api");
    await app.listen(0, "127.0.0.1");
    base = await app.getUrl();
  });

  afterAll(async () => {
    await app?.close();
    await prisma.client.$disconnect();
    if (previousDatabase === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousDatabase;
  });

  it("详情、列表和重新加载项目快照返回相同参数修正提示，不泄露内部原文", async () => {
    const detail = await (await fetch(`${base}/api/jobs/${jobId}`)).json();
    expect(detail).toMatchObject({
      code: 1060, msg: message,
      data: { code: "task_type_param_constraint", job_id: jobId, status: "failed" },
    });
    const list = await (await fetch(`${base}/api/jobs?ids=${jobId}`)).json();
    expect(list).toMatchObject({ data: { records: [{
      job_id: jobId, error: { code: 1060, reason: "task_type_param_constraint", message },
    }] } });
    for (let reload = 0; reload < 2; reload += 1) {
      const snapshot = await (await fetch(`${base}/api/projects/${projectId}/snapshot`)).json();
      expect(snapshot).toMatchObject({ code: 200, data: { generation_jobs: [{
        job_id: jobId, status: "failed",
        error: { code: 1060, reason: "task_type_param_constraint", message },
      }] } });
      expect(JSON.stringify(snapshot)).not.toMatch(/internal-account|sk-private-token|InvalidParameter/);
    }
    expect(JSON.stringify([detail, list])).not.toMatch(/internal-account|sk-private-token|InvalidParameter/);
  });
});
