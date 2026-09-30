import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// IKJCOE：generation_jobs 列数棘轮。
//
// 这份清单不是「现状记录」，是**闸门**：往主表加列会让本测试变红，逼作者在评审里回答
// 三问（见下），而不是顺手 `ALTER TABLE ADD COLUMN` 就过去。
//
// 加列的正当理由只有三条（ADR-0120）：
//   ① 要在领取/终态 CAS 的 WHERE 或同一条 UPDATE 的 SET 表达式里用 → 必须在本行
//   ② 是**所有** type 共用的生命周期列（lease/fencing/status/…），不是某个 type 专有
//   ③ 列表页要投影它，且不值得为此多一次子表查询
// 三个都不满足 → 进 generation_job_extras（键值）/ generation_job_logs（逐事件）/
// input（请求快照）。确实必须加列时，把列名追加到下面的清单**并在同一个 commit 里**
// 更新 ADR-0120 的理由。

const schemaPrisma = readFileSync(
  new URL("../../../prisma/schema.prisma", import.meta.url),
  "utf8",
);

/** 主表列清单（27 列）。顺序无所谓，集合必须一致。 */
const EXPECTED_COLUMNS = [
  // CAS / 领取 / 索引必需
  "id",
  "project_id",
  "user_id",
  "type",
  "source",
  "status",
  "input",
  "output_asset_ids",
  "error",
  "provider_task_id",
  // 扛唯一索引 uk_generation_jobs__source_sample_job_id（并发裁决点），不可搬
  "source_sample_job_id",
  // 租约 / 运行时
  "lease_owner",
  "lease_expires_at",
  "fencing_token",
  "execution_deadline_at",
  "next_action_at",
  "cancel_requested_at",
  "retry_of_job_id",
  "poll_count",
  "retry_count",
  "last_polled_at",
  // 通用
  "progress",
  "provider",
  "version",
  "is_delete",
  "gmt_create",
  "gmt_modified",
];

function fieldsOf(modelName: string): string[] {
  const start = schemaPrisma.indexOf(`model ${modelName} {`);
  expect(start, `schema.prisma 里找不到 model ${modelName}`).toBeGreaterThan(-1);
  const rest = schemaPrisma.slice(start);
  const block = rest.slice(0, rest.indexOf("\n}\n"));
  return block
    .split("\n")
    .slice(1)
    .filter((line) => line.trim() && !line.trim().startsWith("@@"))
    .filter((line) => !line.trim().startsWith("//"))
    .map((line) => line.trim().split(/\s+/)[0] ?? "");
}

describe("generation_jobs 列数棘轮（ADR-0120）", () => {
  it("主表列集合与冻结清单一致", () => {
    const actual = fieldsOf("generation_jobs");
    const added = actual.filter((c) => !EXPECTED_COLUMNS.includes(c));
    const removed = EXPECTED_COLUMNS.filter((c) => !actual.includes(c));
    expect(
      { added, removed },
      [
        "generation_jobs 的列集合变了。",
        added.length > 0
          ? `新增列：[${added.join(", ")}]。先答三问：① 要进 CAS/终态守卫的 WHERE 或 SET` +
            "表达式？② 是所有 type 共用的生命周期列？③ 列表页要投影且不值得多一次子表查询？" +
            "三个都不满足就改用 generation_job_extras / generation_job_logs / input。" +
            "确实必须加列：把列名加进本文件 EXPECTED_COLUMNS，并在同一 commit 里补 ADR-0120 的理由。"
          : "",
        removed.length > 0
          ? `删除列：[${removed.join(", ")}]。删列同样要同步本清单与 ADR-0120。`
          : "",
      ]
        .filter(Boolean)
        .join("\n"),
    ).toEqual({ added: [], removed: [] });
    expect(actual).toHaveLength(27);
  });

  it("扩展表存在且有 (job_id, extra_key) 唯一键 —— 加列之外的出口是通的", () => {
    expect(fieldsOf("generation_job_extras")).toEqual([
      "id",
      "generation_job_id",
      "extra_key",
      "value_type",
      "value_text",
      "gmt_create",
      "gmt_modified",
    ]);
    expect(schemaPrisma).toContain('map: "uk_generation_job_extras__job_key"');
  });
});
