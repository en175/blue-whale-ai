import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// IKJ4W6：Seedance 2.5 默认比例改 `adaptive`（界面显示 auto）——数据迁移，非结构。
//
// 镜像 ikg4ur-parity / video-model-25-first-parity 的三轨核对结构：prisma migration、
// schema 独立文件、docs/sql 快照三处同源，另钉种子基线同口径。
//
// 这条链路的病根是「默认值」与「界面文案」被当成同一个东西：把展示名 auto 写回默认值，
// 上游火山会因 ratio 不是 adaptive 直接失败（worker 侧 NewApiVideoClient 强制要求）。
// 故断言分两层：迁移只改 2.5 一列且值仍是内部键 adaptive；2.0 一行不动。

const migrationSql = readFileSync(
  new URL(
    "../../../prisma/migrations/20260929020000_ikj4w6_default_aspect_ratio_adaptive/migration.sql",
    import.meta.url,
  ),
  "utf8",
);
const standaloneSql = readFileSync(
  new URL("../../../prisma/schema/057_ikj4w6_default_aspect_ratio_adaptive.sql", import.meta.url),
  "utf8",
);
const snapshotSql = readFileSync(
  new URL("../../../../docs/sql/20260929_ikj4w6_default_aspect_ratio_adaptive.sql", import.meta.url),
  "utf8",
);
const seedSql = readFileSync(
  new URL("../../../prisma/schema/002_seed.sql", import.meta.url),
  "utf8",
);

/** 剥离行内 `--` 注释后的种子：2.5 行的 default_aspect_ratio 前有一行说明注释，
 *  不剥离会被算进列值。 */
const seedSqlNoComments = seedSql
  .split("\n")
  .filter((line) => !line.trimStart().startsWith("--"))
  .join("\n");

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

/** 按顶层逗号切分（追踪引号与括号深度）——口径同 seed-constraints.test.ts。
 *
 *  这里必须逐列取值而不是正则捞字符串：`default_aspect_ratio` 与 `supported_aspect_ratios`
 *  里都可能出现 `'adaptive'`，正则捞不准列位置。 */
function splitTopLevel(input: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let inQuote = false;
  let start = 0;
  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (inQuote) {
      if (ch === "'") {
        if (input[i + 1] === "'") i++;
        else inQuote = false;
      }
      continue;
    }
    if (ch === "'") inQuote = true;
    else if (ch === "(") depth++;
    else if (ch === ")") depth--;
    else if (ch === "," && depth === 0) {
      parts.push(input.slice(start, i).trim());
      start = i + 1;
    }
  }
  parts.push(input.slice(start).trim());
  return parts;
}

/** 取种子中指定模型那行的列值（元组以 `),\n  (` 为界切块；注释已剥离）。 */
function seedRow(modelId: string): Record<string, string> {
  const block = seedSqlNoComments.split("),\n  (").find((part) => part.includes(`'${modelId}'`));
  expect(block, `种子缺少模型 ${modelId}`).toBeTruthy();
  const values = splitTopLevel(block!.trim());
  values[values.length - 1] = values[values.length - 1].replace(/[,;]\s*$/, "");
  expect(values, `${modelId} 列数应等于表结构列数`).toHaveLength(COLUMN_NAMES.length);
  return Object.fromEntries(COLUMN_NAMES.map((name, i) => [name, values[i]!]));
}

/** 迁移里去掉 `--` 注释行后的纯 SQL（注释会提到 supported_aspect_ratios，不能拿来判「只改一列」）。 */
const migrationStatements = migrationSql
  .split("\n")
  .filter((line) => !line.trimStart().startsWith("--"))
  .join("\n");

describe("IKJ4W6 Seedance 2.5 默认比例 adaptive（三轨迁移 + 种子同口径）", () => {
  it("三轨逐字一致（改一处必须三处同改）", () => {
    expect(standaloneSql).toBe(migrationSql);
    expect(snapshotSql).toBe(migrationSql);
  });

  it("含 SET NAMES utf8mb4（charset 回归保护）", () => {
    expect(migrationSql).toContain("SET NAMES utf8mb4");
  });

  it("只动 Seedance 2.5 一行的 default_aspect_ratio", () => {
    expect(migrationSql).toContain("'doubao-seedance-2-5-260628'");
    expect(migrationSql.match(/UPDATE `generation_model_capability`/g)).toHaveLength(1);
    expect(migrationStatements).toContain("SET `default_aspect_ratio` = 'adaptive'");
    // 只改这一列：不得顺手改 supported_aspect_ratios / sort_order 等（拼写漂移即红）
    expect(migrationStatements).not.toContain("supported_aspect_ratios");
    expect(migrationStatements).not.toContain("sort_order");
  });

  it("WHERE 限定 2.5 且排除软删行（防误伤其它模型/已删行）", () => {
    expect(migrationSql).toMatch(/WHERE `model_id` = 'doubao-seedance-2-5-260628'\n\s*AND `is_delete` = 0;/);
  });

  it("默认值仍是内部键 adaptive，不是展示名 auto（把 auto 写进库里视频必失败）", () => {
    expect(migrationSql).not.toContain("'auto'");
  });

  it("迁移后默认值合法：2.5 支持 adaptive，故默认选中该档", () => {
    const row = seedRow("doubao-seedance-2-5-260628");
    expect(row.default_aspect_ratio).toBe("'adaptive'");
    expect(row.supported_aspect_ratios).toContain("'adaptive'");
  });

  it("2.0 系列未被误改：默认比例仍 16:9（上游不接受 adaptive）", () => {
    const row = seedRow("doubao-seedance-2-0-260128");
    expect(row.default_aspect_ratio).toBe("'16:9'");
    expect(row.supported_aspect_ratios).not.toContain("'adaptive'");
  });

  it("种子基线同口径：除 2.5 外没有第二行默认 adaptive", () => {
    const rows = seedSqlNoComments.split("),\n  (").filter((part) => part.includes("'video'"));
    const adaptiveDefaults = rows.filter((part) => /'adaptive',\n\s*\d+,/.test(part));
    expect(adaptiveDefaults).toHaveLength(1);
    expect(adaptiveDefaults[0]).toContain("'doubao-seedance-2-5-260628'");
  });
});
