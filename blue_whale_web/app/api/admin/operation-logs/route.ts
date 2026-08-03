import { createOperationLogDeps } from "@/lib/operation-log/deps";

// GET /api/admin/operation-logs → 操作日志列表（按类别/时间/关键词过滤，时间倒序）
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const category = searchParams.get("category") ?? undefined;
    const searchText = searchParams.get("searchText") ?? undefined;
    const dateFrom = searchParams.get("dateFrom");
    const dateTo = searchParams.get("dateTo");

    const from = dateFrom ? new Date(dateFrom) : undefined;
    // dateTo 含当天：取当天零点 + 1 天作为上界（与原 mock 的 +86400000 语义一致）
    const to = dateTo
      ? new Date(new Date(dateTo).getTime() + 86_400_000)
      : undefined;

    const { db } = createOperationLogDeps();
    const rows = await db.list({ category, searchText, from, to });
    return Response.json({ success: true, data: rows });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "unknown";
    return Response.json({ success: false, error: msg }, { status: 500 });
  }
}

/** BigInt 列（target_user_id / operator_id）入参守卫：仅接受十进制正整数串，避免 BigInt() 抛错成 500。 */
const BIGINT_ID_RE = /^\d{1,19}$/;

// 列长度与 admin_operation_logs schema 对齐（category 32 / action 64 / target 255 / operator 64 / ip_address 64）。
const FIELD_LIMITS = {
  category: 32,
  action: 64,
  target: 255,
  operator: 64,
  ipAddress: 64,
} as const;

// POST /api/admin/operation-logs → 写一条操作审计（变更操作由调用方在写入成功后触发）
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const {
      category,
      action,
      target,
      targetUserId,
      detail,
      operator,
      operatorId,
      ipAddress,
    } = body;

    if (!category || typeof category !== "string") {
      return Response.json(
        { success: false, error: "category 必填" },
        { status: 400 },
      );
    }
    if (!action || typeof action !== "string") {
      return Response.json(
        { success: false, error: "action 必填" },
        { status: 400 },
      );
    }
    for (const [field, limit] of Object.entries(FIELD_LIMITS)) {
      const value = body[field];
      if (typeof value === "string" && value.length > limit) {
        return Response.json(
          { success: false, error: `${field} 长度不得超过 ${limit}` },
          { status: 400 },
        );
      }
    }
    for (const field of ["targetUserId", "operatorId"] as const) {
      const value = body[field];
      if (value != null && !BIGINT_ID_RE.test(String(value))) {
        return Response.json(
          { success: false, error: `${field} 须为正整数` },
          { status: 400 },
        );
      }
    }

    const { db } = createOperationLogDeps();
    const row = await db.create({
      category,
      action,
      target: typeof target === "string" ? target : "",
      targetUserId: targetUserId != null ? String(targetUserId) : null,
      detail: typeof detail === "string" ? detail : "",
      operator: typeof operator === "string" ? operator : "",
      operatorId: operatorId != null ? String(operatorId) : null,
      ipAddress: typeof ipAddress === "string" ? ipAddress : null,
    });
    return Response.json({ success: true, data: row }, { status: 201 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "unknown";
    return Response.json({ success: false, error: msg }, { status: 500 });
  }
}
