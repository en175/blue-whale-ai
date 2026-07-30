import { authenticationErrorResponse } from "@/lib/account/bff";

import {
  AuthenticationError,
  getAuthenticatedUser,
  type AuthenticatedUser,
} from "./authenticated-user";

export async function withAuthenticatedUser(
  request: Request,
  handler: (user: AuthenticatedUser) => Promise<Response> | Response,
): Promise<Response> {
  let user: AuthenticatedUser;

  try {
    user = await getAuthenticatedUser(request);
  } catch (error) {
    if (error instanceof AuthenticationError) {
      return authenticationErrorResponse(error.status);
    }
    throw error;
  }

  return handler(user);
}
