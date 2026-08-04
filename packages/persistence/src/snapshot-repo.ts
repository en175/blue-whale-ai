import type { PrismaClient } from "@prisma/client";
import {
  creativeSkillActivationSchema,
  type CreativeSkillActivation,
} from "@blue-whale/contracts";

import { publicGenerationInput } from "./generation-input.js";

/** Snapshot 读路径的 job + asset 聚合 db port（Prisma-backed）。
 *  对齐 Java SnapshotService 项目级 GenerationJob 与 Asset 引用读取：
 *  - generation_jobs 按 project_id 过滤、gmt_create desc。
 *  - 按 project_id 一次读取全部 normal assets（包含上传与生成产物，防 N+1）。
 *  对齐部署 schema：conversation_messages / agent_runs / generation_job_outputs /
 *  project_events 表暂无 → 这些切片由 handler 补空数组与 cursor 0。字段 snake_case。 */

export interface SnapshotJobView {
  job_id: string;
  type: string;
  source: string;
  status: string;
  progress: number;
  input: unknown;
  output_asset_ids: string[];
  /** DB 原始 error（结构化 map）；投影成公开信封是 handler 层职责。 */
  stored_error: Record<string, unknown> | null;
}

export interface SnapshotAssetRow {
  id: string;
  type: string;
  url: string;
  /** assets.project_id 在部署 schema 非空（默认 0）；理论可空时按全局 asset 处理。 */
  project_id: string | null;
}

export interface SnapshotJobAggregate {
  generation_jobs: SnapshotJobView[];
  assets: SnapshotAssetRow[];
}

export interface SnapshotConversationState {
  conversation_messages: Array<{
    message_id: string;
    conversation_id: string;
    agent_run_id: string | null;
    role: string;
    content: string;
    sequence_no: number;
    created_at: string;
  }>;
  agent_runs: Array<{
    agent_run_id: string;
    conversation_id: string;
    status: string;
    stage: string | null;
    version: number;
    terminal_reason: string | null;
    failure_code: string | null;
    retry_count: number;
    activated_creative_skill_versions: CreativeSkillActivation[];
    reasoning_summary: string | null;
    active_input_request: {
      input_request_id: string;
      request_type: string;
      question: string | null;
      status: string;
      expires_at: string;
    } | null;
  }>;
  high_watermark_cursor: string;
}

export interface SnapshotRepo {
  loadJobsAndAssets(projectId: string): Promise<SnapshotJobAggregate>;
  loadConversationState(projectId: string): Promise<SnapshotConversationState>;
}

/** output_asset_ids（Json 数组）→ string[]。容忍 number/string 混合（历史数据）。 */
function parseAssetIdList(json: unknown): string[] {
  if (!Array.isArray(json)) return [];
  return json
    .map((v) =>
      typeof v === "number" || typeof v === "string" ? String(v) : null,
    )
    .filter((v): v is string => v !== null);
}

/** error 列 → 受控 map（仅非数组的 plain object），否则 null。 */
function toStoredError(json: unknown): Record<string, unknown> | null {
  if (json && typeof json === "object" && !Array.isArray(json)) {
    return json as Record<string, unknown>;
  }
  return null;
}

export function createSnapshotRepo(prisma: PrismaClient): SnapshotRepo {
  return {
    async loadJobsAndAssets(projectId) {
      const pid = BigInt(projectId);
      const jobs = await prisma.generation_jobs.findMany({
        where: { project_id: pid, is_delete: false },
        orderBy: { gmt_create: "desc" },
      });

      const assetRows = await prisma.assets.findMany({
        where: { project_id: pid, status: "normal", is_delete: false },
      });

      // 对齐 Java：仅保留归属本项目的 asset（防跨项目泄漏）。
      const assets: SnapshotAssetRow[] = [];
      for (const a of assetRows) {
        const rowProjectId =
          a.project_id == null ? null : a.project_id.toString();
        if (rowProjectId !== null && rowProjectId !== projectId) continue;
        assets.push({
          id: a.id.toString(),
          type: a.type,
          url: a.url,
          project_id: rowProjectId,
        });
      }

      const generation_jobs: SnapshotJobView[] = jobs.map((job) => ({
        job_id: job.id.toString(),
        type: job.type,
        source: job.source,
        status: job.status,
        progress: job.progress,
        input: publicGenerationInput(job.input ?? null),
        output_asset_ids: parseAssetIdList(job.output_asset_ids),
        stored_error: toStoredError(job.error),
      }));

      return { generation_jobs, assets };
    },
    async loadConversationState(projectId) {
      const pid = BigInt(projectId);
      const [messages, runs, inputRequests, maxCursorRow] = await Promise.all([
        prisma.conversation_messages.findMany({
          where: { project_id: pid, is_delete: 0 },
          orderBy: { sequence_no: "asc" },
        }),
        prisma.agent_runs.findMany({
          where: { project_id: pid, is_delete: 0 },
          orderBy: { id: "asc" },
        }),
        prisma.user_input_requests.findMany({
          where: {
            project_id: pid,
            status: "pending",
            expires_at: { gt: new Date() },
            is_delete: 0,
          },
          orderBy: { id: "asc" },
        }),
        // cursor 改雪花后 project_event_stream.high_watermark 不再维护；
        // 当前水位直接取 project_events 的最大 cursor。
        prisma.project_events.aggregate({
          where: { project_id: pid, is_delete: 0 },
          _max: { cursor: true },
        }),
      ]);
      const activeByRun = new Map(
        inputRequests
          .filter((request) => request.source_agent_run_id !== null)
          .map((request) => [
            request.source_agent_run_id!.toString(),
            {
              input_request_id: request.id.toString(),
              request_type: request.request_type,
              question: request.question,
              status: request.status,
              expires_at: request.expires_at.toISOString(),
            },
          ]),
      );
      return {
        conversation_messages: messages.map((message) => ({
          message_id: message.id.toString(),
          conversation_id: message.conversation_id.toString(),
          agent_run_id: message.agent_run_id?.toString() ?? null,
          role: message.role,
          content: message.content,
          sequence_no: message.sequence_no,
          created_at: message.gmt_create.toISOString(),
        })),
        agent_runs: runs.map((run) => {
          const activations = creativeSkillActivationSchema
            .array()
            .max(1)
            .safeParse(run.activated_creative_skill_versions);
          return {
            agent_run_id: run.id.toString(),
            conversation_id: run.conversation_id.toString(),
            status: run.status,
            stage: run.stage,
            version: run.version,
            terminal_reason:
              run.terminal_reason === "user_requested" ||
              run.terminal_reason === "runtime_error"
                ? run.terminal_reason
                : null,
            failure_code: run.failure_code,
            retry_count: run.retry_count,
            activated_creative_skill_versions: activations.success
              ? activations.data
              : [],
            reasoning_summary:
              typeof run.reasoning_summary === "string" &&
              run.reasoning_summary.length <= 280
                ? run.reasoning_summary
                : null,
            active_input_request: activeByRun.get(run.id.toString()) ?? null,
          };
        }),
        high_watermark_cursor: (maxCursorRow?._max?.cursor ?? 0n).toString(),
      };
    },
  };
}
