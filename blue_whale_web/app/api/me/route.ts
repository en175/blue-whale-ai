import {
  accountErrorResponse,
  bearerToken,
  createAccountClient,
  type AccountClient,
} from "@/lib/account/bff";

// GET /api/me
export function createMeHandler(
  client: Pick<AccountClient, "resolveTokenIdentity">,
) {
  return async function GET(request: Request) {
    const token = bearerToken(request);
    if (!token) {
      return Response.json(
        { code: 401, msg: "缺少登录凭证", data: null },
        { status: 401 },
      );
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
