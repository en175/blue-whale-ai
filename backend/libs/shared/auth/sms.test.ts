import { describe, expect, it } from "vitest";

import { resolveSmsCredentials } from "./sms.js";

describe("resolveSmsCredentials — 短信 AK/SK 独立配置", () => {
  it("配置了短信专用 AK/SK 时优先使用", () => {
    expect(
      resolveSmsCredentials({
        VOLC_SMS_ACCESS_KEY_ID: "sms-ak",
        VOLC_SMS_SECRET_ACCESS_KEY: "sms-sk",
        VOLC_ACCESS_KEY_ID: "shared-ak",
        VOLC_SECRET_ACCESS_KEY: "shared-sk",
      }),
    ).toEqual({ ak: "sms-ak", sk: "sms-sk" });
  });

  it("未配置短信专用值时回退到共用 AK/SK", () => {
    expect(
      resolveSmsCredentials({
        VOLC_ACCESS_KEY_ID: "shared-ak",
        VOLC_SECRET_ACCESS_KEY: "shared-sk",
      }),
    ).toEqual({ ak: "shared-ak", sk: "shared-sk" });
  });

  it("短信专用值为空白时同样回退", () => {
    expect(
      resolveSmsCredentials({
        VOLC_SMS_ACCESS_KEY_ID: "   ",
        VOLC_SMS_SECRET_ACCESS_KEY: "",
        VOLC_ACCESS_KEY_ID: "shared-ak",
        VOLC_SECRET_ACCESS_KEY: "shared-sk",
      }),
    ).toEqual({ ak: "shared-ak", sk: "shared-sk" });
  });

  it("两者都未配置时返回空串", () => {
    expect(resolveSmsCredentials({})).toEqual({ ak: "", sk: "" });
  });
});
