import "reflect-metadata";
import { Module } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PrismaService } from "@lib/shared/prisma/prisma.service.js";
import { ProjectService } from "@lib/shared/project/project.service.js";
import { JobsService } from "@lib/shared/jobs/jobs.service.js";
import { JobsController } from "./jobs.controller.js";

const { transactions } = vi.hoisted(() => ({ transactions: vi.fn() }));
vi.mock("@lib/shared/billing/billing-client.js", async (original) => ({
  ...await original<typeof import("@lib/shared/billing/billing-client.js")>(),
  sharedBillingClient: () => ({ listTransactions: transactions }),
}));

describe.skipIf(!process.env.IKM12Y_DATABASE_URL)("取消任务计费状态 HTTP 查询", () => {
  const prisma = new PrismaService();
  const projects = new ProjectService(prisma);
  let app: Awaited<ReturnType<typeof NestFactory.create>>;
  let base: string;
  let projectId: string;
  const previousDatabase = process.env.DATABASE_URL;
  beforeEach(() => transactions.mockReset());

  beforeAll(async () => {
    const url = process.env.IKM12Y_DATABASE_URL!;
    if (new URL(url).pathname !== "/ikm12y_query_test") throw new Error("要求独立 IKM12Y 测试库");
    process.env.DATABASE_URL = url;
    projectId = (await projects.create("9012", "IKM12Y 查询验收")).id;
    Reflect.defineMetadata("design:paramtypes", [JobsService], JobsController);
    class HarnessModule {}
    Module({
      controllers: [JobsController],
      providers: [{ provide: JobsService, useValue: new JobsService(prisma, projects) }],
    })(HarnessModule);
    app = await NestFactory.create(HarnessModule, { logger: false });
    app.use((req: { user: unknown; headers: Record<string, string> }, _res: unknown, next: () => void) => {
      req.user = { userId: req.headers["x-test-user"] ?? "9012" };
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

  async function fixture(stage: string, status = "cancelled") {
    const job = await prisma.client.generation_jobs.create({ data: {
      project_id: BigInt(projectId), user_id: 9012n, type: "video", status,
    } });
    await prisma.client.generation_job_extras.createMany({ data: [
      { generation_job_id: job.id, extra_key: "video_stage", value_type: "string", value_text: stage },
      ...(stage === "video" ? [] : [{ generation_job_id: job.id, extra_key: "charge_state", value_type: "string", value_text: "charged" }]),
    ] });
    return job.id.toString();
  }

  it("样片退款已提交时详情返回 refunded，不再读取陈旧 charged", async () => {
    const id = await fixture("sample");
    transactions.mockResolvedValue({ items: [{ type: "consume", generationJobId: id, chargeState: "refunded" }], total: 1 });
    const response = await fetch(`${base}/api/jobs/${id}`);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ data: { job_id: id, status: "cancelled", charge_state: "refunded" } });
  });

  it("成片详情与批量列表都读取计费状态，退款前保持 charged", async () => {
    const id = await fixture("final");
    transactions.mockResolvedValue({ items: [{ type: "consume", generationJobId: id, chargeState: "charged" }], total: 1 });
    expect(await (await fetch(`${base}/api/jobs/${id}`)).json()).toMatchObject({ data: { charge_state: "charged" } });
    transactions.mockResolvedValue({ items: [{ type: "consume", generationJobId: id, chargeState: "refunded" }], total: 1 });
    expect(await (await fetch(`${base}/api/jobs/${id}`)).json()).toMatchObject({ data: { status: "cancelled", charge_state: "refunded" } });
    expect(await (await fetch(`${base}/api/jobs?ids=${id}`)).json()).toMatchObject({ data: { records: [{ job_id: id, charge_state: "refunded" }] } });
  });

  it.each([undefined, "", "future-state"])("缺少或未知计费状态 %s 时不使用陈旧退款标记", async (chargeState) => {
    const id = await fixture("sample");
    await prisma.client.generation_job_extras.updateMany({
      where: { generation_job_id: BigInt(id), extra_key: "charge_state" }, data: { value_text: "refunded" },
    });
    transactions.mockResolvedValue({ items: [{ type: "consume", generationJobId: id, chargeState, credits: 0, status: "done" }], total: 1 });
    expect(await (await fetch(`${base}/api/jobs/${id}`)).json()).toMatchObject({ data: { status: "cancelled", charge_state: null } });
  });

  it("计费不可用和缺少流水时返回未确认，恢复后下次查询收敛", async () => {
    const id = await fixture("sample");
    transactions.mockRejectedValueOnce(new Error("unavailable"));
    expect(await (await fetch(`${base}/api/jobs/${id}`)).json()).toMatchObject({ data: { status: "cancelled", charge_state: null } });
    transactions.mockResolvedValueOnce({ items: [], total: 0 });
    expect(await (await fetch(`${base}/api/jobs/${id}`)).json()).toMatchObject({ data: { charge_state: null } });
    transactions.mockResolvedValueOnce({ items: [{ type: "consume", generationJobId: id, chargeState: "refunded" }], total: 1 });
    expect(await (await fetch(`${base}/api/jobs/${id}`)).json()).toMatchObject({ data: { charge_state: "refunded" } });
  });

  it("普通视频保持 null，运行中的样片保持原值，不新增计费依赖", async () => {
    const ordinary = await fixture("video");
    const running = await fixture("sample", "processing");
    expect(await (await fetch(`${base}/api/jobs/${ordinary}`)).json()).toMatchObject({ data: { charge_state: null } });
    expect(await (await fetch(`${base}/api/jobs/${running}`)).json()).toMatchObject({ data: { status: "processing", charge_state: "charged" } });
    expect(transactions).not.toHaveBeenCalled();
  });

  it("异用户和失去项目归属的请求在查询计费之前拒绝", async () => {
    const id = await fixture("sample");
    const other = await (await fetch(`${base}/api/jobs/${id}`, { headers: { "x-test-user": "9013" } })).json();
    expect(other.data).toBeNull();
    expect(other.code).not.toBe(200);
    const otherProject = await projects.create("9013", "其他用户项目");
    await prisma.client.generation_jobs.update({ where: { id: BigInt(id) }, data: { project_id: BigInt(otherProject.id) } });
    const lost = await (await fetch(`${base}/api/jobs/${id}`)).json();
    expect(lost.data).toBeNull();
    expect(lost.code).not.toBe(200);
    expect(transactions).not.toHaveBeenCalled();
  });
});
