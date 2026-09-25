// new-api 的**上游调用面**——只剩这三块，其余账单/充值/管理接口都已随
// 「new-api 降级成上游供应商」一并删除（余额与消费流水改写 billing 账本，
// 充值面整条摘除，管理端订单/统计改读我们自己的库）。
//
// 留下的三块都是「上游本职」，不归我们的账本管：
//   1. Agent Run 用量汇总（agent-session-credits 用，另有决定）
//   2. 模型定价目录（生成侧估算成本用）
//   3. Go 全局 option 读写（充值档位折扣，RootAuth）
import type {NewApiEnvelope, NewApiRequest} from "./new-api-transport.js";
import type {NewApiAgentRunQuotaResult, NewApiPricingItem, NewApiPricingResult} from "./new-api-types.js";

/**
 * 从一条账单的 `other` 字段里读出 Agent Run 号。
 *
 * new-api 那边写的是 JSON 字符串（`service/log_info_generate.go`：走蓝鲸网关计费时写入
 * `billing_authority: "agent_gateway"` 与 `agent_run_id`）。这里刻意宽容：解析失败、不是对象、
 * 字段缺失，一律当成「这笔账不属于任何 Run」——它多半就是出图出片那类不走 Agent 的消费，
 * **丢掉是对的**。
 *
 * 券退役前这里读的是 `run_capability_id`（IKCGE7）。换字段不只是改名：券号是一次性凭证的
 * 编号，Run 号是 Run 本身的身份，后者不会因为凭证机制再变一次而失效。
 */
function readAgentRunId(other: unknown): string {
  const raw = typeof other === "string" ? safeParse(other) : other;
  if (!raw || typeof raw !== "object") return "";
  const id = (raw as Record<string, unknown>).agent_run_id;
  return typeof id === "string" ? id : "";
}

function safeParse(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

export function createNewApiUpstreamOps(request: NewApiRequest) {
  return {
    /**
     * IKAFPC / IKCGE7：把一组 Agent Run 号对应的实际消费加起来。
     *
     * 走的是**用户自己的凭证**（`/api/log/self` 是 AccountTokenOrUserAuth），不需要管理员权限。
     * `other.agent_run_id` 由 new-api 在网关代打时写入，用户侧查询里保留着
     * （`formatUserLogs` 只剥 admin_info / audit_info / stream_status）。
     *
     * 时间窗只用来**收敛翻页**，不参与归属判定：归属完全由 Run 号决定，所以窗口开大一点只是
     * 多翻几页，绝不会把别人的账算进来。
     */
    async sumAgentRunQuota(
      token: string,
      agentRunIds: readonly string[],
      window: {
        startTimestamp?: number;
        endTimestamp?: number;
        maxPages?: number;
        /** 整个求和的时间上限（毫秒），到点就停并标 truncated。缺省 20 秒。 */
        budgetMs?: number;
      } = {},
    ): Promise<NewApiAgentRunQuotaResult> {
      const wanted = new Set(agentRunIds.filter((id) => typeof id === "string" && id.length > 0));
      if (wanted.size === 0) return { quota: 0, matched: 0, truncated: false };

      const pageSize = 100;
      const maxPages = Math.max(1, Math.trunc(window.maxPages ?? 10));
      // 整体预算（审查 W·A13）。
      //
      // 翻页是串行的，每次 request() 自带 10 秒超时：10 页最坏就是约 100 秒，而调用方
      // （BFF 的查账端点）自己前面还有一次 10 秒的 fetchRuns。忙账户（dock 一直在出图，
      // /api/log/self 被刷屏）会被迫走满 10 页——那时浏览器早就超时走人了，而 handler
      // 还在烧上游调用，**每一轮结束都来一遍**。
      //
      // 20 秒之内还没数完就认账：给一个下界并标 truncated，比把连接挂死强。
      const deadline = Date.now() + Math.max(1_000, Math.trunc(window.budgetMs ?? 20_000));
      const range = [
        window.startTimestamp ? `&start_timestamp=${Math.trunc(window.startTimestamp)}` : "",
        window.endTimestamp ? `&end_timestamp=${Math.trunc(window.endTimestamp)}` : "",
      ].join("");

      let quota = 0;
      let matched = 0;
      let truncated = false;
      for (let page = 1; page <= maxPages; page += 1) {
        if (Date.now() >= deadline) {
          truncated = true;
          break;
        }
        const response = await request<NewApiEnvelope>(
          `/api/log/self?p=${page}&page_size=${pageSize}&type=2${range}`,
          { method: "GET" },
          token,
        );
        const data = (response.data ?? {}) as { items?: unknown; total?: unknown };
        const rawItems = Array.isArray(data.items) ? (data.items as Array<Record<string, unknown>>) : [];
        for (const raw of rawItems) {
          if (!wanted.has(readAgentRunId(raw.other))) continue;
          matched += 1;
          quota += Number(raw.quota ?? 0);
        }
        if (rawItems.length < pageSize) break;
        // 还有下一页却已经到上限：如实标记，别让调用方把一个下界当成确切账。
        if (page === maxPages) truncated = true;
      }
      return { quota, matched, truncated };

      // **不要加「Run 号全部命中就提前退出」。** 审查（W·A13）建议过这一条，它是错的：
      // 一次 Run 会调好几次模型，因此**同一个 Run 号有多条账单**，且可能跨页。见到每个 Run 号
      // 各一次就收手，求和会少算——那比慢更糟，因为它不会被标成 truncated，用户看到的是一个
      // 笃定的错数。
    },

    /** IK7G9X：拉模型定价目录（GET /api/pricing，默认匿名可访问）。
     *  响应信封 {success, data: Pricing[]， pricing_version}：data 即定价数组。
     *  返回定价列表（含 ModelPrice/ModelRatio/BillingExpr）与响应级 pricing_version，
     *  供建预留时估算金额并落四个 *_version 字段。 */
    async getPricing(
      token?: string,
    ): Promise<NewApiPricingResult> {
      const response = await request<NewApiEnvelope>(
        "/api/pricing",
        { method: "GET" },
        token,
      );
      const envelope = (response ?? {}) as Record<string, unknown>;
      const items = Array.isArray(envelope.data)
        ? (envelope.data as Array<Record<string, unknown>>)
        : [];
      return {
        pricing: items.map((raw): NewApiPricingItem => {
          const modelPrice =
            typeof raw.model_price === "number" ? raw.model_price : undefined;
          const modelRatio =
            typeof raw.model_ratio === "number" ? raw.model_ratio : undefined;
          const billingMode =
            typeof raw.billing_mode === "string" ? raw.billing_mode : undefined;
          const billingExpr =
            typeof raw.billing_expr === "string" ? raw.billing_expr : undefined;
          return {
            modelName: typeof raw.model_name === "string" ? raw.model_name : "",
            ...(modelPrice !== undefined ? { modelPrice } : {}),
            ...(modelRatio !== undefined ? { modelRatio } : {}),
            ...(billingMode !== undefined ? { billingMode } : {}),
            ...(billingExpr !== undefined ? { billingExpr } : {}),
          };
        }),
        ...(typeof envelope.pricing_version === "string"
          ? { pricingVersion: envelope.pricing_version }
          : {}),
      };
    },

    // ---- Go 管理端 option（RootAuth）----
    // PUT/GET /api/option/ 走 middleware.RootAuth：需 root 用户的 access_token（Authorization）
    // + New-Api-User 头（= 令牌属主的数字 id，authHelper 校验 id == apiUserId）。
    // 用于 web 维护 Go 全局 payment_setting.amount_discount（逐档充值折扣）。
    // 信封是标准 {success,...}，通用 request() 的 isBusinessFailure 可判错（不同于 topup 的 {message} 壳）。

    /** 读单个 option 的原始字符串值；不存在返回 null。 */
    async getRootOption(
      rootToken: string,
      rootUserId: number,
      key: string,
    ): Promise<string | null> {
      const response = await request<NewApiEnvelope>(
        "/api/option/",
        {
          method: "GET",
          headers: { "New-Api-User": String(rootUserId) },
        },
        rootToken,
      );
      const items = Array.isArray(response.data)
        ? (response.data as Array<{ key?: unknown; value?: unknown }>)
        : [];
      const found = items.find((item) => item.key === key);
      if (!found || found.value == null) return null;
      return typeof found.value === "string" ? found.value : String(found.value);
    },

    /** 写单个 option。value 必须已是 JSON 字符串——Go UpdateOption 对 object 值会
     *  `fmt.Sprintf("%v")` 损坏，必须发字符串（Go 前端即如此）。 */
    async putRootOption(
      rootToken: string,
      rootUserId: number,
      key: string,
      value: string,
    ): Promise<void> {
      await request<NewApiEnvelope>(
        "/api/option/",
        {
          method: "PUT",
          headers: { "New-Api-User": String(rootUserId) },
          body: JSON.stringify({ key, value }),
        },
        rootToken,
      );
    },
  };
}
