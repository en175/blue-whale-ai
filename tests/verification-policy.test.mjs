import { classifyChanges } from '../scripts/verification-policy.mjs';
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  cpSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  realpathSync,
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

function installPnpmCmdShim(bin) {
  if (process.platform !== "win32") return;
  writeFileSync(
    join(bin, "pnpm.cmd"),
    "@echo off\r\nbash \"%~dp0pnpm\" %*\r\nif errorlevel 1 exit /b 1\r\nexit /b 0\r\n",
  );
}

function withFakePnpmOnPath(fakeBin) {
  return `${fakeBin}${process.platform === "win32" ? ";" : ":"}${process.env.PATH}`;
}

function git(cwd, ...args) {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function createRepository({ flakyRuleTest = false, localAhead = false, masterAhead = false } = {}) {
  const directory = mkdtempSync(join(tmpdir(), "blue-whale-verification-"));
  git(directory, "init", "-b", "master");
  git(directory, "config", "user.email", "agent@example.com");
  git(directory, "config", "user.name", "Agent Test");
  mkdirSync(join(directory, "tests"));
  writeFileSync(join(directory, "README.md"), "baseline\n");
  mkdirSync(join(directory, ".githooks"));
  writeFileSync(join(directory, ".githooks", "pre-push"), "#!/bin/sh\nexit 0\n");
  chmodSync(join(directory, ".githooks", "pre-push"), 0o755);
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
  const origin = join(directory, ".git", "test-origin.git");
  git(directory, "init", "--bare", origin);
  git(directory, "remote", "add", "origin", origin);
  git(directory, "branch", "release/prod");
  git(directory, "push", "origin", "release/prod");
  if (localAhead) {
    git(directory, "switch", "release/prod");
    mkdirSync(join(directory, "docs"));
    writeFileSync(join(directory, "docs", "shared-baseline.md"), "local baseline\n");
    git(directory, "add", "docs/shared-baseline.md");
    git(directory, "commit", "-m", "docs: local release baseline");
  }
  git(directory, "switch", "-c", "chore/test-verification");
  const startSha = git(directory, "rev-parse", "HEAD");
  if (masterAhead) {
    mkdirSync(join(directory, "docs"), { recursive: true });
    writeFileSync(join(directory, "docs", "master-only.md"), "master change\n");
    git(directory, "add", "docs/master-only.md");
    git(directory, "commit", "-m", "docs: advance master");
    git(directory, "push", "origin", "HEAD:master");
    git(directory, "reset", "--hard", startSha);
  }
  mkdirSync(join(directory, ".git", "blue-whale"), { recursive: true });
  writeFileSync(join(directory, ".git", "blue-whale", "task-base.json"), JSON.stringify({
    version: 1,
    task_branch: "chore/test-verification",
    target_branch: "release/prod",
    start_sha: startSha,
  }));
  mkdirSync(join(directory, "docs"), { recursive: true });
  writeFileSync(join(directory, "docs", "change.md"), "change\n");
  git(directory, "add", "docs/change.md");
  git(directory, "commit", "-m", "docs: change");
  return directory;
}

test("completion plans run complete application suites without changed or empty-suite exemptions", async () => {
  const { buildVerificationPlan } = await import("../scripts/verification-policy.mjs");
  const plan = buildVerificationPlan(classifyChanges([
    "backend/libs/shared/result.ts", "web/src/pages/Home/index.tsx",
  ]), { base: "base" });
  assert.ok(plan.some((command) => JSON.stringify(command) === JSON.stringify(["pnpm", "exec", "vitest", "run", "backend"])));
  assert.ok(plan.some((command) => JSON.stringify(command) === JSON.stringify(["npm", "--prefix", "web", "run", "test"])));
  assert.ok(plan.every((command) => !command.includes("--changed") && !command.includes("--passWithNoTests")));
});

test("database-only completion verifies backend before a task can be reported complete", async () => {
  const { buildVerificationPlan } = await import("../scripts/verification-policy.mjs");
  for (const file of ["backend/prisma/schema.prisma", "backend/prisma/schema/001_baseline.sql", "backend/prisma/migrations/example/migration.sql"]) {
    const classification = classifyChanges([file]);
    assert.equal(classification.tier, "full", file);
    assert.ok(classification.areas.includes("backend"), file);
    assert.ok(buildVerificationPlan(classification, { base: "base" }).some((command) => command.join(" ") === "pnpm verify"), file);
  }
});

test("full backend verification executes its complete test suite only once", async () => {
  const { buildVerificationPlan } = await import("../scripts/verification-policy.mjs");
  const plan = buildVerificationPlan(classifyChanges(["backend/libs/shared/result.ts"], { risk: "high" }), { base: "base" });
  const backendRuns = plan.filter((command) => command.join(" ") === "pnpm verify" ||
    command.includes("vitest") && command.includes("backend"));
  assert.equal(backendRuns.length, 1);
});

test("previous changed-only receipts cannot satisfy complete application verification", async () => {
  const { buildVerificationPlan, validateReceipt } = await import("../scripts/verification-policy.mjs");
  const classification = classifyChanges(["backend/libs/shared/result.ts"]);
  const binding = { head: "head", base: "base", changedFilesHash: "scope" };
  const commands = buildVerificationPlan(classification, { base: "base" });
  const previousCommands = [
    ["git", "diff", "--check", "base...HEAD"],
    ["pnpm", "exec", "tsc", "-p", "backend/tsconfig.json", "--noEmit", "--pretty", "false"],
    ["pnpm", "exec", "vitest", "run", "backend", "--changed", "base"],
  ];
  const receipt = { version: 1, status: "passed", ...binding, classification, commands: previousCommands,
    results: previousCommands.map((command) => ({ command, exitCode: 0, attempts: [{ exitCode: 0 }] })) };
  assert.equal(validateReceipt(receipt, { ...binding, classification, commands }).valid, false);
});

test("classifies backend BFF sources as scoped/backend", async () => {
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

test("classifies the Java worker as its own area and actually runs Maven", async () => {
  const { classifyChanges, buildVerificationPlan } = await import("../scripts/verification-policy.mjs");

  const classification = classifyChanges([
    "server/blue-whale-worker/src/main/java/com/bluewhale/worker/application/processor/VideoJobProcessor.java",
    "server/blue-whale-worker/pom.xml",
  ]);
  assert.equal(classification.tier, "full");
  assert.deepEqual(classification.areas, ["worker-java"]);

  const flattened = buildVerificationPlan(classification, { base: "BASE" }).map((command) =>
    command.join(" "),
  );
  assert.ok(
    flattened.some(
      (command) =>
        command.startsWith("mvn ") &&
        command.includes("server/pom.xml") &&
        command.includes("-pl blue-whale-worker") &&
        command.includes("-am"),
    ),
    "worker-java 必须从聚合根用 -pl worker -am 跑（它依赖 server/blue-whale-common）",
  );

  const prClassification = classifyChanges(
    ["server/blue-whale-worker/src/main/java/com/bluewhale/worker/application/processor/VideoJobProcessor.java"],
    { stage: "pr" },
  );
  assert.equal(prClassification.tier, "full");
});

test("classifies the agent route manifest copy as web, not unclassified", async () => {
  const { classifyChanges } = await import("../scripts/verification-policy.mjs");

  const classification = classifyChanges(["web/src/api/agent-rest-routes.v1.json"]);
  assert.equal(classification.tier, "scoped");
  assert.deepEqual(classification.areas, ["web"]);
});

test("no path in a mixed real-world change set falls through unclassified", async () => {
  const { classifyChanges } = await import("../scripts/verification-policy.mjs");

  const files = [
    "backend/apps/blue-whale/src/api/agent/agent-v1.module.ts",
    "web/package.json",
    "web/package-lock.json",
    "web/.env.test",
    "web/src/api/agent-rest-routes.v1.json",
    "scripts/check-agent-routes.mjs",
    "backend/libs/core/new-api-billing-ops.ts",
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
    classifyChanges(["README.md", "docs/adr/example.md"]),
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
    reasons: ["unclassified scope requires full verification"],
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

test("classifies skill Markdown as documentation (docs) at completion and PR stage", async () => {
  const { classifyChanges } = await import("../scripts/verification-policy.mjs");

  assert.deepEqual(classifyChanges([".claude/skills/tdd/SKILL.md"]), {
    tier: "docs",
    reasons: ["only documentation files changed"],
  });
  assert.deepEqual(classifyChanges([".claude/skills/tdd/SKILL.md"], { stage: "pr" }), {
    tier: "docs",
    reasons: ["only documentation files changed"],
  });
  assert.deepEqual(classifyChanges([".agents/skills/tdd/SKILL.md"], { stage: "pr" }), {
    tier: "docs",
    reasons: ["only documentation files changed"],
  });
});

test("classifies slash command Markdown as documentation like skill Markdown", async () => {
  const { classifyChanges } = await import("../scripts/verification-policy.mjs");

  for (const file of [
    ".agents/commands/ponytail.md",
    ".claude/commands/ponytail-audit.md",
    ".zcode/commands/ponytail-review.md",
  ]) {
    assert.deepEqual(classifyChanges([file]), {
      tier: "docs",
      reasons: ["only documentation files changed"],
    });
    const classification = classifyChanges([file], { stage: "pr" });
    assert.deepEqual(classification, {
      tier: "docs",
      reasons: ["only documentation files changed"],
    });
    assert.deepEqual(
      classification,
      classifyChanges([".agents/skills/ponytail/SKILL.md"], { stage: "pr" }),
    );
  }
});

test("classifies known Node source changes as scoped verification", async () => {
  const { classifyChanges } = await import("../scripts/verification-policy.mjs");
  const files = [
    "backend/libs/shared/result.ts",
    "backend/apps/blue-whale/src/main.ts",
  ];
  const expected =
    {
      tier: "scoped",
      areas: ["backend"],
      reasons: ["known source paths changed"],
    };

  assert.deepEqual(classifyChanges(files), expected);
  assert.deepEqual(classifyChanges(files, { stage: "pr" }), expected);
});

test("keeps node coverage tests scoped at PR stage", async () => {
  const { classifyChanges } = await import("../scripts/verification-policy.mjs");

  assert.deepEqual(
    classifyChanges(["backend/libs/shared/result.test.ts"], { stage: "pr" }),
    {
      tier: "scoped",
      areas: ["backend"],
      reasons: ["known source paths changed"],
    },
  );
});

test("allows an explicit high-risk escalation to full verification", async () => {
  const { classifyChanges } = await import("../scripts/verification-policy.mjs");

  assert.deepEqual(
    classifyChanges(["backend/libs/shared/result.ts"], { risk: "high" }),
    {
      tier: "full",
      areas: ["backend"],
      reasons: ["risk explicitly escalated to high"],
    },
  );
});

test("verifies high-impact infrastructure fully at completion and PR stages", async () => {
  const { classifyChanges } = await import("../scripts/verification-policy.mjs");
  const files = [
    "pnpm-lock.yaml",
    "Dockerfile.typescript-baseline",
    "backend/prisma/schema/001_baseline.sql",
  ];

  for (const stage of ["completion", "pr"]) {
    assert.deepEqual(classifyChanges(files, { stage }), {
      tier: "full",
      areas: ["backend", "web"],
      reasons: ["product-impact changes require full verification"],
    });
  }
});

test("treats skill agents metadata as documentation at both stages", async () => {
  const { classifyChanges } = await import("../scripts/verification-policy.mjs");
  for (const file of [
    ".claude/skills/ask-matt/agents/openai.yaml",
    ".zcode/skills/pr/agents/openai.yaml",
    ".agents/skills/pr/agents/openai.yaml",
  ]) {
    assert.deepEqual(classifyChanges([file]), { tier: "docs", reasons: ["only documentation files changed"] });
    assert.deepEqual(classifyChanges([file], { stage: "pr" }), { tier: "docs", reasons: ["only documentation files changed"] });
  }
});

test("treats comment-only Dockerfile edits as documentation without weakening real edits", async () => {
  const { classifyChanges } = await import("../scripts/verification-policy.mjs");
  const file = "backend/Dockerfile";

  assert.deepEqual(
    classifyChanges([file], { stage: "pr", documentationOnlyFiles: [file] }),
    { tier: "docs", reasons: ["only documentation files changed"] },
  );
  assert.deepEqual(classifyChanges([file], { stage: "pr" }), {
    tier: "full",
    reasons: ["product-impact changes require full verification"],
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

test("classifies the release sync entrypoints as control-plane at both stages", () => {
  for (const stage of ["completion", "pr"]) {
    assert.deepEqual(
      classifyChanges(["scripts/sync-release-line.py", "scripts/sync-release-line.sh",
        "scripts/merge-implement-spec-child.py", "scripts/cleanup-implement-spec-child.py",
        "scripts/sync-implement-spec-skill.py"], { stage }),
      { tier: "scoped", areas: ["control-plane"], reasons: ["control-plane changed"] },
    );
  }
  assert.throws(() => classifyChanges(["scripts/sync-release-line-new.sh"]), /UNCLASSIFIED_PATH/);
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

  assert.deepEqual(
    classifyChanges(["scripts/reconcile-cost-reservations.mjs"], { stage: "pr" }),
    {
      tier: "scoped",
      areas: ["operations"],
      reasons: ["operations tooling changed"],
    },
  );

  assert.deepEqual(
    classifyChanges(["scripts/compress-gallery-images.mjs"], { stage: "pr" }),
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

test("classifies web tooling scripts as web", async () => {
  const { classifyChanges } = await import("../scripts/verification-policy.mjs");

  assert.deepEqual(
    classifyChanges(["web/scripts/some-tool.mjs"], { stage: "pr" }),
    {
      tier: "scoped",
      areas: ["web"],
      reasons: ["known source paths changed"],
    },
  );

  assert.deepEqual(
    classifyChanges(["web/scripts/some-tool.mjs", "web/src/api/agentRoutes.ts"], {
      stage: "pr",
    }),
    {
      tier: "scoped",
      areas: ["web"],
      reasons: ["known source paths changed"],
    },
  );

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
    tier: "full",
    areas: ["control-plane", "governance"],
    reasons: ["product-impact changes require full verification"],
  });
  assert.deepEqual(buildVerificationPlan(classifyChanges(files), { base: "base" }), [
    ["git", "diff", "--check", "base...HEAD"],
    ["node", "--test", "tests/verification-policy.test.mjs", "tests/agent-rules.test.mjs"],
    ["bash", "scripts/test-hooks.sh"],
    [
      "python3",
      "-m",
      "unittest",
      "scripts.tests.test_cbm_context",
      "scripts.tests.test_gitee_channel",
      "scripts.tests.test_publish_review_package",
      "scripts.tests.test_start_task_worktree",
      "scripts.tests.test_sync_task_from_origin",
      "scripts.tests.test_manage_release_branch",
      "scripts.tests.test_sync_release_line",
      "scripts.tests.test_cleanup_task_worktree",
      "scripts.tests.test_implement_spec_child_merge",
      "scripts.tests.test_project_skills",
      "scripts.tests.test_release_task_workflow",
      "scripts.tests.test_code_comments",
    ],
    ["pnpm", "verify"],
  ]);

  const prClassification = classifyChanges(files, { stage: "pr" });
  assert.deepEqual(prClassification, {
    tier: "full",
    areas: ["control-plane", "governance"],
    reasons: ["product-impact changes require full verification"],
  });
  assert.deepEqual(buildVerificationPlan(prClassification, { base: "base" }), [
    ["git", "diff", "--check", "base...HEAD"],
    ["node", "--test", "tests/verification-policy.test.mjs", "tests/agent-rules.test.mjs"],
    ["bash", "scripts/test-hooks.sh"],
    [
      "python3",
      "-m",
      "unittest",
      "scripts.tests.test_cbm_context",
      "scripts.tests.test_gitee_channel",
      "scripts.tests.test_publish_review_package",
      "scripts.tests.test_start_task_worktree",
      "scripts.tests.test_sync_task_from_origin",
      "scripts.tests.test_manage_release_branch",
      "scripts.tests.test_sync_release_line",
      "scripts.tests.test_cleanup_task_worktree",
      "scripts.tests.test_implement_spec_child_merge",
      "scripts.tests.test_project_skills",
      "scripts.tests.test_release_task_workflow",
      "scripts.tests.test_code_comments",
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
      ".superpowers/skills/requesting-code-review/SKILL.md",
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
      ["npm", "--prefix", "web", "run", "test"],
      ["node", "web/node_modules/vite/bin/vite.js", "build", "--mode", "test"],
      ["node", "web/node_modules/vite/bin/vite.js", "build", "--mode", "release"],
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
      ["pnpm", "exec", "vitest", "run", "packages", "apps"],
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
        "scripts.tests.test_cbm_context",
        "scripts.tests.test_gitee_channel",
        "scripts.tests.test_publish_review_package",
        "scripts.tests.test_start_task_worktree",
        "scripts.tests.test_sync_task_from_origin",
        "scripts.tests.test_manage_release_branch",
        "scripts.tests.test_sync_release_line",
        "scripts.tests.test_cleanup_task_worktree",
        "scripts.tests.test_implement_spec_child_merge",
        "scripts.tests.test_project_skills",
        "scripts.tests.test_release_task_workflow",
        "scripts.tests.test_code_comments",
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
      ["pnpm", "exec", "vitest", "run", "packages", "apps"],
      ["pnpm", "verify"],
    ],
  );
});

test("keeps ordinary source changes scoped at PR stage", async () => {
  const { buildVerificationPlan, classifyChanges } = await import(
    "../scripts/verification-policy.mjs"
  );
  const files = ["backend/libs/shared/result.ts"];

  const classification = classifyChanges(files, { stage: "pr" });
  assert.deepEqual(classification, {
    tier: "scoped",
    areas: ["backend"],
    reasons: ["known source paths changed"],
  });
  assert.deepEqual(buildVerificationPlan(classification, { base: "origin/master" }), [
    ["git", "diff", "--check", "origin/master...HEAD"],
    ["pnpm", "exec", "tsc", "-p", "backend/tsconfig.json", "--noEmit", "--pretty", "false"],
    ["pnpm", "exec", "vitest", "run", "backend"],
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
    () => classifyChanges(["backend/libs/shared/result.ts"], { stage: "merge" }),
    /stage must be completion or pr/,
  );
});

test("full verification reports each existing stage without changing the commands", () => {
  const directory = mkdtempSync(join(tmpdir(), "blue-whale-stage-report-"));
  try {
    const fakeBin = join(directory, "bin");
    const stageLog = join(directory, "stages.jsonl");
    const worktree = join(directory, "worktree");
    mkdirSync(fakeBin);
    mkdirSync(join(worktree, "backend", "libs", "contracts", "gen", "billing"), {
      recursive: true,
    });
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
      cwd: worktree,
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

test("checks the selected Python interpreter against the verification receipt", async () => {
  const { buildVerificationPlan, validateReceipt } = await import(
    "../scripts/verification-policy.mjs"
  );
  const classification = { tier: "scoped", areas: ["control-plane"] };
  const pythonCommand = ["python3.12"];
  const commands = buildVerificationPlan(classification, {
    base: "def456", pythonCommand,
  });
  const binding = {
    head: "abc123", base: "def456", changedFilesHash: "scope-hash",
  };
  const current = { ...binding, classification, commands, pythonCommand };
  const receipt = {
    version: 1, status: "passed", ...binding, classification, commands,
    results: commands.map((command) => ({
      command, exitCode: 0, attempts: [{ exitCode: 0 }],
    })),
  };

  assert.deepEqual(validateReceipt(receipt, current), { valid: true });
  assert.deepEqual(
    validateReceipt({ ...receipt, commands: buildVerificationPlan(classification, {
      base: "def456",
    }) }, current),
    { valid: false, reason: "verification plan does not match its classification" },
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
    () => classifyChanges(["backend/libs/shared/result.ts"], { risk: "low" }),
    /risk must be auto or high/,
  );
});

test("plans verification from the committed Git diff", () => {
  const repository = createRepository();
  try {
    const result = spawnSync(
      process.execPath,
      [CLI, "plan", "--json"],
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

test("targets behind master publish without rebase and verification follows each target", () => {
  const repository = createRepository({ masterAhead: true });
  try {
    for (const target of ["dev", "test"]) {
      git(repository, "push", "origin",
        `${git(repository, "rev-parse", "origin/release/prod")}:refs/heads/${target}`);
      const plan = spawnSync(process.execPath, [CLI, "plan", "--stage", "pr", "--target-branch", target, "--json"], {
        cwd: repository, encoding: "utf8", env: childEnvironment(),
      });
      assert.equal(plan.status, 0, plan.stderr);
      const scope = JSON.parse(plan.stdout);
      assert.deepEqual(scope.changedFiles, ["docs/change.md"]);
      assert.equal(scope.targetBranch, target);
      assert.equal(scope.base, git(repository, "rev-parse", `origin/${target}`));

      const run = spawnSync(process.execPath, [CLI, "run", "--stage", "pr", "--target-branch", target, "--json"], {
        cwd: repository, encoding: "utf8", env: childEnvironment(),
      });
      assert.equal(run.status, 0, run.stderr);

      const check = spawnSync(process.execPath, [CLI, "check", "--stage", "pr", "--target-branch", target, "--json"], {
        cwd: repository, encoding: "utf8", env: childEnvironment(),
      });
      assert.equal(check.status, 0, check.stderr);
    }

    const publish = spawnSync("bash", [PUBLISH, "--user-authorized", "--create-pr", "--target-branch", "dev", "--json"], {
      cwd: repository, encoding: "utf8", env: childEnvironment(),
    });
    assert.equal(publish.status, 0, publish.stderr);
    assert.equal(JSON.parse(publish.stdout).status, "PUSHED_CREATE_PR");
  } finally {
    rmSync(repository, { recursive: true, force: true });
  }
});

test("target advance invalidates a receipt and synced target files leave the task scope", () => {
  const repository = createRepository();
  try {
    const initial = spawnSync(process.execPath, [CLI, "run", "--json"], {
      cwd: repository, encoding: "utf8", env: childEnvironment(),
    });
    assert.equal(initial.status, 0, initial.stderr);
    const startSha = git(repository, "rev-parse", "HEAD~1");

    git(repository, "switch", "release/prod");
    mkdirSync(join(repository, "docs"), { recursive: true });
    writeFileSync(join(repository, "docs", "remote-only.md"), "target change\n");
    git(repository, "add", "docs/remote-only.md");
    git(repository, "commit", "-m", "docs: advance release");
    const targetSha = git(repository, "rev-parse", "HEAD");
    git(repository, "push", "origin", "release/prod");
    git(repository, "switch", "chore/test-verification");

    const stale = spawnSync(process.execPath, [CLI, "check", "--stage", "pr", "--json"], {
      cwd: repository, encoding: "utf8", env: childEnvironment(),
    });
    assert.equal(stale.status, 4, stale.stderr);
    assert.equal(JSON.parse(stale.stdout).reason, "PR target changed after verification");

    const unsynced = spawnSync(process.execPath, [CLI, "plan", "--stage", "pr", "--json"], {
      cwd: repository, encoding: "utf8", env: childEnvironment(),
    });
    assert.equal(unsynced.status, 0, unsynced.stderr);
    const unsyncedScope = JSON.parse(unsynced.stdout);
    assert.equal(unsyncedScope.base, startSha);
    assert.deepEqual(unsyncedScope.changedFiles, ["docs/change.md"]);

    git(repository, "rebase", "release/prod");
    const synced = spawnSync(process.execPath, [CLI, "plan", "--stage", "pr", "--json"], {
      cwd: repository, encoding: "utf8", env: childEnvironment(),
    });
    assert.equal(synced.status, 0, synced.stderr);
    const scope = JSON.parse(synced.stdout);
    assert.equal(scope.base, targetSha);
    assert.deepEqual(scope.changedFiles, ["docs/change.md"]);
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

    const result = spawnSync(process.execPath, [CLI, "plan", "--stage", "pr", "--json"], {
      cwd: repository,
      encoding: "utf8",
      env: childEnvironment(),
    });
    assert.equal(result.status, 0, result.stderr);
    const scope = JSON.parse(result.stdout);
    assert.deepEqual(scope.changedFiles, ["docs/API/视觉模型.md", "docs/change.md"]);
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
      [CLI, "check", "--json"],
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

test("verification refuses missing task metadata", () => {
  const repository = createRepository();
  try {
    rmSync(join(repository, ".git", "blue-whale", "task-base.json"));
    const result = spawnSync(process.execPath, [CLI, "plan", "--json"], {
      cwd: repository, encoding: "utf8", env: childEnvironment(),
    });
    assert.equal(result.status, 2);
    assert.match(result.stderr, /缺少任务基线元数据/);
  } finally {
    rmSync(repository, { recursive: true, force: true });
  }
});

test("verification refuses a task HEAD that no longer descends from its start", () => {
  const repository = createRepository({ localAhead: true });
  try {
    git(repository, "reset", "--hard", "origin/release/prod");
    const result = spawnSync(process.execPath, [CLI, "plan", "--json"], {
      cwd: repository, encoding: "utf8", env: childEnvironment(),
    });
    assert.equal(result.status, 2);
    assert.match(result.stderr, /HEAD 已脱离记录的起点 SHA/);
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
      [CLI, "run", "--json"],
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
      [CLI, "run", "--json"],
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
      [CLI, "check", "--json"],
      { cwd: repository, encoding: "utf8", env: childEnvironment() },
    );
    assert.equal(check.status, 0, check.stderr);
    assert.equal(JSON.parse(check.stdout).status, "VERIFIED");

    const summary = spawnSync(
      process.execPath,
      [CLI, "summary"],
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
    installPnpmCmdShim(fakeBin);
    const environment = {
      ...childEnvironment(),
      PATH: withFakePnpmOnPath(fakeBin),
    };

    const run = spawnSync(
      process.execPath,
      [CLI, "run", "--stage", "pr", "--json"],
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
      [CLI, "summary", "--stage", "pr"],
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

test("automatic publication preserves failed high-risk evidence despite classification changes", () => {
  for (const productImpact of [false, true]) {
    const repository = createRepository();
    const fakeBin = mkdtempSync(join(tmpdir(), "blue-whale-failed-high-risk-"));
    try {
      if (productImpact) {
        mkdirSync(join(repository, "deploy"));
        writeFileSync(join(repository, "deploy", "example.txt"), "deployment input\n");
        git(repository, "add", "deploy/example.txt");
        git(repository, "commit", "-m", "chore: deployment input");
      }
      const callsPath = join(repository, ".git", "high-risk-calls.log");
      writeFileSync(join(fakeBin, "pnpm"), '#!/usr/bin/env bash\nprintf "verify\\n" >> "$FIXTURE_VERIFY_CALLS"\nexit 1\n');
      chmodSync(join(fakeBin, "pnpm"), 0o755);
      installPnpmCmdShim(fakeBin);
      const environment = { ...childEnvironment(), PATH: withFakePnpmOnPath(fakeBin), FIXTURE_VERIFY_CALLS: callsPath };
      const high = spawnSync(process.execPath, [CLI, "run", "--stage", "pr", "--risk", "high", "--json"], {
        cwd: repository, encoding: "utf8", env: environment,
      });
      assert.equal(high.status, 5, high.stderr);
      const receiptPath = join(repository, ".git", "blue-whale", "verification", `${git(repository, "rev-parse", "HEAD")}.json`);
      const failed = readFileSync(receiptPath, "utf8");
      const previous = JSON.parse(failed);
      assert.equal(previous.classification.tier, "full");
      const plan = spawnSync(process.execPath, [CLI, "plan", "--stage", "pr", "--json"], {
        cwd: repository, encoding: "utf8", env: environment,
      });
      assert.equal(plan.status, 0, plan.stderr);
      const current = JSON.parse(plan.stdout);
      assert.equal(previous.inputHash, current.inputHash);
      assert.notDeepEqual(previous.classification, current.classification);
      if (productImpact) assert.deepEqual(previous.commands, current.commands);
      const blocked = spawnSync(process.execPath, [CLI, "ensure", "--stage", "pr", "--json"], {
        cwd: repository, encoding: "utf8", env: environment,
      });
      assert.equal(blocked.status, 5, blocked.stderr);
      const publish = spawnSync("bash", [PUBLISH, "--user-authorized", "--create-pr", "--target-branch", "release/prod", "--json"], {
        cwd: repository, encoding: "utf8", env: environment,
      });
      assert.equal(publish.status, 11, publish.stderr);
      assert.equal(readFileSync(receiptPath, "utf8"), failed);
      assert.equal(readFileSync(callsPath, "utf8"), "verify\n");
      assert.equal(git(repository, "ls-remote", "--heads", "origin", "refs/heads/chore/test-verification"), "");
    } finally {
      rmSync(repository, { recursive: true, force: true });
      rmSync(fakeBin, { recursive: true, force: true });
    }
  }
});

test("retries a declared infrastructure failure once and records both attempts", () => {
  const repository = createRepository({ flakyRuleTest: true });
  try {
    assert.equal(existsSync(join(repository, ".git", "fixture-retry")), false);
    const failedRun = spawnSync(
      process.execPath,
      [CLI, "run", "--json"],
      { cwd: repository, encoding: "utf8", env: childEnvironment() },
    );
    assert.equal(failedRun.status, 5, failedRun.stdout + failedRun.stderr);

    const run = spawnSync(
      process.execPath,
      [
        CLI,
        "run",
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
      [CLI, "summary"],
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
      [CLI, "run", "--stage", "pr", "--json"],
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
    installPnpmCmdShim(fakeBin);
    const retriedRun = spawnSync(
      process.execPath,
      [
        CLI,
        "run",
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
        env: { ...childEnvironment(), PATH: withFakePnpmOnPath(fakeBin) },
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

test("publishing automatically verifies when the current HEAD has no receipt", () => {
  const repository = createRepository();
  const remote = mkdtempSync(join(tmpdir(), "blue-whale-verification-remote-"));
  try {

    const result = spawnSync(
      "bash",
      [PUBLISH, "--user-authorized", "--create-pr", "--target-branch", "release/prod", "--json"],
      { cwd: repository, encoding: "utf8", env: childEnvironment() },
    );

    assert.equal(result.status, 0, result.stderr);
    assert.equal(JSON.parse(result.stdout.trim().split("\n").at(-1)).status, "PUSHED_CREATE_PR");
    assert.equal(git(repository, "config", "--get", "core.hooksPath"), ".githooks");
  } finally {
    rmSync(repository, { recursive: true, force: true });
    rmSync(remote, { recursive: true, force: true });
  }
});

test("allows publishing when the current HEAD has a valid verification receipt", () => {
  const repository = createRepository();
  const remote = mkdtempSync(join(tmpdir(), "blue-whale-verification-remote-"));
  try {

    const verification = spawnSync(
      process.execPath,
      [CLI, "run", "--json"],
      { cwd: repository, encoding: "utf8", env: childEnvironment() },
    );
    assert.equal(verification.status, 0, verification.stderr);

    const publish = spawnSync(
      "bash",
      [PUBLISH, "--user-authorized", "--create-pr", "--target-branch", "release/prod", "--json"],
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
    mkdirSync(join(repository, "backend", "libs", "shared"), { recursive: true });
    writeFileSync(join(repository, "backend", "libs", "shared", "result.ts"), "export {};\n");
    git(repository, "add", "backend/libs/shared/result.ts");
    git(repository, "commit", "-m", "feat: add source change");

    const fakePnpm = join(fakeBin, "pnpm");
    writeFileSync(fakePnpm, ["#!/usr/bin/env bash", "exit 0", ""].join("\n"));
    chmodSync(fakePnpm, 0o755);
    installPnpmCmdShim(fakeBin);
    const environment = {
      ...childEnvironment(),
      PATH: withFakePnpmOnPath(fakeBin),
    };

    const completion = spawnSync(
      process.execPath,
      [CLI, "run", "--json"],
      { cwd: repository, encoding: "utf8", env: environment },
    );
    assert.equal(completion.status, 0, completion.stderr);
    assert.equal(JSON.parse(completion.stdout).tier, "scoped");

    const publish = spawnSync(
      "bash",
      [PUBLISH, "--user-authorized", "--create-pr", "--target-branch", "release/prod", "--json"],
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
      [CLI, "plan", "--stage", "pr", "--json"],
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
      [CLI, "plan", "--stage", "merge", "--json"],
      { cwd: repository, encoding: "utf8", env: childEnvironment() },
    );

    assert.equal(result.status, 2);
    assert.match(result.stderr, /stage must be completion or pr/);
  } finally {
    rmSync(repository, { recursive: true, force: true });
  }
});


test("skill assets select their real checks at both stages", async () => {
  const { classifyChanges, buildVerificationPlan } = await import("../scripts/verification-policy.mjs");
  const files = [
    ".agents/skills/deploy-blue-whale-api/tests/test-tag-propagation.sh",
    ".agents/skills/setup-ts-deep-modules/dependency-cruiser.config.cjs",
    ".agents/skills/wizard/template.sh",
    "tests/skill-assets.test.mjs",
  ];
  for (const stage of ["completion", "pr"]) {
    for (const file of files) {
      const classification = classifyChanges([file], { stage });
      assert.equal(classification.tier, "scoped");
      assert.deepEqual(classification.areas, ["skill-assets"]);
      const commands = buildVerificationPlan(classification, { base: "BASE" });
      for (const expected of [
        ["bash", files[0]],
        ["node", "--check", files[1]],
        ["bash", "-n", files[2]],
        ["node", "--test", files[3]],
      ]) assert.ok(commands.some(command => JSON.stringify(command) === JSON.stringify(expected)));
    }
  }
});

test("skill assets do not allow unknown siblings or downgrade product impact", async () => {
  const { classifyChanges } = await import("../scripts/verification-policy.mjs");
  for (const stage of ["completion", "pr"]) {
    for (const file of [
      ".agents/skills/wizard/unknown.sh",
      ".agents/skills/deploy-blue-whale-api/tests/unknown.sh",
      ".agents/skills/setup-ts-deep-modules/unknown.cjs",
    ]) assert.throws(() => classifyChanges([file], { stage }), /UNCLASSIFIED_PATH/);
  }
  const classification = classifyChanges([
    ".agents/skills/wizard/template.sh", "backend/Dockerfile",
  ], { stage: "pr" });
  assert.equal(classification.tier, "full");
  assert.ok(classification.areas.includes("skill-assets"));
});

test("legacy skill Dockerfile migration stays scoped at PR stage", () => {
  const files = [
    ".zcode/skills/deploy-blue-whale-api/docker/Dockerfile",
    ".agents/skills/deploy-blue-whale-api/docker/Dockerfile",
  ];
  for (const stage of ["completion", "pr"]) {
    const classification = classifyChanges(files, { stage });
    assert.equal(classification.tier, "scoped");
    assert.deepEqual(classification.areas, ["operations"]);
  }
  assert.equal(classifyChanges([...files, "backend/Dockerfile"], { stage: "pr" }).tier, "full");
});

test('CBM client adapters select control-plane verification', () => {
  const result = classifyChanges(['.qoder/settings.json', '.kimi-code/hooks.toml', '.claude/settings.json', '.codex/hooks.json']);
  assert.equal(result.tier, 'scoped');
  assert.deepEqual(result.areas, ['control-plane']);
});

test('Ponytail runtime dependencies select control-plane verification', () => {
  const files = ['.claude/hooks/ponytail-map.js', '.claude/hooks/ponytail-statusline.js',
    '.claude/hooks/ponytail-statusline.sh', '.claude/hooks/ponytail-statusline.ps1',
    'scripts/tests/test_codex_ponytail_hooks.py'];
  for (const stage of ['completion', 'pr']) {
    assert.deepEqual(classifyChanges(files, { stage }), {
      tier: 'scoped', areas: ['control-plane'], reasons: ['control-plane changed'],
    });
  }
});

test('ZCode Ponytail plugin assets select control-plane verification', () => {
  const files = ['.zcode/ponytail.json', '.zcode/plugins/marketplace.json',
    '.zcode/plugins/ponytail/.zcode-plugin/plugin.json',
    '.zcode/plugins/ponytail/hooks/hooks.json', '.zcode/plugins/ponytail/hooks/route.js'];
  for (const stage of ['completion', 'pr']) {
    for (const file of files) {
      assert.deepEqual(classifyChanges([file], { stage }), {
        tier: 'scoped', areas: ['control-plane'], reasons: ['control-plane changed'],
      });
    }
    assert.throws(() => classifyChanges(['.zcode/plugins/unmanaged/hooks/route.js'], { stage }), /UNCLASSIFIED_PATH/);
    assert.equal(classifyChanges([...files, 'backend/Dockerfile'], { stage }).tier, 'full');
  }
});

function createFrontendRepository({ localPublish = false } = {}) {
  const repository = createRepository();
  writeFileSync(join(repository, ".git", "info", "exclude"), "node_modules/\nscripts/\n.env.local\n.env.*.local\n");
  if (localPublish) {
    mkdirSync(join(repository, "scripts"));
    for (const name of ["start-task-worktree.py", "verify-change-scope.mjs", "verification-policy.mjs"]) {
      copyFileSync(join(ROOT, "scripts", name), join(repository, "scripts", name));
    }
    cpSync(join(ROOT, "scripts", "lib"), join(repository, "scripts", "lib"), { recursive: true });
    copyFileSync(join(ROOT, ".githooks", "pre-push"), join(repository, ".githooks", "pre-push"));
  }
  mkdirSync(join(repository, "web", "src"), { recursive: true });
  const calls = join(repository, ".git", "frontend-calls.jsonl");
  for (const [tool, file] of [
    ["tsc", "typescript/bin/tsc"], ["vite", "vite/bin/vite.js"], ["checks", "fixture-checks.mjs"],
  ]) {
    const path = join(repository, "web", "node_modules", file);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, [
      'import { appendFileSync, readFileSync } from "node:fs";',
      `const tool = ${JSON.stringify(tool)};`,
      'const mode = process.argv[process.argv.indexOf("--mode") + 1];',
      `appendFileSync(${JSON.stringify(calls)}, JSON.stringify({ tool, mode, cwd: process.cwd() }) + "\\n");`,
      'if (tool === "vite") readFileSync(`.env.${mode}`);',
      'if (process.env.FIXTURE_BUILD_FAILURE === tool || (tool === "vite" && process.env.FIXTURE_BUILD_FAILURE === mode)) process.exit(1);',
      '',
    ].join("\n"));
  }
  writeFileSync(join(repository, "web", "package.json"), JSON.stringify({
    type: "module", scripts: { lint: "node node_modules/fixture-checks.mjs", test: "node node_modules/fixture-checks.mjs" },
  }));
  writeFileSync(join(repository, "web", ".env.test"), "VITE_APP_ENV=test\n");
  writeFileSync(join(repository, "web", ".env.release"), "VITE_APP_ENV=release\n");
  git(repository, "add", "web", ".githooks");
  git(repository, "commit", "-m", "test: frontend baseline");
  git(repository, "push", "origin", "HEAD:release/prod");
  if (localPublish) git(repository, "branch", "-m", "chore/验证本地自动构建");
  writeFileSync(join(repository, ".git", "blue-whale", "task-base.json"), JSON.stringify({
    version: 1, task_branch: git(repository, "branch", "--show-current"), target_branch: "release/prod", start_sha: git(repository, "rev-parse", "HEAD"),
  }));
  writeFileSync(join(repository, "web", "src", "index.ts"), "export const value = 1;\n");
  git(repository, "add", "web/src/index.ts");
  git(repository, "commit", "-m", "feat: frontend change");
  return repository;
}

function frontendCli(repository, args, environment = {}) {
  return spawnSync(process.execPath, [CLI, ...args, "--json"], {
    cwd: repository, encoding: "utf8", env: { ...childEnvironment(), ...environment },
  });
}

test("local publication enables hooks, builds before push, and reuses the same result", () => {
  const repository = createFrontendRepository({ localPublish: true });
  try {
    const publish = (environment = {}) => spawnSync("bash",
      [PUBLISH, "--user-authorized", "--create-pr", "--target-branch", "release/prod", "--json"], {
        cwd: repository, encoding: "utf8", env: { ...childEnvironment(), ...environment },
      });
    const head = git(repository, "rev-parse", "HEAD");
    const ref = "refs/heads/chore/验证本地自动构建";
    assert.equal(git(repository, "ls-remote", "--heads", "origin", ref), "");
    const first = publish();
    assert.equal(first.status, 0, first.stderr + first.stdout);
    assert.equal(git(repository, "config", "--get", "core.hooksPath"), ".githooks");
    assert.equal(git(repository, "ls-remote", "--heads", "origin", ref).split(/\s/)[0], head);
    const callsPath = join(repository, ".git", "frontend-calls.jsonl");
    const calls = readFileSync(callsPath, "utf8");
    const records = calls.trim().split("\n").map(JSON.parse);
    assert.equal(records.filter(call => call.tool === "tsc").length, 1);
    assert.deepEqual(records.filter(call => call.tool === "vite").map(call => call.mode), ["test", "release"]);
    const receiptPath = join(repository, ".git", "blue-whale", "verification", `${head}.json`);
    const receipt = readFileSync(receiptPath, "utf8");
    const again = publish();
    assert.equal(again.status, 0, again.stderr);
    assert.equal(readFileSync(callsPath, "utf8"), calls);
    assert.equal(readFileSync(receiptPath, "utf8"), receipt);
    const changedInputs = frontendCli(repository, ["ensure", "--stage", "pr"], { VITE_APP_ENV: "changed" });
    assert.equal(changedInputs.status, 0, changedInputs.stderr);
    assert.notEqual(readFileSync(callsPath, "utf8"), calls);
  } finally { rmSync(repository, { recursive: true, force: true }); }
});

test("typecheck and either build mode failure leave create and update remotes unchanged", () => {
  for (const mode of ["create", "update"]) {
    for (const failure of ["tsc", "test", "release"]) {
      const repository = createFrontendRepository({ localPublish: true });
      try {
        const ref = "refs/heads/chore/验证本地自动构建";
        let args = ["--create-pr", "--target-branch", "release/prod"];
        let before = "";
        if (mode === "update") {
          git(repository, "push", "origin", `HEAD:${ref}`);
          before = git(repository, "rev-parse", "HEAD");
          const snapshot = join(repository, ".git", "pr-snapshot.json");
          writeFileSync(snapshot, JSON.stringify({
            pull_request_id: 65, state: "opened", source_branch: "chore/验证本地自动构建",
            target_branch: "release/prod", head_sha: before, conflict: false,
            changed_files: ["web/src/index.ts"], fetched_at: Math.floor(Date.now() / 1000),
          }));
          writeFileSync(join(repository, "web", "src", "index.ts"), "export const value = 2;\n");
          git(repository, "add", "web/src/index.ts");
          git(repository, "commit", "-m", "fix: review change");
          args = ["--update-pr", "65", "--pr-snapshot", snapshot];
        }
        const publish = () => spawnSync("bash", [PUBLISH, "--user-authorized", ...args, "--json"], {
          cwd: repository, encoding: "utf8",
          env: { ...childEnvironment(), FIXTURE_BUILD_FAILURE: failure },
        });
        const failed = publish();
        assert.equal(failed.status, 11, `${mode}/${failure}: ${failed.stderr}${failed.stdout}`);
        assert.equal(JSON.parse(failed.stdout.trim().split("\n").at(-1)).status, "VERIFICATION_FAILED");
        assert.equal(git(repository, "ls-remote", "--heads", "origin", ref).split(/\s/)[0] || "", before);
        const callsPath = join(repository, ".git", "frontend-calls.jsonl");
        const calls = readFileSync(callsPath, "utf8");
        assert.equal(publish().status, 11);
        assert.equal(readFileSync(callsPath, "utf8"), calls);
        assert.equal(git(repository, "ls-remote", "--heads", "origin", ref).split(/\s/)[0] || "", before);
      } finally { rmSync(repository, { recursive: true, force: true }); }
    }
  }
});

test("frontend plans cover shared inputs and skip unrelated changes", async () => {
  const { requiresFrontendBuild, buildVerificationPlan } = await import("../scripts/verification-policy.mjs");
  for (const file of [
    "web/vite.config.ts", "web/tsconfig.app.json", "web/public/icon.svg", "web/index.html",
    "web/package.json", "web/package-lock.json", "web/.env.test", "web/Dockerfile",
    "backend/libs/contracts/quote.ts", "backend/libs/core/result.ts", "backend/tsconfig.json",
    "package.json", "pnpm-lock.yaml", "pnpm-workspace.yaml", "tsconfig.base.json", ".nvmrc", ".dockerignore",
  ]) {
    assert.equal(requiresFrontendBuild([file]), true, file);
    for (const stage of ["completion", "pr"]) {
      const commands = buildVerificationPlan(classifyChanges([file], { stage }), { base: "BASE" });
      assert.equal(commands.filter(command => command[1] === "web/node_modules/typescript/bin/tsc").length, 1, file);
      assert.deepEqual(commands.filter(command => command[1] === "web/node_modules/vite/bin/vite.js").map(command => command.at(-1)), ["test", "release"], file);
    }
  }
  for (const file of ["GLOSSARY.md", "docs/example.md", "web/README.md", "scripts/test-hooks.sh", "backend/libs/shared/account.ts"]) {
    assert.equal(requiresFrontendBuild([file]), false, file);
  }
  assert.equal(requiresFrontendBuild(["web/Dockerfile"], ["web/Dockerfile"]), false);
  assert.equal(classifyChanges(["GLOSSARY.md"], { stage: "pr" }).tier, "docs");
});

test("frontend verification checks types once and builds both modes from web", () => {
  const repository = createFrontendRepository();
  try {
    const result = frontendCli(repository, ["run", "--stage", "pr"]);
    assert.equal(result.status, 0, result.stderr);
    const calls = readFileSync(join(repository, ".git", "frontend-calls.jsonl"), "utf8").trim().split("\n").map(JSON.parse);
    assert.equal(calls.filter(call => call.tool === "tsc").length, 1);
    assert.deepEqual(calls.filter(call => call.tool === "vite").map(call => call.mode), ["test", "release"]);
    assert.ok(calls.filter(call => call.tool === "vite").every(call => call.cwd === realpathSync(join(repository, "web"))));
    const head = git(repository, "rev-parse", "HEAD");
    const before = readFileSync(join(repository, ".git", "frontend-calls.jsonl"), "utf8");
    assert.equal(frontendCli(repository, ["check-push", "--head", head]).status, 0);
    assert.equal(readFileSync(join(repository, ".git", "frontend-calls.jsonl"), "utf8"), before);
    const wrongHead = frontendCli(repository, ["check-push", "--head", git(repository, "rev-parse", "HEAD~1")]);
    assert.equal(wrongHead.status, 4);
    assert.equal(JSON.parse(wrongHead.stdout).status, "PUSH_HEAD_MISMATCH");
  } finally { rmSync(repository, { recursive: true, force: true }); }
});

test("each frontend typecheck or mode failure blocks push", () => {
  for (const failure of ["tsc", "test", "release"]) {
    const repository = createFrontendRepository();
    try {
      const failed = frontendCli(repository, ["run", "--stage", "pr"], { FIXTURE_BUILD_FAILURE: failure });
      assert.equal(failed.status, 5, failed.stderr);
      const head = git(repository, "rev-parse", "HEAD");
      const check = frontendCli(repository, ["check-push", "--head", head]);
      assert.equal(check.status, 4, check.stderr);
      assert.equal(JSON.parse(check.stdout).reason, "verification did not pass");
    } finally { rmSync(repository, { recursive: true, force: true }); }
  }
});

test("frontend push pins its receipt to the target it will merge into", () => {
  const repository = createFrontendRepository();
  try {
    assert.equal(frontendCli(repository, ["run"]).status, 0);
    git(repository, "switch", "-c", "release-update", "origin/release/prod");
    writeFileSync(join(repository, "README.md"), "new release input\n");
    git(repository, "add", "README.md");
    git(repository, "commit", "-m", "docs: advance release");
    git(repository, "push", "origin", "HEAD:release/prod");
    git(repository, "switch", "chore/test-verification");
    const result = frontendCli(repository, ["check-push", "--head", git(repository, "rev-parse", "HEAD")]);
    assert.equal(result.status, 4, result.stdout);
    assert.equal(JSON.parse(result.stdout).reason, "PR target changed after verification");
  } finally { rmSync(repository, { recursive: true, force: true }); }
});

test("frontend input changes invalidate a successful receipt without exposing values", () => {
  for (const changedInput of ["environment", "env-file", "dependency-install"]) {
    const repository = createFrontendRepository();
    try {
      assert.equal(frontendCli(repository, ["run", "--stage", "pr"]).status, 0);
      let environment = {};
      if (changedInput === "environment") environment = { VITE_API_BASE_URL: "private-fixture-value" };
      if (changedInput === "env-file") writeFileSync(join(repository, "web", ".env.test.local"), "VITE_API_BASE_URL=private-fixture-value\n");
      if (changedInput === "dependency-install") writeFileSync(join(repository, "web", "node_modules", ".package-lock.json"), '{"packages":{"vite":{"version":"changed"}}}');
      const result = frontendCli(repository, ["check-push", "--head", git(repository, "rev-parse", "HEAD")], environment);
      assert.equal(result.status, 4, result.stderr);
      assert.equal(JSON.parse(result.stdout).reason, "verification inputs changed");
      assert.doesNotMatch(result.stdout + result.stderr, /private-fixture-value/);
    } finally { rmSync(repository, { recursive: true, force: true }); }
  }
});

test("a direct git push is blocked before the remote changes and reuses a passed receipt", () => {
  const repository = createFrontendRepository();
  try {
    mkdirSync(join(repository, "scripts"));
    writeFileSync(join(repository, "scripts", "start-task-worktree.py"), "import sys\nsys.exit(0)\n");
    copyFileSync(CLI, join(repository, "scripts", "verify-change-scope.mjs"));
    copyFileSync(join(ROOT, "scripts", "verification-policy.mjs"), join(repository, "scripts", "verification-policy.mjs"));
    cpSync(join(ROOT, "scripts", "lib"), join(repository, "scripts", "lib"), { recursive: true });
    git(repository, "config", "core.hooksPath", join(ROOT, ".githooks"));
    const push = () => spawnSync("git", ["push", "origin", "HEAD:refs/heads/chore/frontend-gate"], { cwd: repository, encoding: "utf8", env: childEnvironment() });
    assert.notEqual(push().status, 0);
    assert.equal(git(repository, "ls-remote", "--heads", "origin", "chore/frontend-gate"), "");
    assert.equal(frontendCli(repository, ["run", "--stage", "pr"]).status, 0);
    assert.equal(push().status, 0);
    assert.equal(git(repository, "ls-remote", "--heads", "origin", "chore/frontend-gate").split(/\s/)[0], git(repository, "rev-parse", "HEAD"));
  } finally { rmSync(repository, { recursive: true, force: true }); }
});

test("unrelated pushes need no frontend receipt", () => {
  const repository = createRepository();
  try {
    const result = frontendCli(repository, ["check-push", "--head", git(repository, "rev-parse", "HEAD")]);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(JSON.parse(result.stdout).status, "BUILD_NOT_REQUIRED");
    mkdirSync(join(repository, "scripts"));
    writeFileSync(join(repository, "scripts", "unclassified-maintenance.sh"), "#!/bin/sh\n");
    git(repository, "add", "scripts/unclassified-maintenance.sh");
    git(repository, "commit", "-m", "chore: unrelated maintenance");
    const maintenance = frontendCli(repository, ["check-push", "--head", git(repository, "rev-parse", "HEAD")]);
    assert.equal(maintenance.status, 0, maintenance.stderr);
    assert.equal(JSON.parse(maintenance.stdout).status, "BUILD_NOT_REQUIRED");
  } finally { rmSync(repository, { recursive: true, force: true }); }
});

test("new releases can reuse production but cannot skip verification for new code or updates", () => {
  const repository = createFrontendRepository();
  try {
    git(repository, "push", "origin", "HEAD~1:refs/heads/master");
    mkdirSync(join(repository, "scripts"));
    copyFileSync(join(ROOT, "scripts", "start-task-worktree.py"), join(repository, "scripts", "start-task-worktree.py"));
    copyFileSync(CLI, join(repository, "scripts", "verify-change-scope.mjs"));
    copyFileSync(join(ROOT, "scripts", "verification-policy.mjs"), join(repository, "scripts", "verification-policy.mjs"));
    cpSync(join(ROOT, "scripts", "lib"), join(repository, "scripts", "lib"), { recursive: true });
    git(repository, "config", "core.hooksPath", join(ROOT, ".githooks"));
    const branch = "release/2026.10.01_下一发布验证";
    const push = refspec => spawnSync("git", ["push", "origin", refspec], { cwd: repository, encoding: "utf8", env: childEnvironment() });
    const create = push(`HEAD~1:refs/heads/${branch}`);
    assert.equal(create.status, 0, create.stderr);
    const production = git(repository, "rev-parse", "HEAD~1");
    assert.equal(git(repository, "ls-remote", "--heads", "origin", branch).split(/\s/)[0], production);
    const changedRelease = push("HEAD:refs/heads/release/2026.10.02_新增代码验证");
    assert.notEqual(changedRelease.status, 0);
    assert.match(changedRelease.stdout + changedRelease.stderr, /VERIFICATION_REQUIRED/);
    const update = push(`HEAD:refs/heads/${branch}`);
    assert.notEqual(update.status, 0);
    assert.equal(git(repository, "ls-remote", "--heads", "origin", branch).split(/\s/)[0], production);
  } finally { rmSync(repository, { recursive: true, force: true }); }
});
