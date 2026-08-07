import { createWebNewApiClient } from "@/lib/logging";

/** 管理端用例依赖：wire new-api client。
 *  注意：token 不在此处持有，由路由层从请求 Authorization 头透传
 *  （管理员 token 即 new-api sk token，天然通过 AdminAuth）。 */
export function createAdminDeps() {
  const baseUrl = process.env.NEW_API_BASE_URL;
  if (!baseUrl) {
    throw new Error("NEW_API_BASE_URL required");
  }
  return { client: createWebNewApiClient({ baseUrl }) };
}
