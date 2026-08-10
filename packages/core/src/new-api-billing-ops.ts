// IK74V8：从 new-api-client.ts 拆出（≤800 行硬线）。逐块搬运，语义不变。
// 计费面：充值档位、订单生命周期、协议与自助充值/消费流水。
import {NewApiError} from "./new-api-transport.js";
import type {NewApiEnvelope, NewApiRequest} from "./new-api-transport.js";
import {parseTopUpRecord} from "./new-api-types.js";
import type {NewApiRechargeAgreement, NewApiRechargeOrderResult, NewApiRechargeOrderStatus, NewApiRechargeTiersResult, NewApiTopUpListResult, NewApiTopUpOrderResult, NewApiTopUpRecord, NewApiUserLogListResult, NewApiUserLogRecord} from "./new-api-types.js";

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

    // ---- Go 管理端 option（RootAuth）----
    // PUT/GET /api/option/ 走 middleware.RootAuth：需 root 用户的 access_token（Authorization）
    // + New-Api-User 头（= 令牌属主的数字 id，authHelper 校验 id == apiUserId）。
    // 用于 web 维护 Go 全局 payment_setting.amount_discount（逐档充值折扣）。
    // 信封是标准 {success,...}，通用 request() 的 isBusinessFailure 可判错（不同于 topup 的 {message} 壳）。

    /** 读单个 option 的原始字符串值；不存在返回 null。 */
  };
}
