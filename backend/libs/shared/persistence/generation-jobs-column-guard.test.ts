import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";


const schemaPrisma = readFileSync(
  new URL("../../../prisma/schema.prisma", import.meta.url),
  "utf8",
);

const EXPECTED_COLUMNS = [
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
  "source_sample_job_id",
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


const WRITE_METHODS = new Set(["create", "update", "updateMany", "createMany", "upsert"]);

export function jobWriteKeys(sourceText: string): { key: string; line: number }[] {
  const source = ts.createSourceFile("x.ts", sourceText, ts.ScriptTarget.Latest, true);
  const found: { key: string; line: number }[] = [];

  const keysOfObject = (node: ts.Node | undefined): void => {
    if (!node || !ts.isObjectLiteralExpression(node)) return;
    for (const prop of node.properties) {
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
      if (!text.includes("generation_jobs")) continue;
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
