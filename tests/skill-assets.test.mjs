import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const config = require("../.agents/skills/setup-ts-deep-modules/dependency-cruiser.config.cjs");

function rejects(ruleName, from, to) {
  const rule = config.forbidden.find((item) => item.name === ruleName);
  assert.ok(rule, `missing dependency rule: ${ruleName}`);
  assert.equal(rule.severity, "error");
  const match = rule.from.path ? from.match(new RegExp(rule.from.path)) : [];
  if (!match || (rule.from.pathNot && new RegExp(rule.from.pathNot).test(from))) return false;
  const substitute = (pattern) => pattern.replace(/\$(\d+)/g, (_, index) => match[Number(index)]);
  return new RegExp(substitute(rule.to.path)).test(to) &&
    !(rule.to.pathNot && new RegExp(substitute(rule.to.pathNot)).test(to));
}

test("dependency template protects private modules while keeping public entries reachable", () => {
  assert.ok(rejects("entrypoint-boundary-from-app", "src/app.ts", "src/packages/a/lib/private.ts"));
  assert.equal(rejects("entrypoint-boundary-from-app", "src/app.ts", "src/packages/a/index.ts"), false);
  assert.ok(rejects("entrypoint-boundary-across-packages", "src/packages/a/index.ts", "src/packages/b/lib/private.ts"));
  assert.equal(rejects("entrypoint-boundary-across-packages", "src/packages/a/index.ts", "src/packages/a/lib/private.ts"), false);
});

test("dependency template keeps tests on public entries and fixtures private", () => {
  assert.ok(rejects("tests-through-entrypoints", "src/packages/a/tests/unit.ts", "src/packages/a/lib/private.ts"));
  assert.equal(rejects("tests-through-entrypoints", "src/packages/a/tests/unit.ts", "src/packages/a/tests/fixture.ts"), false);
  assert.equal(rejects("tests-through-entrypoints", "src/packages/a/tests/unit.ts", "src/packages/a/index.ts"), false);
  assert.ok(rejects("tests-folder-is-private", "src/app.ts", "src/packages/a/tests/fixture.ts"));
  const cycle = config.forbidden.find((rule) => rule.name === "no-circular");
  assert.equal(cycle?.severity, "error");
  assert.equal(cycle?.to.circular, true);
});
