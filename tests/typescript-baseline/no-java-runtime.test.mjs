import assert from "node:assert/strict";
import {
  readFileSync,
  readdirSync,
  statSync,
} from "node:fs";
import path from "node:path";
import { test } from "node:test";

const roots = [
  "blue_whale_web",
  "apps",
  "packages",
  "deploy/typescript-baseline",
  "Dockerfile.typescript-baseline",
  "scripts/run-typescript-baseline-acceptance.sh",
];
const skippedDirectories = new Set([
  ".git",
  ".next",
  ".worker-dist",
  "dist",
  "node_modules",
]);
const executableExtensions = new Set([
  ".cjs",
  ".js",
  ".mjs",
  ".sh",
  ".ts",
  ".tsx",
  ".yaml",
  ".yml",
]);

function walk(entry) {
  const metadata = statSync(entry);
  if (!metadata.isDirectory()) return [entry];
  return readdirSync(entry).flatMap((child) => {
    if (skippedDirectories.has(child)) return [];
    return walk(path.join(entry, child));
  });
}

function isRuntimeSource(file) {
  if (path.basename(file) === "Dockerfile") return true;
  if (!executableExtensions.has(path.extname(file))) return false;
  return !/\.(?:test|spec)\.[cm]?[jt]sx?$/.test(file);
}

test("TypeScript baseline cannot reconnect executable runtime to Java services", () => {
  const violations = roots
    .flatMap(walk)
    .filter(isRuntimeSource)
    .flatMap((file) => {
      const source = readFileSync(file, "utf8");
      const symbols = [
        "process.env.GATEWAY_URL",
        "GATEWAY_URL=",
        "http://blue-whale-gateway",
        "http://blue-whale-user",
        "http://blue-whale-product",
        "blue_whale_server/",
      ];
      return symbols
        .filter((symbol) => source.includes(symbol))
        .map((symbol) => `${file}: ${symbol}`);
    });

  assert.deepEqual(violations, []);
});
