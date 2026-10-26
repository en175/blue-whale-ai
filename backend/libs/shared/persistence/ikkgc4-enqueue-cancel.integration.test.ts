import { readFileSync } from "node:fs";
import { PrismaMariaDb } from "@prisma/adapter-mariadb";
import type { Pool } from "mariadb";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { buildPoolConfig, getPrismaClient } from "./db.js";
import { createGenerationCommandRepo } from "./generation-command-repo.js";

const databaseUrl = process.env.IKKGC4_DATABASE_URL;
const mapperSource = readFileSync(new URL(
  "../../../../server/blue-whale-worker/src/main/java/com/bluewhale/worker/infrastructure/persistence/mapper/GenerationJobMapper.java",
  import.meta.url,
), "utf8");
const cancelScanSql = mapperSource.match(
  /@Select\("""([\s\S]*?)"""\)\s*List<GenerationJobEntity> listCancelPendingJobs/,
)?.[1].split('@Select("""').at(-1)?.replace("#{limit}", "100");

describe.skipIf(!databaseUrl)("IKKGC4 入队失败与顺延后取消真库回归", () => {
  let prisma: PrismaClient;
  let raw: Pool;
  let repo: ReturnType<typeof createGenerationCommandRepo>;

  beforeAll(async () => {
    const url = new URL(databaseUrl!);
    if (url.hostname !== "127.0.0.1" || url.pathname !== "/bw_gate_ikkgc4") {
      throw new Error("仅允许本地 IKKGC4 隔离数据库");
    }
    prisma = getPrismaClient(databaseUrl!);
    const adapter = await new PrismaMariaDb(buildPoolConfig(databaseUrl!)).connect();
    raw = adapter.underlyingDriver();
    repo = createGenerationCommandRepo(prisma);
  });

  beforeEach(async () => {
    await prisma.generation_outbox.deleteMany({});
    await prisma.generation_job_logs.deleteMany({});
    await prisma.generation_jobs.deleteMany({});
  });

  afterAll(async () => {
    await raw?.end();
    await prisma?.$disconnect();
  });

  async function job(status = "queued", nextActionAt: Date | null = new Date()) {
    return prisma.generation_jobs.create({ data: {
      user_id: 68n,
      project_id: 434n,
      type: "video",
      source: "bottom_dock",
      status,
      next_action_at: nextActionAt,
      execution_deadline_at: new Date(Date.now() + 24 * 60 * 60 * 1000),
    } });
  }

  it.each([new Date(Date.now() + 60 * 60 * 1000), null])(
    "已顺延或无调度时间的 queued 任务取消后进入下一次 Worker 取消扫描（%s）",
    async (nextActionAt) => {
      const row = await job("queued", nextActionAt);
      expect(await repo.requestCancel(String(row.id), "68")).toBe("cancelled");
      expect(cancelScanSql).toBeDefined();
      const connection = await raw.getConnection();
      try {
        await connection.query("SET time_zone = '+08:00'");
        await connection.query("SET timestamp = UNIX_TIMESTAMP() + 2");
        const selected = await connection.query<Array<{ id: bigint }>>(cancelScanSql!);
        expect(selected.map((item) => String(item.id))).toContain(String(row.id));
      } finally {
        await connection.query("SET timestamp = 0");
        connection.release();
      }
      expect((await prisma.generation_jobs.findUniqueOrThrow({ where: { id: row.id } })).status)
        .toBe("queued");
    },
  );

  it("入队失败持久化待重发退款事件，重复失败仅产生一条", async () => {
    const row = await job();
    const results = await Promise.all(Array.from({ length: 6 }, () =>
      repo.markFailedQueued(String(row.id), "enqueue_failed", "任务入队失败")));
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(await prisma.generation_outbox.findMany({})).toMatchObject([{
      job_id: row.id,
      user_id: 68n,
      terminal_status: "failed",
      reason: "任务入队失败",
      send_state: "pending",
      attempts: 0,
    }]);
  });

  it("Worker 已领取时入队失败处理不能覆盖状态或发起退款", async () => {
    const row = await job("processing");
    expect(await repo.markFailedQueued(String(row.id), "enqueue_failed", "任务入队失败"))
      .toBe(false);
    expect(await prisma.generation_outbox.count()).toBe(0);
    expect((await prisma.generation_jobs.findUniqueOrThrow({ where: { id: row.id } })).status)
      .toBe("processing");
  });

  it("outbox 落库失败回滚终态，保留任务恢复资格", async () => {
    const row = await job();
    await raw.query(`CREATE TRIGGER ikk_gc4_outbox_failure
      BEFORE INSERT ON generation_outbox FOR EACH ROW
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'outbox unavailable'`);
    try {
      await expect(repo.markFailedQueued(String(row.id), "enqueue_failed", "任务入队失败"))
        .rejects.toThrow();
      expect((await prisma.generation_jobs.findUniqueOrThrow({ where: { id: row.id } })).status)
        .toBe("queued");
    } finally {
      await raw.query("DROP TRIGGER ikk_gc4_outbox_failure");
    }
  });
});
