/**
 * account-records — 账户记录 API 函数（IK39UR）
 *
 * 调用 Next.js BFF 路由 /api/account/*（内部转发 Go topup/self 与 log/self）。
 * 响应为 { code, msg, data } 信封，由 apiRequest 统一剥壳。
 */
import { apiRequest } from "@/lib/api-client";
import type {
  AccountRecordsResponse,
  ConsumptionRecordDto,
  RechargeRecordDto,
} from "./account-records.dto";

/** 充值记录（时间倒序，Go id desc） */
export async function getRechargeRecords(
  page = 1,
  pageSize = 20,
): Promise<AccountRecordsResponse<RechargeRecordDto>> {
  return apiRequest<AccountRecordsResponse<RechargeRecordDto>>(
    `/api/account/topups?p=${page}&page_size=${pageSize}`,
  );
}

/** 消费记录（时间倒序，Go id desc） */
export async function getConsumptionRecords(
  page = 1,
  pageSize = 20,
): Promise<AccountRecordsResponse<ConsumptionRecordDto>> {
  return apiRequest<AccountRecordsResponse<ConsumptionRecordDto>>(
    `/api/account/consumptions?p=${page}&page_size=${pageSize}`,
  );
}
