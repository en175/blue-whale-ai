// IKAFPC：按能力券号汇总本会话消费。
//
// 这里锁住的是全案的正确性核心——**归属只认券号，不认时间窗**。new-api 只有「用户」这一个
// 维度，同一个账号可能同时跑两个 Agent 会话、也可能一边对话一边出图；按时间窗求和会把这些
// 全算进来，而按券号筛是逐笔精确的。
import { describe, expect, it } from "vitest";

import { createNewApiClient } from "./new-api-client.js";
import { jsonResponse } from "./new-api-client.testlib.js";

/** 造一条账单。`other` 是 new-api 写的 JSON 字符串。 */
function log(quota: number, agentRunId?: string) {
  return {
    id: Math.trunc(quota),
    type: 2,
    quota,
    model_name: "MiniMax-M3",
    created_at: 1_700_000_000,
    other: agentRunId
      ? JSON.stringify({ billing_authority: "agent_gateway", agent_run_id: agentRunId })
      : JSON.stringify({ billing_source: "wallet" }),
  };
}

function clientReturning(pages: Array<Array<ReturnType<typeof log>>>, urls: string[] = []) {
  return createNewApiClient({
    baseUrl: "http://new-api.test",
    fetchImpl: async (input) => {
      const url = String(input);
      urls.push(url);
      const page = Number(new URL(url).searchParams.get("p") ?? 1);
      const items = pages[page - 1] ?? [];
      return jsonResponse({ success: true, message: "", data: { items, total: 999 } });
    },
  });
}

describe("sumAgentRunQuota", () => {
  it("只把属于这些券的账加起来", async () => {
    const client = clientReturning([[log(100, "run_a"), log(250, "run_b")]]);
    const result = await client.sumAgentRunQuota("sk-user", ["run_a", "run_b"]);
    expect(result).toEqual({ quota: 350, matched: 2, truncated: false });
  });

  it("同账号另一个会话的账不算进来——这是并发下唯一算得准的口径", async () => {
    const client = clientReturning([[log(100, "run_mine"), log(9999, "run_other_session")]]);
    const result = await client.sumAgentRunQuota("sk-user", ["run_mine"]);
    expect(result.quota).toBe(100);
    expect(result.matched).toBe(1);
  });

  it("出图出片的账没有券号，天然被排除", async () => {
    // dock 栏出图不走能力券链路，账单 other 里根本没有 agent_run_id。
    const client = clientReturning([[log(100, "run_a"), log(5000)]]);
    const result = await client.sumAgentRunQuota("sk-user", ["run_a"]);
    expect(result.quota).toBe(100);
  });

  it("other 是坏 JSON 时当作「不属于任何券」丢掉，不炸", async () => {
    const client = clientReturning([[{ ...log(100, "run_a"), other: "{not json" }, log(30, "run_a")]]);
    const result = await client.sumAgentRunQuota("sk-user", ["run_a"]);
    expect(result.quota).toBe(30);
  });

  it("一张券都没给时直接返回 0，连请求都不发", async () => {
    const urls: string[] = [];
    const client = clientReturning([[log(100, "run_a")]], urls);
    const result = await client.sumAgentRunQuota("sk-user", []);
    expect(result).toEqual({ quota: 0, matched: 0, truncated: false });
    expect(urls).toEqual([]);
  });

  it("满页时继续翻，不满页即停", async () => {
    const full = Array.from({ length: 100 }, () => log(1, "run_a"));
    const urls: string[] = [];
    const client = clientReturning([full, [log(5, "run_a")]], urls);
    const result = await client.sumAgentRunQuota("sk-user", ["run_a"]);
    expect(result.quota).toBe(105);
    expect(urls).toHaveLength(2);
  });

  it("翻到页数上限仍有下一页时如实标记 truncated——那个数是下界不是确切账", async () => {
    const full = Array.from({ length: 100 }, () => log(1, "run_a"));
    const client = clientReturning([full, full]);
    const result = await client.sumAgentRunQuota("sk-user", ["run_a"], { maxPages: 2 });
    expect(result.quota).toBe(200);
    expect(result.truncated).toBe(true);
  });

  it("时间窗只用于收敛翻页，会随请求带上", async () => {
    const urls: string[] = [];
    const client = clientReturning([[log(10, "run_a")]], urls);
    await client.sumAgentRunQuota("sk-user", ["run_a"], {
      startTimestamp: 1_700_000_000,
      endTimestamp: 1_700_000_600,
    });
    expect(urls[0]).toContain("start_timestamp=1700000000");
    expect(urls[0]).toContain("end_timestamp=1700000600");
    // type=2 是消费日志；不带这个会把充值记录也拉回来。
    expect(urls[0]).toContain("type=2");
  });
});
