import { describe, expect, it } from "vitest";

import { loadGoTopUpCredentials } from "./go-topup";

const CONFIGURED_ENV = {
  NEW_API_BASE_URL: "http://new-api.test",
  NEW_API_ROOT_ACCESS_TOKEN: "root-access-token",
  NEW_API_ROOT_USER_ID: "1",
};

describe("loadGoTopUpCredentials", () => {
  it("env 齐全 → 解析出 baseUrl / rootToken / rootUserId", () => {
    expect(loadGoTopUpCredentials(CONFIGURED_ENV)).toEqual({
      baseUrl: "http://new-api.test",
      rootToken: "root-access-token",
      rootUserId: 1,
    });
  });

  it("缺任一凭证 / 非法 user id → null", () => {
    expect(loadGoTopUpCredentials({})).toBeNull();
    expect(
      loadGoTopUpCredentials({
        NEW_API_BASE_URL: "http://x",
        NEW_API_ROOT_ACCESS_TOKEN: "t",
      }),
    ).toBeNull();
    expect(
      loadGoTopUpCredentials({
        ...CONFIGURED_ENV,
        NEW_API_ROOT_USER_ID: "abc",
      }),
    ).toBeNull();
    expect(
      loadGoTopUpCredentials({ ...CONFIGURED_ENV, NEW_API_ROOT_USER_ID: "0" }),
    ).toBeNull();
    expect(
      loadGoTopUpCredentials({
        ...CONFIGURED_ENV,
        NEW_API_ROOT_ACCESS_TOKEN: "",
      }),
    ).toBeNull();
  });
});
