/* ============================================
 * 口令哈希 —— bcrypt 的**唯一**入口
 *
 * 为什么是 bcrypt 而不是 scrypt / argon2：
 * `identity_users.password` 里的存量哈希是从 new-api 搬过来的，而 new-api 是
 * Go 写的、用的 `golang.org/x/crypto/bcrypt`（`$2a$10$...`）。
 * 换成别的算法意味着存量用户全部登不上——那不是「技术选型」，那是清库。
 *
 * ⚠️ **全套用一处**：散在几个 controller 里各写一遍，就会出现
 * 「注册用 cost 12、改密用 cost 10」这种没人会发现的不一致。
 * ============================================ */
import { compare, hash } from "bcryptjs";

/**
 * bcrypt 代价因子。
 *
 * ⚠️ **10 是刻意的，与 new-api 一致**（Go 的 `bcrypt.DefaultCost`）。
 * 调高会让本地登录慢一个数量级（12 = 4 倍），而现有存量哈希还是 10——
 * `compare` 读的是哈希里自带的那一档，所以调高只影响新口令，
 * 结果是库里混着两种代价、登录耗时随用户注册时间而变。要调就是一次带重算的全量迁移。
 */
export const BCRYPT_COST = 10;

/**
 * bcrypt 的输入上限：**72 字节**，超出部分被算法直接丢弃。
 *
 * 这是 bcrypt 的固有性质（不是实现缺陷）。它带来的问题是
 * 「80 个字符的密码」实际等价于「它的前 72 个字符」，
 * 而用户对此一无所知。
 */
export const MAX_PASSWORD_BYTES = 72;

/**
 * 口令长度下限（**只用于设置口令**）。
 *
 * <p>这**不是**复杂度规则。大小写/符号要求把用户推向 `Passw0rd!` 这类可预测的口令，
 * 收益远不如长度；而长度是唯一一条既有真实防护力、用户又能直觉遵守的规则。
 * 8 位是对齐前端既有提示（「密码长度需为 8-20 个字符」）的结果——两边不一致时，
 * 通过 API 注册的短口令用户会在登录页被前端自己拦住。
 */
export const MIN_PASSWORD_LENGTH = 8;

/** 口令不合规（过短 / 过长）。**只用于设置口令**，不用于校验——见 {@link verifyPassword}。 */
export class PasswordPolicyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PasswordPolicyError";
  }
}

/** 字节数而非字符数：bcrypt 按字节截断，一个汉字算 3 字节。 */
function byteLength(value: string): number {
  return Buffer.byteLength(value, "utf8");
}

/**
 * 生成口令哈希（注册 / 修改密码用）。
 *
 * @throws PasswordPolicyError 短于 {@link MIN_PASSWORD_LENGTH} 位、或超过
 *         {@link MAX_PASSWORD_BYTES} 字节——**拒绝，而不是截断**。
 *         截断意味着用户以为设了 80 位密码，实际只有 72 位有效，
 *         而且他永远不会知道。宁可让他当场换一个短的。
 */
export async function hashPassword(plain: string): Promise<string> {
  // 长度按**字符**数算下限、按**字节**数算上限，这不是笔误：
  // bcrypt 截断发生在字节层，而「密码太短」是给人看的判断——没人会说「你的密码不到 8 字节」。
  if (plain.length < MIN_PASSWORD_LENGTH) {
    throw new PasswordPolicyError(`密码至少 ${MIN_PASSWORD_LENGTH} 位`);
  }
  if (byteLength(plain) > MAX_PASSWORD_BYTES) {
    throw new PasswordPolicyError(
      `密码过长（${MAX_PASSWORD_BYTES} 字节上限，一个汉字算 3 字节）`,
    );
  }
  return hash(plain, BCRYPT_COST);
}

/**
 * 校验口令。
 *
 * @param plain 用户提交的明文
 * @param storedHash `identity_users.password`；**为 null / 空表示这个账号没有口令**
 *                   （手机号注册、或新-api 迁来的纯 OAuth 账号），一律返回 false
 * @returns 是否匹配。**任何异常都视作不匹配**——哈希格式损坏时的正确反应是「登不上」，
 *          不是「放行」
 *
 * <h2>为什么这里不拒绝超长口令</h2>
 *
 * 与 {@link hashPassword} 不对称，且刻意如此：bcrypt 校验时会截断到 72 字节，
 * 而 new-api 的 Go 实现**同样截断**。所以存量库里可能真的存在「密码 > 72 字节、
 * 靠前 72 字节生效」的账号。在这里拒绝等于把他们锁在门外，
 * 而他们没做错任何事——是我们的历史实现允许了这件事。
 *
 * 新口令在设置时就被 {@link hashPassword} 挡住了，所以这个口子只会随时间收窄。
 */
export async function verifyPassword(
  plain: string,
  storedHash: string | null | undefined,
): Promise<boolean> {
  if (!storedHash) return false;
  try {
    return await compare(plain, storedHash);
  } catch {
    // 哈希格式坏了（列被截断、写入了明文、从别处搬来的非 bcrypt 串）
    return false;
  }
}

/**
 * 用户不存在时用来**消耗等量时间**的哈希。
 *
 * <h2>它防的是什么</h2>
 *
 * 用户名不存在就直接返回「用户名或密码错误」的话，那个响应比「密码错」快得多
 * ——因为它跳过了 bcrypt 那 60ms。攻击者据此可以逐个确认哪些用户名真实存在，
 * 而这正是撞库的第一步（先拿一份有效用户名单，再集中火力）。
 *
 * <p>用一个**永远不可能匹配**的哈希把时间抹平：密码是随机 32 字节，
 * 没有任何输入能撞上它，但校验过程照跑。
 *
 * <p>懒生成而不是硬编码常量：硬编码的字符串没人能确认它到底是不是一个合法的
 * bcrypt 哈希，改错了也不会有测试红——那样它就退化成一个纯粹的空操作。
 */
let dummyHashCache: string | null = null;

export async function burnVerificationTime(plain: string): Promise<void> {
  if (!dummyHashCache) {
    dummyHashCache = await hash(
      `no-such-password:${Math.random().toString(36).slice(2)}`,
      BCRYPT_COST,
    );
  }
  await compare(plain, dummyHashCache);
}
