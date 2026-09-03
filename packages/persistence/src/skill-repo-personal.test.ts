// IK74V8：从 skill-repo.test.ts 拆出（≤800 行硬线）。用例逐块搬运，断言不变。
import type {PrismaClient} from "@prisma/client";
import {describe, expect, it, vi} from "vitest";
import {agentRunPinSchema, type AgentRunPin} from "@blue-whale/contracts";
import {createSkillRepo, SkillInUseError} from "./skill-repo.js";

// SkillRepo 资产边界（契约 docs/specs/2026-08-03-creative-skill-asset-contract.md §2/§3/§6/§11）：
// wire 主键一律 creative_skill_id；自增 id/skill_id、content/body/prompt 永不出库；
// mine = 官方引用（official）∪ 名下个人技能（personal）；个人技能跨用户按不存在处理；
// library v2（IK60WT）：分类过滤、featured/most_used/newest 排序、zh/en 语言解析、
// keyword 命中解析语言 name/description + search_keywords（绝不匹配 content）、
// usage_count = creative_skill_activation COUNT(DISTINCT user_id)。
import {OTHER_RESOURCE, TARGET_RESOURCE, candidateOf, expectWhitelistOnly, pinWithSkills, signRunPin, withTransaction} from "./skill-repo.testlib.js";

describe("SkillRepo — 我的技能与个人技能生命周期", () => {
  function createUnionPrisma() {
    const queryRawUnsafe = vi.fn().mockImplementation((sql: string) => {
      if (sql.includes("owner_user_id")) {
        return Promise.resolve([
          {
            creative_skill_id: "my_personal",
            name: "我的技能",
            description: "个人资产",
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
        { skill_id: 3n, gmt_create: new Date("2026-02-01T00:00:00Z") },
      ]);
    const prisma = {
      user_skill: { findMany: userSkillFindMany },
      skill: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 3n,
            name: "Deep Writing",
            description: "写作助手",
            cover_url: "https://x/cover.png",
            source: "official",
            name_en: null,
            name_zh: "深度写作",
            description_en: null,
            description_zh: null,
          },
        ]),
      },
      $queryRawUnsafe: queryRawUnsafe,
    } as unknown as PrismaClient;
    return { prisma, queryRawUnsafe, userSkillFindMany };
  }

  it("listMine 官方引用标题中文优先解析（name_zh → 回退单语 name），与技能库一致（IKCXOK）", async () => {
    // 真实存量：name_zh 已填充、name_en 为 NULL、skill.name 是英文标题 —— 修复前直接
    // 透传 s.name 出英文；修复后走 §11.4 resolveName("zh") 中文优先，返回 name_zh。
    const { prisma } = createUnionPrisma();
    const page = await createSkillRepo(prisma).listMine("9", {
      pageNum: 1,
      pageSize: 10,
    });
    expect(page.records[0]).toMatchObject({
      creative_skill_id: "deep_writing",
      name: "深度写作",
      asset_domain: "official",
    });
  });

  it("listMine 官方引用 name_zh/name_en 均缺失时回退单语 name，不返回空", async () => {
    const prisma = {
      user_skill: {
        findMany: vi.fn().mockResolvedValue([{ skill_id: 3n, gmt_create: new Date("2026-02-01T00:00:00Z") }]),
      },
      skill: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 3n,
            name: "深度写作",
            description: "写作助手",
            cover_url: null,
            source: "official",
            name_en: null,
            name_zh: null,
          },
        ]),
      },
      $queryRawUnsafe: vi.fn().mockResolvedValue([]),
    } as unknown as PrismaClient;
    const page = await createSkillRepo(prisma).listMine("9", {
      pageNum: 1,
      pageSize: 10,
    });
    expect(page.records[0]).toMatchObject({
      name: "深度写作",
      asset_domain: "official",
    });
  });

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
        name: "深度写作",
        description: "写作助手",
        cover_url: "https://x/cover.png",
        source: "official",
        skill_code: null,
        asset_domain: "official",
      },
      {
        creative_skill_id: "my_personal",
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
    // 个人技能查询带 owner 谓词（§16.1）：他人的个人技能不会进入结果。
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
    expect(page.pages).toBe(2);
    expect(page.records).toEqual([
      {
        creative_skill_id: "my_personal",
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
        findMany: vi.fn().mockResolvedValue([{ skill_id: 3n }]),
      },
      skill: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 3n,
            name: "深度写作",
            description: "写作助手",
            cover_url: null,
            source: "official",
            name_en: null,
            name_zh: null,
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
