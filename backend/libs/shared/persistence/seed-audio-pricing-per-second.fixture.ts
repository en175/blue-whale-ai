/**
 * 从 043 迁移的 SQL 文本里读出它写下的那条音频规则。
 *
 * <h2>为什么要有这个 fixture</h2>
 *
 * 守卫要检的是**规则本身**（基准维度是不是点名的那个、上限够不够），
 * 而不是「SQL 里有没有出现某个字符串」。直接在测试里 `toContain("'maxCredits', 12")`
 * 之类只能证明字面量在，证明不了它落在 JSON 的哪一层、也证明不了五个键是齐的。
 * 这里把 SQL 里的字面量读成一个对象，断言就成了对象比对象——**形态错位当场现形**。
 *
 * <p>它**不是**一个通用的 SQL 解析器：只认这条迁移写下的那种「`'键', 值` 平铺」形态。
 * 换一种写法（例如 JSON_SET 打补丁）它就读不出完整的对象——而那种写法本身就是
 * 本迁移明确不要的（见 parity 测试里那条「整体替换，不打补丁」）。
 */

/** SQL 里的字符串字面量：`'键', '值'`。 */
function textOf(sql: string, key: string): string | null {
  const m = sql.match(new RegExp(`'${key}',\\s*'([^']*)'`));
  // `?? null` 而不是 `m[1]`：捕获组下标访问在 noUncheckedIndexedAccess 下是
  // `string | undefined`，直接返回会让调用方拿到两套「没有」的表示
  return m?.[1] ?? null;
}

/** SQL 里的整数字面量：`'键', 123`。 */
function numberOf(sql: string, key: string): number | null {
  const m = sql.match(new RegExp(`'${key}',\\s*(\\d+)`));
  return m ? Number(m[1]) : null;
}

/** 该迁移为 seed-audio-1.0/audio 写下的计价规则（读不出来时为 null）。 */
export function audioRuleOf(sql: string) {
  return {
    baseUnit: textOf(sql, "baseUnit"),
    basePrice: { kind: textOf(sql, "kind"), value: numberOf(sql, "value") },
    unitDenominator: numberOf(sql, "unitDenominator"),
    minCredits: numberOf(sql, "minCredits"),
    maxCredits: numberOf(sql, "maxCredits"),
  };
}
