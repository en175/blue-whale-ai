import { Injectable } from "@nestjs/common";
import { createNewApiClient, NewApiError } from "@lib/core";

type NewApiClient = ReturnType<typeof createNewApiClient>;

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

  sumAgentRunQuota(
    token: string,
    agentRunIds: readonly string[],
    window?: { startTimestamp?: number; endTimestamp?: number; maxPages?: number },
  ) {
    return this.client.sumAgentRunQuota(token, agentRunIds, window);
  }
}
