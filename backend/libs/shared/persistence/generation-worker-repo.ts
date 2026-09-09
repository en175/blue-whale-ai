// generation worker 仓储组合入口。实现按职责拆分到同目录子模块（IK74V8，≤800 行硬线）；
// 本文件只做组合与再导出，对外导出面保持不变。
import type { PrismaClient } from "@prisma/client";

import { createWorkerClaimOps } from "./generation-worker-claim-ops.js";
import { createWorkerVideoOps } from "./generation-worker-video-ops.js";
import { createWorkerAssetOps } from "./generation-worker-asset-ops.js";
import { createWorkerSettleOps } from "./generation-worker-settle-ops.js";
import { createWorkerMediaExtractOps } from "./generation-worker-media-extract-ops.js";
import type { WorkerRepo } from "./generation-worker-types.js";

export * from "./generation-worker-types.js";
export { createWorkerAssetOps } from "./generation-worker-asset-ops.js";

export function createWorkerRepo(prisma: PrismaClient): WorkerRepo {
  return {
    ...createWorkerClaimOps(prisma),
    ...createWorkerVideoOps(prisma),
    ...createWorkerAssetOps(prisma),
    ...createWorkerSettleOps(prisma),
    ...createWorkerMediaExtractOps(prisma),
  };
}
