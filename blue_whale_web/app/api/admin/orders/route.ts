import { bearerToken } from "@/lib/account/bff";
import { createAdminDeps } from "@/lib/admin/deps";
import { mapAdminOrder } from "@/lib/admin/mapper";
import { parsePageParam, parsePageSizeParam } from "@/lib/admin/query";
import { adminErrorResponse } from "@/lib/admin/response";
import { withAdminUser } from "@/lib/auth/product-route-auth";
import { userAuthFailureHeaders } from "@/lib/auth/session-failure";

// GET /api/admin/orders → 充值订单列表/搜索（IK6JXI 契约 4.4）
// 注意：status 为 web 层当前页过滤（new-api /api/user/topup 无 status 参数）；
// total 为 new-api 原始总数，前端按 list 渲染即可。
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

    const { searchParams } = new URL(request.url);
    const keyword = searchParams.get("keyword")?.trim() || undefined;
    const status = searchParams.get("status");
    const page = parsePageParam(searchParams.get("page"));
    const pageSize = parsePageSizeParam(searchParams.get("pageSize"));

    try {
      const { client } = createAdminDeps();
      const result = await client.listAdminTopUps(token, Number(user.userId), {
        keyword,
        page,
        pageSize,
      });
      let list = result.items.map(mapAdminOrder);
      if (status) {
        list = list.filter((order) => order.status === status);
      }
      return Response.json({
        success: true,
        data: { list, total: result.total },
      });
    } catch (error) {
      return adminErrorResponse(error);
    }
  });
}
