import { describe, expect, it } from "vitest";

import { NewApiError } from "@lib/core";
import {
  ACCOUNT_ERROR_CODE_WRONG,
  ACCOUNT_ERROR_PASSWORD_INCORRECT,
  ACCOUNT_ERROR_PASSWORD_INVALID,
  ACCOUNT_ERROR_UNKNOWN_NUMERIC_CODE,
  accountErrorToNumeric,
  accountMessageFor,
} from "@lib/contracts";
import {
  CodeWrongError,
  InvalidPhoneError,
} from "@lib/shared/auth/phone-verification.service.js";
import {
  AccountDisabledError,
  InvalidCredentialsError,
  NicknameInvalidError,
} from "@lib/shared/identity/identity.service.js";
import { PasswordPolicyError } from "@lib/shared/identity/password.js";
import { PhoneTakenError } from "@lib/shared/persistence/identity-user-repo.js";
import {
  projectAuthFailure,
  projectPasswordChangeFailure,
  toAuthError,
} from "./auth-error.js";

describe("projectAuthFailure", () => {
  it("验证码错误保留剩余次数文案", () => {
    expect(projectAuthFailure(new CodeWrongError(3))).toEqual({
      status: 400,
      message: "验证码错误，请重新输入（还可尝试3次）",
      errorCode: ACCOUNT_ERROR_CODE_WRONG,
    });
  });

  it("手机号非法与账号停用使用各自的公开状态", () => {
    expect(projectAuthFailure(new InvalidPhoneError())).toEqual({
      status: 400,
      message: "手机号格式不正确",
    });
    expect(projectAuthFailure(new AccountDisabledError())).toMatchObject({
      status: 403,
      errorCode: "account_disabled",
    });
  });

  it("号码占用与昵称非法映射到契约错误码", () => {
    expect(projectAuthFailure(new PhoneTakenError())).toMatchObject({
      status: 400,
      errorCode: "phone_taken",
    });
    expect(projectAuthFailure(new NicknameInvalidError())).toMatchObject({
      status: 400,
      errorCode: "nickname_invalid",
    });
  });

  it("凭据错误映射 401 invalid_credentials", () => {
    expect(projectAuthFailure(new InvalidCredentialsError())).toMatchObject({
      status: 401,
      errorCode: "invalid_credentials",
    });
  });

  it("未知错误返回 null，交给统一兜底", () => {
    expect(projectAuthFailure(new Error("boom"))).toBeNull();
    expect(projectAuthFailure("boom")).toBeNull();
  });
});

describe("projectPasswordChangeFailure", () => {
  it("密码策略错误 → password_invalid", () => {
    expect(
      projectPasswordChangeFailure(
        new PasswordPolicyError("密码长度需为8-20位"),
        "修改密码失败",
      ),
    ).toEqual({
      code: accountErrorToNumeric(ACCOUNT_ERROR_PASSWORD_INVALID),
      message: "密码长度需为8-20位",
    });
  });

  it("凭据错误 → password_incorrect", () => {
    expect(
      projectPasswordChangeFailure(
        new InvalidCredentialsError(),
        "修改密码失败",
      ),
    ).toEqual({
      code: accountErrorToNumeric(ACCOUNT_ERROR_PASSWORD_INCORRECT),
      message: accountMessageFor(ACCOUNT_ERROR_PASSWORD_INCORRECT),
    });
  });

  it("未知错误 → 1100 + 兜底文案", () => {
    expect(
      projectPasswordChangeFailure(new Error("db exploded"), "修改密码失败"),
    ).toEqual({
      code: ACCOUNT_ERROR_UNKNOWN_NUMERIC_CODE,
      message: "修改密码失败",
    });
  });
});

describe("toAuthError", () => {
  it("401 统一为登录凭证无效", () => {
    expect(toAuthError(new NewApiError("x", 401))).toMatchObject({
      status: 401,
      message: "登录凭证无效",
    });
  });

  it("未知错误 → 502 account_service_error", () => {
    expect(toAuthError(new Error("boom"))).toMatchObject({
      status: 502,
      code: "account_service_error",
    });
  });
});
