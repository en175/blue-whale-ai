const DOCUMENTATION_FILE = /^(?:CLAUDE\.md|AGENTS\.md|agent-rules\/.*\.md|CONTEXT\.md|README(?:\.[^/]+)?\.md|docs\/.*\.(?:md|html?|pdf|png|jpe?g|gif|webp|svg|js|css)|(?:apps|packages)\/.*\/README(?:\.[^/]+)?\.md|\.(?:agents|claude|superpowers|zcode|qoder)\/skills\/[^/]+\/.*\.md|\.(?:agents|claude|superpowers|zcode|qoder)\/skills\/[^/]+\/agents\/openai\.yaml|\.(?:agents|claude|superpowers|zcode|qoder)\/commands\/[^/]+\.md)$/i;
const NODE_SOURCE = /^(?:apps|packages)\/[^/]+\/(?:src|tests?)\/.*\.(?:ts|tsx)$/;
const FRONTEND_BUILD_FILE = /^(?:web\/|backend\/libs\/(?:contracts|core)\/|(?:backend\/)?(?:package\.json|tsconfig(?:\.[^.]+)?\.json)$|pnpm-lock\.yaml$|pnpm-workspace\.yaml$|\.nvmrc$|\.dockerignore$)/;
const WEB_SOURCE = /^web\/src\/.*\.(?:ts|tsx|css|json)$/;
const BACKEND_SOURCE = /^backend\/(?:apps|libs)\/.*\.ts$/;
const BACKEND_TOOLING_FILE = /^backend\/scripts\/.*\.mjs$/;
const JAVA_SOURCE = /^server\/(?:blue-whale-worker\/|blue-whale-common\/|pom\.xml)/;
const BILLING_SOURCE = /^server\/blue-whale-billing\//;
const WEB_TOOLING_FILE = /^web\/scripts\/.*\.(?:mjs|cjs|js)$/;
const CONTROL_PLANE_FILE = /^(?:\.githooks\/|\.claude\/skills$|\.claude\/settings\.json|\.codex\/hooks\.json|\.qoder\/settings\.json|\.kimi-code\/(?:hooks\.toml|hooks\/)|\.(?:claude|codex)\/hooks\/|\.zcode\/(?:config\.json|ponytail\.json$|plugins\/(?:marketplace\.json$|ponytail\/))|scripts\/(?:check-code-comments|check-contract-breaking|check-error-code-drift|check-hook-closed-loop|check-hook-contracts|check-project-skills|cleanup-implement-spec-child|cleanup-release-branch|cleanup-task-worktree|commit-spec-on-master|commit-task-for-review|gitee-resolve-ids|install-kimi-hooks|list-task-worktrees|manage-agent-authorization|manage-release-branch|merge-implement-spec-child|merge-task-to-local-master|pr-update-evidence|probe-codex-write-hook|probe-zcode-write-hook|publish-review-package|publish-task-branch|query-hook-audit|setup-hooks|start-task-worktree|sync-codex-skill|sync-implement-spec-skill|sync-release-line|sync-superpowers-skills|sync-task-from-origin|sync-write-rules-skill|sync_recovery|test-hooks|verification-policy|verify-change-scope|verify-pr-update)\.|scripts\/lib\/|scripts\/tests\/)/;
const OPERATIONS_FILE = /^scripts\/(?:check-schema-charset|check-target-environment-retirement|compress-gallery-images|ensure-graphify-worktree|fix-ik7grv-replace-slot-backfill|fix-ikij40-canvas-309-mojibake|import-brand-gallery-assets|reconcile-cost-reservations|recompress-gallery-videos|run-ik50gb-c-testsite-probe|run-real-canary|run-testsite-sql|tunnel-testsite-db|update-gallery-final)\./;
const PRODUCT_IMPACT_FILE = /^(?:(?:web\/|backend\/)?package\.json|web\/package-lock\.json|web\/\.env[^/]*|pnpm-lock\.yaml|pnpm-workspace\.yaml|tsconfig(?:\.[^.]+)?\.json|(?:.*\/)?Dockerfile[^/]*|deploy\/|contracts\/|backend\/libs\/contracts\/|backend\/prisma\/|server\/|tests\/typescript-baseline\/|scripts\/(?:dev-blue-whale|dev-stack|init-typescript-baseline-db|run-typescript-baseline-acceptance|verify-typescript-baseline)\.)/;
const CONTRACTS_SOURCE = /^contracts\//;
const EXECUTABLE_FILE = /^(?:scripts\/|.*\.(?:sh|py|mjs|cjs|js))$/;
const SKILL_SCRIPT_FILE = /^\.(?:agents|claude|superpowers|zcode|qoder)\/skills\/[^/]+\/scripts\/.*\.(?:sh|py|mjs|cjs|js)$/;
const SKILL_PACKAGE_FILE = /^\.agents\/skills\/[^/]+\/.+/;
const SKILL_DOCKERFILE = /^\.(?:agents|claude|superpowers|zcode|qoder)\/skills\/[^/]+\/(?:.*\/)?Dockerfile[^/]*$/;
const GOVERNANCE_FILE = /^(?:eslint\.config\.mjs|docs\/agents\/testing-strategy\.md|scripts\/(?:verification-policy|verify-change-scope)\.mjs|scripts\/publish-review-package\.sh|tests\/(?:verification-policy|agent-rules)\.test\.mjs|\.gitee\/PULL_REQUEST_TEMPLATE\.md|\.(?:agents|claude|superpowers|zcode|qoder)\/skills\/implement\/)/;

const SKILL_ASSET_FILES = new Set([
  ".agents/skills/deploy-blue-whale-api/tests/test-tag-propagation.sh",
  ".agents/skills/setup-ts-deep-modules/dependency-cruiser.config.cjs",
  ".agents/skills/wizard/template.sh",
  ".zcode/skills/deploy-blue-whale-api/tests/test-tag-propagation.sh",
  ".zcode/skills/setup-ts-deep-modules/dependency-cruiser.config.cjs",
  ".zcode/skills/wizard/template.sh",
  ".claude/skills/setup-ts-deep-modules/dependency-cruiser.config.cjs",
  ".claude/skills/wizard/template.sh",
  "tests/skill-assets.test.mjs",
  ".claude/skills/systematic-debugging/find-polluter.sh",
  ".claude/skills/writing-skills/render-graphs.js",
  ".superpowers/skills/systematic-debugging/find-polluter.sh",
  ".superpowers/skills/writing-skills/render-graphs.js",
  ".zcode/skills/systematic-debugging/find-polluter.sh",
  ".zcode/skills/writing-skills/render-graphs.js",
]);

function isTestFile(file) {
  return /(?:^|\/)[^/]+\.(?:test|spec)\.(?:ts|tsx|js|mjs|cjs)$/.test(file);
}

function hasProductImpact(file, documentationOnlyFiles) {
  return PRODUCT_IMPACT_FILE.test(file) && !SKILL_PACKAGE_FILE.test(file) && !SKILL_DOCKERFILE.test(file) && !isTestFile(file) && !documentationOnlyFiles.has(file);
}

export function requiresFrontendBuild(files, documentationOnlyFiles = []) {
  const documentation = new Set(documentationOnlyFiles);
  return files.some((file) => FRONTEND_BUILD_FILE.test(file) &&
    !isDocumentation(file, documentation) && !/\.mdx?$/i.test(file));
}

function sourceArea(file) {
  if (SKILL_ASSET_FILES.has(file)) return "skill-assets";
  if (BILLING_SOURCE.test(file)) return "billing-java";
  if (CONTRACTS_SOURCE.test(file)) return "contracts";
  if (NODE_SOURCE.test(file)) return "node";
  if (BACKEND_SOURCE.test(file) || BACKEND_TOOLING_FILE.test(file) || /^backend\/prisma\//.test(file)) return "backend";
  if (JAVA_SOURCE.test(file)) return "worker-java";
  if (WEB_SOURCE.test(file) || WEB_TOOLING_FILE.test(file) ||
      (file.startsWith("web/") && !EXECUTABLE_FILE.test(file) && requiresFrontendBuild([file]))) return "web";
  if (CONTROL_PLANE_FILE.test(file)) return "control-plane";
  if (OPERATIONS_FILE.test(file)) return "operations";
  if (SKILL_SCRIPT_FILE.test(file)) return "operations";
  if (SKILL_DOCKERFILE.test(file)) return "operations";
  if (SKILL_PACKAGE_FILE.test(file) && !EXECUTABLE_FILE.test(file)) return "operations";
  return null;
}

function inferredAreas(files, documentationOnlyFiles) {
  const areas = new Set(files.map(sourceArea).filter(Boolean));
  if (requiresFrontendBuild(files, documentationOnlyFiles)) areas.add("web");
  if (files.some((file) => /^server\/(?:blue-whale-common\/|pom\.xml)/.test(file))) {
    areas.add("worker-java");
    areas.add("billing-java");
  }
  if (files.some((file) => GOVERNANCE_FILE.test(file))) {
    areas.add("governance");
  } else if (files.some((file) => DOCUMENTATION_FILE.test(file))) {
    areas.add("docs");
  }
  return [...areas].sort();
}

function isDocumentation(file, documentationOnlyFiles) {
  return DOCUMENTATION_FILE.test(file) || file === "GLOSSARY.md" ||
    /^web\/.*\.mdx?$/i.test(file) || documentationOnlyFiles.has(file);
}

function classified(file, documentationOnlyFiles) {
  return (
    isDocumentation(file, documentationOnlyFiles) ||
    GOVERNANCE_FILE.test(file) ||
    PRODUCT_IMPACT_FILE.test(file) ||
    sourceArea(file) !== null || (!EXECUTABLE_FILE.test(file) && requiresFrontendBuild([file], documentationOnlyFiles))
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

function classifyAutomatically(files, documentationOnlyFiles) {
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

  if (files.some((file) => hasProductImpact(file, documentationOnlyFiles))) {
    return fullClassification(files, "product-impact changes require full verification", documentationOnlyFiles);
  }
  if (files.some((file) => !classified(file, documentationOnlyFiles))) {
    return fullClassification(files, "unclassified scope requires full verification", documentationOnlyFiles);
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
      areas: inferredAreas(files, documentationOnlyFiles),
      reasons: ["known source paths changed"],
    };
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
  const automatic = classifyAutomatically(files, documentationOnlySet);
  if (risk === "auto") return automatic;

  return fullClassification(files, "risk explicitly escalated to high", documentationOnlySet);
}

function appendAreaCommands(commands, areas, base, full) {
  if (areas.includes("docs") && !areas.includes("governance")) {
    commands.push(["node", "--test", "tests/agent-rules.test.mjs"]);
  }
  if (areas.includes("node")) {
    commands.push(
      ["pnpm", "exec", "tsc", "-b", "--pretty", "false"],
      ["pnpm", "exec", "vitest", "run", "packages", "apps"],
    );
  }
  if (areas.includes("backend")) {
    commands.push(
      ["pnpm", "exec", "tsc", "-p", "backend/tsconfig.json", "--noEmit", "--pretty", "false"],
    );
    if (!full) commands.push(["pnpm", "exec", "vitest", "run", "backend"]);
  }
  if (areas.includes("web")) {
    commands.push(
      ["node", "web/node_modules/typescript/bin/tsc", "-b", "web/tsconfig.json", "--pretty", "false"],
      ["npm", "--prefix", "web", "run", "lint"],
      ["npm", "--prefix", "web", "run", "test"],
      ["node", "web/node_modules/vite/bin/vite.js", "build", "--mode", "test"],
      ["node", "web/node_modules/vite/bin/vite.js", "build", "--mode", "release"],
    );
  }
  if (areas.includes("worker-java")) {
    commands.push(["mvn", "-f", "server/pom.xml", "-pl", "blue-whale-worker", "-am", "-q", "test"]);
  }
  if (areas.includes("contracts")) {
    commands.push(["bash", "scripts/check-contract-breaking.sh", base]);
  }
  if (areas.includes("billing-java")) {
    commands.push(["mvn", "-f", "server/pom.xml", "-pl", "blue-whale-billing", "-am", "-q", "test"]);
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
    );
  }
  if (areas.includes("skill-assets")) {
    commands.push(
      ["bash", ".agents/skills/deploy-blue-whale-api/tests/test-tag-propagation.sh"],
      ["bash", "-n", ".agents/skills/wizard/template.sh"],
      ["node", "--check", ".agents/skills/setup-ts-deep-modules/dependency-cruiser.config.cjs"],
      ["node", "--test", "tests/skill-assets.test.mjs"],
    );
  }
  if (areas.includes("operations")) {
    commands.push(["python3", "-m", "unittest", "discover", "-s", "scripts/tests"]);
  }
}

export function buildVerificationPlan(classification, { base, pythonCommand = ["python3"] }) {
  const commands = [["git", "diff", "--check", `${base}...HEAD`]];
  const areas = classification.tier === "docs" ? ["docs"] : classification.areas ?? [];
  appendAreaCommands(commands, areas, base, classification.tier === "full");
  if (classification.tier === "full") {
    commands.push(["pnpm", "verify"]);
  }
  return commands.map((command) => command[0] === "python3"
    ? [...pythonCommand, ...command.slice(1)]
    : command);
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
  if (receipt.startSha !== current.startSha) {
    return { valid: false, reason: "task start changed after verification" };
  }
  if (receipt.targetBranch !== current.targetBranch || receipt.targetSha !== current.targetSha) {
    return { valid: false, reason: "PR target changed after verification" };
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
    const expectedPlan = buildVerificationPlan(receipt.classification, {
      base: current.base,
      pythonCommand: current.pythonCommand,
    });
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
