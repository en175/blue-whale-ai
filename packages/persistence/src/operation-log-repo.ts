import type { PrismaClient } from "@prisma/client";

/** 管理后台操作审计 repo（Prisma-backed），blue_whale 侧。
 *  只记录改变系统状态的写操作（档位/定价/用户/订单等管理变更），查询不记。
 *  operator_id / target_user_id / ip_address 为 spec 预留列，鉴权落地前可空。 */

export interface OperationLogView {
  id: string;
  category: string;
  action: string;
  target: string;
  targetUserId: string | null;
  detail: string;
  operator: string;
  operatorId: string | null;
  ipAddress: string | null;
  createdAt: string;
}

export interface OperationLogFilter {
  /** 类别；缺省或 "all" 表示不过滤 */
  category?: string;
  /** 对 target / detail / operator 做包含匹配 */
  searchText?: string;
  /** gmt_create 下界（含） */
  from?: Date;
  /** gmt_create 上界（含） */
  to?: Date;
  /** 返回上限，缺省 500 */
  limit?: number;
}

export interface CreateOperationLogInput {
  category: string;
  action: string;
  target?: string;
  targetUserId?: string | null;
  detail?: string;
  operator?: string;
  operatorId?: string | null;
  ipAddress?: string | null;
}

export interface OperationLogRepo {
  list(filter?: OperationLogFilter): Promise<OperationLogView[]>;
  create(input: CreateOperationLogInput): Promise<OperationLogView>;
}

/* ---------- helpers ---------- */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toView(row: any): OperationLogView {
  return {
    id: row.id.toString(),
    category: row.category,
    action: row.action,
    target: row.target,
    targetUserId: row.target_user_id != null ? row.target_user_id.toString() : null,
    detail: row.detail,
    operator: row.operator,
    operatorId: row.operator_id != null ? row.operator_id.toString() : null,
    ipAddress: row.ip_address,
    createdAt: new Date(row.gmt_create).toISOString(),
  };
}

/* ---------- factory ---------- */

export function createOperationLogRepo(prisma: PrismaClient): OperationLogRepo {
  return {
    async list(filter = {}) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const where: any = { is_delete: 0 };
      if (filter.category && filter.category !== "all") {
        where.category = filter.category;
      }
      if (filter.from || filter.to) {
        where.gmt_create = {};
        if (filter.from) where.gmt_create.gte = filter.from;
        if (filter.to) where.gmt_create.lte = filter.to;
      }
      const q = filter.searchText?.trim();
      if (q) {
        where.OR = [
          { target: { contains: q } },
          { detail: { contains: q } },
          { operator: { contains: q } },
        ];
      }
      const rows = await prisma.admin_operation_logs.findMany({
        where,
        orderBy: { gmt_create: "desc" },
        take: filter.limit ?? 500,
      });
      return rows.map(toView);
    },

    async create(input) {
      const row = await prisma.admin_operation_logs.create({
        data: {
          category: input.category,
          action: input.action,
          target: input.target ?? "",
          target_user_id:
            input.targetUserId != null ? BigInt(input.targetUserId) : null,
          detail: input.detail ?? "",
          operator: input.operator ?? "",
          operator_id:
            input.operatorId != null ? BigInt(input.operatorId) : null,
          ip_address: input.ipAddress ?? null,
        },
      });
      return toView(row);
    },
  };
}
