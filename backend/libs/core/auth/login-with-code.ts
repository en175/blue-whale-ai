
export interface LoginWithCodeInput {
  phone: string;
  code: string;
}

export interface AuthUser {
  id: string;
  username: string;
  phone: string;
}

export interface LoginWithCodeDeps {
  db: {
    findValidCode(phone: string, code: string): Promise<{ id: string } | null>;
    upsertUser(phone: string): Promise<AuthUser>;
    markCodeUsed(codeId: string): Promise<unknown>;
  };
  jwt: {
    issueAccessToken(userId: string, phone: string): Promise<string>;
  };
}

export interface LoginResult {
  accessToken: string;
  user: AuthUser;
}

export class InvalidVerificationCodeError extends Error {}

export async function loginWithCode(
  input: LoginWithCodeInput,
  deps: LoginWithCodeDeps,
): Promise<LoginResult> {
  const codeRecord = await deps.db.findValidCode(input.phone, input.code);
  if (!codeRecord) {
    throw new InvalidVerificationCodeError("verification code invalid or expired");
  }
  const user = await deps.db.upsertUser(input.phone);
  await deps.db.markCodeUsed(codeRecord.id);
  const accessToken = await deps.jwt.issueAccessToken(user.id, input.phone);
  return { accessToken, user };
}
