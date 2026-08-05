import { bearerToken } from "@/lib/account/bff";
import { createAdminDeps } from "@/lib/admin/deps";
import { recordAdminAction } from "@/lib/admin/operation-log";
import { adminErrorResponse } from "@/lib/admin/response";
import { withAdminUser } from "@/lib/auth/product-route-auth";

const USER_MANAGE_ACTIONS = new Set(["freeze", "unfreeze", "adjustBalance"]);

const ACTION_LOG_MAP: Record<string, string> = {
  freeze: "user.freeze",
  unfreeze: "user.unfreeze",
  adjustBalance: "user.adjust_balance",
};

// POST /api/admin/users/:userId/manage（IK6JXI 契约 4.3）
// Body: { action: "freeze" | "unfreeze" | "adjustBalance", value?: number, reason: string }
export async function POST(
  request: Request,
  ctx: { params: Promise<{ userId: string }> },
) {
  return withAdminUser(request, async (admin) => {
    const token = bearerToken(request);
    if (!token) {
      return Response.json(
        { success: false, error: "缺少登录凭证" },
        { status: 401 },
      );
    }

    const { userId: rawUserId } = await ctx.params;
    const userId = Number(rawUserId);
    if (!Number.isInteger(userId) || userId <= 0) {
      return Response.json(
        { success: false, error: "userId 须为正整数" },
        { status: 400 },
      );
    }

    const body = (await request.json().catch(() => ({}))) as Record<
      string,
      unknown
    >;
    const action = body.action;
    if (typeof action !== "string" || !USER_MANAGE_ACTIONS.has(action)) {
      return Response.json(
        { success: false, error: "action 须为 freeze/unfreeze/adjustBalance" },
        { status: 400 },
      );
    }
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
      if (action === "freeze") {
        await client.manageAdminUser(token, Number(admin.userId), {
          id: userId,
          action: "disable",
        });
      } else if (action === "unfreeze") {
        await client.manageAdminUser(token, Number(admin.userId), {
          id: userId,
          action: "enable",
        });
      } else {
        // adjustBalance：value 正加负减，零拒绝（契约 4.3）。
        const value = Number(body.value);
        if (!Number.isFinite(value) || value === 0) {
          return Response.json(
            { success: false, error: "value 须为非零数值" },
            { status: 400 },
          );
        }
        await client.manageAdminUser(token, Number(admin.userId), {
          id: userId,
          action: "add_quota",
          value: Math.abs(Math.round(value)),
          mode: value > 0 ? "add" : "subtract",
        });
      }
    } catch (error) {
      return adminErrorResponse(error);
    }

    // 契约 5：写操作成功后服务端审计（best-effort）。
    await recordAdminAction({
      category: "user",
      action: ACTION_LOG_MAP[action],
      target: `user:${userId}`,
      targetUserId: String(userId),
      detail: JSON.stringify({
        reason,
        ...(action === "adjustBalance" ? { value: Number(body.value) } : {}),
      }),
      operator: admin.username,
      operatorId: admin.userId,
      ipAddress,
    });

    return Response.json({ success: true, data: null });
  });
}
