// IK74V8：从 skill-repo.test.ts 拆出（≤800 行硬线）。用例逐块搬运，断言不变。
import type {PrismaClient} from "@prisma/client";
import {describe, expect, it, vi} from "vitest";
import {createSkillRepo, SkillAddConflictError} from "./skill-repo.js";

// SkillRepo 资产边界（契约 docs/specs/2026-08-03-creative-skill-asset-contract.md §2/§3/§6/§11）：
// wire 主键一律 creative_skill_id；自增 id/skill_id、content/body/prompt 永不出库；
// mine = 官方引用（official）∪ 名下个人技能（personal）；个人技能跨用户按不存在处理；
// library v2（IK60WT）：分类过滤、featured/most_used/newest 排序、zh/en 语言解析、
// keyword 命中解析语言 name/description + search_keywords（绝不匹配 content）、
// usage_count = creative_skill_activation COUNT(DISTINCT user_id)。

describe("SkillRepo — 引用注册与 auto 开关", () => {
  function createAddPrisma(opts: {
    officialName?: string | null;
    conflictCount?: bigint;
    conflictQueryError?: Error;
  }) {
    const executeRaw = vi.fn().mockResolvedValue(1);
    const prisma = {
      skill: {
        findUnique: vi
          .fn()
          .mockResolvedValue(
            opts.officialName === undefined || opts.officialName === null
              ? null
              : { name: opts.officialName },
          ),
      },
      $queryRawUnsafe: opts.conflictQueryError
        ? vi.fn().mockRejectedValue(opts.conflictQueryError)
        : vi.fn().mockResolvedValue([{ c: opts.conflictCount ?? 0n }]),
      $executeRaw: executeRaw,
    } as unknown as PrismaClient;
    return { prisma, executeRaw };
  }

  it("addReference 以调用方 resolve 出的内部 id 落库（签名不变）", async () => {
    const { prisma, executeRaw } = createAddPrisma({
      officialName: "深度写作",
    });

    await createSkillRepo(prisma).addReference("9", "3");

    expect(executeRaw).toHaveBeenCalled();
  });

  it("addReference 撞同账户个人技能 Name Key → SkillAddConflictError，不落库（契约 §5.4）", async () => {
    const { prisma, executeRaw } = createAddPrisma({
      officialName: "深度写作",
      conflictCount: 1n,
    });

    await expect(
      createSkillRepo(prisma).addReference("9", "3"),
    ).rejects.toThrow(SkillAddConflictError);
    expect(executeRaw).not.toHaveBeenCalled();
  });

  it("addReference 名称大小写/空白折叠后相同也判冲突（Name Key 语义）", async () => {
    const { prisma, executeRaw } = createAddPrisma({
      officialName: "Deep  Writing",
      conflictCount: 1n,
    });

    await expect(
      createSkillRepo(prisma).addReference("9", "3"),
    ).rejects.toThrow(SkillAddConflictError);
    expect(executeRaw).not.toHaveBeenCalled();
  });

  it("addReference 冲突查询失败（旧库缺 name_key 列）→ 容错跳过，继续落库", async () => {
    const { prisma, executeRaw } = createAddPrisma({
      officialName: "深度写作",
      conflictQueryError: new Error("Unknown column 'name_key'"),
    });

    await createSkillRepo(prisma).addReference("9", "3");

    expect(executeRaw).toHaveBeenCalled();
  });

  it("addReference 目录行查不到（findUnique 未命中）→ 跳过冲突检查，照常落库", async () => {
    const { prisma, executeRaw } = createAddPrisma({ officialName: null });

    await createSkillRepo(prisma).addReference("9", "3");

    expect(executeRaw).toHaveBeenCalled();
  });

  it("addReference 重复添加幂等：upsert（ON DUPLICATE KEY）不报唯一冲突（契约 §6）", async () => {
    const { prisma, executeRaw } = createAddPrisma({
      officialName: "深度写作",
    });
    const repo = createSkillRepo(prisma);

    await repo.addReference("9", "3");
    await repo.addReference("9", "3");

    expect(executeRaw).toHaveBeenCalledTimes(2);
    const sql = (executeRaw.mock.calls[0][0] as string[]).join("?");
    expect(sql).toContain("ON DUPLICATE KEY UPDATE");
  });

  it("addReference 移除后重加：upsert SQL 将 is_delete 恢复为 0（IK60WX 验收 3 可再添加）", async () => {
    const { prisma, executeRaw } = createAddPrisma({
      officialName: "深度写作",
    });

    await createSkillRepo(prisma).addReference("9", "3");

    const sql = (executeRaw.mock.calls[0][0] as string[]).join("?");
    expect(sql).toMatch(/ON DUPLICATE KEY UPDATE.*is_delete = 0/s);
  });

  it("addReference 移除后重加：upsert SQL 刷新 gmt_create，重加技能按最近添加时间进顶部（IK693G，spec 故事 27/30）", async () => {
    const { prisma, executeRaw } = createAddPrisma({
      officialName: "深度写作",
    });
    await createSkillRepo(prisma).addReference("9", "3");

    const sql = (executeRaw.mock.calls[0][0] as string[]).join("?");
    expect(sql).toMatch(
      /ON DUPLICATE KEY UPDATE.*gmt_create = CURRENT_TIMESTAMP\(3\)/s,
    );
  });

  it("removeReferenceByCreativeSkillId resolve 命中后逻辑删对应 user_skill 行", async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const prisma = {
      skill: { count: vi.fn().mockResolvedValue(1) },
      user_skill: { updateMany },
      $queryRawUnsafe: vi.fn().mockResolvedValue([{ source_skill_id: 3n }]),
    } as unknown as PrismaClient;

    await expect(
      createSkillRepo(prisma).removeReferenceByCreativeSkillId(
        "9",
        "deep_writing",
      ),
    ).resolves.toBe(true);
    expect(updateMany).toHaveBeenCalledWith({
      where: { user_id: 9n, skill_id: 3n, is_delete: 0 },
      data: { is_delete: 1 },
    });
  });

  it("removeReferenceByCreativeSkillId 指向个人/未知 ID 时返回 false 且不写库", async () => {
    const updateMany = vi.fn();
    const prisma = {
      skill: { count: vi.fn() },
      user_skill: { updateMany },
      $queryRawUnsafe: vi.fn().mockResolvedValue([]),
    } as unknown as PrismaClient;

    await expect(
      createSkillRepo(prisma).removeReferenceByCreativeSkillId(
        "9",
        "my_personal",
      ),
    ).resolves.toBe(false);
    expect(updateMany).not.toHaveBeenCalled();
  });

  // listMine 并集夹具：1 条官方引用 + 1 条名下个人技能。
  // IK60WU §12.5：统一按最近添加/创建时间倒序；官方引用 gmt_create 更晚 → 排在前。
});
