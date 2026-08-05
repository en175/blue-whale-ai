import { bearerToken } from "@/lib/account/bff";
import { createAdminDeps } from "@/lib/admin/deps";
import { mapAdminUser } from "@/lib/admin/mapper";
import { parsePageParam, parsePageSizeParam } from "@/lib/admin/query";
import { adminErrorResponse } from "@/lib/admin/response";
import { withAdminUser } from "@/lib/auth/product-route-auth";

// GET /api/admin/users → 用户列表/搜索（IK6JXI 契约 4.2）
// IK6M2F：管理端 client 需带当前管理员 userId（New-Api-User 头）。
export async function GET(request: Request) {
  return withAdminUser(request, async (user) => {
    const token = bearerToken(request);
    if (!token) {
      return Response.json(
        { success: false, error: "缺少登录凭证" },
        { status: 401 },
      );
    }

    const { searchParams } = new URL(request.url);
    const keyword = searchParams.get("keyword")?.trim() || undefined;
    const statusParam = searchParams.get("status");
    const roleParam = searchParams.get("role");
    const page = parsePageParam(searchParams.get("page"));
    const pageSize = parsePageSizeParam(searchParams.get("pageSize"));

    // 契约 4.2：status 入参为 active/disabled，转 new-api 的 1/0。
    const status =
      statusParam === "active" ? 1 : statusParam === "disabled" ? 0 : undefined;
    const role =
      roleParam && roleParam.trim() !== "" ? Number(roleParam) : undefined;

    try {
      const { client } = createAdminDeps();
      const result = await client.listAdminUsers(token, Number(user.userId), {
        keyword,
        status,
        role,
        page,
        pageSize,
      });
      return Response.json({
        success: true,
        data: { list: result.items.map(mapAdminUser), total: result.total },
      });
    } catch (error) {
      return adminErrorResponse(error);
    }
  });
}
