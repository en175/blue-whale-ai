const DOCUMENTATION_FILE = /^(?:CLAUDE\.md|AGENTS\.md|CONTEXT\.md|README(?:\.[^/]+)?\.md|docs\/.*\.(?:md|html?|pdf|png|jpe?g|gif|webp|svg|js|css)|(?:apps|packages)\/.*\/README(?:\.[^/]+)?\.md)$/i;
const NODE_SOURCE = /^(?:apps|packages)\/[^/]+\/(?:src|tests?)\/.*\.(?:ts|tsx)$/;
const WEB_SOURCE = /^web\/src\/.*\.(?:ts|tsx|css)$/;
// web 自己的工具脚本（契约核对、构建辅助等）。归 web 而不是 operations：它们的题材是 web 的契约，
// 对应的定向验证就是 web 那套（typecheck + lint + vitest）——`check-agent-routes.mjs` 要守的
// `web/src/api/agent-rest-routes.v1.json`，正是 `web/src/api/agentRoutes.test.ts` 在断言的东西。
// 归 operations 会去跑 `scripts/tests` 下的 Python 单测，与这里毫无关系。
const WEB_TOOLING_FILE = /^web\/scripts\/.*\.(?:mjs|cjs|js)$/;
const CONTROL_PLANE_FILE = /^(?:\.githooks\/|\.(?:claude|codex)\/hooks\/|\.zcode\/config\.json|scripts\/(?:check-hook-closed-loop|check-hook-contracts|cleanup-release-branch|cleanup-task-worktree|commit-spec-on-master|commit-task-for-review|gitee-resolve-ids|install-kimi-hooks|list-task-worktrees|manage-agent-authorization|merge-task-to-local-master|pr-update-evidence|probe-codex-write-hook|publish-review-package|publish-task-branch|query-hook-audit|setup-hooks|start-task-worktree|sync-codex-skill|sync-superpowers-skills|sync-task-from-origin|sync-write-rules-skill|sync_recovery|test-hooks|verification-policy|verify-change-scope|verify-pr-update)\.|scripts\/lib\/|scripts\/tests\/)/;
const OPERATIONS_FILE = /^scripts\/(?:check-schema-charset|check-target-environment-retirement|ensure-graphify-worktree|fix-ik7grv-replace-slot-backfill|reconcile-cost-reservations|run-ik50gb-c-testsite-probe|run-real-canary|tunnel-testsite-db)\./;
const PRODUCT_IMPACT_FILE = /^(?:package\.json|pnpm-lock\.yaml|pnpm-workspace\.yaml|tsconfig(?:\.[^.]+)?\.json|(?:.*\/)?Dockerfile[^/]*|deploy\/|packages\/contracts\/|packages\/persistence\/(?:prisma\/migrations|schema)\/|tests\/typescript-baseline\/|scripts\/(?:dev-blue-whale|dev-stack|init-typescript-baseline-db|run-typescript-baseline-acceptance|verify-typescript-baseline)\.)/;
const EXECUTABLE_FILE = /^(?:scripts\/|.*\.(?:sh|py|mjs|cjs|js))$/;
const SKILL_SCRIPT_FILE = /^\.(?:claude|superpowers|zcode|qoder)\/skills\/[^/]+\/scripts\/.*\.(?:sh|py|mjs|cjs|js)$/;
const GOVERNANCE_FILE = /^(?:eslint\.config\.mjs|docs\/agents\/testing-strategy\.md|scripts\/(?:verification-policy|verify-change-scope)\.mjs|scripts\/publish-review-package\.sh|tests\/(?:verification-policy|agent-rules)\.test\.mjs|\.gitee\/PULL_REQUEST_TEMPLATE\.md|\.(?:claude|superpowers|zcode|qoder)\/skills\/(?:implement|dispatching-parallel-agents|finishing-a-development-branch|subagent-driven-development)\/)/;

function isTestFile(file) {
  return /(?:^|\/)[^/]+\.(?:test|spec)\.(?:ts|tsx|js|mjs|cjs)$/.test(file);
}

function hasProductImpact(file, documentationOnlyFiles) {
  return PRODUCT_IMPACT_FILE.test(file) && !isTestFile(file) && !documentationOnlyFiles.has(file);
}

function sourceArea(file) {
  if (NODE_SOURCE.test(file)) return "node";
  if (WEB_SOURCE.test(file) || WEB_TOOLING_FILE.test(file)) return "web";
  if (CONTROL_PLANE_FILE.test(file)) return "control-plane";
  if (OPERATIONS_FILE.test(file)) return "operations";
  if (SKILL_SCRIPT_FILE.test(file)) return "operations";
  return null;
}

function inferredAreas(files, documentationOnlyFiles) {
  const areas = new Set(files.map(sourceArea).filter(Boolean));
  if (files.some((file) => GOVERNANCE_FILE.test(file))) {
    areas.add("governance");
  } else if (files.some((file) => DOCUMENTATION_FILE.test(file))) {
    areas.add("docs");
  }
  return [...areas].sort();
}

function isDocumentation(file, documentationOnlyFiles) {
  return DOCUMENTATION_FILE.test(file) || documentationOnlyFiles.has(file);
}

function classified(file, documentationOnlyFiles) {
  return (
    isDocumentation(file, documentationOnlyFiles) ||
    GOVERNANCE_FILE.test(file) ||
    PRODUCT_IMPACT_FILE.test(file) ||
    sourceArea(file) !== null
  );
}

function scopedClassification(files, reason, documentationOnlyFiles) {
  const areas = inferredAreas(files, documentationOnlyFiles);
  return {
    tier: "scoped",
    ...(areas.length > 0 ? { areas } : {}),
    reasons: [reason],
  };
}

function fullClassification(files, reason, documentationOnlyFiles) {
  const areas = inferredAreas(files, documentationOnlyFiles);
  return {
    tier: "full",
    ...(areas.length > 0 ? { areas } : {}),
    reasons: [reason],
  };
}

function classifyAutomatically(files, stage, documentationOnlyFiles) {
  const unknownExecutable = files.filter(
    (file) => EXECUTABLE_FILE.test(file) && !classified(file, documentationOnlyFiles),
  );
  if (unknownExecutable.length > 0) {
    throw new Error(`UNCLASSIFIED_PATH: ${unknownExecutable.join(", ")}`);
  }

  if (
    files.some((file) => GOVERNANCE_FILE.test(file)) &&
    files.every((file) => isDocumentation(file, documentationOnlyFiles) || GOVERNANCE_FILE.test(file))
  ) {
    return {
      tier: "scoped",
      areas: ["governance"],
      reasons: ["verification governance changed"],
    };
  }

  if (files.length > 0 && files.every((file) => isDocumentation(file, documentationOnlyFiles))) {
    return {
      tier: "docs",
      reasons: ["only documentation files changed"],
    };
  }

  if (stage === "pr") {
    if (files.some((file) => hasProductImpact(file, documentationOnlyFiles))) {
      return fullClassification(
        files,
        "publishing product-impact changes requires full verification",
        documentationOnlyFiles,
      );
    }
    if (files.some((file) => !classified(file, documentationOnlyFiles))) {
      return fullClassification(files, "unclassified PR scope requires full verification", documentationOnlyFiles);
    }
  }

  const areas = [...new Set(files.map(sourceArea).filter(Boolean))].sort();
  if (
    areas.length === 1 &&
    areas[0] === "control-plane" &&
    files.every((file) => isDocumentation(file, documentationOnlyFiles) || CONTROL_PLANE_FILE.test(file))
  ) {
    return scopedClassification(files, "control-plane changed", documentationOnlyFiles);
  }
  if (
    areas.length === 1 &&
    areas[0] === "operations" &&
    files.every((file) => isDocumentation(file, documentationOnlyFiles) || OPERATIONS_FILE.test(file))
  ) {
    return scopedClassification(files, "operations tooling changed", documentationOnlyFiles);
  }
  if (
    areas.some((area) => ["governance", "control-plane", "operations"].includes(area)) &&
    files.every(
      (file) =>
        isDocumentation(file, documentationOnlyFiles) || GOVERNANCE_FILE.test(file) || sourceArea(file),
    )
  ) {
    return scopedClassification(files, "known scoped paths changed", documentationOnlyFiles);
  }
  if (
    areas.length > 0 &&
    files.every((file) => isDocumentation(file, documentationOnlyFiles) || sourceArea(file))
  ) {
    return {
      tier: "scoped",
      areas,
      reasons: ["known source paths changed"],
    };
  }

  if (files.some((file) => hasProductImpact(file, documentationOnlyFiles))) {
    return scopedClassification(files, "product-impact infrastructure changed", documentationOnlyFiles);
  }

  return scopedClassification(files, "change scope is not classified", documentationOnlyFiles);
}

export function classifyChanges(files, { risk = "auto", stage = "completion", documentationOnlyFiles = [] } = {}) {
  if (risk !== "auto" && risk !== "high") {
    throw new Error("risk must be auto or high");
  }
  if (stage !== "completion" && stage !== "pr") {
    throw new Error("stage must be completion or pr");
  }
  const documentationOnlySet = new Set(documentationOnlyFiles);
  const automatic = classifyAutomatically(files, stage, documentationOnlySet);
  if (risk === "auto") return automatic;

  return fullClassification(files, "risk explicitly escalated to high", documentationOnlySet);
}

function appendAreaCommands(commands, areas, base) {
  if (areas.includes("docs") && !areas.includes("governance")) {
    commands.push(["node", "--test", "tests/agent-rules.test.mjs"]);
  }
  if (areas.includes("node")) {
    commands.push(
      ["pnpm", "exec", "tsc", "-b", "--pretty", "false"],
      ["pnpm", "exec", "vitest", "run", "packages", "apps", "--changed", base],
    );
  }
  if (areas.includes("web")) {
    commands.push(
      ["node", "web/node_modules/typescript/bin/tsc", "-b", "web/tsconfig.json", "--pretty", "false"],
      ["npm", "--prefix", "web", "run", "lint"],
      // docs/agents/testing-strategy.md 的 scoped/web 一行写的是「Web typecheck + Web Vitest --changed」，
      // 这一条此前缺失，web 下的单测从来没有被门禁执行过。
      // --passWithNoTests：web 变更常常只动 CSS 或页面壳，模块图上够不到任何测试；
      // 那种情况该放行，而不是把「没有相关测试」报成失败。
      ["npm", "--prefix", "web", "run", "test", "--", "--changed", base, "--passWithNoTests"],
    );
  }
  if (areas.includes("governance")) {
    commands.push([
      "node",
      "--test",
      "tests/verification-policy.test.mjs",
      "tests/agent-rules.test.mjs",
    ]);
  }
  if (areas.includes("control-plane")) {
    commands.push(
      ["bash", "scripts/test-hooks.sh"],
      [
        "python3",
        "-m",
        "unittest",
        "scripts.tests.test_publish_review_package",
        "scripts.tests.test_start_task_worktree",
        "scripts.tests.test_sync_task_from_origin",
      ],
    );
  }
  if (areas.includes("operations")) {
    commands.push(["python3", "-m", "unittest", "discover", "-s", "scripts/tests"]);
  }
}

export function buildVerificationPlan(classification, { base }) {
  const commands = [["git", "diff", "--check", `${base}...HEAD`]];
  const areas = classification.tier === "docs" ? ["docs"] : classification.areas ?? [];
  appendAreaCommands(commands, areas, base);
  if (classification.tier === "full") {
    commands.push(["pnpm", "verify"]);
  }
  return commands;
}

function classificationCovers(receipt, current) {
  if (!receipt || !current) return true;
  if (current.tier === "full") {
    return receipt.tier === "full";
  }
  if (receipt.tier === "full") return true;
  if (receipt.tier !== current.tier) return false;
  if (current.tier !== "scoped") return true;
  const receiptAreas = new Set(receipt.areas ?? []);
  return (current.areas ?? []).every((area) => receiptAreas.has(area));
}

function commandsMatch(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function validateReceipt(receipt, current) {
  if (!receipt) {
    return { valid: false, reason: "verification receipt is missing" };
  }
  if (receipt.version !== 1) {
    return { valid: false, reason: "verification receipt version is unsupported" };
  }
  if (receipt.status !== "passed") {
    return { valid: false, reason: "verification did not pass" };
  }
  if (receipt.head !== current.head) {
    return { valid: false, reason: "HEAD changed after verification" };
  }
  if (receipt.base !== current.base) {
    return { valid: false, reason: "verification base changed" };
  }
  if (receipt.changedFilesHash !== current.changedFilesHash) {
    return { valid: false, reason: "changed file scope changed" };
  }
  if (current.inputHash && receipt.inputHash !== current.inputHash) {
    return { valid: false, reason: "verification inputs changed" };
  }
  if (!classificationCovers(receipt.classification, current.classification)) {
    return { valid: false, reason: "verification tier does not cover current risk" };
  }
  if (current.commands) {
    const expectedPlan = buildVerificationPlan(receipt.classification, { base: current.base });
    if (!commandsMatch(receipt.commands, expectedPlan)) {
      return { valid: false, reason: "verification plan does not match its classification" };
    }
    if (
      !Array.isArray(receipt.results) ||
      receipt.results.length !== expectedPlan.length ||
      receipt.results.some((result, index) => {
        const attempts = result.attempts;
        return (
          !commandsMatch(result.command, expectedPlan[index]) ||
          result.exitCode !== 0 ||
          !Array.isArray(attempts) ||
          attempts.length === 0 ||
          attempts.at(-1).exitCode !== 0
        );
      })
    ) {
      return { valid: false, reason: "verification results are incomplete or failed" };
    }
  }
  return { valid: true };
}
