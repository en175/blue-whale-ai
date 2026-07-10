/**
 * jobs —— GenerationJob 状态映射（IJZYVQ ARCH-5 验收 #4 跨模块消费）
 *
 * 位置：`blue_whale_web/lib/jobs.ts` —— 顶层 lib（非 _canvas 内部），证明领域类型可被
 * 非画布模块使用。
 *
 * 本文件只承载**领域类型之间的纯映射**（不引 UI 标签/中文文案）：
 *   - Job.status → Card.status 视图映射（CONTEXT.md L79-80）
 *   - Job 是否终态判断
 *
 * UI 标签（"排队中"/"生成中"等）属 UI 层职责，不在本文件。
 */

import type { CardStatus, GenerationJob, GenerationJobStatus } from "@/types/domain";

/**
 * GenerationJob 状态 → Card 视图状态（CONTEXT.md L79-80 视图映射）。
 *
 *   queued     → generating（视为过渡态，与 processing UI 一致）
 *   processing → generating
 *   succeeded  → normal
 *   failed     → failed
 */
export function mapJobStatusToCardStatus(
  status: GenerationJobStatus,
): CardStatus {
  switch (status) {
    case "queued":
    case "processing":
      return "generating";
    case "succeeded":
      return "normal";
    case "failed":
      return "failed";
  }
}

/** Job 是否处于终态（不再有状态转移）。succeeded / failed 都是终态。 */
export function isJobTerminal(job: GenerationJob): boolean {
  return job.status === "succeeded" || job.status === "failed";
}