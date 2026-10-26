import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const DIST = "dist";
const MAIN = join(DIST, "apps/blue-whale/src/main.js");
const SCAN_EXT = ".js";

function walk(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (full.endsWith(SCAN_EXT)) out.push(full);
  }
  return out;
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

if (!statSync(DIST, { throwIfNoEntry: false })?.isDirectory()) {
  fail("dist 不存在：先 npm run build");
}
if (!statSync(MAIN, { throwIfNoEntry: false })?.isFile()) {
  fail(`dist 不完整（缺 ${MAIN}）：先 npm run build`);
}

const offenders = [];
for (const file of walk(DIST)) {
  const line = readFileSync(file, "utf8")
    .split("\n")
    .find((l) => /^\s*(import|export)\b[^;]*["']@lib\//.test(l));
  if (line) offenders.push([file, line.trim()]);
}

if (offenders.length > 0) {
  console.error(
    `dist 里残留 ${offenders.length} 处 @lib/ 别名（tsc-alias 没改写成功）。`,
  );
  console.error("典型原因：tsconfig 的 paths 缺少该子路径的通配映射，");
  console.error("于是 tsc-alias 匹配不上、原样留在产物里，运行时才报找不到包。\n");
  for (const [file, line] of offenders.slice(0, 20)) {
    console.error(`  ${file}\n    ${line}`);
  }
  if (offenders.length > 20) console.error(`  …另有 ${offenders.length - 20} 处`);
  console.error("\n修法：给 backend/tsconfig.json 的 paths 补上对应通配，重新 npm run build");
  process.exit(1);
}
