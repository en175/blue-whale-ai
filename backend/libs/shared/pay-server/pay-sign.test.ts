import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";
import { paySign, verifyPaySign } from "./pay-sign.js";

describe("pay-sign — 商户报文签名（对齐网关 JeepayKit.getSign）", () => {
  it("固定向量：非空字段拼 k=v& 排序后接 key={secret}，MD5 转大写", () => {
    // 手算锚点（不是拿实现自证）：payload = "a=1&b=2&key=k"
    expect(paySign({ a: "1", b: "2" }, "k")).toBe("F8F06AFA2E241A36469B9DAC959B3474");
  });

  it("排序是 Java CASE_INSENSITIVE_ORDER，不是 JS 默认码位序", () => {
    // 这组键专门用来分开两种排序：
    //   Java：先比大写 → 'A'='a' → 再比小写 → 'a' < 'b' → "ab=2&" 在前
    //   JS 默认：'A'(65) < 'a'(97) → "Amount=1&" 在前（错）
    // 键是大写开头而网关是小写开头时（或反之），只有 Java 的规则能签出同一个值。
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
    // 与「一开始就不带这些字段」等价
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
  /**
   * ⚠️ 这条钉的是一个**今天不会发作、将来会**的 bug。
   *
   * JDK 的 `String.CaseInsensitiveComparator` 在「大写不同」那一步**不返回**，
   * 而是把已转大写的值**再转小写**，返回小写差值。曾经的实现在大写那步就 return 了 ——
   * 两者在字母之间结果相同，但在「非字母（`[ \ ] ^ _ \``，码位 91–96）对上字母」时
   * **符号相反**，因为转小写把 65–90 的字母推到 97–122，跨过了那些非字母。
   *
   * 实际报文里的键全是 camelCase，两种算法恰好给出同样的顺序 —— 所以线上跑得通，
   * 也所以这个错**不会被任何真实调用暴露**。一旦出现下划线与 camelCase 混排的键，
   * 签名翻转，症状是一句无从下手的「验签失败」。
   *
   * 断言不写死一个魔数，而是把**正确的拼接顺序显式写出来**自己算 MD5：
   * 这样读测试的人能直接对着 JDK 的判断逐字符核，不用相信我。
   */
  it("★ 下划线对上字母时排序不翻转：`a_b` 排在 `aB` 之前", () => {
    const signed = paySign({ a_b: "1", aB: "2" }, "secret");

    // 逐字符走一遍 JDK：i=1 时 '_'(95) vs 'B'(66) →
    // 转大写仍是 95 vs 66（不同）→ 再转小写是 95 vs 98（仍不同）→ 返回 95-98 < 0
    // ⇒ '_' 排在 'B' 前 ⇒ 拼接顺序是 a_b 在前。
    // 修复前卡在大写那步返回 95-66 > 0，顺序恰好反过来。
    const correctOrder = "a_b=1&aB=2&key=secret";
    expect(signed).toBe(
      createHash("md5").update(correctOrder, "utf8").digest("hex").toUpperCase(),
    );
  });

  it("反证：全是 camelCase 的键上，两种算法给出同一个顺序 —— 这正是它潜伏至今的原因", () => {
    // `amount` vs `appId`：第 2 个字符 'm'(109) vs 'p'(112) 都是字母，
    // 转大写/转小写都保持同向，所以两种实现一致 —— 真实报文全是这种键，
    // 上线跑了这么久也没暴露，正是因为这里恰好重合。
    const signed = paySign({ amount: "2", appId: "a" }, "secret");
    expect(signed).toBe(
      createHash("md5").update("amount=2&appId=a&key=secret", "utf8").digest("hex").toUpperCase(),
    );
  });
});
