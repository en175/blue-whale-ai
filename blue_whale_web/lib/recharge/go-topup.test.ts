import { describe, expect, it } from "vitest";

import { loadGoTopUpConfig } from "./go-topup";

describe("loadGoTopUpConfig", () => {
  it("有 NEW_API_BASE_URL → 解析出 baseUrl", () => {
    expect(loadGoTopUpConfig({ NEW_API_BASE_URL: "http://new-api.test" })).toEqual({
      baseUrl: "http://new-api.test",
    });
  });

  it("充值链路不再依赖 root 凭证 env（退役），未配置 root env 不影响解析", () => {
    expect(
      loadGoTopUpConfig({
        NEW_API_BASE_URL: "http://new-api.test",
        NEW_API_ROOT_ACCESS_TOKEN: "",
        NEW_API_ROOT_USER_ID: "",
      }),
    ).toEqual({ baseUrl: "http://new-api.test" });
  });

  it("缺 NEW_API_BASE_URL → null（调用方按未配置返回 503）", () => {
    expect(loadGoTopUpConfig({})).toBeNull();
    expect(loadGoTopUpConfig({ NEW_API_BASE_URL: "" })).toBeNull();
  });
});
