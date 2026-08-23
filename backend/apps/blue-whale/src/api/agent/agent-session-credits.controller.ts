// IKAFPC：本会话累计消耗积分。
//
// 归属只认**券号**，不认时间窗。new-api 只有「用户」这一个维度，没有会话与项目；同一个账号
// 完全可能同时跑两个 Agent 会话，也完全可能一边对话一边在 dock 栏出图。按「用户 + 时间窗」
// 求和会把这些全算进来。而 new-api 已经把 `other.run_capability_id` 写进每一笔走能力券的账单，
// 一张券对应一次 Run，逐笔精确——出图出片不走能力券链路，账单上根本没有这个字段。
//
// 因此 new-api 一行都不用改：它只是把一个自己看不懂的不透明 id 原样记下来，
// 「哪些券属于哪个会话」这层知识留在蓝鲸这边。
//
// 求和只能发生在本层：agent 与后端之间用的是服务令牌，它手里没有用户凭证，调不了
// /api/log/self；而浏览器请求带着用户 token 到达这里。agent 因此完全不碰钱，只负责记住
// 「这个 Run 用的是哪张券」。
import { Controller, Get, Headers, Param, Query } from "@nestjs/common";
import { NewApiError } from "@blue-whale/core";
import { ok } from "@blue-whale/contracts";
import { CurrentUser } from "@lib/infra/decorators/current-user.decorator.js";
import { logger } from "@lib/infra/logging/blue-whale-logger.js";
import { AccountService } from "@lib/shared/account/account.service.js";
import { quotaToCredits } from "@lib/shared/credits/credits.js";
import { ProjectService } from "@lib/shared/project/project.service.js";
import { parseBearerToken } from "@lib/shared/errors/bearer-token.js";
import type { AuthenticatedUser } from "@lib/shared/types/authenticated-user.js";

/** 查账时间窗在 Run 起止两端各放宽的秒数。窗口只用于收敛翻页，放宽不影响归属判定。 */
const WINDOW_SLACK_SECONDS = 300;
/** 翻页上限：一个会话的 Run 数有限，10 页 × 100 条足够；超出会如实标记 truncated。 */
const MAX_LOG_PAGES = 10;

interface AgentRunView {
  run_id?: unknown;
  capability_id?: unknown;
  created_at?: unknown;
  finished_at?: unknown;
}

function agentServiceBaseUrl(): string {
  return process.env.AGENT_SERVICE_BASE_URL?.trim() || "http://localhost:4111";
}
function agentServiceToken(): string {
  return process.env.AGENT_SERVICE_TOKEN?.trim() || "";
}
function agentTenantId(): string {
  return process.env.AGENT_TENANT_ID?.trim() || "default";
}

/** ISO 时间 → 秒级时间戳；缺失或不可解析返回 null（调用方自行决定怎么兜底）。 */
function secondsOf(value: unknown): number | null {
  if (typeof value !== "string" || !value) return null;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? null : Math.floor(ms / 1000);
}

@Controller("agent/billing")
export class AgentSessionCreditsController {
  constructor(
    private readonly project: ProjectService,
    private readonly account: AccountService,
  ) {}

  /**
   * GET /api/agent/billing/sessions/:sessionId?project_id=xxx
   *
   * 返回本会话到目前为止累计消耗的积分。
   */
  @Get("sessions/:sessionId")
  async sessionCredits(
    @Param("sessionId") sessionId: string,
    @Query("project_id") projectId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Headers("authorization") authorization?: string,
  ) {
    const token = parseBearerToken(authorization);
    if (!token) throw new NewApiError("未提供有效令牌", 401, "unauthorized");
    if (!projectId) throw new NewApiError("缺少 project_id", 400, "invalid_request");

    const owned = await this.project.findOwnedById(projectId, user.userId);
    if (!owned) throw new NewApiError("项目不可访问", 403, "forbidden");

    const runs = await this.fetchRuns(projectId, sessionId, user.userId);
    const capabilityIds = runs
      .map((run) => run.capability_id)
      .filter((id): id is string => typeof id === "string" && id.length > 0);

    // 一张券都没有：这个会话还没真正跑过模型，是实打实的 0，不是查不到。
    if (capabilityIds.length === 0) {
      return ok({ credits: 0, quota: 0, matched: 0, runCount: runs.length, truncated: false });
    }

    const starts = runs.map((run) => secondsOf(run.created_at)).filter((s): s is number => s !== null);
    const ends = runs.map((run) => secondsOf(run.finished_at)).filter((s): s is number => s !== null);
    const window: { startTimestamp?: number; endTimestamp?: number; maxPages: number } = {
      maxPages: MAX_LOG_PAGES,
    };
    if (starts.length > 0) window.startTimestamp = Math.min(...starts) - WINDOW_SLACK_SECONDS;
    // 还在跑的 Run 没有 finished_at：此时不设上界，否则会把正在产生的账单挡在窗外。
    if (ends.length === runs.length && ends.length > 0) {
      window.endTimestamp = Math.max(...ends) + WINDOW_SLACK_SECONDS;
    }

    const summed = await this.account.sumRunCapabilityQuota(token, capabilityIds, window);
    return ok({
      credits: quotaToCredits(summed.quota),
      quota: summed.quota,
      matched: summed.matched,
      runCount: runs.length,
      // 翻页到顶时 quota 是下界而非确切值，如实告诉前端，别把偏小的数说成确切花费。
      truncated: summed.truncated,
    });
  }

  /** 向 agent 服务取本会话的全部 Run（服务凭证 + 可信上下文头，与 BFF 代理同一套）。 */
  private async fetchRuns(projectId: string, sessionId: string, userId: string): Promise<AgentRunView[]> {
    const url =
      `${agentServiceBaseUrl()}/v1/projects/${encodeURIComponent(projectId)}` +
      `/sessions/${encodeURIComponent(sessionId)}/runs`;
    let response: globalThis.Response;
    try {
      response = await fetch(url, {
        method: "GET",
        headers: {
          authorization: `Bearer ${agentServiceToken()}`,
          "x-blue-whale-tenant-id": agentTenantId(),
          "x-blue-whale-user-id": userId,
          "x-blue-whale-project-id": projectId,
        },
        signal: AbortSignal.timeout(10_000),
      });
    } catch (error) {
      logger.error(
        `[agent/billing] agent 服务不可用: ${error instanceof Error ? error.message : String(error)}`,
      );
      throw new NewApiError("上游 agent 服务不可用", 502, "agent_unavailable");
    }
    if (response.status === 404) throw new NewApiError("会话不存在", 404, "session_not_found");
    if (!response.ok) throw new NewApiError("读取会话运行记录失败", 502, "agent_error");

    const body = (await response.json()) as { items?: unknown };
    return Array.isArray(body.items) ? (body.items as AgentRunView[]) : [];
  }
}
