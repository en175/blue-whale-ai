import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const CLI = join(ROOT, "scripts", "verify-change-scope.mjs");
const PUBLISH = join(ROOT, "scripts", "publish-review-package.sh");
const FULL_VERIFY = join(ROOT, "scripts", "verify-typescript-baseline.sh");

function childEnvironment() {
  const environment = { ...process.env };
  delete environment.NODE_TEST_CONTEXT;
  return environment;
}

function git(cwd, ...args) {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function createRepository({ flakyRuleTest = false } = {}) {
  const directory = mkdtempSync(join(tmpdir(), "blue-whale-verification-"));
  git(directory, "init", "-b", "master");
  git(directory, "config", "user.email", "agent@example.com");
  git(directory, "config", "user.name", "Agent Test");
  mkdirSync(join(directory, "tests"));
  writeFileSync(join(directory, "README.md"), "baseline\n");
  writeFileSync(
    join(directory, "tests", "agent-rules.test.mjs"),
    flakyRuleTest
      ? [
          'import { existsSync, writeFileSync } from "node:fs";',
          'import test from "node:test";',
          'if (!existsSync(".git/fixture-retry")) {',
          '  writeFileSync(".git/fixture-retry", "retry\\n");',
          '  throw new Error("transient fixture failure");',
          "}",
          'test("fixture flake", () => {});',
          "",
        ].join("\n")
      : 'import test from "node:test";\ntest("fixture", () => {});\n',
  );
  git(directory, "add", ".");
  git(directory, "commit", "-m", "docs: baseline");
  git(directory, "switch", "-c", "chore/test-verification");
  mkdirSync(join(directory, "docs"));
  writeFileSync(join(directory, "docs", "change.md"), "change\n");
  git(directory, "add", "docs/change.md");
  git(directory, "commit", "-m", "docs: change");
  return directory;
}

test("classifies backend BFF sources as scoped/backend", async () => {
  // 整棵 backend/ 树此前没有任何归类规则：NODE_SOURCE 只认 `^(?:apps|packages)/`，
  // 于是改 BFF 的 controller 落进「未归类」，门禁一条 backend 的 typecheck 或测试都不跑。
  const { classifyChanges, buildVerificationPlan } = await import("../scripts/verification-policy.mjs");

  const classification = classifyChanges([
    "backend/apps/blue-whale/src/api/agent/agent-session-credits.controller.ts",
    "backend/libs/shared/account/account.service.ts",
  ]);
  assert.equal(classification.tier, "scoped");
  assert.deepEqual(classification.areas, ["backend"]);

  const commands = buildVerificationPlan(classification, { base: "BASE" });
  const flattened = commands.map((command) => command.join(" "));
  assert.ok(
    flattened.some((command) => command.includes("backend/tsconfig.json")),
    "backend 有自己的 tsconfig（@lib/* 别名），根 tsc -b 覆盖不到它",
  );
  assert.ok(
    flattened.some((command) => command.includes("vitest run backend")),
    "backend 的测试必须真的被跑到",
  );
});

test("classifies the agent route manifest copy as web, not unclassified", async () => {
  // web/src/api/agent-rest-routes.v1.json 是 agent 路由清单的副本，agentRoutes.test.ts 正在断言它。
  // WEB_SOURCE 原来只认 ts|tsx|css，改了副本却不跑 web 测试，等于没有守卫。
  const { classifyChanges } = await import("../scripts/verification-policy.mjs");

  const classification = classifyChanges(["web/src/api/agent-rest-routes.v1.json"]);
  assert.equal(classification.tier, "scoped");
  assert.deepEqual(classification.areas, ["web"]);
});

test("no path in a mixed real-world change set falls through unclassified", async () => {
  // 兜底那条分支不会失败，只会把 reason 写成「change scope is not classified」并照常放行——
  // 所以「有没有漏网」必须由这条测试盯着，而不是靠人读 reason。
  const { classifyChanges } = await import("../scripts/verification-policy.mjs");

  const files = [
    "backend/apps/blue-whale/src/api/agent/agent-v1.module.ts",
    "web/package.json",
    "web/package-lock.json",
    "web/.env.test",
    "web/src/api/agent-rest-routes.v1.json",
    "web/scripts/check-agent-routes.mjs",
    "packages/core/src/new-api-billing-ops.ts",
  ];
  for (const file of files) {
    const reasons = classifyChanges([file]).reasons ?? [];
    assert.ok(
      !reasons.some((reason) => /not classified/.test(reason)),
      `${file} 未归类：门禁不会为它跑任何定向验证`,
    );
  }
});

test("classifies Markdown-only changes as documentation verification", async () => {
  const { classifyChanges } = await import("../scripts/verification-policy.mjs");

  assert.deepEqual(classifyChanges(["CLAUDE.md", "docs/adr/example.md"]), {
    tier: "docs",
    reasons: ["only documentation files changed"],
  });
});

test("classifies ordinary README files as documentation verification", async () => {
  const { classifyChanges } = await import("../scripts/verification-policy.mjs");

  assert.deepEqual(
    classifyChanges(["README.md", "packages/core/README.md"]),
    {
      tier: "docs",
      reasons: ["only documentation files changed"],
    },
  );
});

test("classifies documentation assets without treating contracts as prose", async () => {
  const { classifyChanges } = await import("../scripts/verification-policy.mjs");

  assert.deepEqual(
    classifyChanges(["docs/archive/page.html", "docs/evidence/screenshot.png", "docs/vendor/manual.pdf"], { stage: "pr" }),
    { tier: "docs", reasons: ["only documentation files changed"] },
  );
  assert.deepEqual(classifyChanges(["docs/specs/runtime.schema.json"], { stage: "pr" }), {
    tier: "full",
    reasons: ["unclassified PR scope requires full verification"],
  });
});

test("classifies docs prototype assets (js/css) as documentation, not executable code", async () => {
  const { classifyChanges } = await import("../scripts/verification-policy.mjs");

  assert.deepEqual(
    classifyChanges(
      [
        "docs/projects/agent-v0/prototype/app.js",
        "docs/projects/agent-v0/prototype/styles.css",
        "docs/projects/agent-v0/prototype/index.html",
      ],
      { stage: "pr" },
    ),
    { tier: "docs", reasons: ["only documentation files changed"] },
  );
});

test("classifies the testing strategy itself as verification governance", async () => {
  const { classifyChanges } = await import("../scripts/verification-policy.mjs");

  assert.deepEqual(classifyChanges(["docs/agents/testing-strategy.md"]), {
    tier: "scoped",
    areas: ["governance"],
    reasons: ["verification governance changed"],
  });
});

test("keeps unclassified skill Markdown scoped at completion but full at PR stage", async () => {
  const { classifyChanges } = await import("../scripts/verification-policy.mjs");

  assert.deepEqual(classifyChanges([".claude/skills/tdd/SKILL.md"]), {
    tier: "scoped",
    reasons: ["change scope is not classified"],
  });
  assert.deepEqual(classifyChanges([".claude/skills/tdd/SKILL.md"], { stage: "pr" }), {
    tier: "full",
    reasons: ["unclassified PR scope requires full verification"],
  });
});

test("classifies known Node source changes as scoped verification", async () => {
  const { classifyChanges } = await import("../scripts/verification-policy.mjs");
  const files = [
    "apps/agent-worker/src/worker-loop.ts",
    "packages/core/src/result.ts",
  ];
  const expected =
    {
      tier: "scoped",
      areas: ["node"],
      reasons: ["known source paths changed"],
    };

  assert.deepEqual(classifyChanges(files), expected);
  assert.deepEqual(classifyChanges(files, { stage: "pr" }), expected);
});

test("keeps node coverage tests scoped at PR stage", async () => {
  const { classifyChanges } = await import("../scripts/verification-policy.mjs");

  assert.deepEqual(
    classifyChanges(["packages/core/src/result.test.ts"], { stage: "pr" }),
    {
      tier: "scoped",
      areas: ["node"],
      reasons: ["known source paths changed"],
    },
  );
});

test("allows an explicit high-risk escalation to full verification", async () => {
  const { classifyChanges } = await import("../scripts/verification-policy.mjs");

  assert.deepEqual(
    classifyChanges(["packages/core/src/result.ts"], { risk: "high" }),
    {
      tier: "full",
      areas: ["node"],
      reasons: ["risk explicitly escalated to high"],
    },
  );
});

test("keeps high-impact infrastructure scoped at completion but full at PR stage", async () => {
  const { classifyChanges } = await import("../scripts/verification-policy.mjs");
  const files = [
    "pnpm-lock.yaml",
    "Dockerfile.typescript-baseline",
    "packages/persistence/schema/001_baseline.sql",
  ];

  assert.deepEqual(classifyChanges(files), {
    tier: "scoped",
    reasons: ["product-impact infrastructure changed"],
  });
  assert.deepEqual(classifyChanges(files, { stage: "pr" }), {
    tier: "full",
    reasons: ["publishing product-impact changes requires full verification"],
  });
});

test("treats comment-only Dockerfile edits as documentation without weakening real edits", async () => {
  const { classifyChanges } = await import("../scripts/verification-policy.mjs");
  const file = "backend/Dockerfile.worker";

  assert.deepEqual(
    classifyChanges([file], { stage: "pr", documentationOnlyFiles: [file] }),
    { tier: "docs", reasons: ["only documentation files changed"] },
  );
  assert.deepEqual(classifyChanges([file], { stage: "pr" }), {
    tier: "full",
    reasons: ["publishing product-impact changes requires full verification"],
  });
});

test("keeps hook and git control-plane changes scoped at PR stage", async () => {
  const { classifyChanges } = await import("../scripts/verification-policy.mjs");

  assert.deepEqual(
    classifyChanges(
      [".claude/hooks/confirm-release-action.sh", ".githooks/pre-push"],
      { stage: "pr" },
    ),
    {
      tier: "scoped",
      areas: ["control-plane"],
      reasons: ["control-plane changed"],
    },
  );
});

test("classifies operational scripts without product acceptance", async () => {
  const { classifyChanges } = await import("../scripts/verification-policy.mjs");

  assert.deepEqual(
    classifyChanges(["scripts/tunnel-testsite-db.sh"], { stage: "pr" }),
    {
      tier: "scoped",
      areas: ["operations"],
      reasons: ["operations tooling changed"],
    },
  );

  // IK9VZ0：对账脚本归 operations 分类（只读运维工具）。
  assert.deepEqual(
    classifyChanges(["scripts/reconcile-cost-reservations.mjs"], { stage: "pr" }),
    {
      tier: "scoped",
      areas: ["operations"],
      reasons: ["operations tooling changed"],
    },
  );
});

test("rejects unknown executable paths instead of escalating to full", async () => {
  const { classifyChanges } = await import("../scripts/verification-policy.mjs");

  assert.throws(
    () => classifyChanges(["scripts/new-unknown-tool.sh"], { stage: "pr" }),
    /UNCLASSIFIED_PATH: scripts\/new-unknown-tool\.sh/,
  );
});

// IKACK2：`web/scripts/` 是本轮新开的目录，此前没有任何规则覆盖，于是它命中 EXECUTABLE_FILE
// 却分不了类，`--stage pr` 必抛 UNCLASSIFIED_PATH。补分类而不是放宽那条规矩——「归不了类就停下」
// 本身是对的，缺的是这一条归属。
test("classifies web tooling scripts as web", async () => {
  const { classifyChanges } = await import("../scripts/verification-policy.mjs");

  assert.deepEqual(
    classifyChanges(["web/scripts/check-agent-routes.mjs"], { stage: "pr" }),
    {
      tier: "scoped",
      areas: ["web"],
      reasons: ["known source paths changed"],
    },
  );

  // 与 web 源码同区：一起改时不该分裂出第二个 area。
  assert.deepEqual(
    classifyChanges(["web/scripts/check-agent-routes.mjs", "web/src/api/agentRoutes.ts"], {
      stage: "pr",
    }),
    {
      tier: "scoped",
      areas: ["web"],
      reasons: ["known source paths changed"],
    },
  );

  // 归类只覆盖 web 自己的脚本目录，不是「凡叫 scripts 就放行」。
  assert.throws(
    () => classifyChanges(["web/tools/some-new-tool.mjs"], { stage: "pr" }),
    /UNCLASSIFIED_PATH: web\/tools\/some-new-tool\.mjs/,
  );
});

test("keeps governance checks when a governance change also hits high-impact paths", async () => {
  const { buildVerificationPlan, classifyChanges } = await import(
    "../scripts/verification-policy.mjs"
  );
  const files = [
    "scripts/verify-typescript-baseline.sh",
    "scripts/verification-policy.mjs",
  ];

  assert.deepEqual(classifyChanges(files), {
    tier: "scoped",
    areas: ["control-plane", "governance"],
    reasons: ["product-impact infrastructure changed"],
  });
  assert.deepEqual(buildVerificationPlan(classifyChanges(files), { base: "base" }), [
    ["git", "diff", "--check", "base...HEAD"],
    ["node", "--test", "tests/verification-policy.test.mjs", "tests/agent-rules.test.mjs"],
    ["bash", "scripts/test-hooks.sh"],
    [
      "python3",
      "-m",
      "unittest",
      "scripts.tests.test_publish_review_package",
      "scripts.tests.test_start_task_worktree",
      "scripts.tests.test_sync_task_from_origin",
    ],
  ]);

  const prClassification = classifyChanges(files, { stage: "pr" });
  assert.deepEqual(prClassification, {
    tier: "full",
    areas: ["control-plane", "governance"],
    reasons: ["publishing product-impact changes requires full verification"],
  });
  assert.deepEqual(buildVerificationPlan(prClassification, { base: "base" }), [
    ["git", "diff", "--check", "base...HEAD"],
    ["node", "--test", "tests/verification-policy.test.mjs", "tests/agent-rules.test.mjs"],
    ["bash", "scripts/test-hooks.sh"],
    [
      "python3",
      "-m",
      "unittest",
      "scripts.tests.test_publish_review_package",
      "scripts.tests.test_start_task_worktree",
      "scripts.tests.test_sync_task_from_origin",
    ],
    ["pnpm", "verify"],
  ]);
});

test("classifies verification governance changes as scoped governance verification", async () => {
  const { classifyChanges } = await import("../scripts/verification-policy.mjs");

  assert.deepEqual(
    classifyChanges([
      "CLAUDE.md",
      "docs/agents/testing-strategy.md",
      "scripts/verification-policy.mjs",
      "eslint.config.mjs",
      "scripts/verify-change-scope.mjs",
      "scripts/publish-review-package.sh",
      "tests/verification-policy.test.mjs",
      "tests/agent-rules.test.mjs",
      ".claude/skills/implement/SKILL.md",
      ".superpowers/skills/finishing-a-development-branch/SKILL.md",
      ".zcode/skills/implement/SKILL.md",
      ".qoder/skills/implement/SKILL.md",
      ".gitee/PULL_REQUEST_TEMPLATE.md",
    ]),
    {
      tier: "scoped",
      areas: ["governance"],
      reasons: ["verification governance changed"],
    },
  );
});

test("builds a documentation plan without code tests", async () => {
  const { buildVerificationPlan } = await import("../scripts/verification-policy.mjs");

  assert.deepEqual(
    buildVerificationPlan(
      { tier: "docs", reasons: ["only documentation files changed"] },
      { base: "origin/master" },
    ),
    [
      ["git", "diff", "--check", "origin/master...HEAD"],
      ["node", "--test", "tests/agent-rules.test.mjs"],
    ],
  );
});

test("classifies web source changes as scoped web verification", async () => {
  const { classifyChanges } = await import("../scripts/verification-policy.mjs");
  const file = "web/src/pages/Home/components/SkillModal/index.tsx";

  assert.deepEqual(classifyChanges([file]), {
    tier: "scoped",
    areas: ["web"],
    reasons: ["known source paths changed"],
  });
  assert.deepEqual(classifyChanges([file], { stage: "pr" }), {
    tier: "scoped",
    areas: ["web"],
    reasons: ["known source paths changed"],
  });
});

test("builds web typecheck, lint and vitest checks for web verification", async () => {
  const { buildVerificationPlan } = await import("../scripts/verification-policy.mjs");

  assert.deepEqual(
    buildVerificationPlan(
      {
        tier: "scoped",
        areas: ["web"],
        reasons: ["known source paths changed"],
      },
      { base: "origin/master" },
    ),
    [
      ["git", "diff", "--check", "origin/master...HEAD"],
      ["node", "web/node_modules/typescript/bin/tsc", "-b", "web/tsconfig.json", "--pretty", "false"],
      ["npm", "--prefix", "web", "run", "lint"],
      ["npm", "--prefix", "web", "run", "test", "--", "--changed", "origin/master", "--passWithNoTests"],
    ],
  );
});

test("builds affected Node checks for scoped verification", async () => {
  const { buildVerificationPlan } = await import("../scripts/verification-policy.mjs");

  assert.deepEqual(
    buildVerificationPlan(
      {
        tier: "scoped",
        areas: ["node"],
        reasons: ["known source paths changed"],
      },
      { base: "origin/master" },
    ),
    [
      ["git", "diff", "--check", "origin/master...HEAD"],
      ["pnpm", "exec", "tsc", "-b", "--pretty", "false"],
      ["pnpm", "exec", "vitest", "run", "packages", "apps", "--changed", "origin/master"],
    ],
  );
});

test("builds targeted rule and release-gate tests for governance changes", async () => {
  const { buildVerificationPlan } = await import("../scripts/verification-policy.mjs");

  assert.deepEqual(
    buildVerificationPlan(
      {
        tier: "scoped",
        areas: ["governance"],
        reasons: ["verification governance changed"],
      },
      { base: "origin/master" },
    ),
    [
      ["git", "diff", "--check", "origin/master...HEAD"],
      [
        "node",
        "--test",
        "tests/verification-policy.test.mjs",
        "tests/agent-rules.test.mjs",
      ],
    ],
  );
});

test("builds targeted hook and workflow tests for control-plane changes", async () => {
  const { buildVerificationPlan } = await import("../scripts/verification-policy.mjs");

  assert.deepEqual(
    buildVerificationPlan(
      { tier: "scoped", areas: ["control-plane"], reasons: ["control-plane changed"] },
      { base: "origin/master" },
    ),
    [
      ["git", "diff", "--check", "origin/master...HEAD"],
      ["bash", "scripts/test-hooks.sh"],
      [
        "python3",
        "-m",
        "unittest",
        "scripts.tests.test_publish_review_package",
        "scripts.tests.test_start_task_worktree",
        "scripts.tests.test_sync_task_from_origin",
      ],
    ],
  );
});

test("builds script unit tests for operations tooling", async () => {
  const { buildVerificationPlan } = await import("../scripts/verification-policy.mjs");

  assert.deepEqual(
    buildVerificationPlan(
      { tier: "scoped", areas: ["operations"], reasons: ["operations tooling changed"] },
      { base: "origin/master" },
    ),
    [
      ["git", "diff", "--check", "origin/master...HEAD"],
      ["python3", "-m", "unittest", "discover", "-s", "scripts/tests"],
    ],
  );
});

test("builds the repository full verification command for full scope", async () => {
  const { buildVerificationPlan } = await import("../scripts/verification-policy.mjs");

  assert.deepEqual(
    buildVerificationPlan(
      {
        tier: "full",
        areas: ["node"],
        reasons: ["risk explicitly escalated to high"],
      },
      { base: "origin/master" },
    ),
    [
      ["git", "diff", "--check", "origin/master...HEAD"],
      ["pnpm", "exec", "tsc", "-b", "--pretty", "false"],
      ["pnpm", "exec", "vitest", "run", "packages", "apps", "--changed", "origin/master"],
      ["pnpm", "verify"],
    ],
  );
});

test("keeps ordinary source changes scoped at PR stage", async () => {
  const { buildVerificationPlan, classifyChanges } = await import(
    "../scripts/verification-policy.mjs"
  );
  const files = ["packages/core/src/result.ts"];

  const classification = classifyChanges(files, { stage: "pr" });
  assert.deepEqual(classification, {
    tier: "scoped",
    areas: ["node"],
    reasons: ["known source paths changed"],
  });
  assert.deepEqual(buildVerificationPlan(classification, { base: "origin/master" }), [
    ["git", "diff", "--check", "origin/master...HEAD"],
    ["pnpm", "exec", "tsc", "-b", "--pretty", "false"],
    ["pnpm", "exec", "vitest", "run", "packages", "apps", "--changed", "origin/master"],
  ]);
});

test("exempts documentation-only changes from full verification at PR stage", async () => {
  const { classifyChanges } = await import("../scripts/verification-policy.mjs");

  assert.deepEqual(
    classifyChanges(["CLAUDE.md", "docs/adr/example.md"], { stage: "pr" }),
    {
      tier: "docs",
      reasons: ["only documentation files changed"],
    },
  );
});

test("keeps pure governance verification scoped at PR stage", async () => {
  const { classifyChanges } = await import("../scripts/verification-policy.mjs");

  assert.deepEqual(
    classifyChanges(
      ["docs/agents/testing-strategy.md", "scripts/verification-policy.mjs"],
      { stage: "pr" },
    ),
    {
      tier: "scoped",
      areas: ["governance"],
      reasons: ["verification governance changed"],
    },
  );
});

test("describes mixed known governance and control-plane scope accurately", async () => {
  const { classifyChanges } = await import("../scripts/verification-policy.mjs");

  assert.deepEqual(
    classifyChanges(
      [
        "docs/agents/testing-strategy.md",
        "scripts/test-hooks.sh",
        "tests/verification-policy.test.mjs",
      ],
      { stage: "pr" },
    ),
    {
      tier: "scoped",
      areas: ["control-plane", "governance"],
      reasons: ["known scoped paths changed"],
    },
  );
});

test("rejects unknown verification stages", async () => {
  const { classifyChanges } = await import("../scripts/verification-policy.mjs");

  assert.throws(
    () => classifyChanges(["packages/core/src/result.ts"], { stage: "merge" }),
    /stage must be completion or pr/,
  );
});

test("full verification reports each existing stage without changing the commands", () => {
  const directory = mkdtempSync(join(tmpdir(), "blue-whale-stage-report-"));
  try {
    const fakeBin = join(directory, "bin");
    const stageLog = join(directory, "stages.jsonl");
    mkdirSync(fakeBin);
    const fakePnpm = join(fakeBin, "pnpm");
    writeFileSync(
      fakePnpm,
      [
        "#!/usr/bin/env bash",
        "if [ \"${1:-}\" = \"--version\" ]; then",
        "  echo 11.17.0",
        "fi",
        "exit 0",
        "",
      ].join("\n"),
    );
    chmodSync(fakePnpm, 0o755);

    const result = spawnSync("bash", [FULL_VERIFY], {
      cwd: ROOT,
      encoding: "utf8",
      env: {
        ...childEnvironment(),
        PATH: `${fakeBin}:${process.env.PATH}`,
        BW_VERIFICATION_STAGE_LOG: stageLog,
      },
    });

    assert.equal(result.status, 0, result.stderr);
    const stages = readFileSync(stageLog, "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    assert.deepEqual(
      stages.map((stage) => stage.name),
      ["typecheck", "build:node", "test"],
    );
    assert.equal(stages.every((stage) => stage.exitCode === 0 && stage.durationMs >= 0), true);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("accepts a passing receipt for the exact verified revision", async () => {
  const { validateReceipt } = await import("../scripts/verification-policy.mjs");
  const current = {
    head: "abc123",
    base: "def456",
    changedFilesHash: "scope-hash",
  };

  assert.deepEqual(
    validateReceipt(
      {
        version: 1,
        status: "passed",
        ...current,
      },
      current,
    ),
    { valid: true },
  );
});

test("rejects a receipt created for another HEAD", async () => {
  const { validateReceipt } = await import("../scripts/verification-policy.mjs");

  assert.deepEqual(
    validateReceipt(
      {
        version: 1,
        status: "passed",
        head: "old-head",
        base: "def456",
        changedFilesHash: "scope-hash",
      },
      {
        head: "new-head",
        base: "def456",
        changedFilesHash: "scope-hash",
      },
    ),
    { valid: false, reason: "HEAD changed after verification" },
  );
});

test("rejects a scoped receipt when the current risk requires full verification", async () => {
  const { validateReceipt } = await import("../scripts/verification-policy.mjs");
  const binding = {
    head: "abc123",
    base: "def456",
    changedFilesHash: "scope-hash",
  };

  assert.deepEqual(
    validateReceipt(
      {
        version: 1,
        status: "passed",
        ...binding,
        classification: { tier: "scoped", areas: ["node"] },
      },
      {
        ...binding,
        classification: { tier: "full", areas: ["node"] },
      },
    ),
    { valid: false, reason: "verification tier does not cover current risk" },
  );
});

test("rejects a receipt whose plan or passing results are inconsistent", async () => {
  const { validateReceipt } = await import("../scripts/verification-policy.mjs");
  const binding = {
    head: "abc123",
    base: "def456",
    changedFilesHash: "scope-hash",
  };
  const classification = { tier: "docs", reasons: ["only documentation files changed"] };
  const commands = [
    ["git", "diff", "--check", "def456...HEAD"],
    ["node", "--test", "tests/agent-rules.test.mjs"],
  ];
  const passingResults = commands.map((command) => ({
    command,
    exitCode: 0,
    durationMs: 1,
    attempts: [{ exitCode: 0, durationMs: 1 }],
  }));
  const current = { ...binding, classification, commands };
  const receipt = {
    version: 1,
    status: "passed",
    ...binding,
    classification,
    commands,
    results: passingResults,
  };

  assert.deepEqual(
    validateReceipt({ ...receipt, commands: commands.slice(0, 1) }, current),
    { valid: false, reason: "verification plan does not match its classification" },
  );
  assert.deepEqual(
    validateReceipt(
      {
        ...receipt,
        results: passingResults.map((result, index) =>
          index === 1 ? { ...result, exitCode: 1 } : result,
        ),
      },
      current,
    ),
    { valid: false, reason: "verification results are incomplete or failed" },
  );
});

test("rejects a receipt when verification input conditions change", async () => {
  const { validateReceipt } = await import("../scripts/verification-policy.mjs");
  const binding = {
    head: "abc123",
    base: "def456",
    changedFilesHash: "scope-hash",
    classification: { tier: "docs", reasons: ["only documentation files changed"] },
  };

  assert.deepEqual(
    validateReceipt(
      { version: 1, status: "passed", ...binding, inputHash: "old-inputs" },
      { ...binding, inputHash: "new-inputs" },
    ),
    { valid: false, reason: "verification inputs changed" },
  );
});

test("rejects missing, failed, or stale verification evidence", async () => {
  const { validateReceipt } = await import("../scripts/verification-policy.mjs");
  const current = {
    head: "abc123",
    base: "def456",
    changedFilesHash: "scope-hash",
  };
  const validReceipt = { version: 1, status: "passed", ...current };
  const cases = [
    [null, "verification receipt is missing"],
    [{ ...validReceipt, version: 2 }, "verification receipt version is unsupported"],
    [{ ...validReceipt, status: "failed" }, "verification did not pass"],
    [{ ...validReceipt, base: "old-base" }, "verification base changed"],
    [{ ...validReceipt, changedFilesHash: "old-scope" }, "changed file scope changed"],
  ];

  for (const [receipt, reason] of cases) {
    assert.deepEqual(validateReceipt(receipt, current), { valid: false, reason });
  }
});

test("rejects attempts to downgrade the computed risk", async () => {
  const { classifyChanges } = await import("../scripts/verification-policy.mjs");

  assert.throws(
    () => classifyChanges(["packages/core/src/result.ts"], { risk: "low" }),
    /risk must be auto or high/,
  );
});

test("plans verification from the committed Git diff", () => {
  const repository = createRepository();
  try {
    const result = spawnSync(
      process.execPath,
      [CLI, "plan", "--base", "master", "--json"],
      { cwd: repository, encoding: "utf8", env: childEnvironment() },
    );

    assert.equal(result.status, 0, result.stderr);
    const plan = JSON.parse(result.stdout);
    assert.equal(plan.classification.tier, "docs");
    assert.deepEqual(plan.changedFiles, ["docs/change.md"]);
    assert.equal(plan.commands.some((command) => command.includes("pnpm")), false);
  } finally {
    rmSync(repository, { recursive: true, force: true });
  }
});

test("plans Chinese documentation paths from raw Git names without escalating", () => {
  const repository = createRepository();
  try {
    mkdirSync(join(repository, "docs", "API"), { recursive: true });
    writeFileSync(join(repository, "docs", "API", "视觉模型.md"), "说明\n");
    git(repository, "add", ".");
    git(repository, "commit", "-m", "docs: add Chinese path");
    git(repository, "branch", "-f", "master", "HEAD");
    rmSync(join(repository, "docs", "API", "视觉模型.md"));
    git(repository, "add", "-A");
    git(repository, "commit", "-m", "docs: remove Chinese path");

    const result = spawnSync(process.execPath, [CLI, "plan", "--base", "master", "--stage", "pr", "--json"], {
      cwd: repository,
      encoding: "utf8",
      env: childEnvironment(),
    });
    assert.equal(result.status, 0, result.stderr);
    const scope = JSON.parse(result.stdout);
    assert.deepEqual(scope.changedFiles, ["docs/API/视觉模型.md"]);
    assert.equal(scope.classification.tier, "docs");
  } finally {
    rmSync(repository, { recursive: true, force: true });
  }
});

test("reports a machine-readable error when verification evidence is missing", () => {
  const repository = createRepository();
  try {
    const result = spawnSync(
      process.execPath,
      [CLI, "check", "--base", "master", "--json"],
      { cwd: repository, encoding: "utf8", env: childEnvironment() },
    );

    assert.equal(result.status, 4, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), {
      status: "VERIFICATION_REQUIRED",
      reason: "verification receipt is missing",
    });
  } finally {
    rmSync(repository, { recursive: true, force: true });
  }
});

test("refuses to verify an uncommitted worktree", () => {
  const repository = createRepository();
  try {
    writeFileSync(join(repository, "uncommitted.txt"), "not in HEAD\n");
    const result = spawnSync(
      process.execPath,
      [CLI, "run", "--base", "master", "--json"],
      { cwd: repository, encoding: "utf8", env: childEnvironment() },
    );

    assert.equal(result.status, 3, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), {
      status: "DIRTY_WORKTREE",
      reason: "verification requires a clean worktree",
    });
  } finally {
    rmSync(repository, { recursive: true, force: true });
  }
});

test("runs the selected plan and reuses its receipt for the same HEAD", () => {
  const repository = createRepository();
  try {
    const run = spawnSync(
      process.execPath,
      [CLI, "run", "--base", "master", "--json"],
      { cwd: repository, encoding: "utf8", env: childEnvironment() },
    );

    assert.equal(run.status, 0, run.stderr);
    const runPayload = JSON.parse(run.stdout);
    assert.equal(runPayload.status, "VERIFIED");
    assert.equal(runPayload.tier, "docs");

    const head = git(repository, "rev-parse", "HEAD");
    const receipt = JSON.parse(
      readFileSync(join(repository, ".git", "blue-whale", "verification", `${head}.json`), "utf8"),
    );
    assert.equal(receipt.status, "passed");
    assert.equal(receipt.results.length, 2);
    assert.equal(receipt.results.every((result) => result.exitCode === 0), true);
    assert.equal(receipt.results.every((result) => result.durationMs >= 0), true);

    const check = spawnSync(
      process.execPath,
      [CLI, "check", "--base", "master", "--json"],
      { cwd: repository, encoding: "utf8", env: childEnvironment() },
    );
    assert.equal(check.status, 0, check.stderr);
    assert.equal(JSON.parse(check.stdout).status, "VERIFIED");

    const summary = spawnSync(
      process.execPath,
      [CLI, "summary", "--base", "master"],
      { cwd: repository, encoding: "utf8", env: childEnvironment() },
    );
    assert.equal(summary.status, 0, summary.stderr);
    assert.match(summary.stdout, /验证层级：`docs`/);
    assert.equal(summary.stdout.includes(`验证 HEAD：\`${head}\``), true);
    assert.match(summary.stdout, /验证结果：`passed`/);
    assert.match(summary.stdout, /总耗时：`\d+ ms`/);
    assert.match(summary.stdout, /验证命令：/);
    assert.doesNotMatch(summary.stdout, new RegExp(repository));
  } finally {
    rmSync(repository, { recursive: true, force: true });
  }
});

test("captures full verification stage timings in the receipt", () => {
  const repository = createRepository();
  const fakeBin = mkdtempSync(join(tmpdir(), "blue-whale-fake-pnpm-"));
  try {
    writeFileSync(join(repository, "runtime.config"), "full verification\n");
    git(repository, "add", "runtime.config");
    git(repository, "commit", "-m", "chore: require full verification");

    const fakePnpm = join(fakeBin, "pnpm");
    writeFileSync(
      fakePnpm,
      [
        "#!/usr/bin/env bash",
        ": \"${BW_VERIFICATION_STAGE_LOG:?stage log is required}\"",
        "printf '%s\\n' \\",
        "  '{\"name\":\"typecheck\",\"exitCode\":0,\"durationMs\":7}' \\",
        "  '{\"name\":\"build:node\",\"exitCode\":0,\"durationMs\":11}' \\",
        "  >\"$BW_VERIFICATION_STAGE_LOG\"",
        "exit 0",
        "",
      ].join("\n"),
    );
    chmodSync(fakePnpm, 0o755);
    const environment = {
      ...childEnvironment(),
      PATH: `${fakeBin}:${process.env.PATH}`,
    };

    const run = spawnSync(
      process.execPath,
      [CLI, "run", "--base", "master", "--stage", "pr", "--json"],
      { cwd: repository, encoding: "utf8", env: environment },
    );

    assert.equal(run.status, 0, run.stderr);
    const head = git(repository, "rev-parse", "HEAD");
    const receipt = JSON.parse(
      readFileSync(join(repository, ".git", "blue-whale", "verification", `${head}.json`), "utf8"),
    );
    assert.deepEqual(
      receipt.results.at(-1).attempts[0].stages.map((stage) => stage.name),
      ["typecheck", "build:node"],
    );

    const summary = spawnSync(
      process.execPath,
      [CLI, "summary", "--base", "master", "--stage", "pr"],
      { cwd: repository, encoding: "utf8", env: environment },
    );
    assert.equal(summary.status, 0, summary.stderr);
    assert.match(summary.stdout, /typecheck — 7 ms/);
    assert.match(summary.stdout, /build:node — 11 ms/);
  } finally {
    rmSync(repository, { recursive: true, force: true });
    rmSync(fakeBin, { recursive: true, force: true });
  }
});

test("retries a declared infrastructure failure once and records both attempts", () => {
  const repository = createRepository({ flakyRuleTest: true });
  try {
    assert.equal(existsSync(join(repository, ".git", "fixture-retry")), false);
    const failedRun = spawnSync(
      process.execPath,
      [CLI, "run", "--base", "master", "--json"],
      { cwd: repository, encoding: "utf8", env: childEnvironment() },
    );
    assert.equal(failedRun.status, 5, failedRun.stdout + failedRun.stderr);

    const run = spawnSync(
      process.execPath,
      [
        CLI,
        "run",
        "--base",
        "master",
        "--retry-kind",
        "known-flaky",
        "--retry-reason",
        "fixture flake",
        "--json",
      ],
      { cwd: repository, encoding: "utf8", env: childEnvironment() },
    );

    assert.equal(run.status, 0, run.stderr);
    const head = git(repository, "rev-parse", "HEAD");
    const receipt = JSON.parse(
      readFileSync(join(repository, ".git", "blue-whale", "verification", `${head}.json`), "utf8"),
    );
    assert.deepEqual(receipt.retry, {
      kind: "known-flaky",
      reason: "fixture flake",
    });
    assert.equal(receipt.results[1].attempts.length, 2, JSON.stringify(receipt, null, 2));
    assert.deepEqual(
      receipt.results[1].attempts.map((attempt) => attempt.exitCode),
      [1, 0],
    );
    rmSync(join(repository, ".git", "fixture-retry"));
    const summary = spawnSync(
      process.execPath,
      [CLI, "summary", "--base", "master"],
      { cwd: repository, encoding: "utf8", env: childEnvironment() },
    );
    assert.equal(summary.status, 0, summary.stderr);
    assert.match(summary.stdout, /重试：`known-flaky` — fixture flake/);
  } finally {
    rmSync(repository, { recursive: true, force: true });
  }
});

test("requires a failed receipt before accepting retry metadata", () => {
  const repository = createRepository();
  try {
    const result = spawnSync(
      process.execPath,
      [
        CLI,
        "run",
        "--base",
        "master",
        "--retry-kind",
        "infrastructure",
        "--retry-reason",
        "fixed port was occupied",
        "--json",
      ],
      { cwd: repository, encoding: "utf8", env: childEnvironment() },
    );

    assert.equal(result.status, 2);
    assert.match(result.stderr, /retry requires a failed receipt for the current scope/);
  } finally {
    rmSync(repository, { recursive: true, force: true });
  }
});

test("does not apply an earlier retry reason to a later failing command", () => {
  const repository = createRepository({ flakyRuleTest: true });
  const fakeBin = mkdtempSync(join(tmpdir(), "blue-whale-retry-boundary-"));
  try {
    mkdirSync(join(repository, "scripts"));
    writeFileSync(join(repository, "scripts", "verify-typescript-baseline.sh"), "changed\n");
    git(repository, "add", "scripts/verify-typescript-baseline.sh");
    git(repository, "commit", "-m", "test: require full verification");

    const failedRun = spawnSync(
      process.execPath,
      [CLI, "run", "--base", "master", "--stage", "pr", "--json"],
      { cwd: repository, encoding: "utf8", env: childEnvironment() },
    );
    assert.equal(failedRun.status, 5, failedRun.stdout + failedRun.stderr);

    const calls = join(fakeBin, "calls");
    const fakePnpm = join(fakeBin, "pnpm");
    writeFileSync(
      fakePnpm,
      ["#!/usr/bin/env bash", `printf 'call\\n' >>"${calls}"`, "exit 1", ""].join("\n"),
    );
    chmodSync(fakePnpm, 0o755);
    const retriedRun = spawnSync(
      process.execPath,
      [
        CLI,
        "run",
        "--base",
        "master",
        "--stage",
        "pr",
        "--retry-kind",
        "known-flaky",
        "--retry-reason",
        "agent rule fixture flake",
        "--json",
      ],
      {
        cwd: repository,
        encoding: "utf8",
        env: { ...childEnvironment(), PATH: `${fakeBin}:${process.env.PATH}` },
      },
    );

    assert.equal(retriedRun.status, 5, retriedRun.stdout + retriedRun.stderr);
    assert.equal(readFileSync(calls, "utf8"), "call\n");
  } finally {
    rmSync(repository, { recursive: true, force: true });
    rmSync(fakeBin, { recursive: true, force: true });
  }
});

test("rejects an unknown retry category", () => {
  const repository = createRepository();
  try {
    const result = spawnSync(
      process.execPath,
      [
        CLI,
        "run",
        "--base",
        "master",
        "--retry-kind",
        "test-failed",
        "--retry-reason",
        "assertion failed",
        "--json",
      ],
      { cwd: repository, encoding: "utf8", env: childEnvironment() },
    );

    assert.equal(result.status, 2);
    assert.match(result.stderr, /retry kind must be infrastructure or known-flaky/);
  } finally {
    rmSync(repository, { recursive: true, force: true });
  }
});

test("blocks publishing when the current HEAD has no valid verification receipt", () => {
  const repository = createRepository();
  const remote = mkdtempSync(join(tmpdir(), "blue-whale-verification-remote-"));
  try {
    git(remote, "init", "--bare");
    git(repository, "remote", "add", "origin", remote);
    git(repository, "push", "origin", "master:master");

    const result = spawnSync(
      "bash",
      [PUBLISH, "--user-authorized", "--create-pr", "--json"],
      { cwd: repository, encoding: "utf8", env: childEnvironment() },
    );

    assert.equal(result.status, 11, result.stderr);
    assert.equal(JSON.parse(result.stdout).status, "VERIFICATION_REQUIRED");
  } finally {
    rmSync(repository, { recursive: true, force: true });
    rmSync(remote, { recursive: true, force: true });
  }
});

test("allows publishing when the current HEAD has a valid verification receipt", () => {
  const repository = createRepository();
  const remote = mkdtempSync(join(tmpdir(), "blue-whale-verification-remote-"));
  try {
    git(remote, "init", "--bare");
    git(repository, "remote", "add", "origin", remote);
    git(repository, "push", "origin", "master:master");

    const verification = spawnSync(
      process.execPath,
      [CLI, "run", "--base", "origin/master", "--json"],
      { cwd: repository, encoding: "utf8", env: childEnvironment() },
    );
    assert.equal(verification.status, 0, verification.stderr);

    const publish = spawnSync(
      "bash",
      [PUBLISH, "--user-authorized", "--create-pr", "--json"],
      { cwd: repository, encoding: "utf8", env: childEnvironment() },
    );

    assert.equal(publish.status, 0, publish.stderr);
    const statusLine = publish.stdout.trim().split("\n").at(-1);
    assert.equal(JSON.parse(statusLine).status, "PUSHED_CREATE_PR");
  } finally {
    rmSync(repository, { recursive: true, force: true });
    rmSync(remote, { recursive: true, force: true });
  }
});

test("publishing reuses a scoped completion receipt for ordinary code changes", () => {
  const repository = createRepository();
  const remote = mkdtempSync(join(tmpdir(), "blue-whale-verification-remote-"));
  const fakeBin = mkdtempSync(join(tmpdir(), "blue-whale-publish-stage-"));
  try {
    mkdirSync(join(repository, "packages", "core", "src"), { recursive: true });
    writeFileSync(join(repository, "packages", "core", "src", "result.ts"), "export {};\n");
    git(repository, "add", "packages/core/src/result.ts");
    git(repository, "commit", "-m", "feat: add source change");
    git(remote, "init", "--bare");
    git(repository, "remote", "add", "origin", remote);
    git(repository, "push", "origin", "master:master");

    const fakePnpm = join(fakeBin, "pnpm");
    writeFileSync(fakePnpm, ["#!/usr/bin/env bash", "exit 0", ""].join("\n"));
    chmodSync(fakePnpm, 0o755);
    const environment = {
      ...childEnvironment(),
      PATH: `${fakeBin}:${process.env.PATH}`,
    };

    const completion = spawnSync(
      process.execPath,
      [CLI, "run", "--base", "origin/master", "--json"],
      { cwd: repository, encoding: "utf8", env: environment },
    );
    assert.equal(completion.status, 0, completion.stderr);
    assert.equal(JSON.parse(completion.stdout).tier, "scoped");

    const publish = spawnSync(
      "bash",
      [PUBLISH, "--user-authorized", "--create-pr", "--json"],
      { cwd: repository, encoding: "utf8", env: environment },
    );
    assert.equal(publish.status, 0, publish.stderr);
    const statusLine = publish.stdout.trim().split("\n").at(-1);
    assert.equal(JSON.parse(statusLine).status, "PUSHED_CREATE_PR");
  } finally {
    rmSync(repository, { recursive: true, force: true });
    rmSync(remote, { recursive: true, force: true });
    rmSync(fakeBin, { recursive: true, force: true });
  }
});

test("CLI rejects an unclassified script without planning full verification", () => {
  const repository = createRepository();
  try {
    mkdirSync(join(repository, "scripts"));
    writeFileSync(join(repository, "scripts", "new-unknown-tool.sh"), "#!/bin/sh\n");
    git(repository, "add", "scripts/new-unknown-tool.sh");
    git(repository, "commit", "-m", "chore: add unknown script");

    const result = spawnSync(
      process.execPath,
      [CLI, "plan", "--base", "master", "--stage", "pr", "--json"],
      { cwd: repository, encoding: "utf8", env: childEnvironment() },
    );

    assert.equal(result.status, 2);
    assert.match(result.stderr, /UNCLASSIFIED_PATH: scripts\/new-unknown-tool\.sh/);
    assert.doesNotMatch(result.stdout, /pnpm verify/);
  } finally {
    rmSync(repository, { recursive: true, force: true });
  }
});

test("rejects an unknown verification stage on the command line", () => {
  const repository = createRepository();
  try {
    const result = spawnSync(
      process.execPath,
      [CLI, "plan", "--base", "master", "--stage", "merge", "--json"],
      { cwd: repository, encoding: "utf8", env: childEnvironment() },
    );

    assert.equal(result.status, 2);
    assert.match(result.stderr, /stage must be completion or pr/);
  } finally {
    rmSync(repository, { recursive: true, force: true });
  }
});
