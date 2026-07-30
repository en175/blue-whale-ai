import { createNewApiClient, NewApiError } from "@blue-whale/core";

export async function POST(request: Request) {
  const authorization = request.headers.get("authorization");
  const token = authorization?.startsWith("Bearer ")
    ? authorization.slice(7).trim()
    : "";
  if (!token.startsWith("sk-")) {
    return Response.json(
      { code: 401, msg: "缺少 sk-xxx token", data: null },
      { status: 401 },
    );
  }

  const baseUrl = process.env.NEW_API_BASE_URL;
  if (!baseUrl) {
    return Response.json(
      { code: 503, msg: "NEW_API_BASE_URL 未配置", data: null },
      { status: 503 },
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

  try {
    const result = await createNewApiClient({ baseUrl }).createRechargeOrder(
      token,
      body.tier_id,
      body.payment_method,
    );
    return Response.json({
      code: 200,
      msg: null,
      data: {
        trade_no: result.trade_no,
        qr_code_url: result.qr_code_data,
        expire_time: new Date(result.expire_time * 1000).toISOString(),
        amount: result.amount,
        points: result.points,
      },
    });
  } catch (error) {
    const status =
      error instanceof NewApiError && error.status >= 400 && error.status < 500
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
}
