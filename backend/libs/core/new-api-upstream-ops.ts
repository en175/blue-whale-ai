import type {NewApiEnvelope, NewApiRequest} from "./new-api-transport.js";
import type {NewApiPricingItem, NewApiPricingResult} from "./new-api-types.js";

export function createNewApiUpstreamOps(request: NewApiRequest) {
  return {
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
