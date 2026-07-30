import {
  accountErrorResponse,
  createAccountClient,
  type AccountClient,
} from "@/lib/account/bff";

export function createCapabilitiesHandler(
  client: Pick<AccountClient, "getAccountCapabilities">,
) {
  return async function GET() {
    try {
      const capabilities = await client.getAccountCapabilities();
      return Response.json({
        code: 200,
        msg: null,
        data: {
          password_login: capabilities.passwordLogin,
          password_register: capabilities.passwordRegister,
          email_verification: capabilities.emailVerification,
        },
      });
    } catch (error) {
      return accountErrorResponse(error);
    }
  };
}

export async function GET() {
  try {
    return await createCapabilitiesHandler(createAccountClient())();
  } catch (error) {
    return accountErrorResponse(error);
  }
}
