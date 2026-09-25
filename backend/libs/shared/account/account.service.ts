import { Injectable } from "@nestjs/common";
import { createNewApiClient, NewApiError } from "@lib/core";

type NewApiClient = ReturnType<typeof createNewApiClient>;

/**
 * new-api 出站 client 封装（懒加载，未配置 NEW_API_BASE_URL 时首次调用才抛）。
 *
 * <p>⚠️ 这里**只剩 Agent 会话消费汇总**，其余全部已摘除：
 *
 * <ul>
 *   <li>用户身份（登录/注册/改密/角色/账号状态）→ 我们自己的库（`IdentityService`）</li>
 *   <li>余额与消费流水 → billing 账本（`billing-client.ts` 的 QueryBalance / ListTransactions）</li>
 *   <li>充值协议、下单、查单、充值记录 → **整条删除**（new-api 不再代我们收款，本仓也没有支付通道）</li>
 *   <li>管理端用户/订单/日志统计 → 我们自己的库</li>
 * </ul>
 *
 * <p>new-api 现在是「带一把统一 key 的上游供应商」，它那边不再有我们的用户。任何以
 * 「这把 key 的属主」为前提的读写，在统一 key 下都只会得到同一个人的答案——所以那些
 * 调用不是「暂时不准」，而是**结构上不可能对**。
 *
 * <p>`sumAgentRunQuota` 留着是因为它按 **Agent Run 号**归属（不是按 key 属主），
 * 归属口径仍然成立；Agent 面另有决定，暂不在此单处置。
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

  /** IKAFPC / IKCGE7：按 Agent Run 号汇总实际消费，用于「本会话累计消耗积分」。 */
  sumAgentRunQuota(
    token: string,
    agentRunIds: readonly string[],
    window?: { startTimestamp?: number; endTimestamp?: number; maxPages?: number },
  ) {
    return this.client.sumAgentRunQuota(token, agentRunIds, window);
  }
}
