import { NewApiError } from "@blue-whale/core";
import { createWebNewApiClient } from "@/lib/logging";
import { parseNewApiBearerToken } from "@/lib/auth/bearer-token";
import { withAuthenticatedUser } from "@/lib/auth/product-route-auth";
import { createTopupTierDeps } from "@/lib/topup-tier/deps";
import { loadGoTopUpConfig } from "@/lib/recharge/go-topup";
import { quotaToCredits } from "@/lib/credits";

/**
 * POST /api/recharge/order — 创建充值订单（Model B：复用 Go 原生 new-api 充值）
 *
 * 数据流：
 *   1. 从 web DB（topup_tiers）按 tier_id 解析档位，取 original_price（=美元额度 N）、amount（=到账积分）。
 *   2. POST /api/user/amount 取实付报价（Go getPayMoney 算，含分组倍率 × 金额折扣）。
 *   3. POST /api/user/bluewhalepay/pay 下单，返回 {pay_data, order_id}。
 *
 * 与旧自定义 recharge 的差异：原生下单只认 amount（N），不再传 tier_id 去 Go 的 recharge_tier
 * 校验——这正是原 502（"档位不存在"，web 档位 vs Go recharge_tier 两套数据源）的根因，改接后消除。
 * 实付与折扣全由 Go 公式决定；web 档位折扣经 payment_setting.amount_discount 同步（见 admin topup-tiers）。
 *
 * 鉴权：Go 原生充值接口挂在账户层 AccountTokenOrUserAuth 下，只凭 Bearer sk-xxx
 * 证明账户身份，订单 User ID 由 Go 从 Token 属主解析。BFF 把经 withAuthenticatedUser
 * 真校验过的同一请求 Token 透传给 Go（Go identity，60s 缓存），不再使用 root 凭证
 * 代理下单，也不发送 New-Api-User。
 */

/** 前端支付方式 → BlueWhalePay wayCode（与旧自定义 recharge 保持一致）。 */
const WAY_CODE_BY_METHOD: Record<string, string> = {
  wechat: "WX_NATIVE",
  alipay: "ALI_QR",
};

/** 下单返回的二维码有效期（仅前端倒计时 UX；真实过期由 BlueWhalePay 控制）。 */
const QR_TTL_MS = 15 * 60 * 1000;

export async function POST(request: Request) {
  const config = loadGoTopUpConfig();
  if (!config) {
    return Response.json(
      {
        code: 503,
        msg: "Go 充值配置未就绪（NEW_API_BASE_URL）",
        data: null,
      },
      { status: 503 },
    );
  }

  return withAuthenticatedUser(request, async (_user) => {
    // 认证回调内提取当前请求的 Bearer Token（刚经 withAuthenticatedUser 真校验），
    // 同一 Token 透传给 Go 充值接口；订单 User ID 由 Go 从 Token 属主解析。
    const userToken = parseNewApiBearerToken(
      request.headers.get("authorization"),
    );
    if (!userToken) {
      return Response.json(
        { code: 401, msg: "未提供有效令牌", data: null },
        { status: 401 },
      );
    }

    let body: { tier_id?: string; payment_method?: string };
    try {
      body = await request.json();
    } catch {
      return Response.json(
        { code: 400, msg: "请求体格式错误", data: null },
        { status: 400 },
      );
    }

    if (!body.tier_id || !body.payment_method) {
      return Response.json(
        { code: 400, msg: "缺少 tier_id 或 payment_method", data: null },
        { status: 400 },
      );
    }

    const wayCode = WAY_CODE_BY_METHOD[body.payment_method];
    if (!wayCode) {
      return Response.json(
        { code: 400, msg: "支付方式仅支持 wechat / alipay", data: null },
        { status: 400 },
      );
    }

    // 从 web DB 解析档位（目录在 web，结算在 Go）。
    let tier;
    try {
      const { db } = createTopupTierDeps();
      tier = await db.getById(body.tier_id);
    } catch (e) {
      return Response.json(
        {
          code: 500,
          msg: e instanceof Error ? e.message : "档位服务不可用",
          data: null,
        },
        { status: 500 },
      );
    }
    if (!tier) {
      return Response.json(
        { code: 404, msg: "档位不存在", data: null },
        { status: 404 },
      );
    }
    if (tier.status !== "active") {
      return Response.json(
        { code: 400, msg: "该档位已下架", data: null },
        { status: 400 },
      );
    }
    const now = Date.now();
    if (tier.startTime && new Date(tier.startTime).getTime() > now) {
      return Response.json(
        { code: 400, msg: "该档位尚未生效", data: null },
        { status: 400 },
      );
    }
    if (tier.endTime && new Date(tier.endTime).getTime() < now) {
      return Response.json(
        { code: 400, msg: "该档位已过期", data: null },
        { status: 400 },
      );
    }

    // 美元额度 N（原生下单 amount 参数）。档位原价在建库时已强制为正整数
    // （admin topup-tiers 入参校验），此处只做防御性取整与兜底校验。
    const amount = Math.round(tier.originalPrice);
    if (!Number.isInteger(amount) || amount <= 0) {
      return Response.json(
        { code: 400, msg: "档位原价须为正整数", data: null },
        { status: 400 },
      );
    }

    try {
      const client = createWebNewApiClient({ baseUrl: config.baseUrl });
      // Go 原生充值接口走账户层 AccountTokenOrUserAuth，凭当前用户 sk- 令牌即可；
      // 先报价拿真实付（Go getPayMoney：N × Price × 分组充值倍率 × 金额折扣），再下单。
      const payMoney = await client.requestTopUpAmount(userToken, amount);
      // 报价与档位实付价对账：不一致说明折扣同步漂移或分组倍率变动，留痕便于排查。
      if (Math.abs(payMoney - tier.price) > 0.01) {
        console.warn(
          `[recharge/order] 报价漂移：Go 报价 ¥${payMoney} ≠ 档位实付 ¥${tier.price}` +
            `（tier id=${tier.id}, N=${amount}），请核对 amount_discount 同步与分组倍率`,
        );
      }
      const order = await client.createBlueWhalePayTopUp(
        userToken,
        amount,
        wayCode,
      );
      return Response.json({
        code: 200,
        msg: null,
        data: {
          trade_no: order.tradeNo,
          qr_code_url: order.payData,
          expire_time: new Date(Date.now() + QR_TTL_MS).toISOString(),
          amount: payMoney,
          points: Math.round(quotaToCredits(tier.amount)),
        },
      });
    } catch (error) {
      const status =
        error instanceof NewApiError &&
        error.status >= 400 &&
        error.status < 500
          ? error.status
          : 502;
      return Response.json(
        {
          code: status,
          msg: error instanceof Error ? error.message : "下单服务不可用",
          data: null,
        },
        { status },
      );
    }
  });
}
