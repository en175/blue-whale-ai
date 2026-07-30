import { createNewApiClient, NewApiError } from "@blue-whale/core";

export async function GET(_request: Request) {
  const baseUrl = process.env.NEW_API_BASE_URL;
  if (!baseUrl) {
    return Response.json(
      { code: 503, msg: "NEW_API_BASE_URL 未配置", data: null },
      { status: 503 },
    );
  }
  try {
    const result = await createNewApiClient({ baseUrl }).getRechargeAgreement();
    return Response.json({ code: 200, msg: null, data: result });
  } catch (error) {
    const status =
      error instanceof NewApiError && error.status >= 400 && error.status < 500
        ? error.status
        : 502;
    return Response.json(
      {
        code: status,
        msg: error instanceof Error ? error.message : "协议服务不可用",
        data: null,
      },
      { status },
    );
  }
}
