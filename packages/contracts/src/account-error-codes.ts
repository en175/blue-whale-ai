// 账号/认证域对外错误码（IKBQEE / ADR-0078 统一错误码体系）。
// 段位约定见 packages/contracts/src/result.ts：1xxx（1000-1999）= 领域错误码，
// 生成任务领域已用 1001-1028；本域（账号/认证）从 1100+ 起，每错一码，前端按码映射文案。
// 触发场景：PUT /api/me/password 改密等账号自助接口，上游网关（new-api）业务失败
// 返回英文 message，此处归一为账号域数值码 + 用户可读中文（job 1612 同款问题的账号域对应）。

/** 账号域未知/白名单外错误兜底码（1100 段起点）。 */
export const ACCOUNT_ERROR_UNKNOWN_NUMERIC_CODE = 1100;

/** 账号域错误码（字符串内部契约 → 数值码外部契约，一一对应）。 */
export const ACCOUNT_ERROR_PASSWORD_INCORRECT = "password_incorrect";
export const ACCOUNT_ERROR_PASSWORD_INVALID = "password_invalid";
export const ACCOUNT_ERROR_PASSWORD_NOT_SET = "password_not_set";

export const ACCOUNT_ERROR_NUMERIC_CODES: Record<string, number> = {
  [ACCOUNT_ERROR_PASSWORD_INCORRECT]: 1101,
  [ACCOUNT_ERROR_PASSWORD_INVALID]: 1102,
  [ACCOUNT_ERROR_PASSWORD_NOT_SET]: 1103,
};

/** 字符串码 → 数值码；白名单外/未知码兜底 1100。 */
export function accountErrorToNumeric(code: string): number {
  return (
    ACCOUNT_ERROR_NUMERIC_CODES[code] ?? ACCOUNT_ERROR_UNKNOWN_NUMERIC_CODE
  );
}

/** 账号域错误中文文案（对外 message 一律由此生成，杜绝网关英文透传）。 */
export function accountMessageFor(code: string): string {
  switch (code) {
    case ACCOUNT_ERROR_PASSWORD_INCORRECT:
      return "原密码错误，请重试";
    case ACCOUNT_ERROR_PASSWORD_INVALID:
      return "新密码需为 8-20 位";
    case ACCOUNT_ERROR_PASSWORD_NOT_SET:
      return "当前账号未设置密码";
    default:
      // 防御性兜底：改密投影 flow 只对已知 3 码调本函数，未知错误由调用方传 fallback；
      // 未来账号域新增错误码（登录/注册等）才可能命中此分支。
      return "账号操作失败，请稍后重试";
  }
}

/** 账号域对外错误对象（数值码 + 中文文案，前端可直接展示 message）。 */
export interface PublicAccountError {
  /** 每错一码的独立数值码（1100+ 段；未知兜底 1100）。 */
  code: number;
  /** 用户可读中文文案。 */
  message: string;
}
