import { DomainError, SKILL_ERROR_SPECS } from "@lib/contracts";
import { describe, expect, it, vi } from "vitest";

import { handleFormatSkillDraft } from "./skill-format.js";

const rules = "格式规则";
const GOOD = `---\nname: 拆解短视频\ndescription: 一句话说明\n---\n\n正文。\n`;

async function rejection(run: () => Promise<unknown>): Promise<DomainError> {
  await expect(run()).rejects.toBeInstanceOf(DomainError);
  return (await run().catch((e: unknown) => e)) as DomainError;
}

describe("AI 格式化草稿", () => {
  it("空草稿 → 400，是用户的输入问题", async () => {
    const error = await rejection(() =>
      handleFormatSkillDraft("   ", { ai: { complete: vi.fn() }, rules }),
    );
    expect({ code: error.code, status: error.status }).toEqual({
      code: SKILL_ERROR_SPECS.SKILL_FORMAT_INVALID.code,
      status: 400,
    });
  });

  it("AI 调不通 → 503，是我们这边不可用，不该说成用户参数错", async () => {
    const error = await rejection(() =>
      handleFormatSkillDraft("草稿", {
        ai: { complete: vi.fn().mockRejectedValue(new Error("upstream down")) },
        rules,
      }),
    );
    expect({ code: error.code, status: error.status }).toEqual({
      code: SKILL_ERROR_SPECS.SKILL_FORMAT_FAILED.code,
      status: 503,
    });
    // 上游原文不许漏给用户。
    expect(error.message).not.toContain("upstream");
  });

  it("AI 返回的东西解析不出来 → 同码，但文案要告诉用户草稿还在", async () => {
    const error = await rejection(() =>
      handleFormatSkillDraft("草稿", {
        ai: { complete: vi.fn().mockResolvedValue("不是 SKILL.md") },
        rules,
      }),
    );
    expect(error.code).toBe(SKILL_ERROR_SPECS.SKILL_FORMAT_FAILED.code);
    expect(error.message).toContain("已保留原草稿");
  });

  it("正常格式化照旧返回 ok 信封", async () => {
    const result = await handleFormatSkillDraft("草稿", {
      ai: { complete: vi.fn().mockResolvedValue(GOOD) },
      rules,
    });
    expect(result).toMatchObject({ code: 200, data: { content: GOOD } });
  });
});
