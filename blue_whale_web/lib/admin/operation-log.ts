import { createOperationLogDeps } from "@/lib/operation-log/deps";

/**
 * 管理端写操作审计（服务端写入，best-effort 不阻断主流程）。
 *
 * 对齐契约第 5 节：写操作成功后由服务端记 admin_operation_logs，
 * operator/operatorId 来自 withAdminUser 解析的管理员身份。
 */
export async function recordAdminAction(input: {
  category: "user" | "order";
  action: string;
  target: string;
  targetUserId?: string | null;
  detail?: string;
  operator: string;
  operatorId: string;
  ipAddress?: string | null;
}): Promise<void> {
  try {
    const { db } = createOperationLogDeps();
    await db.create({
      category: input.category,
      action: input.action,
      target: input.target,
      targetUserId: input.targetUserId ?? null,
      detail: input.detail ?? "",
      operator: input.operator,
      operatorId: input.operatorId,
      ipAddress: input.ipAddress ?? null,
    });
  } catch (error) {
    console.error("[admin] 审计写入失败（不阻断主流程）", error);
  }
}
