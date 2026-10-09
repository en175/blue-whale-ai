import type {NewApiEnvelope, NewApiRequest} from "./new-api-transport.js";
import type {NewApiAgentRunQuotaResult, NewApiPricingItem, NewApiPricingResult} from "./new-api-types.js";

function readAgentRunId(other: unknown): string {
  const raw = typeof other === "string" ? safeParse(other) : other;
  if (!raw || typeof raw !== "object") return "";
  const id = (raw as Record<string, unknown>).agent_run_id;
  return typeof id === "string" ? id : "";
}

function safeParse(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

export function createNewApiUpstreamOps(request: NewApiRequest) {
  return {
    async sumAgentRunQuota(
      token: string,
      agentRunIds: readonly string[],
      window: {
        startTimestamp?: number;
        endTimestamp?: number;
        maxPages?: number;
        budgetMs?: number;
      } = {},
    ): Promise<NewApiAgentRunQuotaResult> {
      const wanted = new Set(agentRunIds.filter((id) => typeof id === "string" && id.length > 0));
      if (wanted.size === 0) return { quota: 0, matched: 0, truncated: false };

      const pageSize = 100;
      const maxPages = Math.max(1, Math.trunc(window.maxPages ?? 10));
      const deadline = Date.now() + Math.max(1_000, Math.trunc(window.budgetMs ?? 20_000));
      const range = [
        window.startTimestamp ? `&start_timestamp=${Math.trunc(window.startTimestamp)}` : "",
        window.endTimestamp ? `&end_timestamp=${Math.trunc(window.endTimestamp)}` : "",
      ].join("");

      let quota = 0;
      let matched = 0;
      let truncated = false;
      for (let page = 1; page <= maxPages; page += 1) {
        if (Date.now() >= deadline) {
          truncated = true;
          break;
        }
        const response = await request<NewApiEnvelope>(
          `/api/log/self?p=${page}&page_size=${pageSize}&type=2${range}`,
          { method: "GET" },
          token,
        );
        const data = (response.data ?? {}) as { items?: unknown; total?: unknown };
        const rawItems = Array.isArray(data.items) ? (data.items as Array<Record<string, unknown>>) : [];
        for (const raw of rawItems) {
          if (!wanted.has(readAgentRunId(raw.other))) continue;
          matched += 1;
          quota += Number(raw.quota ?? 0);
        }
        if (rawItems.length < pageSize) break;
        if (page === maxPages) truncated = true;
      }
      return { quota, matched, truncated };

    },

    async getPricing(
      token?: string,
    ): Promise<NewApiPricingResult> {
      const response = await request<NewApiEnvelope>(
        "/api/pricing",
        { method: "GET" },
        token,
      );
      const envelope = (response ?? {}) as Record<string, unknown>;
      const items = Array.isArray(envelope.data)
        ? (envelope.data as Array<Record<string, unknown>>)
        : [];
      return {
        pricing: items.map((raw): NewApiPricingItem => {
          const modelPrice =
            typeof raw.model_price === "number" ? raw.model_price : undefined;
          const modelRatio =
            typeof raw.model_ratio === "number" ? raw.model_ratio : undefined;
          const billingMode =
            typeof raw.billing_mode === "string" ? raw.billing_mode : undefined;
          const billingExpr =
            typeof raw.billing_expr === "string" ? raw.billing_expr : undefined;
          return {
            modelName: typeof raw.model_name === "string" ? raw.model_name : "",
            ...(modelPrice !== undefined ? { modelPrice } : {}),
            ...(modelRatio !== undefined ? { modelRatio } : {}),
            ...(billingMode !== undefined ? { billingMode } : {}),
            ...(billingExpr !== undefined ? { billingExpr } : {}),
          };
        }),
        ...(typeof envelope.pricing_version === "string"
          ? { pricingVersion: envelope.pricing_version }
          : {}),
      };
    },


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
  };
}
