import { Injectable } from "@nestjs/common";
import {
  createNewApiClient,
  NewApiError,
  type NewApiUsage,
} from "@lib/core";

type NewApiClient = ReturnType<typeof createNewApiClient>;

/**
 * new-api 出站 client 封装（懒加载，未配置 NEW_API_BASE_URL 时首次调用才抛）。
 *
 * <p>⚠️ 这里**只有账单与上游管理面**。用户身份（登录/注册/改密/身份复核/角色）与
 * 账号状态全部走我们自己的库（`IdentityService`）：new-api 已经降级成「带一把统一
 * key 的上游供应商」，它那边不再有我们的用户，任何以「这把 key 的属主」为前提的
 * 读写在统一 key 下都只会得到同一个人的答案。
 */
@Injectable()
export class AccountService {
  private clientInstance?: NewApiClient;

  private get client(): NewApiClient {
    if (!this.clientInstance) {
      const baseUrl = process.env.NEW_API_BASE_URL;
      if (!baseUrl) {
        throw new NewApiError(
          "账户服务未配置",
          503,
          "account_service_unavailable",
        );
      }
      this.clientInstance = createNewApiClient({ baseUrl });
    }
    return this.clientInstance;
  }

  // —— 账单：用量 / 消费流水 ——

  getTokenUsage(token: string): Promise<NewApiUsage> {
    return this.client.getTokenUsage(token);
  }

  // —— 充值/消费记录 ——

  getRechargeAgreement() {
    return this.client.getRechargeAgreement();
  }

  requestTopUpAmount(token: string, amount: number) {
    return this.client.requestTopUpAmount(token, amount);
  }

  createBlueWhalePayTopUp(token: string, amount: number, wayCode: string) {
    return this.client.createBlueWhalePayTopUp(token, amount, wayCode);
  }

  createCollectTopUp(
    input: Parameters<NewApiClient["createCollectTopUp"]>[0],
  ) {
    return this.client.createCollectTopUp(input);
  }

  listUserTopUps(token: string, options: { page?: number; pageSize?: number }) {
    return this.client.listUserTopUps(token, options);
  }

  getTopUpByTradeNo(token: string, tradeNo: string) {
    return this.client.getTopUpByTradeNo(token, tradeNo);
  }

  /** 分页拉消费流水；`type` 必传，可给数组取并集（IKGCWU：`[2, 6]` = 消耗 + 退款）。
   *  不给缺省是刻意的——见 `packages/core` 同名的说明。 */
  listUserConsumeLogs(
    token: string,
    options: {
      page?: number;
      pageSize?: number;
      type: number | readonly number[];
    },
  ) {
    return this.client.listUserConsumeLogs(token, options);
  }

  /** IKAFPC / IKCGE7：按 Agent Run 号汇总实际消费，用于「本会话累计消耗积分」。 */
  sumAgentRunQuota(
    token: string,
    agentRunIds: readonly string[],
    window?: { startTimestamp?: number; endTimestamp?: number; maxPages?: number },
  ) {
    return this.client.sumAgentRunQuota(token, agentRunIds, window);
  }

  // —— 管理端 new-api admin ops ——

  listAdminUsers(
    token: string,
    userId: number,
    options?: {
      keyword?: string;
      status?: number;
      role?: number;
      page?: number;
      pageSize?: number;
    },
  ) {
    return this.client.listAdminUsers(token, userId, options);
  }

  listAdminTopUps(
    token: string,
    userId: number,
    options?: { keyword?: string; page?: number; pageSize?: number },
  ) {
    return this.client.listAdminTopUps(token, userId, options);
  }

  getAdminLogStat(
    token: string,
    userId: number,
    input: { type: number; startTimestamp: number; endTimestamp: number },
  ) {
    return this.client.getAdminLogStat(token, userId, input);
  }

  listAdminLogs(
    token: string,
    userId: number,
    options?: { page?: number; pageSize?: number },
  ) {
    return this.client.listAdminLogs(token, userId, options);
  }

  completeAdminTopUp(token: string, userId: number, tradeNo: string) {
    return this.client.completeAdminTopUp(token, userId, tradeNo);
  }
}
