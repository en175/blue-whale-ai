/* 启动前守卫：dist 里不许残留 `@lib/` 别名。
 *
 * ── 为什么必须扫**整棵** dist，而不是只看 main.js ────────────────────────────
 *
 * tsc 不认那个别名（它只在 tsconfig 的 paths 里存在），把代码交给 node 之前必须由
 * tsc-alias 改写成相对路径。漏改的文件在 `import` 那一刻才会炸，报的是
 * ERR_MODULE_NOT_FOUND: Cannot find package '@lib/core'。
 *
 * 老版本只检查 `dist/apps/blue-whale/src/main.js`。main.js 干净不代表它的**传递依赖**
 * 干净——真正的缺口就出在那里：`@lib/core/identity/roles.js` 这类子路径因为
 * tsconfig 里 `@lib/core` 这条**文件级**映射遮蔽了 `@lib/*` 通配，tsc-alias 匹配不上、
 * 原样留下，而 main.js 自己一个都没剩。于是守卫放行、进程启动、然后在第一个
 * 转到 identity 的请求上崩掉——排查要从「找不到包」倒推回「构建期别名」，
 * 那是最费时间的一类错。
 *
 * 所以这里扫整棵 dist，并把命中的文件与那一行**打出来**：知道是哪个文件，
 * 才能直接去改导入（或补 tsconfig paths），不用再从崩溃栈反推。
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const DIST = "dist";
const MAIN = join(DIST, "apps/blue-whale/src/main.js");
/** 只看 .js：.d.ts 里的 `@lib/...` 是文档注释与类型引用，运行时不会去解析它们 */
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
  // 只看 import/export 语句里的别名，不看注释正文——
  // 本仓很多 javadoc 会写「见 {@code @lib/core/identity/roles.ts}」，那是说明不是引用。
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
