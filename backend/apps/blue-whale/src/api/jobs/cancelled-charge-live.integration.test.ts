import "reflect-metadata";
import { readFile } from "node:fs/promises";
import { Module } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaService } from "@lib/shared/prisma/prisma.service.js";
import { ProjectService } from "@lib/shared/project/project.service.js";
import { JobsService } from "@lib/shared/jobs/jobs.service.js";
import { sharedBillingClient } from "@lib/shared/billing/billing-client.js";
import { createJobRepo } from "@lib/shared/persistence/job-repo.js";
import { JobsController } from "./jobs.controller.js";

describe.skipIf(!process.env.IKM12Y_LIVE_DATABASE_URL)("Worker 取消及真实退款后的 HTTP 查询", () => {
  const prisma = new PrismaService();
  let app: Awaited<ReturnType<typeof NestFactory.create>>;
  let base: string;
  const previousDatabase = process.env.DATABASE_URL;

  beforeAll(async () => {
    const url = process.env.IKM12Y_LIVE_DATABASE_URL!;
    if (new URL(url).pathname !== "/ikm12y_e2e_worker") throw new Error("要求独立 Worker 验收库");
    if (!process.env.IKM12Y_EVENT_DIR || !process.env.BILLING_GRPC_URL) throw new Error("要求真实事件与计费服务");
    process.env.DATABASE_URL = url;
    Reflect.defineMetadata("design:paramtypes", [JobsService], JobsController);
    class HarnessModule {}
    Module({ controllers: [JobsController], providers: [
      { provide: JobsService, useValue: new JobsService(prisma, new ProjectService(prisma)) },
    ] })(HarnessModule);
    app = await NestFactory.create(HarnessModule, { logger: false });
    app.use((req: { user: unknown; headers: Record<string, string> }, _res: unknown, next: () => void) => {
      req.user = { userId: req.headers["x-test-user"] };
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

  it.each(["sample", "final"])("%s 同一真实任务、事件、账本与查询一致", async (stage) => {
    const receipt = JSON.parse(await readFile(`${process.env.IKM12Y_EVENT_DIR}/event-${stage}.json`, "utf8"));
    const id = String(receipt.jobId);
    const user = String(receipt.userId);
    expect(receipt).toMatchObject({ status: "cancelled", sendState: "sent", attempts: 1 });
    expect(JSON.parse(receipt.payload)).toMatchObject({ jobId: receipt.jobId, userId: receipt.userId, refund: true });
    const stored = await createJobRepo(prisma.client).findByIdForUser(id, user);
    expect(stored).toMatchObject({ job_id: id, status: "cancelled", video_stage: stage, charge_state: "charged" });
    const billing = sharedBillingClient();
    expect(await billing.listTransactions({ userId: Number(user), generationJobIds: [id] }))
      .toMatchObject({ items: [{ generationJobId: id, chargeState: "refunded", credits: 0 }] });
    expect(await billing.queryBalance(Number(user))).toMatchObject({ availableCredits: 100 });
    const headers = { "x-test-user": user };
    expect(await (await fetch(`${base}/api/jobs/${id}`, { headers })).json())
      .toMatchObject({ code: 200, data: { job_id: id, status: "cancelled", video_stage: stage, charge_state: "refunded" } });
    expect(await (await fetch(`${base}/api/jobs?ids=${id}`, { headers })).json())
      .toMatchObject({ data: { records: [{ job_id: id, status: "cancelled", charge_state: "refunded" }] } });
    expect(await prisma.client.generation_outbox.findUnique({ where: { id: BigInt(receipt.outboxId) } }))
      .toMatchObject({ job_id: BigInt(id), terminal_status: "cancelled", send_state: "sent" });
  });
});
