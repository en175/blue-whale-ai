import type { PrismaClient } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import { createSkillRepo } from "./skill-repo.js";

// SkillRepo 资产边界（契约 docs/specs/2026-08-03-creative-skill-asset-contract.md §2/§3/§6）：
// wire 主键一律 creative_skill_id；自增 id/skill_id、content/body/prompt 永不出库；
// mine = 官方引用（official）∪ 名下个人技能（personal）；个人技能跨用户按不存在处理。

const FORBIDDEN_KEYS = ["content", "body", "prompt", "id", "skill_id"];

function expectWhitelistOnly(records: Record<string, unknown>[]) {
  for (const record of records) {
    for (const key of Object.keys(record)) {
      expect(FORBIDDEN_KEYS).not.toContain(key);
    }
  }
}

describe("SkillRepo", () => {
  it("listLibrary 只出白名单字段，主键为 creative_skill_id（无自增 id）", async () => {
    const prisma = {
      skill: {
        count: vi.fn().mockResolvedValue(1),
        findMany: vi.fn().mockResolvedValue([
          {
            id: 3n,
            name: "深度写作",
            description: "写作助手",
            cover_url: "https://x/cover.png",
            source: "official",
          },
        ]),
      },
      user_skill: {
        findMany: vi.fn().mockResolvedValue([{ skill_id: 3n }]),
      },
      $queryRawUnsafe: vi
        .fn()
        .mockResolvedValue([
          { source_skill_id: 3n, creative_skill_id: "deep_writing" },
        ]),
    } as unknown as PrismaClient;

    const page = await createSkillRepo(prisma).listLibrary("9", {
      pageNum: 1,
      pageSize: 10,
    });

    expect(page.total).toBe(1);
    expect(page.records).toEqual([
      {
        creative_skill_id: "deep_writing",
        name: "深度写作",
        description: "写作助手",
        cover_url: "https://x/cover.png",
        source: "official",
        asset_domain: "official",
        added: true,
      },
    ]);
    expectWhitelistOnly(page.records);
  });

  it("resolveOfficialSkillId 命中官方映射时返回 skill.id 字符串", async () => {
    const queryRawUnsafe = vi
      .fn()
      .mockResolvedValue([{ source_skill_id: 3n }]);
    const prisma = {
      skill: { count: vi.fn().mockResolvedValue(1) },
      $queryRawUnsafe: queryRawUnsafe,
    } as unknown as PrismaClient;

    await expect(
      createSkillRepo(prisma).resolveOfficialSkillId("deep_writing"),
    ).resolves.toBe("3");
    expect(queryRawUnsafe).toHaveBeenCalledWith(
      expect.stringContaining("asset_domain = 'official'"),
      "deep_writing",
    );
  });

  it("个人技能 ID 与未知 ID 解析失败（resolve 返回 null，按不存在处理）", async () => {
    // creative_skill 查询带 asset_domain='official' 谓词：个人域/未知 ID 在 DB 层 0 命中。
    const count = vi.fn();
    const prisma = {
      skill: { count },
      $queryRawUnsafe: vi.fn().mockResolvedValue([]),
    } as unknown as PrismaClient;
    const repo = createSkillRepo(prisma);

    await expect(repo.resolveOfficialSkillId("my_personal")).resolves.toBeNull();
    await expect(repo.resolveOfficialSkillId("no_such_skill")).resolves.toBeNull();
    expect(count).not.toHaveBeenCalled();
  });

  it("官方映射指向的 skill 行已逻辑删时 resolve 返回 null", async () => {
    const prisma = {
      skill: { count: vi.fn().mockResolvedValue(0) },
      $queryRawUnsafe: vi.fn().mockResolvedValue([{ source_skill_id: 3n }]),
    } as unknown as PrismaClient;

    await expect(
      createSkillRepo(prisma).resolveOfficialSkillId("deep_writing"),
    ).resolves.toBeNull();
  });

  it("findAssetDomainInfo 返回任意域的域与 owner（forced 守卫用）", async () => {
    const prisma = {
      $queryRawUnsafe: vi
        .fn()
        .mockResolvedValue([{ asset_domain: "personal", owner_user_id: 42n }]),
    } as unknown as PrismaClient;

    await expect(
      createSkillRepo(prisma).findAssetDomainInfo("my_personal"),
    ).resolves.toEqual({ asset_domain: "personal", owner_user_id: "42" });
  });

  it("findAssetDomainInfo 未知 ID / 表缺失 → null（按不可用处理，不泄露存在性）", async () => {
    const missing = {
      $queryRawUnsafe: vi.fn().mockResolvedValue([]),
    } as unknown as PrismaClient;
    await expect(
      createSkillRepo(missing).findAssetDomainInfo("no_such_skill"),
    ).resolves.toBeNull();

    const broken = {
      $queryRawUnsafe: vi.fn().mockRejectedValue(new Error("no such table")),
    } as unknown as PrismaClient;
    await expect(
      createSkillRepo(broken).findAssetDomainInfo("deep_writing"),
    ).resolves.toBeNull();
  });

  it("addReference 以调用方 resolve 出的内部 id 落库（签名不变）", async () => {
    const executeRaw = vi.fn().mockResolvedValue(1);
    const prisma = { $executeRaw: executeRaw } as unknown as PrismaClient;

    await createSkillRepo(prisma).addReference("9", "3");

    expect(executeRaw).toHaveBeenCalled();
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

  it("updateAutoByCreativeSkillId resolve 命中后更新 auto；未命中返回 false", async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const hitPrisma = {
      skill: { count: vi.fn().mockResolvedValue(1) },
      user_skill: { updateMany },
      $queryRawUnsafe: vi.fn().mockResolvedValue([{ source_skill_id: 3n }]),
    } as unknown as PrismaClient;

    await expect(
      createSkillRepo(hitPrisma).updateAutoByCreativeSkillId(
        "9",
        "deep_writing",
        true,
      ),
    ).resolves.toBe(true);
    expect(updateMany).toHaveBeenCalledWith({
      where: { user_id: 9n, skill_id: 3n, is_delete: 0 },
      data: { auto: 1 },
    });

    const missUpdateMany = vi.fn();
    const missPrisma = {
      skill: { count: vi.fn() },
      user_skill: { updateMany: missUpdateMany },
      $queryRawUnsafe: vi.fn().mockResolvedValue([]),
    } as unknown as PrismaClient;
    await expect(
      createSkillRepo(missPrisma).updateAutoByCreativeSkillId(
        "9",
        "no_such_skill",
        true,
      ),
    ).resolves.toBe(false);
    expect(missUpdateMany).not.toHaveBeenCalled();
  });

  // listMine 并集夹具：1 条官方引用（auto=1）+ 1 条名下个人技能。
  function createUnionPrisma() {
    const queryRawUnsafe = vi.fn().mockImplementation((sql: string) => {
      if (sql.includes("owner_user_id")) {
        return Promise.resolve([
          {
            creative_skill_id: "my_personal",
            name: "我的技能",
            description: "个人资产",
          },
        ]);
      }
      return Promise.resolve([
        { source_skill_id: 3n, creative_skill_id: "deep_writing" },
      ]);
    });
    const userSkillFindMany = vi
      .fn()
      .mockResolvedValue([{ skill_id: 3n, auto: 1 }]);
    const prisma = {
      user_skill: { findMany: userSkillFindMany },
      skill: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 3n,
            name: "深度写作",
            description: "写作助手",
            cover_url: "https://x/cover.png",
            source: "official",
          },
        ]),
      },
      $queryRawUnsafe: queryRawUnsafe,
    } as unknown as PrismaClient;
    return { prisma, queryRawUnsafe, userSkillFindMany };
  }

  it("listMine 同页返回官方引用 ∪ 名下个人技能，asset_domain 分别为 official/personal", async () => {
    const { prisma, queryRawUnsafe, userSkillFindMany } = createUnionPrisma();

    const page = await createSkillRepo(prisma).listMine("9", {
      pageNum: 1,
      pageSize: 10,
    });

    // 官方引用按 skill_id asc 在前，个人技能按 creative_skill_id asc 在后。
    expect(page.total).toBe(2);
    expect(page.records).toEqual([
      {
        creative_skill_id: "deep_writing",
        auto: true,
        name: "深度写作",
        description: "写作助手",
        cover_url: "https://x/cover.png",
        source: "official",
        asset_domain: "official",
      },
      {
        creative_skill_id: "my_personal",
        auto: false,
        name: "我的技能",
        description: "个人资产",
        cover_url: null,
        source: null,
        asset_domain: "personal",
      },
    ]);
    expectWhitelistOnly(page.records);
    expect(userSkillFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: { skill_id: "asc" } }),
    );
    // 个人技能查询带 owner 谓词：他人的个人技能不会进入结果。
    expect(queryRawUnsafe).toHaveBeenCalledWith(
      expect.stringContaining("owner_user_id = ?"),
      9n,
    );
  });

  it("listMine 合并后内存切片分页，total 为合并总数", async () => {
    const { prisma } = createUnionPrisma();

    const page = await createSkillRepo(prisma).listMine("9", {
      pageNum: 2,
      pageSize: 1,
    });

    expect(page.total).toBe(2);
    expect(page.current).toBe(2);
    expect(page.size).toBe(1);
    expect(page.records).toEqual([
      {
        creative_skill_id: "my_personal",
        auto: false,
        name: "我的技能",
        description: "个人资产",
        cover_url: null,
        source: null,
        asset_domain: "personal",
      },
    ]);
  });

  it("findPersonalView 非 owner 调用不命中（null，不泄露存在性）", async () => {
    const queryRawUnsafe = vi.fn().mockResolvedValue([]);
    const prisma = {
      $queryRawUnsafe: queryRawUnsafe,
    } as unknown as PrismaClient;

    await expect(
      createSkillRepo(prisma).findPersonalView("7", "my_personal"),
    ).resolves.toBeNull();
    expect(queryRawUnsafe).toHaveBeenCalledWith(
      expect.stringContaining("owner_user_id = ?"),
      7n,
      "my_personal",
    );
  });

  it("findPersonalView owner 命中返回白名单视图", async () => {
    const prisma = {
      $queryRawUnsafe: vi.fn().mockResolvedValue([
        {
          creative_skill_id: "my_personal",
          name: "我的技能",
          description: null,
        },
      ]),
    } as unknown as PrismaClient;

    await expect(
      createSkillRepo(prisma).findPersonalView("9", "my_personal"),
    ).resolves.toEqual({
      creative_skill_id: "my_personal",
      name: "我的技能",
      description: null,
    });
  });

  it("deletePersonal 命中时物理删除本体及其 creative_skill_version 行", async () => {
    const executeRawUnsafe = vi.fn().mockImplementation((sql: string) => {
      if (sql.includes("creative_skill_version")) return Promise.resolve(2);
      return Promise.resolve(1);
    });
    const prisma = {
      $executeRawUnsafe: executeRawUnsafe,
    } as unknown as PrismaClient;

    await expect(
      createSkillRepo(prisma).deletePersonal("9", "my_personal"),
    ).resolves.toBe(true);
    expect(executeRawUnsafe).toHaveBeenCalledTimes(2);
    expect(executeRawUnsafe).toHaveBeenCalledWith(
      expect.stringContaining("DELETE FROM creative_skill_version"),
      "my_personal",
    );
  });

  it("deletePersonal 非 owner 调用不命中：本体与版本行都不动", async () => {
    const executeRawUnsafe = vi.fn().mockResolvedValue(0);
    const prisma = {
      $executeRawUnsafe: executeRawUnsafe,
    } as unknown as PrismaClient;

    await expect(
      createSkillRepo(prisma).deletePersonal("7", "my_personal"),
    ).resolves.toBe(false);
    expect(executeRawUnsafe).toHaveBeenCalledTimes(1);
  });

  it("deletePersonal 对 official 行不删（asset_domain 谓词保护，即使 owner 巧合匹配）", async () => {
    const executeRawUnsafe = vi.fn().mockResolvedValue(0);
    const prisma = {
      $executeRawUnsafe: executeRawUnsafe,
    } as unknown as PrismaClient;

    await expect(
      createSkillRepo(prisma).deletePersonal("0", "deep_writing"),
    ).resolves.toBe(false);
    const [sql, ...params] = executeRawUnsafe.mock.calls[0];
    expect(sql).toContain("asset_domain = 'personal'");
    expect(sql).toContain("owner_user_id = ?");
    expect(sql).toContain("DELETE FROM creative_skill ");
    expect(params).toEqual(["deep_writing", 0n]);
    expect(executeRawUnsafe).toHaveBeenCalledTimes(1);
  });

  it("creative_skill 读查询失败时容错为空（表不存在不阻塞主路径）；deletePersonal 写失败则抛错", async () => {
    const prisma = {
      user_skill: {
        findMany: vi.fn().mockResolvedValue([{ skill_id: 3n, auto: 0 }]),
      },
      skill: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 3n,
            name: "深度写作",
            description: "写作助手",
            cover_url: null,
            source: "official",
          },
        ]),
        count: vi.fn(),
      },
      $queryRawUnsafe: vi.fn().mockRejectedValue(new Error("table missing")),
      $executeRawUnsafe: vi.fn().mockRejectedValue(new Error("table missing")),
    } as unknown as PrismaClient;
    const repo = createSkillRepo(prisma);

    const page = await repo.listMine("9", { pageNum: 1, pageSize: 10 });
    expect(page.total).toBe(1);
    expect(page.records[0]).toMatchObject({
      creative_skill_id: null,
      asset_domain: "official",
    });
    await expect(repo.resolveOfficialSkillId("deep_writing")).resolves.toBeNull();
    await expect(repo.listPersonalByOwner("9")).resolves.toEqual([]);
    await expect(repo.findPersonalView("9", "my_personal")).resolves.toBeNull();
    await expect(repo.deletePersonal("9", "my_personal")).rejects.toThrow(
      "table missing",
    );
  });
});
