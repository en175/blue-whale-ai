import { bearerToken } from "@/lib/account/bff";
import { collectDashboardStats } from "@/lib/admin/dashboard";
import { createAdminDeps } from "@/lib/admin/deps";
import { adminErrorResponse } from "@/lib/admin/response";
import { withAdminUser } from "@/lib/auth/product-route-auth";

// GET /api/admin/dashboard → 仪表板统计（IK6JXI 契约 4.6）
export async function GET(request: Request) {
  return withAdminUser(request, async () => {
    const token = bearerToken(request);
    if (!token) {
      return Response.json(
        { success: false, error: "缺少登录凭证" },
        { status: 401 },
      );
    }

    try {
      const { client } = createAdminDeps();
      const data = await collectDashboardStats(client, token);
      return Response.json({ success: true, data });
    } catch (error) {
      return adminErrorResponse(error);
    }
  });
}
