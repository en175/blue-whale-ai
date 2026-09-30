// 跨语言一致性：视频任务类型的关键词表（`resolveVideoTaskType` 的意图判定）。
//
// **为什么需要这条锚点**：这张表决定「一个带参考视频的提交算 edit 还是 prolong」，而它
// **两端各写了一份**——
//   · TS：backend/libs/contracts/capability-param-validation.ts（接纳侧校验 duration=-1 是否合法）
//   · Java：server/blue-whale-worker/.../VideoJobProcessor.java（执行侧同一判定）
// 代码里写着「两端不得各自发明」，但此前**没有东西机械地保证这件事**：改一侧、忘另一侧，
// 表现是「提交时放行、执行时拒绝」（或反过来），而且只在带参考视频的单上出现——最难归因的那类。
//
// 现在两处的关键词**逐字对齐火山方舟 Seedance 2.5 提示词指南的「任务使用说明」**。
// 那次对齐就是把「我们自己加宽的词」收回官方闭集，所以更要钉住：谁再凭语感加一个词，这里即红。
//
// 对账方向与 mq-route-parity.test.ts 一致：**TS 侧常量直接 import 当期望值**，
// 从 Java 源码文本里抠出同名字段的字面量逐项比。
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  EDIT_INTENT_KEYWORDS,
  NEGATION_KEYWORDS,
  PROLONG_INTENT_KEYWORDS,
} from "./capability-param-validation.js";

// 3 级 .. = 仓库根
const javaSource = readFileSync(
  new URL(
    "../../../server/blue-whale-worker/src/main/java/com/bluewhale/worker/application/processor/VideoJobProcessor.java",
    import.meta.url,
  ),
  "utf8",
);

/** 抠出 Java 侧 `private static final List<String> NAME = List.of("a", "b");` 里的字面量。
 *  找不到就抛——「正则失效导致空数组对空数组」的假绿比漏测更难发现。 */
function javaListLiteral(fieldName: string): string[] {
  const match = javaSource.match(
    new RegExp(`List<String>\\s+${fieldName}\\s*=\\s*List\\.of\\(([^)]*)\\)`, "s"),
  );
  if (!match) throw new Error(`Java 侧找不到字段 ${fieldName}`);
  return [...match[1].matchAll(/"([^"]*)"/g)].map((m) => m[1]);
}

/** 顺序不参与语义（判定是「包含其一即可」），但**重复**要报出来：重复项是抄错留下的气味。 */
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
    // IKJ78C：否定防护词表同样两端各写一份，必须与关键词表同等级钉死。
    { field: "NEGATION_KEYWORDS", ts: NEGATION_KEYWORDS },
  ] as const;

  it.each(cases.map((c) => [c.field, c] as const))(
    "%s 两端逐项相同",
    (field, c) => {
      const java = javaListLiteral(field);
      // 先自检抠出来的不是空数组（正则失效会让下面两条断言双双通过）
      expect(java.length, `Java 侧 ${field} 抠出 0 项——提取规则失效了`).toBeGreaterThan(0);
      expect(java.length, `Java 侧 ${field} 项数`).toBe(c.ts.length);

      const ts = describeList("ts", c.ts);
      const jv = describeList("java", java);
      expect(jv.sorted, `Java 侧 ${field} 与 TS 侧不一致`).toEqual(ts.sorted);
      expect(ts.duplicates, `TS 侧 ${field} 有重复项`).toEqual([]);
      expect(jv.duplicates, `Java 侧 ${field} 有重复项`).toEqual([]);
    },
  );

  /* 官方原文那两句是**闭集**（「包含其一即可」），下面把「曾经我们多出来、现在必须没有」的词
     单独钉一遍：它们逐字来自火山方舟 Seedance 2.5 提示词指南，不是我的语感。
     这条比上面的对账更强——即使两端一起改错，这里也红。 */
  it("两个表都不含官方没列的词", () => {
    // 官方编辑词是「编辑视频」（两字连写），没有裸「编辑」
    expect(EDIT_INTENT_KEYWORDS).toContain("编辑视频");
    expect(EDIT_INTENT_KEYWORDS).not.toContain("编辑");
    // 官方延长词是「向前/向后延长」（方向二选一），没有裸「向前」「向后」「延长」
    expect(PROLONG_INTENT_KEYWORDS).toContain("向前延长");
    expect(PROLONG_INTENT_KEYWORDS).toContain("向后延长");
    expect(PROLONG_INTENT_KEYWORDS).not.toContain("向前");
    expect(PROLONG_INTENT_KEYWORDS).not.toContain("向后");
    expect(PROLONG_INTENT_KEYWORDS).not.toContain("延长");
  });

  /* IKJ78C：否定词表与官方关键词不同——它是本仓为「禁止修改」类约束句加的防护词，
     六词闭集是评审定的口径（扩词走评审）。钉住闭集本身，防止一端悄悄加词/减词。 */
  it("否定词表是 IKJ78C 评审定的六词闭集", () => {
    expect([...NEGATION_KEYWORDS].sort()).toEqual(
      ["不得", "不能", "不要", "勿", "无需", "禁止"],
    );
  });
});
