import { PrismaClient } from "@prisma/client";
import { PrismaMariaDb } from "@prisma/adapter-mariadb";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildPoolConfig } from "./db.js";
import { createJobRepo } from "./job-repo.js";

const databaseUrl = process.env.IKKDAA_DATABASE_URL;

describe.skipIf(!databaseUrl)("已消耗筛选：任务类型 / 模型先落回 job_id 集合（IKKDAA）", () => {
  let adapter: Awaited<ReturnType<PrismaMariaDb["connect"]>>;
  let repo: ReturnType<typeof createJobRepo>;

  beforeAll(async () => {
    adapter = await new PrismaMariaDb(buildPoolConfig(databaseUrl!)).connect();
    repo = createJobRepo(
      new PrismaClient({ adapter: new PrismaMariaDb(buildPoolConfig(databaseUrl!)) }) as never,
    );

    await adapter.executeRaw({
      sql: "DROP TABLE IF EXISTS generation_jobs",
      args: [],
      argTypes: [],
    });
    await adapter.executeRaw({
      sql: `CREATE TABLE generation_jobs (
              id BIGINT NOT NULL,
              user_id BIGINT NOT NULL,
              type VARCHAR(32) NOT NULL,
              gmt_create DATETIME(0) NOT NULL,
              input JSON NULL,
              PRIMARY KEY (id)
            ) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
      args: [],
      argTypes: [],
    });
  });

  afterAll(async () => {
    if (!adapter) return;
    await adapter.executeRaw({
      sql: "DROP TABLE IF EXISTS generation_jobs",
      args: [],
      argTypes: [],
    });
    await adapter.dispose();
  });

  async function seedJob(
    id: number,
    userId: number,
    type: string,
    modelId: string | null,
    hoursAgo: number,
  ): Promise<string> {
    await adapter.executeRaw({
      sql: `INSERT INTO generation_jobs (id, user_id, type, gmt_create, input)
            VALUES (?, ?, ?, NOW() - INTERVAL ? HOUR, CAST(? AS JSON))`,
      args: [id, userId, type, hoursAgo, modelId === null ? null : JSON.stringify({ model_id: modelId })],
      argTypes: [
        { scalarType: "int64", dbType: "BIGINT", arity: "scalar" },
        { scalarType: "int64", dbType: "BIGINT", arity: "scalar" },
        { scalarType: "string", dbType: "VARCHAR", arity: "scalar" },
        { scalarType: "int32", dbType: "INT", arity: "scalar" },
        { scalarType: "json", dbType: "JSON", arity: "scalar" },
      ],
    });
    return String(id);
  }

  it("★ 模型筛选走 input.model_id 的 JSON 路径，取不到模型的那行照样在不带筛选时出现", async () => {
    await seedJob(1, 7001, "text2video", "alpha-1", 1);
    await seedJob(2, 7001, "image", "alpha-1", 2);
    await seedJob(3, 7001, "text2video", "beta-1", 3);
    await seedJob(4, 7001, "text2video", null, 4);
    await seedJob(5, 7002, "text2video", "alpha-1", 1);

    expect(await repo.listUserJobIds({ userId: "7001", limit: 50 })).toEqual({
      ids: ["1", "2", "3", "4"],
      truncated: false,
    });

    expect(await repo.listUserJobIds({ userId: "7001", modelId: "alpha-1", limit: 50 })).toEqual({
      ids: ["1", "2"],
      truncated: false,
    });

    expect(await repo.listUserJobIds({ userId: "7001", type: "image", limit: 50 })).toEqual({
      ids: ["2"],
      truncated: false,
    });

    expect(
      await repo.listUserJobIds({ userId: "7001", modelId: "beta-1", type: "image", limit: 50 }),
    ).toEqual({ ids: [], truncated: false });

    expect(await repo.listUserJobIds({ userId: "7001", modelId: "beta-1", limit: 50 })).toEqual({
      ids: ["3"],
      truncated: false,
    });
  });

  it("别人名下的任务不串进筛选结果", async () => {
    await seedJob(11, 7011, "text2video", "gamma-1", 1);
    await seedJob(12, 7012, "text2video", "gamma-1", 1);

    expect(await repo.listUserJobIds({ userId: "7011", modelId: "gamma-1", limit: 50 })).toEqual({
      ids: ["11"],
      truncated: false,
    });
  });

  it("时间窗口按 gmt_create 收窄", async () => {
    await seedJob(21, 7021, "text2video", "delta-1", 4);
    await seedJob(22, 7021, "text2video", "delta-1", 2);
    await seedJob(23, 7021, "text2video", "delta-1", 1);

    expect(
      await repo.listUserJobIds({
        userId: "7021",
        createdFrom: new Date(Date.now() - 90 * 60 * 1000),
        limit: 50,
      }),
    ).toEqual({ ids: ["23"], truncated: false });

    expect(
      await repo.listUserJobIds({
        userId: "7021",
        createdTo: new Date(Date.now() - 3 * 60 * 60 * 1000),
        limit: 50,
      }),
    ).toEqual({ ids: ["21"], truncated: false });

    expect(
      await repo.listUserJobIds({
        userId: "7021",
        createdFrom: new Date(Date.now() - 3 * 60 * 60 * 1000),
        createdTo: new Date(Date.now() - 90 * 60 * 1000),
        limit: 50,
      }),
    ).toEqual({ ids: ["22"], truncated: false });
  });

  it("★ 上限边界：恰好等于 limit 不算截断，多一条才算", async () => {
    await seedJob(31, 7031, "text2video", "epsilon-1", 3);
    await seedJob(32, 7031, "text2video", "epsilon-1", 2);
    await seedJob(33, 7031, "text2video", "epsilon-1", 1);

    expect(await repo.listUserJobIds({ userId: "7031", limit: 3 })).toEqual({
      ids: ["33", "32", "31"],
      truncated: false,
    });

    expect(await repo.listUserJobIds({ userId: "7031", limit: 2 })).toEqual({
      ids: ["33", "32"],
      truncated: true,
    });
  });
});
