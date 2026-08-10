const DOCUMENTATION_FILE = /^(?:CLAUDE\.md|AGENTS\.md|CONTEXT\.md|README(?:\.[^/]+)?\.md|docs\/.*\.md|(?:apps|packages|blue_whale_web)\/.*\/README(?:\.[^/]+)?\.md)$/;
const NODE_SOURCE = /^(?:apps|packages)\/[^/]+\/(?:src|tests?)\/.*\.(?:ts|tsx)$/;
const WEB_SOURCE = /^blue_whale_web\/(?:app|components|hooks|lib|workers)\/.*\.(?:ts|tsx)$/;
const HIGH_IMPACT_FILE = /^(?:package\.json|pnpm-lock\.yaml|pnpm-workspace\.yaml|tsconfig(?:\.[^.]+)?\.json|Dockerfile[^/]*|deploy\/|packages\/contracts\/|packages\/persistence\/(?:prisma\/migrations|schema)\/|blue_whale_web\/(?:app\/api\/auth|lib\/auth|e2e-fullstack\/|playwright\.)|tests\/typescript-baseline\/|scripts\/(?:init-typescript-baseline-db|run-typescript-baseline-acceptance|verify-typescript-baseline)\.|\.githooks\/|\.(?:claude|codex)\/hooks\/|\.zcode\/config\.json)/;
const GOVERNANCE_FILE = /^(?:docs\/agents\/testing-strategy\.md|scripts\/(?:verification-policy|verify-change-scope)\.mjs|scripts\/publish-review-package\.sh|tests\/(?:verification-policy|agent-rules)\.test\.mjs|\.gitee\/PULL_REQUEST_TEMPLATE\.md|\.(?:claude|superpowers|zcode|qoder)\/skills\/(?:implement|dispatching-parallel-agents|finishing-a-development-branch|subagent-driven-development)\/)/;

function sourceArea(file) {
  if (NODE_SOURCE.test(file)) return "node";
  if (WEB_SOURCE.test(file)) return "web";
  return null;
}

function inferredAreas(files) {
  const areas = new Set(files.map(sourceArea).filter(Boolean));
  if (files.some((file) => GOVERNANCE_FILE.test(file))) {
    areas.add("governance");
  } else if (files.some((file) => DOCUMENTATION_FILE.test(file))) {
    areas.add("docs");
  }
  return [...areas].sort();
}

function fullClassification(files, reason) {
  const areas = inferredAreas(files);
  return {
    tier: "full",
    ...(areas.length > 0 ? { areas } : {}),
    reasons: [reason],
  };
}

function classifyAutomatically(files) {
  if (
    files.some((file) => GOVERNANCE_FILE.test(file)) &&
    files.every((file) => DOCUMENTATION_FILE.test(file) || GOVERNANCE_FILE.test(file))
  ) {
    return {
      tier: "scoped",
      areas: ["governance"],
      reasons: ["verification governance changed"],
    };
  }

  if (files.length > 0 && files.every((file) => DOCUMENTATION_FILE.test(file))) {
    return {
      tier: "docs",
      reasons: ["only documentation files changed"],
    };
  }

  if (files.some((file) => HIGH_IMPACT_FILE.test(file))) {
    return fullClassification(files, "high-impact infrastructure changed");
  }

  const areas = [...new Set(files.map(sourceArea).filter(Boolean))].sort();
  if (
    areas.length > 0 &&
    files.every((file) => DOCUMENTATION_FILE.test(file) || sourceArea(file))
  ) {
    return {
      tier: "scoped",
      areas,
      reasons: ["known source paths changed"],
    };
  }

  return fullClassification(files, "change scope is not classified");
}

export function classifyChanges(files, { risk = "auto" } = {}) {
  if (risk !== "auto" && risk !== "high") {
    throw new Error("risk must be auto or high");
  }
  const automatic = classifyAutomatically(files);
  if (risk === "auto") return automatic;

  const areas = inferredAreas(files);
  return {
    tier: "full",
    ...(areas.length > 0 ? { areas } : {}),
    reasons: ["risk explicitly escalated to high"],
  };
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
      ["pnpm", "--filter", "@blue-whale/web", "exec", "tsc", "--noEmit"],
      ["pnpm", "--filter", "@blue-whale/web", "exec", "vitest", "run", "--changed", base],
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
}

export function buildVerificationPlan(classification, { base }) {
  const commands = [["git", "diff", "--check", `${base}...HEAD`]];
  const areas = classification.tier === "docs" ? ["docs"] : classification.areas ?? [];
  appendAreaCommands(commands, areas, base);
  if (classification.tier === "full") commands.push(["pnpm", "verify"]);
  return commands;
}

function classificationCovers(receipt, current) {
  if (!receipt || !current) return true;
  if (current.tier === "full") return receipt.tier === "full";
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
