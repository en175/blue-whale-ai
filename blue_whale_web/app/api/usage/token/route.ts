import {
  accountErrorResponse,
  bearerToken,
  createAccountClient,
  userCredentialRequiredResponse,
  type AccountClient,
} from "@/lib/account/bff";

export function createUsageHandler(
  client: Pick<AccountClient, "getTokenUsage">,
) {
  return async function GET(request: Request) {
    const token = bearerToken(request);
    if (!token) {
      return userCredentialRequiredResponse("缺少登录凭证");
    }
    try {
      const usage = await client.getTokenUsage(token);
      return Response.json({
        code: 200,
        msg: null,
        data: { quota: usage.userQuota },
      });
    } catch (error) {
      return accountErrorResponse(error);
    }
  };
}

export async function GET(request: Request) {
  try {
    return await createUsageHandler(createAccountClient())(request);
  } catch (error) {
    return accountErrorResponse(error);
  }
}
