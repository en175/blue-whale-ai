import { describe, expect, it } from "vitest";

import { isCaptchaAnswerCorrect, normalizeCaptchaAnswer } from "./captcha.js";

describe("验证码答案比对", () => {
  it("忽略大小写和首尾空白", () => {
    expect(isCaptchaAnswerCorrect(" AB2C ", "AB2C")).toBe(true);
    expect(isCaptchaAnswerCorrect("ab2c", "AB2C")).toBe(true);
  });

  it("错误答案/空值判失败", () => {
    expect(isCaptchaAnswerCorrect("AB2D", "AB2C")).toBe(false);
    expect(isCaptchaAnswerCorrect("", "AB2C")).toBe(false);
    expect(isCaptchaAnswerCorrect(undefined, "AB2C")).toBe(false);
  });

  it("归一化：非字符串回空串", () => {
    expect(normalizeCaptchaAnswer(123)).toBe("");
    expect(normalizeCaptchaAnswer(" ab2c ")).toBe("AB2C");
  });
});
