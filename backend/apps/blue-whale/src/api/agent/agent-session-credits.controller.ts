// IKAFPC / IKCGE7：本会话累计消耗积分。
//
// 归属只认 **Run 号**，不认时间窗。new-api 只有「用户」这一个维度，没有会话与项目；同一个账号
// 完全可能同时跑两个 Agent 会话，也完全可能一边对话一边在 dock 栏出图。按「用户 + 时间窗」
// 求和会把这些全算进来。而 new-api 把 `other.agent_run_id` 写进每一笔经蓝鲸网关代打的账单，
// 逐笔精确——出图出片不走这条链路，账单上根本没有这个字段。
//
// 券退役前这里认的是券号（`other.run_capability_id`）。那意味着「这个会话花了多少钱」这件事，
// 悬挂在一个一次性凭证的编号上：券没领到、券号没写下来，账就永久对不回来。Run 号是 Run 自己的
// 身份，它一定存在，也不会随下一次凭证机制变更而消失。
//
// 求和只能发生在本层：agent 与后端之间用的是服务令牌，它手里没有用户凭证，调不了
// /api/log/self；而浏览器请求带着用户 token 到达这里。agent 因此完全不碰钱。
import { Controller, Get, Headers, Param, Query } from "@nestjs/common";
import { NewApiError } from "@lib/core";
import { ok } from "@lib/contracts";
import { CurrentUser } from "@lib/infra/decorators/current-user.decorator.js";
import { logger } from "@lib/infra/logging/blue-whale-logger.js";
import { AccountService } from "@lib/shared/account/account.service.js";
import { quotaToCredits } from "@lib/shared/credits/credits.js";
import { ProjectService } from "@lib/shared/project/project.service.js";
import { parseBearerToken } from "@lib/shared/errors/bearer-token.js";
import type { AuthenticatedUser } from "@lib/shared/types/authenticated-user.js";
import { agentServiceBaseUrl, agentServiceToken, agentTenantId } from "@lib/shared/agent/agent-service-env.js";

/** 查账时间窗在 Run 起止两端各放宽的秒数。窗口只用于收敛翻页，放宽不影响归属判定。 */
const WINDOW_SLACK_SECONDS = 300;
/** 翻页上限：一个会话的 Run 数有限，10 页 × 100 条足够；超出会如实标记 truncated。 */
const MAX_LOG_PAGES = 10;
/**
 * 求和这一段的时间预算（毫秒）。
 *
 * 上面 fetchRuns 已经占了最多 10 秒，加上这 15 秒，单个请求的上游 I/O 封顶 25 秒——
 * 忙账户被迫翻满 10 页时，浏览器早就超时走人，而 handler 还在烧上游调用（审查 W·A13）。
 * 到点就认账：给一个下界并标 truncated，让前端说「至少花了这么多」，而不是把连接挂死。
 */
const SUM_BUDGET_MS = 15_000;

interface AgentRunView {
  run_id?: unknown;
  created_at?: unknown;
  finished_at?: unknown;
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
    const agentRunIds = runs
      .map((run) => run.run_id)
      .filter((id): id is string => typeof id === "string" && id.length > 0);

    // 一个 Run 号都没读到。**不要读成「这个会话没花过钱」**——更可能是 agent 那边取数失败或
    // 返回了意料之外的形状。
    //
    // 本层没有能力分辨这两者，所以**不编一个数**：`credits: null` 就是「不知道」。
    // 此前这里返回 `credits: 0` 并在注释里断言那是实打实的 0——它无从知道这件事，
    // 而 `truncated: false` 还主动为这个错误答案背书（审查 W·P1）。工单原话：
    // 「nullable 是有意义的：取数失败 / 尚未回填 / 老数据，与『真的花了 0』是两回事，不许默认成 0。」
    if (agentRunIds.length === 0) {
      // 一个 Run 都没有，才是货真价实的 0——那时候确实什么都没发生。
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
    // 还在跑的 Run 没有 finished_at：此时不设上界，否则会把正在产生的账单挡在窗外。
    if (ends.length === runs.length && ends.length > 0) {
      window.endTimestamp = Math.max(...ends) + WINDOW_SLACK_SECONDS;
    }

    const summed = await this.account.sumAgentRunQuota(token, agentRunIds, window);
    // 只有一部分 Run 读到了号：剩下那些的花费查不到，求和必然偏小。Run 号理应永远存在，所以
    // 这一条如今只是防御——但它守的失真是真的，与翻页到顶同一种，走同一个字段告诉前端。
    const partiallyAttributed = agentRunIds.length < runs.length;

    // 有 Run 号，却一条账单都没匹配上——这同样是「不知道」，不是 0。
    //
    // 最常见的成因是券退役上线**之前**产生的账单：那些行写的是 `other.run_capability_id`，
    // 没有 `agent_run_id`，按新口径一条都查不到。此外还有账单尚未回填、上游取数为空等。
    //
    // 上面 `agentRunIds.length === 0` 那一支已经立过规矩：本层分辨不了「真的花了 0」和
    // 「查不到」时就不编数字，`credits: null` 就是不知道（审查 W·P1）。这里是同一件事的
    // 另一半——此前它漏了，于是一个有 12 个 Run、真花过钱的老会话会返回
    // `credits: 0, truncated: false`，一个带着「确切」背书的错误答案。
    //
    // 判据是 `matched === 0` 而不是 `quota === 0`：免费模型会留下一条 quota 为 0 的账单行，
    // 那时 `matched` 是 1，能与「一行都没有」区分开。
    const nothingMatched = summed.matched === 0;
    return ok({
      credits: nothingMatched ? null : quotaToCredits(summed.quota),
      quota: nothingMatched ? null : summed.quota,
      matched: summed.matched,
      runCount: runs.length,
      // 翻页到顶时 quota 是下界而非确切值，如实告诉前端，别把偏小的数说成确切花费。
      truncated: summed.truncated || partiallyAttributed || nothingMatched,
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

    // 解析也要护栏：agent 挂在会把错误页当 200 返的代理后面时，`response.json()` 会抛，
    // 而上面那个 try 只罩住 fetch——抛出去就是一个不透明的 500，而不是这里明摆着想给的 502。
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
