import { DomainError, SKILL_ERROR_SPECS } from "@lib/contracts";
import {
  SkillAddConflictError,
  SkillNameConflictError,
  SkillNameReservedError,
} from "@lib/shared/persistence/index.js";
import { describe, expect, it, vi } from "vitest";

import {
  handleAddSkill,
  handleCreateSkill,
  handleDeletePersonalSkill,
  handleGetPersonalSkill,
  handleRemoveSkill,
} from "./skill-writes.js";

async function rejection(run: () => Promise<unknown>): Promise<DomainError> {
  await expect(run()).rejects.toBeInstanceOf(DomainError);
  return (await run().catch((e: unknown) => e)) as DomainError;
}

const svc = (overrides: Record<string, unknown> = {}) =>
  ({
    resolveOfficialSkillId: vi.fn().mockResolvedValue("official-1"),
    addReference: vi.fn().mockResolvedValue(undefined),
    removeReferenceByCreativeSkillId: vi.fn().mockResolvedValue(undefined),
    createPersonalSkill: vi.fn(),
    findPersonalContent: vi.fn(),
    deletePersonal: vi.fn().mockResolvedValue(true),
    ...overrides,
  }) as never;

const VALID_MD = `---\nname: 拆解短视频\ndescription: 一句话说明\n---\n\n正文。\n`;

describe("技能 id 不合规 → 当作不存在", () => {
  it("抛 100100，HTTP 404——此前在 POST 上回 201、GET 上回 200", async () => {
    const error = await rejection(() => handleAddSkill("7", "Bad-ID!", svc()));
    expect({ code: error.code, status: error.status }).toEqual({
      code: SKILL_ERROR_SPECS.SKILL_NOT_FOUND.code,
      status: 404,
    });
    expect(error.message).toContain("Bad-ID!");
  });

  it("不合规就不该打到服务层", async () => {
    const skills = svc();
    await rejection(() => handleRemoveSkill("7", "X", skills));
    expect(
      (skills as unknown as { resolveOfficialSkillId: ReturnType<typeof vi.fn> })
        .resolveOfficialSkillId,
    ).not.toHaveBeenCalled();
  });
});

describe("技能不存在", () => {
  it("add：官方技能查不到 → 404", async () => {
    const error = await rejection(() =>
      handleAddSkill("7", "valid_skill_id", svc({ resolveOfficialSkillId: vi.fn().mockResolvedValue(null) })),
    );
    expect(error.status).toBe(404);
  });

  it("get personal：查不到正文 → 404", async () => {
    const error = await rejection(() =>
      handleGetPersonalSkill("7", "valid_skill_id", svc({ findPersonalContent: vi.fn().mockResolvedValue(null) })),
    );
    expect(error.status).toBe(404);
  });

  it("delete personal：没删掉 → 404", async () => {
    const error = await rejection(() =>
      handleDeletePersonalSkill("7", "valid_skill_id", svc({ deletePersonal: vi.fn().mockResolvedValue(false) })),
    );
    expect(error.status).toBe(404);
  });
});

describe("SKILL.md 不合法 → 400，且文案要点名缺了哪一格", () => {
  const cases: [string, string, string][] = [
    ["没有 frontmatter", "只有正文，没有任何 frontmatter。", "缺少 frontmatter"],
    ["名称为空", `---\nname: "  "\ndescription: d\n---\n\n正文\n`, "名称不能为空"],
    ["简介为空", `---\nname: n\ndescription: "  "\n---\n\n正文\n`, "简介不能为空"],
    ["正文为空", `---\nname: n\ndescription: d\n---\n\n   \n`, "正文不能为空"],
  ];
  for (const [label, content, expected] of cases) {
    it(label, async () => {
      const error = await rejection(() => handleCreateSkill("7", content, svc()));
      expect({ code: error.code, status: error.status }).toEqual({
        code: SKILL_ERROR_SPECS.SKILL_FORMAT_INVALID.code,
        status: 400,
      });
      expect(error.message).toContain(expected);
    });
  }
});

describe("冲突类 → 409，不是 400", () => {
  it("同名个人技能", async () => {
    const error = await rejection(() =>
      handleCreateSkill("7", VALID_MD, svc({
        createPersonalSkill: vi.fn().mockRejectedValue(new SkillNameConflictError("拆解短视频")),
      })),
    );
    expect({ code: error.code, status: error.status }).toEqual({
      code: SKILL_ERROR_SPECS.SKILL_NAME_CONFLICT.code,
      status: 409,
    });
  });

  it("名称与官方技能冲突", async () => {
    const error = await rejection(() =>
      handleCreateSkill("7", VALID_MD, svc({
        createPersonalSkill: vi.fn().mockRejectedValue(new SkillNameReservedError("拆解短视频")),
      })),
    );
    expect(error.status).toBe(409);
    expect(error.code).toBe(SKILL_ERROR_SPECS.SKILL_NAME_RESERVED.code);
  });

  it("添加官方技能与个人技能重名，文案点名是哪一个", async () => {
    const error = await rejection(() =>
      handleAddSkill("7", "valid_skill_id", svc({
        addReference: vi.fn().mockRejectedValue(new SkillAddConflictError("我的拆解")),
      })),
    );
    expect(error.status).toBe(409);
    expect(error.message).toContain("我的拆解");
  });

});

describe("不是 DomainError 的异常照旧往上抛", () => {
  it("服务层抛别的错不被吞成一个技能错误", async () => {
    const boom = new Error("connect ECONNREFUSED");
    await expect(
      handleCreateSkill("7", VALID_MD, svc({ createPersonalSkill: vi.fn().mockRejectedValue(boom) })),
    ).rejects.toBe(boom);
  });
});
