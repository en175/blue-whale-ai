import { issueAccessToken } from "@blue-whale/core";
import { createAuthRepo, getPrismaClient } from "@blue-whale/persistence";

import { consoleSmsProvider, createVolcengineSmsProvider } from "./sms";

/** 把 env → 登录用例依赖（db/sms/jwt）。prisma 进程内单例；SMS 默认 console（dev），SMS_PROVIDER=volcengine 走真短信。 */
export function createAuthDeps() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL required");

  const prisma = getPrismaClient(databaseUrl);
  const db = createAuthRepo(prisma);

  const sms =
    process.env.SMS_PROVIDER === "volcengine"
      ? createVolcengineSmsProvider({
          ak: process.env.VOLC_ACCESS_KEY_ID ?? "",
          sk: process.env.VOLC_SECRET_ACCESS_KEY ?? "",
          smsAccount: process.env.VOLC_SMS_ACCOUNT ?? "",
          sign: process.env.VOLC_SMS_SIGN ?? "玄浮科技",
          templateId: process.env.VOLC_SMS_TEMPLATE_ID ?? "",
        })
      : consoleSmsProvider;

  const jwtSecret =
    process.env.JWT_SECRET ?? "blue-whale-dev-secret-key-at-least-256-bits!!";
  const jwt = {
    issueAccessToken: (userId: string, phone: string) =>
      issueAccessToken(userId, phone, jwtSecret),
  };

  return { db, sms, jwt };
}
