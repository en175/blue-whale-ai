import { fail, ok } from "@blue-whale/contracts";
import type { UserRepo } from "@blue-whale/persistence";

/** GET /api/me：当前用户信息。对齐 Java UserController.me。 */
export async function handleGetMe(userId: string, deps: { users: Pick<UserRepo, "findInfoById"> }) {
  const info = await deps.users.findInfoById(userId);
  if (!info) return fail(401, "用户不存在");
  return ok(info);
}
