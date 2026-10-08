import { Controller, Get, Param, Query } from "@nestjs/common";
import { NewApiError } from "@lib/core";
import { ok } from "@lib/contracts";
import { CurrentUser } from "@lib/infra/decorators/current-user.decorator.js";
import { logger } from "@lib/infra/logging/blue-whale-logger.js";
import { AccountService } from "@lib/shared/account/account.service.js";
import { quotaToCredits } from "@lib/shared/credits/credits.js";
import { ProjectService } from "@lib/shared/project/project.service.js";
import { SystemSettingsService } from "@lib/shared/system-settings/index.js";
import type { AuthenticatedUser } from "@lib/shared/types/authenticated-user.js";
import { agentServiceBaseUrl, agentServiceToken, agentTenantId } from "@lib/shared/agent/agent-service-env.js";

const WINDOW_SLACK_SECONDS = 300;
const MAX_LOG_PAGES = 10;
const SUM_BUDGET_MS = 15_000;

interface AgentRunView {
  run_id?: unknown;
  created_at?: unknown;
  finished_at?: unknown;
}


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
    private readonly settings: SystemSettingsService,
  ) {}

  @Get("sessions/:sessionId")
  async sessionCredits(
    @Param("sessionId") sessionId: string,
    @Query("project_id") projectId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    if (!projectId) throw new NewApiError("缺少 project_id", 400, "invalid_request");

    const owned = await this.project.findOwnedById(projectId, user.userId);
    if (!owned) throw new NewApiError("项目不可访问", 403, "forbidden");

    const runs = await this.fetchRuns(projectId, sessionId, user.userId);
    const agentRunIds = runs
      .map((run) => run.run_id)
      .filter((id): id is string => typeof id === "string" && id.length > 0);

    if (agentRunIds.length === 0) {
      const genuinelyZero = runs.length === 0;
      return ok({
        credits: genuinelyZero ? 0 : null,
        quota: genuinelyZero ? 0 : null,
        matched: 0,
        runCount: runs.length,
        truncated: false,
      });
    }

    const starts = runs.map((run) => secondsOf(run.created_at)).filter((s): s is number => s !== null);
    const ends = runs.map((run) => secondsOf(run.finished_at)).filter((s): s is number => s !== null);
    const window: {
      startTimestamp?: number;
      endTimestamp?: number;
      maxPages: number;
      budgetMs: number;
    } = {
      maxPages: MAX_LOG_PAGES,
      budgetMs: SUM_BUDGET_MS,
    };
    if (starts.length > 0) window.startTimestamp = Math.min(...starts) - WINDOW_SLACK_SECONDS;
    if (ends.length === runs.length && ends.length > 0) {
      window.endTimestamp = Math.max(...ends) + WINDOW_SLACK_SECONDS;
    }

    const summed = await this.account.sumAgentRunQuota(
      await this.settings.requireUpstreamKey(),
      agentRunIds,
      window,
    );
    const partiallyAttributed = agentRunIds.length < runs.length;

    const nothingMatched = summed.matched === 0;
    return ok({
      credits: nothingMatched ? null : quotaToCredits(summed.quota),
      quota: nothingMatched ? null : summed.quota,
      matched: summed.matched,
      runCount: runs.length,
      truncated: summed.truncated || partiallyAttributed || nothingMatched,
    });
  }

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

    let body: { items?: unknown } | null;
    try {
      body = (await response.json()) as { items?: unknown } | null;
    } catch (error) {
      logger.error(
        `[agent/billing] agent 响应不是 JSON: ${error instanceof Error ? error.message : String(error)}`,
      );
      throw new NewApiError("读取会话运行记录失败", 502, "agent_error");
    }
    return Array.isArray(body?.items) ? (body.items as AgentRunView[]) : [];
  }
}
