import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  EDIT_INTENT_KEYWORDS,
  NEGATION_KEYWORDS,
  PROLONG_INTENT_KEYWORDS,
} from "./capability-param-validation.js";

const javaSource = readFileSync(
  new URL(
    "../../../server/blue-whale-worker/src/main/java/com/bluewhale/worker/application/processor/VideoJobProcessor.java",
    import.meta.url,
  ),
  "utf8",
);

function javaListLiteral(fieldName: string): string[] {
  const match = javaSource.match(
    new RegExp(`List<String>\\s+${fieldName}\\s*=\\s*List\\.of\\(([^)]*)\\)`, "s"),
  );
  if (!match) throw new Error(`Java 侧找不到字段 ${fieldName}`);
  return [...match[1].matchAll(/"([^"]*)"/g)].map((m) => m[1]);
}

function describeList(name: string, values: readonly string[]) {
  return {
    name,
    sorted: [...values].sort(),
    duplicates: values.filter((v, i) => values.indexOf(v) !== i),
  };
}

describe("视频任务类型关键词：TS ↔ worker-java 对账", () => {
  const cases = [
    { field: "EDIT_INTENT_KEYWORDS", ts: EDIT_INTENT_KEYWORDS },
    { field: "PROLONG_INTENT_KEYWORDS", ts: PROLONG_INTENT_KEYWORDS },
    { field: "NEGATION_KEYWORDS", ts: NEGATION_KEYWORDS },
  ] as const;

  it.each(cases.map((c) => [c.field, c] as const))(
    "%s 两端逐项相同",
    (field, c) => {
      const java = javaListLiteral(field);
      expect(java.length, `Java 侧 ${field} 抠出 0 项——提取规则失效了`).toBeGreaterThan(0);
      expect(java.length, `Java 侧 ${field} 项数`).toBe(c.ts.length);

      const ts = describeList("ts", c.ts);
      const jv = describeList("java", java);
      expect(jv.sorted, `Java 侧 ${field} 与 TS 侧不一致`).toEqual(ts.sorted);
      expect(ts.duplicates, `TS 侧 ${field} 有重复项`).toEqual([]);
      expect(jv.duplicates, `Java 侧 ${field} 有重复项`).toEqual([]);
    },
  );

  it("两个表都不含官方没列的词", () => {
    expect(EDIT_INTENT_KEYWORDS).toContain("编辑视频");
    expect(EDIT_INTENT_KEYWORDS).not.toContain("编辑");
    expect(PROLONG_INTENT_KEYWORDS).toContain("向前延长");
    expect(PROLONG_INTENT_KEYWORDS).toContain("向后延长");
    expect(PROLONG_INTENT_KEYWORDS).not.toContain("向前");
    expect(PROLONG_INTENT_KEYWORDS).not.toContain("向后");
    expect(PROLONG_INTENT_KEYWORDS).not.toContain("延长");
  });

  it("否定词表是 IKJ78C 评审定的六词闭集", () => {
    expect([...NEGATION_KEYWORDS].sort()).toEqual(
      ["不得", "不能", "不要", "勿", "无需", "禁止"],
    );
  });
});
