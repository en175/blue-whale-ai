import { describe, expect, it } from "vitest";

import { signVolcengineRequest } from "./volcengine-signer.js";

describe("signVolcengineRequest", () => {
  it("matches Java VolcengineSigner Authorization for a fixed SMS request", () => {
    const result = signVolcengineRequest({
      method: "POST",
      body: '{"Sign":"玄浮科技","code":"123456"}',
      date: new Date("2026-07-27T12:00:00.000Z"),
      action: "SendSms",
      version: "2020-01-01",
      region: "cn-beijing",
      service: "volcSMS",
      host: "open.volcengineapi.com",
      path: "/",
      ak: "test-ak-123",
      sk: "test-sk-456",
    });

    expect(result.xDate).toBe("20260727T120000Z");
    expect(result.contentHash).toBe(
      "45ecb1c54adc9b6c6375eff1f5a1fd2537cd854245a8f0635f39996399df51f3",
    );
    expect(result.authorization).toBe(
      "HMAC-SHA256 Credential=test-ak-123/20260727/cn-beijing/volcSMS/request, SignedHeaders=content-type;host;x-content-sha256;x-date, Signature=058e3fa0eed00298994bf9de3e4c4fc74a8c78bb68e5d4dfa87676f8ab79b59d",
    );
  });
});
