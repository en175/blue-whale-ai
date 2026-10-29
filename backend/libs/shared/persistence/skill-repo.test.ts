import type {PrismaClient} from "@prisma/client";
import {describe, expect, it, vi} from "vitest";
import {createSkillRepo, SkillNameConflictError, SkillNameReservedError} from "./skill-repo.js";

import {expectWhitelistOnly} from "./skill-repo.testlib.js";

describe("SkillRepo — 技能库读路径与激活埋点", () => {
  it("listLibrary 只出白名单字段，主键为 creative_skill_id（无自增 id）", async () => {
    const prisma = {
      catalog_skills: {
        count: vi.fn().mockResolvedValue(1),
        findMany: vi.fn().mockResolvedValue([
          {
            id: 3n,
            name: "深度写作",
            description: "写作助手",
            cover_url: "https://x/cover.png",
            source: "official",
            category: "marketing",
            sort_order: 1,
            gmt_create: new Date("2026-01-01T00:00:00Z"),
            name_en: "Deep Writing",
            name_zh: "深度写作",
            description_en: "Writing assistant",
            description_zh: "写作助手",
            search_keywords: null,
          },
        ]),
      },
      user_skills: {
        findMany: vi.fn().mockResolvedValue([{ skill_id: 3n }]),
      },
      $queryRawUnsafe: vi.fn().mockImplementation((sql: string) =>
        Promise.resolve(
          sql.includes("creative_skill_activation")
            ? [{ creative_skill_id: "deep_writing", usage_count: 5n }]
            : [{ source_skill_id: 3n, creative_skill_id: "deep_writing" }],
        ),
      ),
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
        skill_code: null,
        asset_domain: "official",
        added: true,
        category: "marketing",
        usage_count: 5,
      },
    ]);
    expectWhitelistOnly(page.records);
  });


  type LibraryRow = Record<string, unknown>;

  function libraryRow(overrides: LibraryRow): LibraryRow {
    return {
      id: 3n,
      name: "深度写作",
      description: "写作助手",
      cover_url: null,
      source: "official",
      category: "other",
      sort_order: 0,
      gmt_create: new Date("2026-01-01T00:00:00Z"),
      name_en: null,
      name_zh: null,
      description_en: null,
      description_zh: null,
      search_keywords: null,
      ...overrides,
    };
  }

  function createLibraryPrisma(opts: {
    rows: LibraryRow[];
    creativeMap?: { source_skill_id: bigint; creative_skill_id: string }[];
    usage?: { creative_skill_id: string; usage_count: bigint }[];
    mine?: { skill_id: bigint }[];
  }) {
    const skillFindMany = vi.fn().mockResolvedValue(opts.rows);
    const queryRawUnsafe = vi.fn().mockImplementation((sql: string) =>
      Promise.resolve(
        sql.includes("creative_skill_activation")
          ? (opts.usage ?? [])
          : (opts.creativeMap ?? []),
      ),
    );
    const prisma = {
      catalog_skills: { findMany: skillFindMany },
      user_skills: {
        findMany: vi.fn().mockResolvedValue(opts.mine ?? []),
      },
      $queryRawUnsafe: queryRawUnsafe,
    } as unknown as PrismaClient;
    return { prisma, skillFindMany, queryRawUnsafe };
  }

  it("category=film/marketing/other 透传 where 过滤；all 或缺省不加过滤", async () => {
    const { prisma, skillFindMany } = createLibraryPrisma({ rows: [] });
    const repo = createSkillRepo(prisma);

    await repo.listLibrary("9", { category: "film", pageNum: 1, pageSize: 10 });
    expect(skillFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { source: "official", is_delete: 0, category: "film" },
      }),
    );

    skillFindMany.mockClear();
    await repo.listLibrary("9", { category: "all", pageNum: 1, pageSize: 10 });
    await repo.listLibrary("9", { pageNum: 1, pageSize: 10 });
    for (const call of skillFindMany.mock.calls) {
      expect(call[0].where).toEqual({ source: "official", is_delete: 0 });
    }
  });

  it("名称与简介按 lang 解析：取请求语言列，空则回退英文列，再回退既有单语字段", async () => {
    const rows = [
      libraryRow({
        id: 1n,
        name: "旧名A",
        description: "旧简介A",
        name_zh: "中文名A",
        name_en: "Name A",
        description_zh: "中文简介A",
        description_en: "Desc A",
      }),
      libraryRow({
        id: 2n,
        name: "旧名B",
        description: "旧简介B",
        name_en: "Name B",
        description_en: "Desc B",
      }),
      libraryRow({
        id: 3n,
        name: "旧名C",
        description: "旧简介C",
        name_zh: "",
        description_zh: "",
      }),
    ];
    const { prisma } = createLibraryPrisma({ rows });
    const repo = createSkillRepo(prisma);

    const zh = await repo.listLibrary("9", { lang: "zh", pageNum: 1, pageSize: 10 });
    expect(zh.records.map((r) => [r.name, r.description])).toEqual([
      ["中文名A", "中文简介A"],
      ["Name B", "Desc B"],
      ["旧名C", "旧简介C"],
    ]);

    const en = await repo.listLibrary("9", { lang: "en", pageNum: 1, pageSize: 10 });
    expect(en.records.map((r) => [r.name, r.description])).toEqual([
      ["Name A", "Desc A"],
      ["Name B", "Desc B"],
      ["旧名C", "旧简介C"],
    ]);

    const dft = await repo.listLibrary("9", { pageNum: 1, pageSize: 10 });
    expect(dft.records[0]?.name).toBe("中文名A");
  });

  it("keyword 命中解析语言的 name/description（含回退列），未参与解析的列不命中", async () => {
    const rows = [
      libraryRow({ id: 1n, name_zh: "海报生成" }),
      libraryRow({ id: 2n, name: "无关B", name_en: "海报Poster" }),
      libraryRow({ id: 3n, name_zh: "中文C", name_en: "海报Poster" }),
      libraryRow({ id: 4n, name_zh: "文案D", description_zh: "一键海报" }),
      libraryRow({
        id: 5n,
        name_zh: "文案E",
        description_zh: "简介E",
        description_en: "海报",
      }),
    ];
    const { prisma } = createLibraryPrisma({ rows });

    const page = await createSkillRepo(prisma).listLibrary("9", {
      keyword: "海报",
      lang: "zh",
      pageNum: 1,
      pageSize: 10,
    });

    expect(page.records.map((r) => r.name)).toEqual([
      "海报生成",
      "海报Poster",
      "文案D",
    ]);
    expect(page.total).toBe(3);
    expect(page.pages).toBe(1);
    expectWhitelistOnly(page.records);
  });

  it("keyword 命中 search_keywords；查询 select 不含 content（正文绝不参与匹配）", async () => {
    const rows = [
      libraryRow({ id: 1n, name_zh: "海报生成", search_keywords: "病毒式 传播" }),
      libraryRow({ id: 2n, name_zh: "海报文案" }),
    ];
    const { prisma, skillFindMany } = createLibraryPrisma({ rows });

    const page = await createSkillRepo(prisma).listLibrary("9", {
      keyword: "传播",
      pageNum: 1,
      pageSize: 10,
    });

    expect(page.records.map((r) => r.name)).toEqual(["海报生成"]);
    const select = skillFindMany.mock.calls[0]?.[0].select as Record<string, unknown>;
    expect(select).not.toHaveProperty("content");
    expect(select).toMatchObject({ name_zh: true, search_keywords: true });
  });

  it("IKBMA3：多词 keyword 按空白拆词 + 全词命中（AND），跨 name/description/search_keywords", async () => {
    const rows = [
      libraryRow({ id: 1n, name_zh: "智能视频生成" }),
      libraryRow({ id: 2n, name_zh: "视频剪辑", description_zh: "一键生成短视频" }),
      libraryRow({ id: 3n, name_zh: "口播文案", search_keywords: "视频带货 文案生成" }),
      libraryRow({ id: 4n, name_zh: "智能海报" }),
      libraryRow({ id: 5n, name_zh: "深度写作" }),
    ];
    const { prisma } = createLibraryPrisma({ rows });

    const page = await createSkillRepo(prisma).listLibrary("9", {
      keyword: "视频 生成",
      lang: "zh",
      pageNum: 1,
      pageSize: 10,
    });

    expect(page.records.map((r) => r.name)).toEqual([
      "智能视频生成",
      "视频剪辑",
      "口播文案",
    ]);
    expect(page.total).toBe(3);
    expect(page.pages).toBe(1);
    expectWhitelistOnly(page.records);
  });

  it("IKBMA3：keyword 空白折叠，多空格/首尾空格与单词等价", async () => {
    const rows = [
      libraryRow({ id: 1n, name_zh: "智能视频生成" }),
      libraryRow({ id: 2n, name_zh: "智能海报" }),
    ];
    const { prisma } = createLibraryPrisma({ rows });

    const page = await createSkillRepo(prisma).listLibrary("9", {
      keyword: "   视频   生成   ",
      lang: "zh",
      pageNum: 1,
      pageSize: 10,
    });

    expect(page.records.map((r) => r.name)).toEqual(["智能视频生成"]);
  });

  it("IKBMA3：全空白 keyword 视同无筛选，返回全部", async () => {
    const rows = [
      libraryRow({ id: 1n, name_zh: "智能视频生成" }),
      libraryRow({ id: 2n, name_zh: "深度写作" }),
    ];
    const { prisma } = createLibraryPrisma({ rows });

    const page = await createSkillRepo(prisma).listLibrary("9", {
      keyword: "   ",
      lang: "zh",
      pageNum: 1,
      pageSize: 10,
    });

    expect(page.total).toBe(2);
  });

  it("IKBMA3：中文真实样例——搜「视频 生成」命中「智能视频生成」", async () => {
    const rows = [
      libraryRow({ id: 1n, name_zh: "智能视频生成", search_keywords: "短视频 内容生产" }),
      libraryRow({ id: 2n, name_zh: "电商海报", search_keywords: "营销" }),
    ];
    const { prisma } = createLibraryPrisma({ rows });

    const page = await createSkillRepo(prisma).listLibrary("9", {
      keyword: "视频 生成",
      lang: "zh",
      pageNum: 1,
      pageSize: 10,
    });

    expect(page.records.map((r) => r.name)).toEqual(["智能视频生成"]);
  });

  it("sort=featured（缺省）按 sort_order 升序取回；sort=newest 按 gmt_create 降序", async () => {
    const rows = [
      libraryRow({ id: 1n, name_zh: "旧", gmt_create: new Date("2026-01-01") }),
      libraryRow({ id: 2n, name_zh: "新", gmt_create: new Date("2026-03-01") }),
      libraryRow({ id: 3n, name_zh: "中", gmt_create: new Date("2026-02-01") }),
    ];
    const { prisma, skillFindMany } = createLibraryPrisma({ rows });
    const repo = createSkillRepo(prisma);

    const featured = await repo.listLibrary("9", { pageNum: 1, pageSize: 10 });
    expect(featured.records.map((r) => r.name)).toEqual(["旧", "新", "中"]);
    expect(skillFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: { sort_order: "asc" } }),
    );

    const newest = await repo.listLibrary("9", {
      sort: "newest",
      pageNum: 1,
      pageSize: 10,
    });
    expect(newest.records.map((r) => r.name)).toEqual(["新", "中", "旧"]);
  });

  it("sort=most_used 按去重使用人数降序，人数相同按 sort_order 升序兜底；无埋点记 0", async () => {
    const rows = [
      libraryRow({ id: 1n, name_zh: "甲", sort_order: 1 }),
      libraryRow({ id: 2n, name_zh: "乙", sort_order: 2 }),
      libraryRow({ id: 3n, name_zh: "丙", sort_order: 3 }),
      libraryRow({ id: 4n, name_zh: "丁", sort_order: 4 }),
    ];
    const { prisma, queryRawUnsafe } = createLibraryPrisma({
      rows,
      creativeMap: [
        { source_skill_id: 1n, creative_skill_id: "skill_a" },
        { source_skill_id: 2n, creative_skill_id: "skill_b" },
        { source_skill_id: 3n, creative_skill_id: "skill_c" },
      ],
      usage: [
        { creative_skill_id: "skill_b", usage_count: 5n },
        { creative_skill_id: "skill_c", usage_count: 5n },
        { creative_skill_id: "skill_a", usage_count: 2n },
      ],
    });

    const page = await createSkillRepo(prisma).listLibrary("9", {
      sort: "most_used",
      pageNum: 1,
      pageSize: 10,
    });

    expect(page.records.map((r) => [r.name, r.usage_count])).toEqual([
      ["乙", 5],
      ["丙", 5],
      ["甲", 2],
      ["丁", 0],
    ]);
    expect(queryRawUnsafe).toHaveBeenCalledWith(
      expect.stringContaining("COUNT(DISTINCT user_id)"),
      "skill_a",
      "skill_b",
      "skill_c",
    );
    expectWhitelistOnly(page.records);
  });

  it("keyword/category/sort 组合后按 offset 内存切片分页，total 为过滤后总数", async () => {
    const rows = [1n, 2n, 3n].map((id) =>
      libraryRow({ id, name_zh: `海报${id}`, category: "film" }),
    );
    const { prisma } = createLibraryPrisma({ rows });

    const page = await createSkillRepo(prisma).listLibrary("9", {
      keyword: "海报",
      category: "film",
      pageNum: 2,
      pageSize: 2,
    });

    expect(page.total).toBe(3);
    expect(page.current).toBe(2);
    expect(page.size).toBe(2);
    expect(page.records.map((r) => r.name)).toEqual(["海报3"]);
  });


  it("resolveOfficialSkillId 命中官方映射时返回 skill.id 字符串", async () => {
    const queryRawUnsafe = vi
      .fn()
      .mockResolvedValue([{ source_skill_id: 3n }]);
    const prisma = {
      catalog_skills: { count: vi.fn().mockResolvedValue(1) },
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
    const count = vi.fn();
    const prisma = {
      catalog_skills: { count },
      $queryRawUnsafe: vi.fn().mockResolvedValue([]),
    } as unknown as PrismaClient;
    const repo = createSkillRepo(prisma);

    await expect(repo.resolveOfficialSkillId("my_personal")).resolves.toBeNull();
    await expect(repo.resolveOfficialSkillId("no_such_skill")).resolves.toBeNull();
    expect(count).not.toHaveBeenCalled();
  });

  it("官方映射指向的 skill 行已逻辑删时 resolve 返回 null", async () => {
    const prisma = {
      catalog_skills: { count: vi.fn().mockResolvedValue(0) },
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

});

describe("SkillRepo.checkPersonalNameAvailable / createPersonalSkill 名称校验", () => {
  function prismaWithNames(input: {
    officialNames: string[];
    personalNameKeys?: string[];
  }) {
    return {
      catalog_skills: {
        findMany: vi.fn().mockResolvedValue(
          input.officialNames.map((name) => ({ name })),
        ),
      },
      $queryRawUnsafe: vi
        .fn()
        .mockImplementation((_sql: string, _userId: bigint, nameKey: string) =>
          Promise.resolve([
            { c: BigInt(input.personalNameKeys?.includes(nameKey) ? 1 : 0) },
          ]),
        ),
      $executeRawUnsafe: vi.fn().mockResolvedValue(1),
    } as unknown as PrismaClient;
  }

  it("同用户已有同 Name Key → conflict；官方保留名 → reserved；其余 ok", async () => {
    const repo = createSkillRepo(
      prismaWithNames({
        officialNames: ["深度写作"],
        personalNameKeys: ["周报助手"],
      }),
    );
    await expect(
      repo.checkPersonalNameAvailable("100", "深度写作"),
    ).resolves.toBe("reserved");
    await expect(
      repo.checkPersonalNameAvailable("100", "周报助手"),
    ).resolves.toBe("conflict");
    await expect(
      repo.checkPersonalNameAvailable("100", "全新技能"),
    ).resolves.toBe("ok");
  });

  it("createPersonalSkill 冲突抛 SkillNameConflictError、保留名抛 SkillNameReservedError", async () => {
    const conflictRepo = createSkillRepo(
      prismaWithNames({ officialNames: [], personalNameKeys: ["周报助手"] }),
    );
    await expect(
      conflictRepo.createPersonalSkill("100", {
        name: "周报助手",
        description: "d",
        body: "b",
      }),
    ).rejects.toBeInstanceOf(SkillNameConflictError);

    const reservedRepo = createSkillRepo(
      prismaWithNames({ officialNames: ["深度写作"] }),
    );
    await expect(
      reservedRepo.createPersonalSkill("100", {
        name: "深度写作",
        description: "d",
        body: "b",
      }),
    ).rejects.toBeInstanceOf(SkillNameReservedError);
  });

  it("跨用户隔离：同名不同 userId 互不冲突（Name Key 校验带 owner_user_id 谓词）", async () => {
    const prisma = prismaWithNames({
      officialNames: [],
      personalNameKeys: [],
    });
    const repo = createSkillRepo(prisma);
    await expect(
      repo.checkPersonalNameAvailable("200", "周报助手"),
    ).resolves.toBe("ok");
    expect(prisma.$queryRawUnsafe).toHaveBeenCalledWith(
      expect.stringContaining("owner_user_id = ?"),
      200n,
      "周报助手",
    );
  });

  it("listLibrary records 含 skill_code", async () => {
    const prisma = {
      catalog_skills: {
        count: vi.fn().mockResolvedValue(1),
        findMany: vi.fn().mockResolvedValue([
          { id: 1n, name: "技能A", description: null, cover_url: null, source: "official", skill_code: "cn01" },
        ]),
      },
      user_skills: { findMany: vi.fn().mockResolvedValue([]) },
      $queryRawUnsafe: vi.fn().mockResolvedValue([]),
    } as unknown as PrismaClient;

    const page = await createSkillRepo(prisma).listLibrary("100", { pageNum: 1, pageSize: 50 });
    expect(page.records[0]).toMatchObject({ skill_code: "cn01" });
  });

  it("listMine records 含 skill_code（skill 快照存在时）", async () => {
    const prisma = {
      catalog_skills: {
        findMany: vi.fn().mockResolvedValue([
          { id: 1n, name: "技能A", description: null, cover_url: null, source: "official", skill_code: "cn01" },
        ]),
      },
      user_skills: {
        count: vi.fn().mockResolvedValue(1),
        findMany: vi.fn().mockResolvedValue([{ skill_id: 1n }]),
      },
      $queryRawUnsafe: vi.fn().mockResolvedValue([]),
    } as unknown as PrismaClient;

    const page = await createSkillRepo(prisma).listMine("100", { pageNum: 1, pageSize: 50 });
    expect(page.records[0]).toMatchObject({ skill_code: "cn01" });
  });
});

describe("SkillRepo — getOfficialContent（IKA64P 直接使用填全文）", () => {
  it("解析 active version body", async () => {
    const prisma = {
      catalog_creative_skills: {
        findFirst: vi.fn().mockResolvedValue({ active_version_id: "v1" }),
      },
      catalog_creative_skill_versions: {
        findFirst: vi.fn().mockResolvedValue({ body: "技能正文" }),
      },
    } as unknown as PrismaClient;
    expect(await createSkillRepo(prisma).getOfficialContent("cs1")).toBe("技能正文");
  });

  it("无 active version 返回 null", async () => {
    const prisma = {
      catalog_creative_skills: { findFirst: vi.fn().mockResolvedValue(null) },
    } as unknown as PrismaClient;
    expect(await createSkillRepo(prisma).getOfficialContent("cs1")).toBeNull();
  });
});

describe("SkillRepo — findAgentSkill 上下架守卫（IKRJP7）", () => {
  function createResolvePrisma(rows: unknown[]) {
    const queryRawUnsafe = vi.fn().mockResolvedValue(rows);
    return {
      prisma: { $queryRawUnsafe: queryRawUnsafe } as unknown as PrismaClient,
      queryRawUnsafe,
    };
  }

  it("官方域要求目录行在架：查询带 is_delete 与 s.id IS NOT NULL 守卫", async () => {
    const { prisma, queryRawUnsafe } = createResolvePrisma([]);

    await createSkillRepo(prisma).findAgentSkill("deep_writing", "9");

    const [sql, ...params] = queryRawUnsafe.mock.calls[0];
    expect(sql).toContain("s.is_delete = 0");
    expect(sql).toContain("cs.asset_domain = 'official' AND s.id IS NOT NULL");
    expect(params).toEqual(["deep_writing", 9n]);
  });

  it("已下架官方技能查无结果 → null（按不存在处理）", async () => {
    const { prisma } = createResolvePrisma([]);

    expect(await createSkillRepo(prisma).findAgentSkill("deep_writing", "9")).toBeNull();
  });

  it("在架官方技能返回正文与稳定身份", async () => {
    const { prisma } = createResolvePrisma([
      {
        creative_skill_id: "deep_writing",
        name: "深度写作",
        description: null,
        asset_domain: "official",
        body: "技能正文",
      },
    ]);

    await expect(
      createSkillRepo(prisma).findAgentSkill("deep_writing", "9"),
    ).resolves.toMatchObject({ creative_skill_id: "deep_writing", body: "技能正文" });
  });
});
