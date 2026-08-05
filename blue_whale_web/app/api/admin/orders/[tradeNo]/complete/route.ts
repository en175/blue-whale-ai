import { bearerToken } from "@/lib/account/bff";
import { createAdminDeps } from "@/lib/admin/deps";
import { recordAdminAction } from "@/lib/admin/operation-log";
import { adminErrorResponse } from "@/lib/admin/response";
import { withAdminUser } from "@/lib/auth/product-route-auth";

// POST /api/admin/orders/:tradeNo/complete → 管理员补单（IK6JXI 契约 4.5）
// Body: { reason: string }
export async function POST(
  request: Request,
  ctx: { params: Promise<{ tradeNo: string }> },
) {
  return withAdminUser(request, async (admin) => {
    const token = bearerToken(request);
    if (!token) {
      return Response.json(
        { success: false, error: "缺少登录凭证" },
        { status: 401 },
      );
    }

    const { tradeNo } = await ctx.params;
    if (!tradeNo.trim()) {
      return Response.json(
        { success: false, error: "tradeNo 必填" },
        { status: 400 },
      );
    }

    const body = (await request.json().catch(() => ({}))) as Record<
      string,
      unknown
    >;
    const reason = typeof body.reason === "string" ? body.reason.trim() : "";
    if (!reason) {
      return Response.json(
        { success: false, error: "reason 必填" },
        { status: 400 },
      );
    }

    const ipAddress = request.headers.get("x-forwarded-for") ?? null;

    const { client } = createAdminDeps();
    try {
      await client.completeAdminTopUp(token, tradeNo);
    } catch (error) {
      return adminErrorResponse(error);
    }

    // 契约 5：写操作成功后服务端审计（best-effort）。
    await recordAdminAction({
      category: "order",
      action: "order.complete",
      target: tradeNo,
      detail: JSON.stringify({ reason }),
      operator: admin.username,
      operatorId: admin.userId,
      ipAddress,
    });

    return Response.json({ success: true, data: null });
  });
}
