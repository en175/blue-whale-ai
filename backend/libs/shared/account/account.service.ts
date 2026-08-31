import { Injectable } from "@nestjs/common";
import {
  createNewApiClient,
  NewApiError,
  type NewApiAccountCapabilities,
  type NewApiAccountIdentity,
  type NewApiChangePasswordInput,
  type NewApiLoginInput,
  type NewApiLoginResult,
  type NewApiRegisterInput,
  type NewApiUsage,
} from "@blue-whale/core";

type NewApiClient = ReturnType<typeof createNewApiClient>;

/** new-api 账户/充值出站 client 封装（懒加载，未配置 NEW_API_BASE_URL 时首次调用才抛）。 */
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

  // —— 账户/鉴权 ——

  login(input: NewApiLoginInput): Promise<NewApiLoginResult> {
    return this.client.login(input);
  }

  register(input: NewApiRegisterInput): Promise<NewApiLoginResult> {
    return this.client.register(input);
  }

  resolveTokenIdentity(token: string): Promise<NewApiAccountIdentity> {
    return this.client.resolveTokenIdentity(token);
  }

  getAccountCapabilities(): Promise<NewApiAccountCapabilities> {
    return this.client.getAccountCapabilities();
  }

  getTokenUsage(token: string): Promise<NewApiUsage> {
    return this.client.getTokenUsage(token);
  }

  /** 修改密码（IKBRCK）：校验原密码后写入新密码，透传网关 PUT /api/user/self。 */
  changePassword(input: NewApiChangePasswordInput, token: string): Promise<void> {
    return this.client.changePassword(input, token);
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

  listUserConsumeLogs(
    token: string,
    options: { page?: number; pageSize?: number },
  ) {
    return this.client.listUserConsumeLogs(token, options);
  }

  /** IKAFPC：按能力券号汇总实际消费，用于「本会话累计消耗积分」。 */
  sumRunCapabilityQuota(
    token: string,
    capabilityIds: readonly string[],
    window?: { startTimestamp?: number; endTimestamp?: number; maxPages?: number },
  ) {
    return this.client.sumRunCapabilityQuota(token, capabilityIds, window);
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

  manageAdminUser(
    token: string,
    userId: number,
    input: {
      id: number;
      action: "disable" | "enable" | "add_quota";
      value?: number;
      mode?: "add" | "subtract";
    },
  ) {
    return this.client.manageAdminUser(token, userId, input);
  }
}
