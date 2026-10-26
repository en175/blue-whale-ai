import type { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { getPrismaClient } from "./db.js";
import { createGenerationCommandRepo } from "./generation-command-repo.js";

const databaseUrl = process.env.IKM09U_DATABASE_URL;

describe.skipIf(!databaseUrl)("取消请求真库守卫（IKM09U）", () => {
  let prisma: PrismaClient;

  beforeAll(() => {
    const database = new URL(databaseUrl!).pathname.slice(1);
    if (database !== "bw_gate_ikm09u") throw new Error("IKM09U 只允许独立验收库");
    prisma = getPrismaClient(databaseUrl!);
  });

  beforeEach(async () => {
    await prisma.generation_job_logs.deleteMany({ where: { generation_job_id: 900905n } });
    await prisma.generation_jobs.deleteMany({ where: { id: 900905n } });
    await prisma.generation_jobs.create({
      data: { id: 900905n, user_id: 9009n, project_id: 99n, type: "image", source: "bottom_dock", status: "queued" },
    });
  });

  afterAll(async () => {
    if (!prisma) return;
    await prisma.generation_job_logs.deleteMany({ where: { generation_job_id: 900905n } });
    await prisma.generation_jobs.deleteMany({ where: { id: 900905n } });
    await prisma.$disconnect();
  });

  it("其他用户不能写入取消标记", async () => {
    const repo = createGenerationCommandRepo(prisma);
    expect(await repo.requestCancel("900905", "9010")).toBe("not_found");
    const job = await prisma.generation_jobs.findUniqueOrThrow({ where: { id: 900905n } });
    expect(job.cancel_requested_at).toBeNull();
    expect(job.status).toBe("queued");
    expect(await prisma.generation_job_logs.count({ where: { generation_job_id: 900905n } })).toBe(0);
  });

  it("processing 和终态拒绝用户取消，queued 才受理", async () => {
    const repo = createGenerationCommandRepo(prisma);
    for (const status of ["processing", "cancelled", "succeeded", "failed"]) {
      await prisma.generation_jobs.update({ where: { id: 900905n }, data: { status } });
      expect(await repo.requestCancel("900905", "9009")).toBe("not_cancelable");
      const job = await prisma.generation_jobs.findUniqueOrThrow({ where: { id: 900905n } });
      expect(job.cancel_requested_at).toBeNull();
      expect(job.status).toBe(status);
    }
    await prisma.generation_jobs.update({ where: { id: 900905n }, data: { status: "queued" } });
    expect(await repo.requestCancel("900905", "9009")).toBe("cancelled");
    const job = await prisma.generation_jobs.findUniqueOrThrow({ where: { id: 900905n } });
    expect(job.cancel_requested_at).toBeInstanceOf(Date);
    expect(job.status).toBe("queued");
  });
});
