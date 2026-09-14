// IK74V8：从 new-api-client.ts 拆出（≤800 行硬线）。逐块搬运，语义不变。
// 管理面（RootAuth）：站点选项、用户与充值管理、日志统计。
import {normalizePage} from "./new-api-transport.js";
import type {NewApiEnvelope, NewApiRequest} from "./new-api-transport.js";
import type {NewApiAdminTopUpRow, NewApiAdminManageUserInput, NewApiAdminUserRow, NewApiLogRow, NewApiLogStat, NewApiPageInfo} from "./new-api-types.js";

export function createNewApiAdminOps(request: NewApiRequest) {
  return {
    async getRootOption(
      rootToken: string,
      rootUserId: number,
      key: string,
    ): Promise<string | null> {
      const response = await request<NewApiEnvelope>(
        "/api/option/",
        {
          method: "GET",
          headers: { "New-Api-User": String(rootUserId) },
        },
        rootToken,
      );
      const items = Array.isArray(response.data)
        ? (response.data as Array<{ key?: unknown; value?: unknown }>)
        : [];
      const found = items.find((item) => item.key === key);
      if (!found || found.value == null) return null;
      return typeof found.value === "string" ? found.value : String(found.value);
    },

    /** 写单个 option。value 必须已是 JSON 字符串——Go UpdateOption 对 object 值会
     *  `fmt.Sprintf("%v")` 损坏，必须发字符串（Go 前端即如此）。 */
    async putRootOption(
      rootToken: string,
      rootUserId: number,
      key: string,
      value: string,
    ): Promise<void> {
      await request<NewApiEnvelope>(
        "/api/option/",
        {
          method: "PUT",
          headers: { "New-Api-User": String(rootUserId) },
          body: JSON.stringify({ key, value }),
        },
        rootToken,
      );
    },

    // ---- 管理端（AdminAuth：role >= 10 的管理员 token，信封为标准分页 PageInfo）----
    // 注意：blue-whale-api 定制版要求管理接口带 New-Api-User:<userId> 头
    //（须与 token 属主一致，authHelper 强制校验），且列表路由须带尾斜杠
    //（/api/user/、/api/log/，无斜杠会 404/301）。IK6M2F。

    /** 用户列表/搜索：有筛选条件走 /api/user/search，否则 /api/user/。 */
    async listAdminUsers(
      token: string,
      userId: number,
      options: {
        keyword?: string;
        status?: number;
        role?: number;
        page?: number;
        pageSize?: number;
      } = {},
    ): Promise<NewApiPageInfo<NewApiAdminUserRow>> {
      const params = new URLSearchParams();
      if (options.keyword) params.set("keyword", options.keyword);
      if (options.status != null) params.set("status", String(options.status));
      if (options.role != null) params.set("role", String(options.role));
      params.set("p", String(options.page ?? 1));
      params.set("page_size", String(options.pageSize ?? 20));
      const hasFilter =
        Boolean(options.keyword) ||
        options.status != null ||
        options.role != null;
      const path = hasFilter
        ? `/api/user/search?${params}`
        : `/api/user/?${params}`;
      const response = await request<NewApiEnvelope>(
        path,
        { method: "GET", headers: { "New-Api-User": String(userId) } },
        token,
      );
      return normalizePage(response.data, options.pageSize ?? 20);
    },

    /** 用户管理写操作（冻结 disable / 解冻 enable / 加减余额 add_quota）。 */
    async manageAdminUser(
      token: string,
      userId: number,
      input: NewApiAdminManageUserInput,
    ): Promise<void> {
      await request<NewApiEnvelope>(
        "/api/user/manage",
        {
          method: "POST",
          headers: { "New-Api-User": String(userId) },
          body: JSON.stringify(input),
        },
        token,
      );
    },

    /** 全平台充值记录（管理端），keyword 模糊匹配 trade_no。 */
    async listAdminTopUps(
      token: string,
      userId: number,
      options: { keyword?: string; page?: number; pageSize?: number } = {},
    ): Promise<NewApiPageInfo<NewApiAdminTopUpRow>> {
      const params = new URLSearchParams();
      if (options.keyword) params.set("keyword", options.keyword);
      params.set("p", String(options.page ?? 1));
      params.set("page_size", String(options.pageSize ?? 20));
      const response = await request<NewApiEnvelope>(
        `/api/user/topup?${params}`,
        { method: "GET", headers: { "New-Api-User": String(userId) } },
        token,
      );
      return normalizePage(response.data, options.pageSize ?? 20);
    },

    /** 管理员补单：把 pending 订单手工置为到账（Go ManualCompleteTopUp）。 */
    async completeAdminTopUp(
      token: string,
      userId: number,
      tradeNo: string,
    ): Promise<void> {
      await request<NewApiEnvelope>(
        "/api/user/topup/complete",
        {
          method: "POST",
          headers: { "New-Api-User": String(userId) },
          body: JSON.stringify({ trade_no: tradeNo }),
        },
        token,
      );
    },

    /** 日志聚合统计（GetLogsStat）：type=2 为消费；quota 单位与用户余额一致。 */
    async getAdminLogStat(
      token: string,
      userId: number,
      input: { type: number; startTimestamp: number; endTimestamp: number },
    ): Promise<NewApiLogStat> {
      const params = new URLSearchParams({
        type: String(input.type),
        start_timestamp: String(input.startTimestamp),
        end_timestamp: String(input.endTimestamp),
      });
      const response = await request<NewApiEnvelope>(
        `/api/log/stat?${params}`,
        { method: "GET", headers: { "New-Api-User": String(userId) } },
        token,
      );
      const data = (response.data ?? {}) as Partial<NewApiLogStat>;
      return {
        quota: typeof data.quota === "number" ? data.quota : 0,
        rpm: typeof data.rpm === "number" ? data.rpm : 0,
        tpm: typeof data.tpm === "number" ? data.tpm : 0,
      };
    },

    /** 全平台使用日志（管理端，/api/log/ 分页，id 倒序）。 */
    async listAdminLogs(
      token: string,
      userId: number,
      options: { page?: number; pageSize?: number } = {},
    ): Promise<NewApiPageInfo<NewApiLogRow>> {
      const params = new URLSearchParams({
        p: String(options.page ?? 1),
        page_size: String(options.pageSize ?? 20),
      });
      const response = await request<NewApiEnvelope>(
        `/api/log/?${params}`,
        { method: "GET", headers: { "New-Api-User": String(userId) } },
        token,
      );
      return normalizePage(response.data, options.pageSize ?? 20);
    },
  };
}
