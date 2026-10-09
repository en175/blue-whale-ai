import type { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getPrismaClient } from "./db.js";
import { createJobRepo } from "./job-repo.js";

const databaseUrl = process.env.IKKDAA_DATABASE_URL;

const USER_FILTER = 7001;
const USER_OTHER = 7002;
const USER_ISOLATED = 7011;
const USER_NEIGHBOUR = 7012;
const USER_WINDOW = 7021;
const USER_LIMIT = 7031;
const TEST_USERS = [
  USER_FILTER,
  USER_OTHER,
  USER_ISOLATED,
  USER_NEIGHBOUR,
  USER_WINDOW,
  USER_LIMIT,
];

describe.skipIf(!databaseUrl)("已消耗筛选：任务类型 / 模型先落回 job_id 集合（IKKDAA）", () => {
  let prisma: PrismaClient;
  let repo: ReturnType<typeof createJobRepo>;

  beforeAll(async () => {
    prisma = getPrismaClient(databaseUrl!);
    repo = createJobRepo(prisma);
    await prisma.generation_jobs.deleteMany({
      where: { user_id: { in: TEST_USERS.map((id) => BigInt(id)) } },
    });
  });

  afterAll(async () => {
    if (!prisma) return;
    await prisma.generation_jobs.deleteMany({
      where: { user_id: { in: TEST_USERS.map((id) => BigInt(id)) } },
    });
  });

  async function seedJob(
    id: number,
    userId: number,
    type: string,
    modelId: string | null,
    hoursAgo: number,
  ): Promise<string> {
    await prisma.generation_jobs.create({
      data: {
        id: BigInt(id),
        user_id: BigInt(userId),
        type,
        gmt_create: new Date(Date.now() - hoursAgo * 60 * 60 * 1000),
        ...(modelId === null ? {} : { input: { model_id: modelId } }),
      },
    });
    return String(id);
  }

  it("★ 模型筛选走 input.model_id 的 JSON 路径，没有模型的那行只是被筛掉而不是丢掉", async () => {
    await seedJob(1, USER_FILTER, "text2video", "alpha-1", 1);
    await seedJob(2, USER_FILTER, "image", "alpha-1", 2);
    await seedJob(3, USER_FILTER, "text2video", "beta-1", 3);
    await seedJob(4, USER_FILTER, "text2video", null, 4);
    await seedJob(5, USER_OTHER, "text2video", "alpha-1", 1);

    expect(await repo.listUserJobIds({ userId: String(USER_FILTER), limit: 50 })).toEqual({
      ids: ["1", "2", "3", "4"],
      truncated: false,
    });

    expect(
      await repo.listUserJobIds({ userId: String(USER_FILTER), modelId: "alpha-1", limit: 50 }),
    ).toEqual({ ids: ["1", "2"], truncated: false });

    expect(
      await repo.listUserJobIds({ userId: String(USER_FILTER), type: "image", limit: 50 }),
    ).toEqual({ ids: ["2"], truncated: false });

    expect(
      await repo.listUserJobIds({
        userId: String(USER_FILTER),
        modelId: "beta-1",
        type: "image",
        limit: 50,
      }),
    ).toEqual({ ids: [], truncated: false });

    expect(
      await repo.listUserJobIds({ userId: String(USER_FILTER), modelId: "beta-1", limit: 50 }),
    ).toEqual({ ids: ["3"], truncated: false });
  });

  it("别人名下的任务不串进筛选结果", async () => {
    await seedJob(11, USER_ISOLATED, "text2video", "gamma-1", 1);
    await seedJob(12, USER_NEIGHBOUR, "text2video", "gamma-1", 1);

    expect(
      await repo.listUserJobIds({ userId: String(USER_ISOLATED), modelId: "gamma-1", limit: 50 }),
    ).toEqual({ ids: ["11"], truncated: false });
  });

  it("时间窗口按 gmt_create 收窄", async () => {
    await seedJob(21, USER_WINDOW, "text2video", "delta-1", 4);
    await seedJob(22, USER_WINDOW, "text2video", "delta-1", 2);
    await seedJob(23, USER_WINDOW, "text2video", "delta-1", 1);

    expect(
      await repo.listUserJobIds({
        userId: String(USER_WINDOW),
        createdFrom: new Date(Date.now() - 90 * 60 * 1000),
        limit: 50,
      }),
    ).toEqual({ ids: ["23"], truncated: false });

    expect(
      await repo.listUserJobIds({
        userId: String(USER_WINDOW),
        createdTo: new Date(Date.now() - 3 * 60 * 60 * 1000),
        limit: 50,
      }),
    ).toEqual({ ids: ["21"], truncated: false });

    expect(
      await repo.listUserJobIds({
        userId: String(USER_WINDOW),
        createdFrom: new Date(Date.now() - 3 * 60 * 60 * 1000),
        createdTo: new Date(Date.now() - 90 * 60 * 1000),
        limit: 50,
      }),
    ).toEqual({ ids: ["22"], truncated: false });
  });

  it("★ 上限边界：恰好等于 limit 不算截断，多一条才算", async () => {
    await seedJob(31, USER_LIMIT, "text2video", "epsilon-1", 3);
    await seedJob(32, USER_LIMIT, "text2video", "epsilon-1", 2);
    await seedJob(33, USER_LIMIT, "text2video", "epsilon-1", 1);

    expect(await repo.listUserJobIds({ userId: String(USER_LIMIT), limit: 3 })).toEqual({
      ids: ["33", "32", "31"],
      truncated: false,
    });

    expect(await repo.listUserJobIds({ userId: String(USER_LIMIT), limit: 2 })).toEqual({
      ids: ["33", "32"],
      truncated: true,
    });
  });
});
