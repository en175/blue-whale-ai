import { wallClockRfc3339 } from "@lib/core";
import type { PrismaClient } from "@prisma/client";


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
  category?: string;
  searchText?: string;
  from?: Date;
  to?: Date;
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
    createdAt: wallClockRfc3339(new Date(row.gmt_create)),
  };
}


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
