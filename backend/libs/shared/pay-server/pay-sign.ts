/* ============================================
 * 支付网关的**商户接口报文签名**（jeepay 协议，MD5）
 *
 * 算法与网关侧 `JeepayKit.getSign` 必须**逐字一致**，否则请求被拒成「验签失败」，
 * 而这个报错指向不了「哪一步的拼串规则不一样」。规则：
 *
 *   1. 排除 `sign` 字段本身；
 *   2. 丢掉**空值**字段（`null` 与空串都丢）——**注意验签侧也只按收到的非空字段算**；
 *   3. 每个字段拼成 `key=value&`；
 *   4. 按 `key=value&` 整串做 **Java `String.CASE_INSENSITIVE_ORDER`** 排序；
 *   5. 拼成一串后接 `key={appSecret}`；
 *   6. MD5 十六进制、**转大写**。
 *
 * ⚠️ 第 4 步的排序不是普通字典序：Java 的比较器先比大写、再比小写。
 *    用 JS 的 `sort()` 默认比较（UTF-16 码位）在 `appId` / `amount` 这类大小写混合的键上
 *    会得出不同顺序。这里照抄 Java 的逐字符比较，见 {@link javaCaseInsensitiveCompare}。
 *
 * ⚠️ 值必须按**它将出现在报文里的那个字符串**参与签名：`amount` 传数字 `1` 就签 `"1"`，
 *    不要先做千分位、货币符号或小数化——网关反序列化成 `Long` 之后再拼串，
 *    签 `"1.00"` 会验不过。
 * ============================================ */
import { createHash } from "node:crypto";

/**
 * Java `String.CASE_INSENSITIVE_ORDER` 的等价实现（ASCII 足够——键值都是数字与标识符）。
 *
 * ⚠️ **必须逐字照抄 JDK 的分支结构，不能只抄「大意」**。JDK 的
 * `String.CaseInsensitiveComparator.compare` 在内层是：
 *
 * ```java
 * if (c1 != c2) {
 *   c1 = toUpperCase(c1); c2 = toUpperCase(c2);
 *   if (c1 != c2) {                       // ← 这里**不返回**
 *     c1 = toLowerCase(c1); c2 = toLowerCase(c2);
 *     if (c1 != c2) return c1 - c2;       // ← 返回的是**转小写之后**的差值
 *   }
 * }
 * ```
 *
 * 曾经的实现在「大写不同」那一步就 `return` 了，于是返回的是**大写差值**。
 * 两者在字母之间、以及在小于 `A` 的字符之间**结果相同**，但在
 * 「非字母（`[ \ ] ^ _ \``，码位 91–96）对上字母」时**符号相反**——
 * 因为转小写会把 65–90 的字母推到 97–122，跨过了那些非字母。
 *
 * <p>它今天没暴露：实际报文里的键全是 camelCase（`appId` / `amount` / `mchOrderNo`），
 * 两种算法在这些键上给出同样的顺序。**一旦将来出现下划线与 camelCase 混排的键，
 * 签名就会翻转**，而症状是一句无从下手的「验签失败」。有测试钉住这一点。
 */
function javaCaseInsensitiveCompare(a: string, b: string): number {
  const min = Math.min(a.length, b.length);
  for (let i = 0; i < min; i += 1) {
    let c1 = a.charCodeAt(i);
    let c2 = b.charCodeAt(i);
    if (c1 === c2) continue;
    c1 = toUpperAscii(c1);
    c2 = toUpperAscii(c2);
    if (c1 !== c2) {
      c1 = toLowerAscii(c1);
      c2 = toLowerAscii(c2);
      if (c1 !== c2) return c1 - c2;
    }
  }
  return a.length - b.length;
}

const toUpperAscii = (c: number): number => (c >= 97 && c <= 122 ? c - 32 : c);
const toLowerAscii = (c: number): number => (c >= 65 && c <= 90 ? c + 32 : c);

/**
 * 计算签名。
 *
 * @param params    参与签名的字段（含 `sign` 也会被忽略，方便把整个报文直接传进来）
 * @param appSecret 商户密钥（网关侧 `t_mch_app.app_secret`）
 */
export function paySign(params: Record<string, unknown>, appSecret: string): string {
  const parts: string[] = [];
  for (const [key, value] of Object.entries(params)) {
    if (key === "sign") continue;
    // 空值不参与：网关也是这么算的（`JeepayKit.getSign` 跳过 null 与 ""）
    if (value === null || value === undefined || value === "") continue;
    parts.push(`${key}=${String(value)}&`);
  }
  parts.sort(javaCaseInsensitiveCompare);
  const payload = `${parts.join("")}key=${appSecret}`;
  return createHash("md5").update(payload, "utf8").digest("hex").toUpperCase();
}

/**
 * 校验回调报文的签名（常量时间比较，避免按字符早退泄漏签名内容）。
 *
 * <p>回调接口是**公网可达**的：没有这一步，任何人都能伪造一条「支付成功」把积分发出去。
 * 验签不通过时一律拒绝，不做任何「兼容放行」。
 *
 * @param params    回调报文的全部字段（表单原文的字符串值）
 * @param appSecret 商户密钥
 */
export function verifyPaySign(params: Record<string, string>, appSecret: string): boolean {
  const provided = params.sign;
  if (!provided) return false;
  return timingSafeEqual(paySign(params, appSecret), provided.toUpperCase());
}

function timingSafeEqual(expected: string, actual: string): boolean {
  if (expected.length !== actual.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i += 1) {
    diff |= expected.charCodeAt(i) ^ actual.charCodeAt(i);
  }
  return diff === 0;
}
