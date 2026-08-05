import type { PrismaClient } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import { bundledAgentRuntimeManifest } from "../../agent-runtime/src/runtime-manifest.js";
import {
  agentRunPinSchema,
  canonicalAgentRunPinDigestInput,
  type AgentRunPin,
} from "@blue-whale/contracts";
import { createHash } from "node:crypto";

import {
  createSkillRepo,
  SkillAddConflictError,
  SkillInUseError,
  SkillNameConflictError,
  SkillNameReservedError,
} from "./skill-repo.js";

// SkillRepo 资产边界（契约 docs/specs/2026-08-03-creative-skill-asset-contract.md §2/§3/§6/§11）：
// wire 主键一律 creative_skill_id；自增 id/skill_id、content/body/prompt 永不出库；
// mine = 官方引用（official）∪ 名下个人技能（personal）；个人技能跨用户按不存在处理；
// library v2（IK60WT）：分类过滤、featured/most_used/newest 排序、zh/en 语言解析、
// keyword 命中解析语言 name/description + search_keywords（绝不匹配 content）、
// usage_count = creative_skill_activation COUNT(DISTINCT user_id)。

const FORBIDDEN_KEYS = ["content", "body", "prompt", "id", "skill_id"];

function expectWhitelistOnly(records: Record<string, unknown>[]) {
  for (const record of records) {
    for (const key of Object.keys(record)) {
      expect(FORBIDDEN_KEYS).not.toContain(key);
    }
  }
}

// deletePersonal 交互事务 mock（先例：createPersonalSkill 的 $transaction(async cb => cb(tx))）。
function withTransaction(
  tx: Record<string, unknown>,
): { $transaction: ReturnType<typeof vi.fn> } {
  return {
    $transaction: vi.fn(
      async (cb: (t: Record<string, unknown>) => Promise<unknown>) => cb(tx),
    ),
  };
}

// RunPin fixture（复制 agent-run-repo.test.ts 的 runPinSource + signRunPin 模式）。
const runPinSource: Omit<AgentRunPin, "pin_digest"> = {
  schema_version: 1 as const,
  manifest_id: bundledAgentRuntimeManifest.manifest_id,
  manifest_version: bundledAgentRuntimeManifest.manifest_version,
  manifest_digest: bundledAgentRuntimeManifest.manifest_digest,
  resources: structuredClone(bundledAgentRuntimeManifest.resources),
  role_resource_id: bundledAgentRuntimeManifest.role_resource_id,
  rule_resource_ids: structuredClone(
    bundledAgentRuntimeManifest.rule_resource_ids,
  ),
  runtime_skill_resource_ids: structuredClone(
    bundledAgentRuntimeManifest.runtime_skill_resource_ids,
  ),
  model_profile: structuredClone(
    bundledAgentRuntimeManifest.model_profiles[0]!,
  ),
  runtime_budget_policy: bundledAgentRuntimeManifest.runtime_budget_policy,
  tool_grants: [],
  auto_creative_skill_candidates: [],
  activated_creative_skill_versions: [],
  creative_skill_resources: [],
};

function signRunPin(source: Omit<AgentRunPin, "pin_digest">): AgentRunPin {
  return {
    ...source,
    pin_digest: `sha256:${createHash("sha256")
      .update(canonicalAgentRunPinDigestInput(source))
      .digest("hex")}`,
  };
}

function resourceOf(
  creativeSkillId: string,
  name: string,
  body: string,
): AgentRunPin["creative_skill_resources"][number] {
  return {
    creative_skill_id: creativeSkillId,
    creative_skill_version_id: `version.${creativeSkillId}.1`,
    name,
    description: `${name}简介`,
    display_version: "1.0.0",
    resource_digest: `sha256:${"a".repeat(64)}`,
    media_type: "text/markdown",
    body,
    content_digest: `sha256:${createHash("sha256").update(body).digest("hex")}`,
  };
}

function candidateOf(
  resource: AgentRunPin["creative_skill_resources"][number],
): AgentRunPin["auto_creative_skill_candidates"][number] {
  const {
    media_type: _mediaType,
    body: _body,
    content_digest: _contentDigest,
    ...candidate
  } = resource;
  return candidate;
}

function activationOf(
  resource: AgentRunPin["creative_skill_resources"][number],
): AgentRunPin["activated_creative_skill_versions"][number] {
  return {
    creative_skill_id: resource.creative_skill_id,
    creative_skill_version_id: resource.creative_skill_version_id,
    name: resource.name,
    display_version: resource.display_version,
    resource_digest: resource.resource_digest,
    source: "auto",
    reason: {
      type: "agent_match",
      detail: { matched_fields: ["conversation_messages"] },
    },
  };
}

const TARGET_BODY = "# 故事板助手\n\n分镜规划正文";
const TARGET_RESOURCE = resourceOf("story_board", "故事板助手", TARGET_BODY);
const OTHER_RESOURCE = resourceOf(
  "poster_expert",
  "海报专家",
  "# 海报专家\n\n海报设计正文",
);

function pinWithSkills(
  resources: AgentRunPin["creative_skill_resources"],
): AgentRunPin {
  return signRunPin({
    ...runPinSource,
    auto_creative_skill_candidates: resources.map(candidateOf),
    // schema 约束 activated_creative_skill_versions 至多 1 个（确定性 auto 激活），fixture 对齐
    activated_creative_skill_versions: resources
      .slice(0, 1)
      .map(activationOf),
    creative_skill_resources: resources,
  });
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
      user_skill: {
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

  // ===== library v2（IK60WT，契约 §11）夹具 =====

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

  /** listLibrary 夹具：skill 行 + creative 映射 + activation 聚合（按 SQL 分发）。 */
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
      skill: { findMany: skillFindMany },
      user_skill: {
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
      // zh 列为 NULL：回退英文列
      libraryRow({
        id: 2n,
        name: "旧名B",
        description: "旧简介B",
        name_en: "Name B",
        description_en: "Desc B",
      }),
      // zh/en 均为空（空串视同 NULL）：回退既有单语字段
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

    // 缺省 lang 视同 zh
    const dft = await repo.listLibrary("9", { pageNum: 1, pageSize: 10 });
    expect(dft.records[0]?.name).toBe("中文名A");
  });

  it("keyword 命中解析语言的 name/description（含回退列），未参与解析的列不命中", async () => {
    const rows = [
      // 解析语言 zh 的 name 命中
      libraryRow({ id: 1n, name_zh: "海报生成" }),
      // zh 列为空回退英文列，解析值即英文列 → 命中
      libraryRow({ id: 2n, name: "无关B", name_en: "海报Poster" }),
      // zh 列非空时英文列不是解析值 → 不命中
      libraryRow({ id: 3n, name_zh: "中文C", name_en: "海报Poster" }),
      // 解析语言 zh 的 description 命中
      libraryRow({ id: 4n, name_zh: "文案D", description_zh: "一键海报" }),
      // description_zh 非空时 description_en 不命中
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

    // 乙/丙同 5 人，sort_order 乙(2) < 丙(3) → 乙在前；丁无埋点记 0 垫底。
    expect(page.records.map((r) => [r.name, r.usage_count])).toEqual([
      ["乙", 5],
      ["丙", 5],
      ["甲", 2],
      ["丁", 0],
    ]);
    // 去重语义由 SQL 保证：COUNT(DISTINCT user_id)。
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

  it("recordActivation 以稳定 ID/用户/AgentRun/版本/来源落一行埋点", async () => {
    const create = vi.fn().mockResolvedValue({});
    const prisma = {
      creative_skill_activation: { create },
    } as unknown as PrismaClient;

    await createSkillRepo(prisma).recordActivation({
      creativeSkillId: "deep_writing",
      userId: "9",
      agentRunId: "42",
      skillVersion: 1,
      activationSource: "forced",
    });

    expect(create).toHaveBeenCalledWith({
      data: {
        creative_skill_id: "deep_writing",
        user_id: 9n,
        agent_run_id: "42",
        skill_version: 1,
        activation_source: "forced",
      },
    });
  });

  it("recordActivation 写失败容错（旧库缺表不阻塞消息接纳主路径）", async () => {
    const prisma = {
      creative_skill_activation: {
        create: vi.fn().mockRejectedValue(new Error("no such table")),
      },
    } as unknown as PrismaClient;

    await expect(
      createSkillRepo(prisma).recordActivation({
        creativeSkillId: "deep_writing",
        userId: "9",
        agentRunId: "42",
        skillVersion: 1,
        activationSource: "forced",
      }),
    ).resolves.toBeUndefined();
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

  /** addReference 夹具（IK60WX）：官方名 + 个人 Name Key 冲突计数（按 SQL 分发）。 */
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

  it("updatePersonalAutoByCreativeSkillId 仅 owner 可切个人本体 auto_match；0 命中返回 false（§16.1）", async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const hitPrisma = {
      creative_skill: { updateMany },
    } as unknown as PrismaClient;

    await expect(
      createSkillRepo(hitPrisma).updatePersonalAutoByCreativeSkillId(
        "9",
        "my_personal",
        true,
      ),
    ).resolves.toBe(true);
    expect(updateMany).toHaveBeenCalledWith({
      where: {
        creative_skill_id: "my_personal",
        asset_domain: "personal",
        owner_user_id: 9n,
      },
      data: { auto_match: 1 },
    });

    // 跨用户 / 官方域 / 未知 ID 均 0 命中 → false，不泄露存在性（§7）。
    const missUpdateMany = vi.fn().mockResolvedValue({ count: 0 });
    const missPrisma = {
      creative_skill: { updateMany: missUpdateMany },
    } as unknown as PrismaClient;
    await expect(
      createSkillRepo(missPrisma).updatePersonalAutoByCreativeSkillId(
        "10",
        "my_personal",
        false,
      ),
    ).resolves.toBe(false);
    expect(missUpdateMany).toHaveBeenCalledWith({
      where: {
        creative_skill_id: "my_personal",
        asset_domain: "personal",
        owner_user_id: 10n,
      },
      data: { auto_match: 0 },
    });
  });

  // listMine 并集夹具：1 条官方引用（auto=1）+ 1 条名下个人技能（auto_match=1）。
  // IK60WU §12.5：统一按最近添加/创建时间倒序；官方引用 gmt_create 更晚 → 排在前。
  function createUnionPrisma() {
    const queryRawUnsafe = vi.fn().mockImplementation((sql: string) => {
      if (sql.includes("owner_user_id")) {
        return Promise.resolve([
          {
            creative_skill_id: "my_personal",
            name: "我的技能",
            description: "个人资产",
            auto_match: 1,
            gmt_create: new Date("2026-01-01T00:00:00Z"),
          },
        ]);
      }
      return Promise.resolve([
        { source_skill_id: 3n, creative_skill_id: "deep_writing" },
      ]);
    });
    const userSkillFindMany = vi
      .fn()
      .mockResolvedValue([
        { skill_id: 3n, auto: 1, gmt_create: new Date("2026-02-01T00:00:00Z") },
      ]);
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

    // 统一按最近添加/创建时间倒序（§12.5）：官方引用时间更晚排在前，个人技能在后。
    expect(page.total).toBe(2);
    expect(page.records).toEqual([
      {
        creative_skill_id: "deep_writing",
        auto: true,
        name: "深度写作",
        description: "写作助手",
        cover_url: "https://x/cover.png",
        source: "official",
        skill_code: null,
        asset_domain: "official",
      },
      {
        creative_skill_id: "my_personal",
        auto: true,
        name: "我的技能",
        description: "个人资产",
        cover_url: null,
        source: null,
        skill_code: null,
        asset_domain: "personal",
      },
    ]);
    expectWhitelistOnly(page.records);
    expect(userSkillFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: { gmt_create: "desc" } }),
    );
    // 个人技能查询带 owner 谓词与 auto_match 透传（§16.1）：他人的个人技能不会进入结果。
    expect(queryRawUnsafe).toHaveBeenCalledWith(
      expect.stringContaining("owner_user_id = ?"),
      9n,
    );
    expect(queryRawUnsafe).toHaveBeenCalledWith(
      expect.stringContaining("auto_match"),
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
    expect(page.pages).toBe(2);
    expect(page.records).toEqual([
      {
        creative_skill_id: "my_personal",
        auto: true,
        name: "我的技能",
        description: "个人资产",
        cover_url: null,
        source: null,
        skill_code: null,
        asset_domain: "personal",
      },
    ]);
  });

  it("listMine 空结果返回 pages = 0（hasMore 恒 false）", async () => {
    const prisma = {
      user_skill: { findMany: vi.fn().mockResolvedValue([]) },
      skill: { findMany: vi.fn().mockResolvedValue([]) },
      $queryRawUnsafe: vi.fn().mockResolvedValue([]),
    } as unknown as PrismaClient;

    const page = await createSkillRepo(prisma).listMine("9", {
      pageNum: 1,
      pageSize: 50,
    });

    expect(page).toEqual({ records: [], total: 0, size: 50, current: 1, pages: 0 });
  });

  it("createPersonalSkill atomically makes its first immutable version active", async () => {
    const executeRawUnsafe = vi.fn().mockResolvedValue(1);
    const tx = { $executeRawUnsafe: executeRawUnsafe };
    const prisma = {
      skill: { findMany: vi.fn().mockResolvedValue([]) },
      $queryRawUnsafe: vi
        .fn()
        .mockResolvedValueOnce([{ c: 0n }])
        .mockResolvedValueOnce([{ c: 0n }]),
      $transaction: vi.fn(async (callback) => callback(tx)),
    } as unknown as PrismaClient;

    await expect(
      createSkillRepo(prisma).createPersonalSkill("9", {
        name: "Storyboard Pro",
        description: "分镜辅助",
        body: "# Storyboard",
      }),
    ).resolves.toMatchObject({ creative_skill_id: "storyboard_pro" });

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(executeRawUnsafe).toHaveBeenCalledTimes(2);
    const [skillSql, ...skillParams] = executeRawUnsafe.mock.calls[0];
    const [versionSql, versionId] = executeRawUnsafe.mock.calls[1];
    expect(skillSql).toContain("active_version_id");
    expect(versionSql).toContain("creative_skill_version");
    expect(skillParams).toContain(versionId);
  });

  it("deletePersonal 命中时物理删除本体及其 creative_skill_version 行", async () => {
    const queryRawUnsafe = vi.fn().mockImplementation((sql: string) => {
      if (sql.includes("SELECT name FROM creative_skill")) return [{ name: "故事板助手" }];
      if (sql.includes("COUNT(*) AS c FROM agent_runs")) return [{ c: 0n }];
      return []; // 终态引用列表为空
    });
    const executeRawUnsafe = vi.fn().mockImplementation((sql: string) => {
      if (sql.includes("creative_skill_version")) return 2;
      return 1;
    });
    const prisma = {
      ...withTransaction({ $queryRawUnsafe: queryRawUnsafe, $executeRawUnsafe: executeRawUnsafe }),
    } as unknown as PrismaClient;

    await expect(
      createSkillRepo(prisma).deletePersonal("9", "my_personal"),
    ).resolves.toBe(true);
    // 禁删检查执行两次（步骤 2 + 步骤 4 X 锁后复检）
    const countCalls = queryRawUnsafe.mock.calls.filter((call) =>
      (call[0] as string).includes("COUNT(*) AS c FROM agent_runs"),
    );
    expect(countCalls).toHaveLength(2);
    expect(executeRawUnsafe).toHaveBeenCalledTimes(2);
    expect(executeRawUnsafe).toHaveBeenCalledWith(
      expect.stringContaining("DELETE FROM creative_skill_version"),
      "my_personal",
    );
    // 最小事实（§13.2/§16.2）：激活埋点只增不改，删除技能不得触碰埋点表。
    for (const call of executeRawUnsafe.mock.calls) {
      expect(call[0] as string).not.toContain("creative_skill_activation");
    }
    for (const call of queryRawUnsafe.mock.calls) {
      expect(call[0] as string).not.toContain("creative_skill_activation");
    }
  });

  it("deletePersonal 非 owner 调用不命中：本体与版本行都不动", async () => {
    const queryRawUnsafe = vi.fn().mockResolvedValue([]); // name SELECT 0 命中
    const executeRawUnsafe = vi.fn();
    const prisma = {
      ...withTransaction({ $queryRawUnsafe: queryRawUnsafe, $executeRawUnsafe: executeRawUnsafe }),
    } as unknown as PrismaClient;

    await expect(
      createSkillRepo(prisma).deletePersonal("7", "my_personal"),
    ).resolves.toBe(false);
    expect(queryRawUnsafe).toHaveBeenCalledTimes(1);
    expect(executeRawUnsafe).not.toHaveBeenCalled();
  });

  it("deletePersonal 对 official 行不删（asset_domain 谓词保护，即使 owner 巧合匹配）", async () => {
    const queryRawUnsafe = vi.fn().mockResolvedValue([]);
    const executeRawUnsafe = vi.fn();
    const prisma = {
      ...withTransaction({ $queryRawUnsafe: queryRawUnsafe, $executeRawUnsafe: executeRawUnsafe }),
    } as unknown as PrismaClient;

    await expect(
      createSkillRepo(prisma).deletePersonal("0", "deep_writing"),
    ).resolves.toBe(false);
    const [sql, ...params] = queryRawUnsafe.mock.calls[0];
    expect(sql).toContain("SELECT name FROM creative_skill");
    expect(sql).toContain("asset_domain = 'personal'");
    expect(sql).toContain("owner_user_id = ?");
    expect(params).toEqual(["deep_writing", 0n]);
    expect(executeRawUnsafe).not.toHaveBeenCalled();
  });

  it("creative_skill 读查询失败时容错为空（表不存在不阻塞主路径）；deletePersonal 写失败则抛错", async () => {
    const queryRawUnsafe = vi.fn().mockRejectedValue(new Error("table missing"));
    const executeRawUnsafe = vi.fn().mockRejectedValue(new Error("table missing"));
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
      $queryRawUnsafe: queryRawUnsafe,
      $executeRawUnsafe: executeRawUnsafe,
      $transaction: vi.fn(
        async (cb: (t: Record<string, unknown>) => Promise<unknown>) =>
          cb({ $queryRawUnsafe: queryRawUnsafe, $executeRawUnsafe: executeRawUnsafe }),
      ),
    } as unknown as PrismaClient;
    const repo = createSkillRepo(prisma);

    const page = await repo.listMine("9", { pageNum: 1, pageSize: 10 });
    expect(page.total).toBe(1);
    expect(page.records[0]).toMatchObject({
      creative_skill_id: null,
      asset_domain: "official",
    });
    await expect(repo.resolveOfficialSkillId("deep_writing")).resolves.toBeNull();
    await expect(
      repo.findPersonalContent("9", "my_personal"),
    ).resolves.toBeNull();
    await expect(repo.deletePersonal("9", "my_personal")).rejects.toThrow(
      "table missing",
    );
  });

  it("deletePersonal 存在进行中 run 引用时抛 SkillInUseError，不执行任何删除", async () => {
    const queryRawUnsafe = vi.fn().mockImplementation((sql: string) => {
      if (sql.includes("SELECT name FROM creative_skill")) {
        return [{ name: "故事板助手" }];
      }
      return [{ c: 1n }]; // 禁删检查命中
    });
    const executeRawUnsafe = vi.fn();
    const prisma = {
      ...withTransaction({
        $queryRawUnsafe: queryRawUnsafe,
        $executeRawUnsafe: executeRawUnsafe,
      }),
    } as unknown as PrismaClient;

    const promise = createSkillRepo(prisma).deletePersonal("9", "story_board");
    await expect(promise).rejects.toThrow(SkillInUseError);
    await expect(promise).rejects.toMatchObject({
      skillName: "故事板助手",
      creativeSkillId: "story_board",
    });
    expect(executeRawUnsafe).not.toHaveBeenCalled();
    // fail-closed 写法：终态之外一律视为进行中（含 queued/running/awaiting_input）
    const countSql = queryRawUnsafe.mock.calls[1][0] as string;
    expect(countSql).toContain(
      "status NOT IN ('completed', 'failed', 'cancelled')",
    );
    expect(countSql).toContain("JSON_SEARCH(run_pin, 'one', ?)");
  });

  it("deletePersonal 终态 scrub：引用技能的历史 run 移除正文供应并重算 digest", async () => {
    const targetPin = pinWithSkills([TARGET_RESOURCE]);
    const queryRawUnsafe = vi.fn().mockImplementation((sql: string) => {
      if (sql.includes("SELECT name FROM creative_skill")) {
        return [{ name: "故事板助手" }];
      }
      if (sql.includes("COUNT(*) AS c FROM agent_runs")) return [{ c: 0n }];
      if (sql.includes("SELECT id, run_pin FROM agent_runs")) {
        return [{ id: 5n, run_pin: JSON.stringify(targetPin) }];
      }
      return [];
    });
    const executeRawUnsafe = vi.fn().mockReturnValue(1);
    const prisma = {
      ...withTransaction({
        $queryRawUnsafe: queryRawUnsafe,
        $executeRawUnsafe: executeRawUnsafe,
      }),
    } as unknown as PrismaClient;

    await expect(
      createSkillRepo(prisma).deletePersonal("9", "story_board"),
    ).resolves.toBe(true);
    const updateCall = executeRawUnsafe.mock.calls.find((call) =>
      (call[0] as string).includes("UPDATE agent_runs SET run_pin"),
    );
    expect(updateCall).toBeDefined();
    const [updateSql, pinValue, runId] = updateCall as [string, string, bigint];
    expect(updateSql).toContain("gmt_modified = CURRENT_TIMESTAMP(3)");
    expect(runId).toBe(5n);
    // 写回 pin：目标技能两数组移除（正文供应消失）、activations 保留（「曾使用」最小事实）
    const written = JSON.parse(pinValue) as AgentRunPin;
    expect(agentRunPinSchema.safeParse(written).success).toBe(true);
    expect(written.auto_creative_skill_candidates).toEqual([]);
    expect(written.creative_skill_resources).toEqual([]);
    expect(written.activated_creative_skill_versions).toEqual(
      targetPin.activated_creative_skill_versions,
    );
    // digest 重算正确（与契约规范化输入同构）
    const { pin_digest: _pinDigest, ...writtenSource } = written;
    expect(written.pin_digest).toBe(signRunPin(writtenSource).pin_digest);
  });

  it("deletePersonal 多技能 pin 只删目标技能，其他技能正文条目保留", async () => {
    const bothPin = pinWithSkills([TARGET_RESOURCE, OTHER_RESOURCE]);
    const queryRawUnsafe = vi.fn().mockImplementation((sql: string) => {
      if (sql.includes("SELECT name FROM creative_skill")) {
        return [{ name: "故事板助手" }];
      }
      if (sql.includes("COUNT(*) AS c FROM agent_runs")) return [{ c: 0n }];
      if (sql.includes("SELECT id, run_pin FROM agent_runs")) {
        return [{ id: 8n, run_pin: JSON.stringify(bothPin) }];
      }
      return [];
    });
    const executeRawUnsafe = vi.fn().mockReturnValue(1);
    const prisma = {
      ...withTransaction({
        $queryRawUnsafe: queryRawUnsafe,
        $executeRawUnsafe: executeRawUnsafe,
      }),
    } as unknown as PrismaClient;

    await expect(
      createSkillRepo(prisma).deletePersonal("9", "story_board"),
    ).resolves.toBe(true);
    const updateCall = executeRawUnsafe.mock.calls.find((call) =>
      (call[0] as string).includes("UPDATE agent_runs SET run_pin"),
    );
    const written = JSON.parse(updateCall![1] as string) as AgentRunPin;
    expect(written.creative_skill_resources).toEqual([OTHER_RESOURCE]);
    expect(written.creative_skill_resources[0]!.body).toBe(
      OTHER_RESOURCE.body,
    );
    expect(written.auto_creative_skill_candidates).toEqual([
      candidateOf(OTHER_RESOURCE),
    ]);
  });

  it("deletePersonal 终态引用无可 scrub 内容（NULL run_pin/不含目标技能）时不写库", async () => {
    const otherPin = pinWithSkills([OTHER_RESOURCE]);
    const queryRawUnsafe = vi.fn().mockImplementation((sql: string) => {
      if (sql.includes("SELECT name FROM creative_skill")) {
        return [{ name: "故事板助手" }];
      }
      if (sql.includes("COUNT(*) AS c FROM agent_runs")) return [{ c: 0n }];
      if (sql.includes("SELECT id, run_pin FROM agent_runs")) {
        // NULL run_pin（防御兜底）与不引用目标技能的 pin（scrub 无变化）都不触发写库
        return [
          { id: 6n, run_pin: null },
          { id: 7n, run_pin: JSON.stringify(otherPin) },
        ];
      }
      return [];
    });
    const executeRawUnsafe = vi.fn().mockReturnValue(1);
    const prisma = {
      ...withTransaction({
        $queryRawUnsafe: queryRawUnsafe,
        $executeRawUnsafe: executeRawUnsafe,
      }),
    } as unknown as PrismaClient;

    await expect(
      createSkillRepo(prisma).deletePersonal("9", "story_board"),
    ).resolves.toBe(true);
    expect(
      executeRawUnsafe.mock.calls.some((call) =>
        (call[0] as string).includes("UPDATE agent_runs"),
      ),
    ).toBe(false);
  });

  it("deletePersonal X 锁后复检命中进行中引用时整体回滚（版本行未删）", async () => {
    const activeCounts = [0n, 1n]; // 第一次检查 0，DELETE 后复检命中 1
    const queryRawUnsafe = vi.fn().mockImplementation((sql: string) => {
      if (sql.includes("SELECT name FROM creative_skill")) {
        return [{ name: "故事板助手" }];
      }
      if (sql.includes("COUNT(*) AS c FROM agent_runs")) {
        return [{ c: activeCounts.shift() ?? 0n }];
      }
      return [];
    });
    const executeRawUnsafe = vi.fn().mockReturnValue(1);
    const prisma = {
      ...withTransaction({
        $queryRawUnsafe: queryRawUnsafe,
        $executeRawUnsafe: executeRawUnsafe,
      }),
    } as unknown as PrismaClient;

    const promise = createSkillRepo(prisma).deletePersonal("9", "story_board");
    await expect(promise).rejects.toThrow(SkillInUseError);
    // 整体回滚：版本行 DELETE 未执行
    expect(
      executeRawUnsafe.mock.calls.some((call) =>
        (call[0] as string).includes("DELETE FROM creative_skill_version"),
      ),
    ).toBe(false);
  });

  it("findPersonalContent owner 命中返回 name/description/body（契约 §13.1）", async () => {
    const queryRawUnsafe = vi.fn().mockResolvedValue([
      { name: "我的技能", description: "个人资产", body: "正文内容" },
    ]);
    const prisma = {
      $queryRawUnsafe: queryRawUnsafe,
    } as unknown as PrismaClient;

    await expect(
      createSkillRepo(prisma).findPersonalContent("9", "my_personal"),
    ).resolves.toEqual({
      name: "我的技能",
      description: "个人资产",
      body: "正文内容",
    });
    const [sql, ...params] = queryRawUnsafe.mock.calls[0];
    expect(sql).toContain("asset_domain = 'personal'");
    expect(sql).toContain("owner_user_id = ?");
    expect(sql).toContain("creative_skill_version");
    expect(params).toEqual([9n, "my_personal"]);
  });

  it("findPersonalContent 非 owner 调用不命中（null，不泄露存在性）", async () => {
    const queryRawUnsafe = vi.fn().mockResolvedValue([]);
    const prisma = {
      $queryRawUnsafe: queryRawUnsafe,
    } as unknown as PrismaClient;

    await expect(
      createSkillRepo(prisma).findPersonalContent("7", "my_personal"),
    ).resolves.toBeNull();
    expect(queryRawUnsafe).toHaveBeenCalledWith(
      expect.stringContaining("owner_user_id = ?"),
      7n,
      "my_personal",
    );
  });
});

// 个人技能名称可用性（IK60WU 契约 §5.2；IK60X1 总结管道提议名预检 §15.4）：
// 官方保留名 → reserved；同用户同 Name Key → conflict；否则 ok；
// createPersonalSkill 与预检共用同一套校验。
describe("SkillRepo.checkPersonalNameAvailable / createPersonalSkill 名称校验", () => {
  function prismaWithNames(input: {
    officialNames: string[];
    personalNameKeys?: string[];
  }) {
    return {
      skill: {
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
      skill: {
        count: vi.fn().mockResolvedValue(1),
        findMany: vi.fn().mockResolvedValue([
          { id: 1n, name: "技能A", description: null, cover_url: null, source: "official", skill_code: "cn01" },
        ]),
      },
      user_skill: { findMany: vi.fn().mockResolvedValue([]) },
      $queryRawUnsafe: vi.fn().mockResolvedValue([]),
    } as unknown as PrismaClient;

    const page = await createSkillRepo(prisma).listLibrary("100", { pageNum: 1, pageSize: 50 });
    expect(page.records[0]).toMatchObject({ skill_code: "cn01" });
  });

  it("listMine records 含 skill_code（skill 快照存在时）", async () => {
    const prisma = {
      skill: {
        findMany: vi.fn().mockResolvedValue([
          { id: 1n, name: "技能A", description: null, cover_url: null, source: "official", skill_code: "cn01" },
        ]),
      },
      user_skill: {
        count: vi.fn().mockResolvedValue(1),
        findMany: vi.fn().mockResolvedValue([{ skill_id: 1n, auto: 1 }]),
      },
      $queryRawUnsafe: vi.fn().mockResolvedValue([]),
    } as unknown as PrismaClient;

    const page = await createSkillRepo(prisma).listMine("100", { pageNum: 1, pageSize: 50 });
    expect(page.records[0]).toMatchObject({ skill_code: "cn01" });
  });
});
