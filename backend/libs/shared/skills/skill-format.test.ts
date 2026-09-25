import { DomainError, SKILL_ERROR_SPECS } from "@lib/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createSkillFormatDeps, handleFormatSkillDraft } from "./skill-format.js";

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

/* ────────────────────────────────────────────────────────────────────────────
 * 依赖组装：地址读环境变量，凭证读**配置表**（所以这个函数是异步的）
 * ──────────────────────────────────────────────────────────────────────────── */

describe("createSkillFormatDeps", () => {
  const ENV_KEYS = ["SKILL_FORMAT_MODEL", "NEW_API_BASE_URL"] as const;

  beforeEach(() => {
    process.env.SKILL_FORMAT_MODEL = "gpt-test";
    process.env.NEW_API_BASE_URL = "http://new-api:3006";
  });

  afterEach(() => {
    for (const k of ENV_KEYS) delete process.env[k];
  });

  it("★ 配了 → 组装出调用客户端（凭证来自配置表，不再是环境变量）", async () => {
    const requireUpstreamKey = vi.fn(async () => "sk-from-config");

    const deps = await createSkillFormatDeps({ requireUpstreamKey });

    expect(deps).not.toBeNull();
    expect(deps!.rules).toContain("SKILL.md");
    expect(requireUpstreamKey).toHaveBeenCalled();
  });

  it("★ 凭证没配 → 返回 null（调用方翻成 503），**不带着空串去打上游**", async () => {
    const deps = await createSkillFormatDeps({
      requireUpstreamKey: async () => {
        throw new Error("上游凭证未配置");
      },
    });

    expect(deps).toBeNull();
  });

  it("缺地址 → 同样 null（不拼出一个没有 host 的 URL）", async () => {
    delete process.env.NEW_API_BASE_URL;
    const deps = await createSkillFormatDeps({ requireUpstreamKey: async () => "sk-x" });
    expect(deps).toBeNull();
  });

  it("缺模型名 → 直接 null，连配置都不查", async () => {
    delete process.env.SKILL_FORMAT_MODEL;
    const requireUpstreamKey = vi.fn(async () => "sk-x");

    expect(await createSkillFormatDeps({ requireUpstreamKey })).toBeNull();
    expect(requireUpstreamKey).not.toHaveBeenCalled();
  });
});
