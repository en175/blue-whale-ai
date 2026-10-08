import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";
import { paySign, verifyPaySign } from "./pay-sign.js";

describe("pay-sign — 商户报文签名（对齐网关 JeepayKit.getSign）", () => {
  it("固定向量：非空字段拼 k=v& 排序后接 key={secret}，MD5 转大写", () => {
    expect(paySign({ a: "1", b: "2" }, "k")).toBe("F8F06AFA2E241A36469B9DAC959B3474");
  });

  it("排序是 Java CASE_INSENSITIVE_ORDER，不是 JS 默认码位序", () => {
    expect(paySign({ Amount: "1", ab: "2" }, "k")).toBe(
      "5B80F43B9959907A816B323CC70ABCCC",
    );
  });

  it("空值字段不参与签名（null / undefined / 空串），与网关一致", () => {
    const withBlanks = paySign(
      { amount: "100", appId: "bw-app", mchOrderNo: "RC1", clientIp: "", extParam: null },
      "s3cret",
    );
    expect(withBlanks).toBe("D93B62A291C9B1191476D45BFC675EA3");
    expect(withBlanks).toBe(
      paySign({ amount: "100", appId: "bw-app", mchOrderNo: "RC1" }, "s3cret"),
    );
  });

  it("数字值按它将出现在报文里的那个字符串参与签名", () => {
    expect(paySign({ amount: 1 }, "k")).toBe(paySign({ amount: "1" }, "k"));
  });

  it("验签通过：自己签的报文自己验得过", () => {
    const params = { mchOrderNo: "RC1", amount: "100", state: "2" };
    const sign = paySign(params, "s3cret");
    expect(verifyPaySign({ ...params, sign }, "s3cret")).toBe(true);
  });

  it("验签失败：报文被改（金额改大）", () => {
    const params = { mchOrderNo: "RC1", amount: "100", state: "2" };
    const sign = paySign(params, "s3cret");
    expect(verifyPaySign({ ...params, amount: "10000", sign }, "s3cret")).toBe(false);
  });

  it("验签失败：密钥不对 / 没有 sign 字段", () => {
    const params = { mchOrderNo: "RC1", amount: "100", state: "2" };
    const sign = paySign(params, "s3cret");
    expect(verifyPaySign({ ...params, sign }, "wrong-secret")).toBe(false);
    expect(verifyPaySign(params, "s3cret")).toBe(false);
  });

  it("验签大小写不敏感：网关回包用大写 MD5，但比对不当成区分大小写", () => {
    const params = { mchOrderNo: "RC1", amount: "100", state: "2" };
    const sign = paySign(params, "s3cret").toLowerCase();
    expect(verifyPaySign({ ...params, sign }, "s3cret")).toBe(true);
  });
});

describe("pay-sign — Java CASE_INSENSITIVE_ORDER 的分支结构必须逐字照抄", () => {
  it("★ 下划线对上字母时排序不翻转：`a_b` 排在 `aB` 之前", () => {
    const signed = paySign({ a_b: "1", aB: "2" }, "secret");

    const correctOrder = "a_b=1&aB=2&key=secret";
    expect(signed).toBe(
      createHash("md5").update(correctOrder, "utf8").digest("hex").toUpperCase(),
    );
  });

  it("反证：全是 camelCase 的键上，两种算法给出同一个顺序 —— 这正是它潜伏至今的原因", () => {
    const signed = paySign({ amount: "2", appId: "a" }, "secret");
    expect(signed).toBe(
      createHash("md5").update("amount=2&appId=a&key=secret", "utf8").digest("hex").toUpperCase(),
    );
  });
});
