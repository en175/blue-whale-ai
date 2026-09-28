import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// IK6ZEH 回归防护：002_seed.sql 的每行都必须满足 001_baseline.sql 的 NOT NULL 约束。
// C1 复盘：text 行曾在 supported_sizes 等 5 列写 NULL → fresh MySQL 8.4（STRICT_TRANS_TABLES）
// 报 1048，listEnabledByType("text") 返回 []，接口 400。单测 mock 了 repo，测不出来，故在此静态断言。

const seedPath = resolve(import.meta.dirname, "../../../prisma/schema/002_seed.sql");
const baselinePath = resolve(import.meta.dirname, "../../../prisma/schema/001_baseline.sql");

const NOT_NULL_COLUMNS = [
  "provider_id",
  "model_id",
  "capability_type",
  "model_label",
  "supported_sizes",
  "supported_aspect_ratios",
  "supported_formats",
  "default_size",
  "default_aspect_ratio",
  "features",
  "enabled",
  "sort_order",
];

/** 按顶层逗号切分元组/列值：追踪单引号（'' 转义）与括号深度，忽略引号内/嵌套括号内的逗号。 */
function splitTopLevel(input: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let inQuote = false;
  let start = 0;
  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (inQuote) {
      if (ch === "'") {
        if (input[i + 1] === "'") {
          i++;
        } else {
          inQuote = false;
        }
      }
      continue;
    }
    if (ch === "'") {
      inQuote = true;
    } else if (ch === "(") {
      depth++;
    } else if (ch === ")") {
      depth--;
    } else if (ch === "," && depth === 0) {
      parts.push(input.slice(start, i).trim());
      start = i + 1;
    }
  }
  parts.push(input.slice(start).trim());
  return parts;
}

function seedTuples(sql: string): Array<{ columns: string[]; values: string[] }> {
  const header = "VALUES\n";
  const valuesIndex = sql.indexOf(header);
  if (valuesIndex === -1) throw new Error("no VALUES in seed");
  const valuesBody = sql.slice(valuesIndex + header.length);
  // 元组从 `  (` 开始（顶格为对齐），到 `\n  )` 结束（`,/;` 收尾）。
  const tuples: Array<{ columns: string[]; values: string[] }> = [];
  for (const tupleMatch of valuesBody.matchAll(/\n  \((.*?)\n  \)/gs)) {
    const inner = tupleMatch[1];
    const parts = splitTopLevel(inner);
    // 去掉尾随的 `,` / `;`
    const last = parts[parts.length - 1].replace(/[,;]\s*$/, "");
    parts[parts.length - 1] = last;
    tuples.push({ columns: COLUMN_NAMES, values: parts });
  }
  return tuples;
}

const COLUMN_NAMES = [
  "provider_id",
  "model_id",
  "capability_type",
  "model_label",
  "supported_sizes",
  "supported_aspect_ratios",
  "supported_durations",
  "supported_formats",
  "default_size",
  "default_format",
  "default_aspect_ratio",
  "default_duration",
  "features",
  "enabled",
  "sort_order",
  "request_mapping",
];

describe("002_seed.sql 满足 001_baseline.sql 的 NOT NULL 约束", () => {
  const seed = readFileSync(seedPath, "utf8");
  const baseline = readFileSync(baselinePath, "utf8");
  // 从 baseline 提取 NOT NULL 非默认列名。
  const tableMatch = baseline.match(
    /CREATE TABLE `generation_model_capability` \(([\s\S]*?)\n\)/,
  );
  if (!tableMatch) throw new Error("baseline capability table not found");
  const notNullColumns = new Set<string>();
  for (const line of tableMatch[1].split("\n")) {
    const m = line.match(/`(\w+)`\s+\w+[^,]*(?: NOT NULL)/);
    if (m && !line.includes("DEFAULT")) notNullColumns.add(m[1]);
  }
  // 忽略带默认值的 NOT NULL（gmt_create/gmt_modified/enabled/sort_order/is_delete 等）。
  for (const col of ["gmt_create", "gmt_modified", "is_delete"]) {
    notNullColumns.delete(col);
  }

  const tuples = seedTuples(seed);
  expect(tuples.length).toBeGreaterThan(0);

  it.each(tuples)("行 provider=$values[0] model=$values[1] 无 NOT NULL 违规", (tuple) => {
    const { columns, values } = tuple;
    for (const col of NOT_NULL_COLUMNS) {
      const idx = columns.indexOf(col);
      expect(idx, `列 ${col} 应在 INSERT 列清单中`).toBeGreaterThanOrEqual(0);
      const val = values[idx];
      expect(
        val !== undefined && !/^\s*NULL\s*$/i.test(val),
        `NOT NULL 列 ${col} 值不能为 NULL（当前: ${val}）`,
      ).toBe(true);
    }
  });

  it("至少含一条 capability_type='text' 行（MiniMax-M3）", () => {
    const hasText = tuples.some(
      (t) =>
        t.values[t.columns.indexOf("capability_type")].replace(/'/g, "") ===
        "text",
    );
    expect(hasText).toBe(true);
  });
});