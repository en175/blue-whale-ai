import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";


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
  const tuples: Array<{ columns: string[]; values: string[] }> = [];
  for (const tupleMatch of valuesBody.matchAll(/\n  \((.*?)\n  \)/gs)) {
    const inner = tupleMatch[1];
    const parts = splitTopLevel(inner);
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
  const tableMatch = baseline.match(
    /CREATE TABLE `generation_model_capability` \(([\s\S]*?)\n\)/,
  );
  if (!tableMatch) throw new Error("baseline capability table not found");
  const notNullColumns = new Set<string>();
  for (const line of tableMatch[1].split("\n")) {
    const m = line.match(/`(\w+)`\s+\w+[^,]*(?: NOT NULL)/);
    if (m && !line.includes("DEFAULT")) notNullColumns.add(m[1]);
  }
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