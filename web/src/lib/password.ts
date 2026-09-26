/**
 * 口令规则 —— **前端唯一的一处**。
 *
 * <h2>为什么要有这个文件</h2>
 *
 * 这条规则原本在 `LoginModal/password.ts` 与 `UserDropdown/PasswordModal/password.ts`
 * 里各写了一遍（两份都是 `length >= 8 && length <= 20`）。两份一模一样的校验不会有
 * 任何测试红——直到有人只改其中一份，于是「注册能过、改密过不了」。
 *
 * <h2>与后端的口径必须逐字对齐</h2>
 *
 * 后端权威在 `backend/libs/shared/identity/password.ts` 的 `hashPassword`：
 * **至少 8 位、至多 72 字节**（bcrypt 在 72 字节处截断，超出部分被丢弃）。
 * 前端若按字符数拦，一个 30 字符的中文密码会在这里通过、到后端才被拒——
 * 用户看到的是「点确定没反应」。
 *
 * <p>⚠️ 与后端一致：**只约束长度，不做复杂度规则**（大小写/符号）。那类规则把用户
 * 推向 `Passw0rd!` 这类可预测的口令，收益远不如长度。
 *
 * ⚠️ 同样与后端一致：**校验（登录）时不施加任何长度规则**。这条只作用于「设置口令」，
 * 拦在校验上会把历史短口令账号锁在门外，而他们没做错任何事。
 */
export const PASSWORD_MIN_LENGTH = 8;

/** bcrypt 的输入上限，单位**字节**（一个汉字算 3 字节）。 */
export const PASSWORD_MAX_BYTES = 72;

/** 给用户看的规则文案，两处表单共用，避免各写一版。 */
export const PASSWORD_RULE_HINT = "密码至少 8 位（最长 72 字节，一个汉字算 3 字节）";

/** 按字节数算长度：`TextEncoder` 与后端 `Buffer.byteLength(..., "utf8")` 同口径。 */
export function passwordByteLength(password: string): number {
  return new TextEncoder().encode(password).length;
}

/** 这个口令能不能用来**设置**（注册 / 改密）。 */
export function isPasswordSettable(password: string): boolean {
  return (
    password.length >= PASSWORD_MIN_LENGTH && passwordByteLength(password) <= PASSWORD_MAX_BYTES
  );
}
