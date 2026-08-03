import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// IK50GD 验收标准：浏览器只访问 BlueWhale 同源 BFF，不直连 new-api。
// 静态守卫：NEW_API_BASE_URL 只允许出现在服务端代码（app/api、lib、workers），
// 且永远不以 NEXT_PUBLIC_ 前缀暴露给浏览器 bundle。

const webRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);

const SKIPPED = new Set([".git", ".next", ".worker-dist", "node_modules", "out"]);

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const filePath = path.join(dir, entry);
    if (statSync(filePath).isDirectory()) {
      return SKIPPED.has(entry) ? [] : walk(filePath);
    }
    return filePath;
  });
}

const SCANNED_EXTENSIONS = new Set([".ts", ".tsx"]);

function sourceFiles(): string[] {
  return ["app", "components", "lib", "workers"].flatMap((sub) =>
    walk(path.join(webRoot, sub)),
  ).filter(
    (file) =>
      SCANNED_EXTENSIONS.has(path.extname(file)) &&
      !/\.(?:test|spec)\.[cm]?[jt]sx?$/.test(file),
  );
}

const SERVER_ONLY_SEGMENTS = new Set([
  path.join("app", "api"),
  path.join("app", "canvas", "_canvas"), // 无 NEW_API 引用，保留全扫
  "lib",
  "workers",
]);

function isServerOnly(file: string): boolean {
  const rel = path.relative(webRoot, file);
  return (
    rel.startsWith(path.join("app", "api") + path.sep) ||
    rel.startsWith("lib" + path.sep) ||
    rel.startsWith("workers" + path.sep) ||
    rel === "instrumentation.ts"
  );
}

describe("new-api topology guard", () => {
  it("never exposes NEW_API_BASE_URL through a NEXT_PUBLIC_ variable", () => {
    const violations = sourceFiles()
      .map((file) => ({ file, source: readFileSync(file, "utf8") }))
      .filter(({ source }) => source.includes("NEXT_PUBLIC"))
      .filter(({ source }) => /NEXT_PUBLIC[_A-Z]*NEW_API|NEXT_PUBLIC[_A-Z]*API_BASE/.test(source))
      .map(({ file }) => path.relative(webRoot, file));

    expect(violations).toEqual([]);
  });

  it("keeps NEW_API_BASE_URL references in server-only modules", () => {
    const violations = sourceFiles()
      .filter((file) =>
        readFileSync(file, "utf8").includes("NEW_API_BASE_URL"),
      )
      .filter((file) => !isServerOnly(file))
      .map((file) => path.relative(webRoot, file));

    expect(violations).toEqual([]);
  });
});
