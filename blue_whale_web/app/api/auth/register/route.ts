import {
  accountErrorResponse,
  createAccountClient,
  loginEnvelope,
  type AccountClient,
} from "@/lib/account/bff";

export function createRegisterHandler(client: Pick<AccountClient, "register">) {
  return async function POST(request: Request) {
    const body = (await request.json().catch(() => ({}))) as Record<
      string,
      unknown
    >;
    const username =
      typeof body.username === "string" ? body.username.trim() : "";
    const password = typeof body.password === "string" ? body.password : "";
    if (!username || !password) {
      return Response.json(
        { code: 400, msg: "用户名和密码不能为空", data: null },
        { status: 400 },
      );
    }
    try {
      const result = await client.register({
        username,
        password,
        ...(typeof body.email === "string" && body.email.trim()
          ? { email: body.email.trim() }
          : {}),
        ...(typeof body.verification_code === "string"
          ? { verificationCode: body.verification_code }
          : {}),
      });
      return Response.json(loginEnvelope(result, true));
    } catch (error) {
      return accountErrorResponse(error);
    }
  };
}

export async function POST(request: Request) {
  try {
    return await createRegisterHandler(createAccountClient())(request);
  } catch (error) {
    return accountErrorResponse(error);
  }
}
