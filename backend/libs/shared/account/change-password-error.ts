// IKBQEE / ADR-0078：账号域错误投影（改密等账号自助接口）。
// 上游网关（new-api）业务失败返回英文 message，这里归一为账号域数值码 + 用户可读中文，
// 杜绝英文透传到前端（job 1612 同款问题在账号域的对应）。数值码段位见 contracts/result.ts（1100+）。
import {
  ACCOUNT_ERROR_PASSWORD_INCORRECT,
  ACCOUNT_ERROR_PASSWORD_INVALID,
  ACCOUNT_ERROR_PASSWORD_NOT_SET,
  ACCOUNT_ERROR_UNKNOWN_NUMERIC_CODE,
  accountErrorToNumeric,
  accountMessageFor,
} from "@blue-whale/contracts";

export interface ProjectedAccountError {
  code: number;
  message: string;
}

/**
 * 上游错误 → 账号域 {code, message}。
 * - 按网关英文/中文关键词归类到账号域错误码（每错一码）；
 * - 无法归类的未知错误兜底 1100 + 调用方 fallback 中文。
 * 归类顺序：密码格式（invalid/length/format）先于原密码错误（incorrect），
 * 避免 "New password length is incorrect" 这类同时含两词的消息被误判成原密码错误。
 * 与生成域 projectPublicError 同构：对外 message 一律中文，不暴露网关原文。
 */
export function projectAccountError(
  error: unknown,
  fallbackMessage: string,
): ProjectedAccountError {
  const text =
    error instanceof Error ? error.message : String(error ?? "");
  const pick = (code: string) => ({
    code: accountErrorToNumeric(code),
    message: accountMessageFor(code),
  });
  if (/invalid|length|format|8-20|weak|弱密码|非法/i.test(text)) {
    return pick(ACCOUNT_ERROR_PASSWORD_INVALID);
  }
  if (/password.*not\s*(set|defined)|未设置密码|no\s*password/i.test(text)) {
    return pick(ACCOUNT_ERROR_PASSWORD_NOT_SET);
  }
  if (/incorrect|wrong|原密码错误|密码错误/i.test(text)) {
    return pick(ACCOUNT_ERROR_PASSWORD_INCORRECT);
  }
  return {
    code: ACCOUNT_ERROR_UNKNOWN_NUMERIC_CODE,
    message: fallbackMessage,
  };
}
