// IK74V8：从 new-api-client.ts 拆出（≤800 行硬线）。逐块搬运，语义不变。
// 计费面：充值档位、订单生命周期、协议与自助充值/消费流水。
import {NewApiError} from "./new-api-transport.js";
import type {NewApiEnvelope, NewApiRequest} from "./new-api-transport.js";
import {parseTopUpRecord} from "./new-api-types.js";
import type {NewApiCapabilityQuotaResult, NewApiCollectTopUpInput, NewApiPricingItem, NewApiPricingResult, NewApiRechargeAgreement, NewApiRechargeOrderResult, NewApiRechargeOrderStatus, NewApiRechargeTiersResult, NewApiTopUpListResult, NewApiTopUpOrderResult, NewApiTopUpRecord, NewApiUserLogListResult, NewApiUserLogRecord} from "./new-api-types.js";

/**
 * 从一条账单的 `other` 字段里读出能力券号。
 *
 * new-api 那边写的是 JSON 字符串（`service/log_info_generate.go`：走能力券计费时写入
 * `billing_authority` 与 `run_capability_id`）。这里刻意宽容：解析失败、不是对象、字段缺失，
 * 一律当成「这笔账不属于任何券」——它多半就是出图出片那类不走券的消费，**丢掉是对的**。
 */
function readRunCapabilityId(other: unknown): string {
  const raw = typeof other === "string" ? safeParse(other) : other;
  if (!raw || typeof raw !== "object") return "";
  const id = (raw as Record<string, unknown>).run_capability_id;
  return typeof id === "string" ? id : "";
}

function safeParse(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function isCollectCredentialFailure(reason: string): boolean {
  return /代收凭证|collect-token|collect token|x-blue-whale-collect-token/i.test(
    reason,
  );
}

export function createNewApiBillingOps(request: NewApiRequest) {
  return {
    async getRechargeTiers(): Promise<NewApiRechargeTiersResult> {
      const response = await request<NewApiEnvelope>("/api/recharge/tiers", { method: "GET" });
      const data = (response.data ?? {}) as NewApiRechargeTiersResult;
      if (!Array.isArray(data.tiers)) {
        throw new NewApiError("new-api recharge tiers 响应缺少 tiers", 502, "invalid_tiers_response", response);
      }
      return data;
    },

    async createRechargeOrder(token: string, tierId: string, paymentMethod: string): Promise<NewApiRechargeOrderResult> {
      const response = await request<NewApiEnvelope>("/api/recharge/order", {
        method: "POST",
        body: JSON.stringify({ tier_id: tierId, payment_method: paymentMethod }),
      }, token);
      const data = (response.data ?? {}) as NewApiRechargeOrderResult;
      if (typeof data.trade_no !== "string" || typeof data.qr_code_data !== "string") {
        throw new NewApiError("new-api recharge order 响应无效", 502, "invalid_order_response", response);
      }
      return data;
    },

    async getRechargeOrderStatus(token: string, tradeNo: string): Promise<NewApiRechargeOrderStatus> {
      const response = await request<NewApiEnvelope>(
        `/api/recharge/order/${encodeURIComponent(tradeNo)}/status`,
        { method: "GET" },
        token,
      );
      const data = (response.data ?? {}) as NewApiRechargeOrderStatus;
      if (typeof data.trade_no !== "string" || typeof data.status !== "string") {
        throw new NewApiError("new-api recharge order status 响应无效", 502, "invalid_status_response", response);
      }
      return data;
    },

    async cancelRechargeOrder(token: string, tradeNo: string): Promise<void> {
      await request<NewApiEnvelope>(
        `/api/recharge/order/${encodeURIComponent(tradeNo)}/cancel`,
        { method: "POST" },
        token,
      );
    },

    async getRechargeAgreement(): Promise<NewApiRechargeAgreement> {
      const response = await request<NewApiEnvelope>("/api/recharge/agreement", { method: "GET" });
      const data = (response.data ?? {}) as NewApiRechargeAgreement;
      if (typeof data.title !== "string") {
        throw new NewApiError("new-api recharge agreement 响应无效", 502, "invalid_agreement_response", response);
      }
      return data;
    },

    // ---- native topup（复用 Go 原生 new-api 充值；web 只管档位目录，结算走这里）----

    /** 原生充值报价：POST /api/user/amount → 实付金额（元，Go getPayMoney 算）。
     *  该端点信封是 {message:"success"/"error", data}（无 success 布尔、HTTP 恒 200），
     *  通用 request() 的 isBusinessFailure 抓不到错误，这里显式判 message==="error"。 */
    async requestTopUpAmount(
      token: string,
      amount: number,
    ): Promise<number> {
      const response = await request<NewApiEnvelope>(
        "/api/user/amount",
        {
          method: "POST",
          body: JSON.stringify({ amount }),
        },
        token,
      );
      if (response.message === "error") {
        throw new NewApiError(
          typeof response.data === "string" ? response.data : "充值报价失败",
          400,
          "topup_amount_error",
          response,
        );
      }
      const money = typeof response.data === "string" ? Number(response.data) : Number.NaN;
      if (!Number.isFinite(money)) {
        throw new NewApiError(
          "new-api 充值报价响应无效",
          502,
          "invalid_topup_amount_response",
          response,
        );
      }
      return money;
    },

    /** 原生 BlueWhalePay 下单：POST /api/user/bluewhalepay/pay。
     *  amount = 美元额度 N（CNY 显示模式直接用；加 quota = N × QuotaPerUnit）。
     *  wayCode：wechat→WX_NATIVE、alipay→ALI_QR；留空走 Go 默认 BlueWhalePayWayCode。
     *  信封同 /api/user/amount，显式判 message==="error"。 */
    async createBlueWhalePayTopUp(
      token: string,
      amount: number,
      wayCode?: string,
    ): Promise<NewApiTopUpOrderResult> {
      const body: Record<string, unknown> = { amount };
      if (wayCode) body.way_code = wayCode;
      const response = await request<NewApiEnvelope>(
        "/api/user/bluewhalepay/pay",
        {
          method: "POST",
          body: JSON.stringify(body),
        },
        token,
      );
      if (response.message === "error") {
        throw new NewApiError(
          typeof response.data === "string" ? response.data : "拉起支付失败",
          400,
          "topup_order_error",
          response,
        );
      }
      const data = (response.data ?? {}) as { pay_data?: unknown; order_id?: unknown };
      if (typeof data.pay_data !== "string" || typeof data.order_id !== "string") {
        throw new NewApiError(
          "new-api bluewhalepay 下单响应无效",
          502,
          "invalid_topup_order_response",
          response,
        );
      }
      return { tradeNo: data.order_id, payData: data.pay_data };
    },

    /** 产品代收下单：POST /internal/v1/topup/pay。
     *  只带代收凭证头，不发用户 JWT / Authorization。信封同钱包口，HTTP 恒 200。 */
    async createCollectTopUp(
      input: NewApiCollectTopUpInput,
    ): Promise<NewApiTopUpOrderResult> {
      const response = await request<NewApiEnvelope>(
        "/internal/v1/topup/pay",
        {
          method: "POST",
          headers: {
            "X-Blue-Whale-Collect-Token": input.collectToken,
          },
          body: JSON.stringify({
            user_id: input.userId,
            money: input.money,
            amount: input.amount,
            way_code: input.wayCode,
          }),
        },
      );
      if (response.message === "error") {
        const reason =
          typeof response.data === "string" ? response.data : "";
        if (isCollectCredentialFailure(reason)) {
          throw new NewApiError(
            "下单服务不可用",
            502,
            "topup_collect_auth_error",
            response,
          );
        }
        throw new NewApiError(
          reason || "拉起支付失败",
          400,
          "topup_collect_error",
          response,
        );
      }
      const data = (response.data ?? {}) as {
        pay_data?: unknown;
        order_id?: unknown;
      };
      if (typeof data.pay_data !== "string" || typeof data.order_id !== "string") {
        throw new NewApiError(
          "new-api 代收下单响应无效",
          502,
          "invalid_topup_collect_response",
          response,
        );
      }
      return { tradeNo: data.order_id, payData: data.pay_data };
    },

    /** 按单号查原生充值订单：GET /api/user/topup/self?keyword=<tradeNo>，取精确匹配项。
     *  未找到（或非当前用户订单）返回 null。状态枚举 pending/success/failed/expired。 */
    async getTopUpByTradeNo(
      token: string,
      tradeNo: string,
    ): Promise<NewApiTopUpRecord | null> {
      const response = await request<NewApiEnvelope>(
        `/api/user/topup/self?keyword=${encodeURIComponent(tradeNo)}`,
        { method: "GET" },
        token,
      );
      const data = (response.data ?? {}) as { items?: unknown };
      const items = Array.isArray(data.items)
        ? (data.items as Array<Record<string, unknown>>)
        : [];
      const match = items.find((item) => item.trade_no === tradeNo);
      if (!match) return null;
      return parseTopUpRecord(match);
    },

    /** 分页拉当前用户原生充值记录：GET /api/user/topup/self（Go 按 id desc，即时间倒序）。
     *  信封 {success, data: PageInfo{page,page_size,total,items}}；page_size 上限 100（Go 侧钳制）。
     *  接口挂账户层 AccountTokenOrUserAuth，只凭 Bearer sk- 证明身份，Go 按 Token 属主过滤，
     *  不得发送 New-Api-User 头（ADR-0062 #18）。 */
    async listUserTopUps(
      token: string,
      options: { page?: number; pageSize?: number } = {},
    ): Promise<NewApiTopUpListResult> {
      const page = Math.max(1, Math.trunc(options.page ?? 1));
      const pageSize = Math.min(100, Math.max(1, Math.trunc(options.pageSize ?? 20)));
      const response = await request<NewApiEnvelope>(
        `/api/user/topup/self?p=${page}&page_size=${pageSize}`,
        { method: "GET" },
        token,
      );
      const data = (response.data ?? {}) as { items?: unknown; total?: unknown };
      const rawItems = Array.isArray(data.items)
        ? (data.items as Array<Record<string, unknown>>)
        : [];
      return {
        items: rawItems.map(parseTopUpRecord),
        total: typeof data.total === "number" ? data.total : 0,
      };
    },

    /** 分页拉当前用户消费流水：GET /api/log/self（Go 按 id desc，即时间倒序）。
     *  type 缺省 2 = LogTypeConsume；信封同 topup/self 的 PageInfo。
     *  鉴权（IK6M2F）：log/self 已迁账户层 AccountTokenOrUserAuth，只凭 Bearer
     *  sk-xxx 证明账户身份；User ID 由 Go 从 Token 属主解析，客户端不得发送
     *  New-Api-User 头（对齐 topup/self）。 */
    async listUserConsumeLogs(
      token: string,
      options: { page?: number; pageSize?: number; type?: number } = {},
    ): Promise<NewApiUserLogListResult> {
      const page = Math.max(1, Math.trunc(options.page ?? 1));
      const pageSize = Math.min(100, Math.max(1, Math.trunc(options.pageSize ?? 20)));
      const type = options.type ?? 2;
      const response = await request<NewApiEnvelope>(
        `/api/log/self?p=${page}&page_size=${pageSize}&type=${type}`,
        { method: "GET" },
        token,
      );
      const data = (response.data ?? {}) as { items?: unknown; total?: unknown };
      const rawItems = Array.isArray(data.items)
        ? (data.items as Array<Record<string, unknown>>)
        : [];
      const items = rawItems.map(
        (raw): NewApiUserLogRecord => ({
          id: Number(raw.id ?? 0),
          type: Number(raw.type ?? 0),
          content: typeof raw.content === "string" ? raw.content : "",
          model_name: typeof raw.model_name === "string" ? raw.model_name : "",
          quota: Number(raw.quota ?? 0),
          created_at: Number(raw.created_at ?? 0),
        }),
      );
      return {
        items,
        total: typeof data.total === "number" ? data.total : 0,
      };
    },

    /**
     * IKAFPC：把一组能力券号对应的实际消费加起来。
     *
     * 走的是**用户自己的凭证**（`/api/log/self` 是 AccountTokenOrUserAuth），不需要管理员权限，
     * 也不需要 new-api 侧任何改动——`other.run_capability_id` 是它本来就在写的字段，用户侧查询
     * 里也保留着（`formatUserLogs` 只剥 admin_info / audit_info / stream_status）。
     *
     * 时间窗只用来**收敛翻页**，不参与归属判定：归属完全由券号决定，所以窗口开大一点只是多翻
     * 几页，绝不会把别人的账算进来。
     */
    async sumRunCapabilityQuota(
      token: string,
      capabilityIds: readonly string[],
      window: {
        startTimestamp?: number;
        endTimestamp?: number;
        maxPages?: number;
        /** 整个求和的时间上限（毫秒），到点就停并标 truncated。缺省 20 秒。 */
        budgetMs?: number;
      } = {},
    ): Promise<NewApiCapabilityQuotaResult> {
      const wanted = new Set(capabilityIds.filter((id) => typeof id === "string" && id.length > 0));
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
          if (!wanted.has(readRunCapabilityId(raw.other))) continue;
          matched += 1;
          quota += Number(raw.quota ?? 0);
        }
        if (rawItems.length < pageSize) break;
        // 还有下一页却已经到上限：如实标记，别让调用方把一个下界当成确切账。
        if (page === maxPages) truncated = true;
      }
      return { quota, matched, truncated };

      // **不要加「券号全部命中就提前退出」。** 审查（W·A13）建议过这一条，它是错的：
      // 一张能力券对应一次 Run，而一次 Run 会调好几次模型，因此**同一个券号有多条账单**，
      // 且可能跨页。见到每个券号各一次就收手，求和会少算——那比慢更糟，因为它不会被标成
      // truncated，用户看到的是一个笃定的错数。
    },

    /** IK7G9X：按 request_id 精确取一条消费流水（quota 单位与余额一致）。
     *  生成 worker 出图后凭响应头 X-Oneapi-Request-Id 关联本次调用真实扣费。
     *  未匹配（或非当前用户调用）返回 null。 */
    async getConsumeLogByRequestId(
      token: string,
      requestId: string,
    ): Promise<NewApiUserLogRecord | null> {
      const response = await request<NewApiEnvelope>(
        `/api/log/self?request_id=${encodeURIComponent(requestId)}&type=2`,
        { method: "GET" },
        token,
      );
      const data = (response.data ?? {}) as { items?: unknown };
      const rawItems = Array.isArray(data.items)
        ? (data.items as Array<Record<string, unknown>>)
        : [];
      const match = rawItems.find((item) => item.request_id === requestId);
      if (!match) return null;
      return {
        id: Number(match.id ?? 0),
        type: Number(match.type ?? 0),
        content: typeof match.content === "string" ? match.content : "",
        model_name:
          typeof match.model_name === "string" ? match.model_name : "",
        quota: Number(match.quota ?? 0),
        created_at: Number(match.created_at ?? 0),
      };
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
  };
}
