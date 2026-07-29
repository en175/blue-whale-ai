import { describe, expect, it } from "vitest";

import { buildTosPresignedGetUrl } from "./tos-presigned-url.js";

// TOS 预签名 URL：Java 走官方 SDK（TOSV2.preSignedURL），无独立签名源可做字节级 golden。
// 此处用确定性回归 + 结构断言锁算法：同输入必出同 URL，结构符合 TOS4-HMAC-SHA256 预签名规范。
// ⚠️ 真实 TOS 端到端可接受性须上线前用真实 AK/SK 验一次。

const baseInput = {
  endpoint: "tos-cn-beijing.volces.com",
  bucket: "blue-whale-test",
  region: "cn-beijing",
  ak: "AKtest123",
  sk: "SKtest456",
  now: new Date("2026-07-27T12:00:00.000Z"),
};

describe("buildTosPresignedGetUrl", () => {
  it("产出结构与 SigV4 预签名规范一致", () => {
    const { url, expiresAt } = buildTosPresignedGetUrl({
      ...baseInput,
      key: "gen/sha256/abc.png",
      expiresInSeconds: 600,
    });

    expect(url.startsWith(
      "https://blue-whale-test.tos-cn-beijing.volces.com/gen/sha256/abc.png?",
    )).toBe(true);
    expect(url).toContain("X-Tos-Algorithm=TOS4-HMAC-SHA256");
    // credential 的 / 须被编码为 %2F（SigV4 规范要求 query 值全量编码）
    expect(url).toContain(
      "X-Tos-Credential=AKtest123%2F20260727%2Fcn-beijing%2Ftos%2Frequest",
    );
    expect(url).toContain("X-Tos-Date=20260727T120000Z");
    expect(url).toContain("X-Tos-Expires=600");
    expect(url).toContain("X-Tos-SignedHeaders=host");
    expect(url).toMatch(/X-Tos-Signature=[0-9a-f]{64}$/);
    expect(expiresAt.toISOString()).toBe("2026-07-27T12:10:00.000Z");
  });

  it("同输入确定性输出（回归 golden）", () => {
    const a = buildTosPresignedGetUrl({
      ...baseInput,
      key: "video/jobs/1/slot-0/x.mp4",
      expiresInSeconds: 900,
    });
    const b = buildTosPresignedGetUrl({
      ...baseInput,
      key: "video/jobs/1/slot-0/x.mp4",
      expiresInSeconds: 900,
    });
    expect(a.url).toBe(b.url);
  });

  it("key 含特殊字符（空格/中文）按段 URI 编码，/ 保留", () => {
    const { url } = buildTosPresignedGetUrl({
      ...baseInput,
      key: "a b/中/x.png",
      expiresInSeconds: 60,
    });
    // 空格→%20，中文→UTF-8 百分比，/ 保留
    expect(url).toContain("/a%20b/%E4%B8%AD/x.png?");
  });

  it("signature 随 sk 变化（签名真的依赖密钥）", () => {
    const a = buildTosPresignedGetUrl({
      ...baseInput,
      key: "k.png",
      expiresInSeconds: 60,
    });
    const b = buildTosPresignedGetUrl({
      ...baseInput,
      key: "k.png",
      expiresInSeconds: 60,
      sk: "SKdifferent789",
    });
    expect(a.url).not.toBe(b.url);
    const sigA = a.url.split("X-Tos-Signature=")[1];
    const sigB = b.url.split("X-Tos-Signature=")[1];
    expect(sigA).not.toBe(sigB);
  });
});
