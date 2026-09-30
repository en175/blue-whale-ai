import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

// IKJCOE：generation_jobs 列数棘轮。
//
// 这份清单不是「现状记录」，是**闸门**：往主表加列会让本测试变红，逼作者在评审里回答
// 三问（见下），而不是顺手 `ALTER TABLE ADD COLUMN` 就过去。
//
// ⚠️ 本测试用 readFileSync 读 schema.prisma，**不在模块依赖图里**——`vitest run backend
// --changed <base>` 这类按变更文件选测试的跑法选不中它。它在 PR 门禁里仍然生效，因为
// `backend/prisma/**` 判为产品影响面 → 层级升 full → `pnpm verify` 跑全量测试。
// 只改 schema.prisma 时想快速自查，请显式指定本文件。
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

// ── 写入点键名闸（同一次改造的第二个盲区）──────────────────────────────────────
//
// 删列之后「哪里还在写这个列」**tsc 查不出来**：Prisma 7 的
// `create<T extends XCreateArgs>(args: SelectSubset<T, …>)` 从字面量反推 T，未知名照样过；
// 手搭的假 prisma（`generation_jobs: { create }`）更是照单全收。
// IKJCOE 就因此漏掉 15 个 service 的直连 create（评审 C1）——生产上是一个 500。
// 这里用 TS 的 AST 把 `generation_jobs.{create,update,…}({ data: {…} })` 里的**字面量键**
// 拿出来，跟 schema.prisma 的模型字段对账。展开（`...spread`）不参与检查（静态看不到键），
// 但字面量键必须存在——这正是漏掉的那一类。

const WRITE_METHODS = new Set(["create", "update", "updateMany", "createMany", "upsert"]);

/** 从一段源码里找出 `generation_jobs.<写>({ data: {...} })` 引用的字面量键。 */
export function jobWriteKeys(sourceText: string): { key: string; line: number }[] {
  const source = ts.createSourceFile("x.ts", sourceText, ts.ScriptTarget.Latest, true);
  const found: { key: string; line: number }[] = [];

  const keysOfObject = (node: ts.Node | undefined): void => {
    if (!node || !ts.isObjectLiteralExpression(node)) return;
    for (const prop of node.properties) {
      // 只认字面量键；`...spread` 与计算属性静态看不到，跳过。
      if (ts.isPropertyAssignment(prop) && (ts.isIdentifier(prop.name) || ts.isStringLiteral(prop.name))) {
        found.push({
          key: prop.name.text,
          line: source.getLineAndCharacterOfPosition(prop.name.getStart(source)).line + 1,
        });
      }
    }
  };

  const visit = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      WRITE_METHODS.has(node.expression.name.text) &&
      ts.isPropertyAccessExpression(node.expression.expression) &&
      node.expression.expression.name.text === "generation_jobs"
    ) {
      const arg = node.arguments[0];
      if (arg && ts.isObjectLiteralExpression(arg)) {
        for (const prop of arg.properties) {
          if (
            ts.isPropertyAssignment(prop) &&
            ts.isIdentifier(prop.name) &&
            // upsert 的 create / update 也是 data 段
            ["data", "create", "update"].includes(prop.name.text)
          ) {
            keysOfObject(prop.initializer);
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

function collectSources(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === "dist" || entry.startsWith(".")) continue;
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      collectSources(full, out);
    } else if (entry.endsWith(".ts") && !entry.endsWith(".test.ts") && !entry.endsWith(".d.ts")) {
      out.push(full);
    }
  }
  return out;
}

describe("generation_jobs 写入点键名闸（ADR-0120）", () => {
  it("闸本身有效：假片段里的未知键会被抓出来", () => {
    const bogus = `
      await prisma.client.generation_jobs.create({
        data: { user_id: 1n, expected_output_count: 1, input: {} },
      });
    `;
    expect(jobWriteKeys(bogus).map((k) => k.key)).toContain("expected_output_count");
  });

  it("闸确实扫到了真实写入点（防空扫描的假绿）", () => {
    // 上一条用例若因「一个文件都没扫到」而通过，就是假绿。这里钉住覆盖面：
    // 至少一个已知的直连 create 服务、以及足够多的键。
    const backendRoot = path.resolve(new URL("../../../", import.meta.url).pathname);
    const scannedFiles: string[] = [];
    let scannedKeys = 0;
    for (const file of collectSources(backendRoot)) {
      const text = readFileSync(file, "utf8");
      if (!text.includes("generation_jobs")) continue;
      const keys = jobWriteKeys(text);
      if (keys.length > 0) scannedFiles.push(path.relative(backendRoot, file));
      scannedKeys += keys.length;
    }
    expect(scannedFiles).toContain("libs/shared/audio-video-muxes/audio-video-muxes.service.ts");
    expect(scannedFiles.length).toBeGreaterThan(10);
    expect(scannedKeys).toBeGreaterThan(50);
  });

  it("backend 全部写入点只引用模型里存在的列", () => {
    const known = new Set(fieldsOf("generation_jobs"));
    const offenders: string[] = [];
    const backendRoot = path.resolve(new URL("../../../", import.meta.url).pathname);
    for (const file of collectSources(backendRoot)) {
      const text = readFileSync(file, "utf8");
      if (!text.includes("generation_jobs")) continue; // 便宜的前置过滤，再决定要不要解析
      for (const { key, line } of jobWriteKeys(text)) {
        if (!known.has(key)) {
          offenders.push(`${path.relative(backendRoot, file)}:${line} → ${key}`);
        }
      }
    }
    expect(
      offenders,
      [
        "有写入点引用了 generation_jobs 模型里不存在的列。",
        "这种错 tsc 看不见（Prisma 的 SelectSubset 从字面量反推类型），假 prisma 单测也看不见，",
        "生产上表现为 PrismaClientValidationError → 接口 500。",
        "若该列刚被删：把它从写入点删掉，或改成写 generation_job_extras。",
        `命中：\n${offenders.join("\n")}`,
      ].join("\n"),
    ).toEqual([]);
  });
});
