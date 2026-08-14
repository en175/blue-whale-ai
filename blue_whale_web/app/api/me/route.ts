import {
  accountErrorResponse,
  bearerToken,
  createAccountClient,
  userCredentialRequiredResponse,
  type AccountClient,
} from "@/lib/account/bff";
import { ADMIN_ROLE_THRESHOLD } from "@/lib/auth/authenticated-user";

// GET /api/me
// data.is_admin：new-api role >= 10 即管理员（IK6JXI，契约 4.1），前端入口判断唯一数据源。
export function createMeHandler(
  client: Pick<AccountClient, "resolveTokenIdentity">,
) {
  return async function GET(request: Request) {
    const token = bearerToken(request);
    if (!token) {
      return userCredentialRequiredResponse("缺少登录凭证");
    }
    try {
      const identity = await client.resolveTokenIdentity(token);
      return Response.json({
        code: 200,
        msg: null,
        data: {
          user_id: identity.userId,
          username: identity.username,
          email: identity.email,
          phone: "",
          has_password: true,
          is_admin: identity.role >= ADMIN_ROLE_THRESHOLD,
        },
      });
    } catch (error) {
      return accountErrorResponse(error);
    }
  };
}

export async function GET(request: Request) {
  try {
    return await createMeHandler(createAccountClient())(request);
  } catch (error) {
    return accountErrorResponse(error);
  }
}
