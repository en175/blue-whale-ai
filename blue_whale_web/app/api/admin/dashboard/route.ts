import { bearerToken } from "@/lib/account/bff";
import { collectDashboardStats } from "@/lib/admin/dashboard";
import { createAdminDeps } from "@/lib/admin/deps";
import { adminErrorResponse } from "@/lib/admin/response";
import { withAdminUser } from "@/lib/auth/product-route-auth";
import { userAuthFailureHeaders } from "@/lib/auth/session-failure";

// GET /api/admin/dashboard → 仪表板统计（IK6JXI 契约 4.6）
// IK6M2F：管理端 client 需带当前管理员 userId（New-Api-User 头）。
export async function GET(request: Request) {
  return withAdminUser(request, async (user) => {
    const token = bearerToken(request);
    if (!token) {
      return Response.json(
        { success: false, error: "缺少登录凭证" },
        { status: 401, headers: userAuthFailureHeaders() },
      );
    }

    try {
      const { client } = createAdminDeps();
      const data = await collectDashboardStats(
        client,
        token,
        Number(user.userId),
      );
      return Response.json({ success: true, data });
    } catch (error) {
      return adminErrorResponse(error);
    }
  });
}
