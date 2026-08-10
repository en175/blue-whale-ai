// AgentRunRepo 组合入口。实现按职责拆分到同目录子模块（IK74V8，≤800 行硬线）；
// 本文件只做组合与再导出，对外导出面保持不变。
import type { PrismaClient } from "@prisma/client";

import { createClaimNextOps } from "./agent-run-claim-ops.js";
import { createCommitSuccessOps } from "./agent-run-commit-ops.js";
import { createCommitFailureOps } from "./agent-run-terminal-ops.js";
import { createAppendProvisionalChunksOps } from "./agent-run-command-ops.js";
import type { AgentRunRepo } from "./agent-run-repo-types.js";

export * from "./agent-run-repo-types.js";
export { loadMentionTargetFacts } from "./agent-run-repo-internals.js";

export function createAgentRunRepo(prisma: PrismaClient): AgentRunRepo {
  return {
    ...createClaimNextOps(prisma),
    ...createCommitSuccessOps(prisma),
    ...createCommitFailureOps(prisma),
    ...createAppendProvisionalChunksOps(prisma),
  };
}
