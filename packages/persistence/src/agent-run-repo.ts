import { Prisma, type PrismaClient } from "@prisma/client";
import {
  agentRunCommitSchema,
  agentRunPinSchema,
  agentRunWorkSchema,
  creativeSkillActivationSchema,
  type AgentRunPin,
  type AutoCreativeSkillActivation,
  type CreativeSkillActivation,
  type AgentRunWork as ContractAgentRunWork,
} from "@blue-whale/contracts";

import { appendProjectEvent } from "./product-event-repo.js";

export interface ClaimAgentRunInput {
  workerId: string;
  leaseMs: number;
}

export type AgentRunWork = ContractAgentRunWork & {
  conversationId: string;
  userId: string;
  /** 总结当前对话意图（IK60X1，契约 §15.2）：为真时 Worker 分流到总结管道。 */
  skillSummarize: boolean;
};

export interface CommitAgentRunSuccessInput {
  workerId: string;
  agentRunId: string;
  advanceId: string;
  fence: string;
  runVersion: number;
  requestDigest: string;
  content: string;
  reasoningSummary: string;
  autoCreativeSkillActivation: AutoCreativeSkillActivation | null;
}

export interface RenewAgentRunLeaseInput {
  workerId: string;
  agentRunId: string;
  fence: string;
  runVersion: number;
  leaseMs: number;
}

export interface CommitAgentRunFailureInput {
  workerId: string;
  agentRunId: string;
  advanceId: string;
  fence: string;
  runVersion: number;
  requestDigest: string;
  failureCode: string;
  failureMessage: string;
}

export type CommitAgentRunResult =
  | {
      kind: "committed";
      cursor: string;
      status: "queued" | "completed" | "failed";
    }
  | {
      kind: "replayed";
      cursor: string;
      status: "queued" | "completed" | "failed";
    }
  | { kind: "conflict" };

export interface AgentRunRepo {
  claimNext(input: ClaimAgentRunInput): Promise<AgentRunWork | null>;
  renewLease(input: RenewAgentRunLeaseInput): Promise<boolean>;
  commitSuccess(
    input: CommitAgentRunSuccessInput,
  ): Promise<CommitAgentRunResult>;
  commitFailure(
    input: CommitAgentRunFailureInput,
  ): Promise<CommitAgentRunResult>;
}

async function databaseNow(tx: Prisma.TransactionClient): Promise<Date> {
  const rows = await tx.$queryRaw<Array<{ db_now: Date }>>(
    Prisma.sql`SELECT CURRENT_TIMESTAMP(3) AS db_now`,
  );
  const now = rows[0]?.db_now;
  if (!(now instanceof Date)) throw new Error("database time unavailable");
  return now;
}

function replayCommitReceipt(receipt: Prisma.JsonValue): CommitAgentRunResult {
  if (
    typeof receipt !== "object" ||
    receipt === null ||
    Array.isArray(receipt) ||
    typeof receipt.cursor !== "string" ||
    !["queued", "completed", "failed"].includes(String(receipt.status))
  ) {
    throw new Error("invalid stored RunCommit receipt");
  }
  return {
    kind: "replayed",
    cursor: receipt.cursor,
    status: receipt.status as "queued" | "completed" | "failed",
  };
}

function resolvedCommitActivations(
  pin: AgentRunPin,
  autoActivation: AutoCreativeSkillActivation | null,
): CreativeSkillActivation[] | null {
  if (!autoActivation) return pin.activated_creative_skill_versions;
  if (pin.activated_creative_skill_versions.length > 0) return null;
  const candidate = pin.auto_creative_skill_candidates.find(
    (entry) =>
      entry.creative_skill_id === autoActivation.creative_skill_id &&
      entry.creative_skill_version_id ===
        autoActivation.creative_skill_version_id &&
      entry.resource_digest === autoActivation.resource_digest,
  );
  const resource = pin.creative_skill_resources.find(
    (entry) =>
      entry.creative_skill_id === autoActivation.creative_skill_id &&
      entry.creative_skill_version_id ===
        autoActivation.creative_skill_version_id &&
      entry.resource_digest === autoActivation.resource_digest,
  );
  if (
    !candidate ||
    !resource ||
    autoActivation.reason.type !== "agent_match" ||
    autoActivation.reason.detail.matched_fields.length !== 1 ||
    autoActivation.reason.detail.matched_fields[0] !== "conversation_messages"
  ) {
    return null;
  }
  return [
    {
      creative_skill_id: candidate.creative_skill_id,
      creative_skill_version_id: candidate.creative_skill_version_id,
      name: candidate.name,
      display_version: candidate.display_version,
      resource_digest: candidate.resource_digest,
      source: "auto",
      reason: {
        type: "agent_match",
        detail: { matched_fields: ["conversation_messages"] },
      },
    },
  ];
}

function majorVersion(displayVersion: string): number {
  const value = Number.parseInt(displayVersion.split(".")[0] ?? "1", 10);
  return Number.isSafeInteger(value) && value > 0 ? value : 1;
}

function publicActivations(value: unknown): CreativeSkillActivation[] {
  const parsed = creativeSkillActivationSchema.array().max(1).safeParse(value);
  return parsed.success ? parsed.data : [];
}

function publicReasoningSummary(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 && value.length <= 280
    ? value
    : null;
}

function publicRunEventPayload(
  run: {
    id: bigint;
    conversation_id: bigint;
    activated_creative_skill_versions?: unknown;
    reasoning_summary?: unknown;
  },
  status: string,
  stage: string | null,
): Prisma.InputJsonObject {
  return {
    agent_run_id: run.id.toString(),
    conversation_id: run.conversation_id.toString(),
    status,
    stage,
    activated_creative_skill_versions: publicActivations(
      run.activated_creative_skill_versions,
    ),
    reasoning_summary: publicReasoningSummary(run.reasoning_summary),
  };
}

export function createAgentRunRepo(prisma: PrismaClient): AgentRunRepo {
  return {
    claimNext(input) {
      return prisma.$transaction(async (tx) => {
        const now = await databaseNow(tx);
        const candidate = await tx.agent_runs.findFirst({
          where: {
            is_delete: 0,
            OR: [
              { status: "queued" },
              {
                status: "running",
                lease_expires_at: { lt: now },
              },
            ],
          },
          orderBy: { id: "asc" },
        });
        if (!candidate) return null;

        const leaseExpiresAt = new Date(now.getTime() + input.leaseMs);
        const claimed = await tx.agent_runs.updateMany({
          where:
            candidate.status === "queued"
              ? {
                  id: candidate.id,
                  status: "queued",
                  version: candidate.version,
                }
              : {
                  id: candidate.id,
                  status: "running",
                  version: candidate.version,
                  lease_expires_at: { lt: now },
                },
          data: {
            status: "running",
            stage: "responding",
            lease_owner: input.workerId,
            lease_expires_at: leaseExpiresAt,
            fencing_token: { increment: 1n },
            version: { increment: 1 },
          },
        });
        if (claimed.count !== 1) return null;

        const run = await tx.agent_runs.findUnique({
          where: { id: candidate.id },
        });
        if (!run) return null;
        const parsedRunPin = agentRunPinSchema.safeParse(run.run_pin);
        if (!parsedRunPin.success) {
          const failedRun = await tx.agent_runs.update({
            where: { id: run.id },
            data: {
              status: "failed",
              stage: null,
              terminal_reason: "runtime_error",
              failure_code: "runtime_pin_missing",
              failure_message:
                "AgentRun does not contain a valid immutable RunPin",
              active_guard: null,
              lease_owner: null,
              lease_expires_at: null,
            },
          });
          await appendProjectEvent(tx, {
            projectId: run.project_id.toString(),
            eventType: "agent_run.status_changed",
            aggregateType: "agent_run",
            aggregateId: run.id.toString(),
            aggregateVersion: failedRun.version,
            correlationId: `run_${run.id.toString()}`,
            payload: publicRunEventPayload(run, "failed", null),
          });
          return null;
        }
        const runPin = parsedRunPin.data;
        const existingAdvance = await tx.agent_advances.findUnique({
          where: { agent_run_id: run.id },
        });
        let advance =
          candidate.status === "running" &&
          existingAdvance?.status === "running"
            ? existingAdvance
            : null;
        if (candidate.status === "running" && !advance) {
          throw new Error(
            "active AgentRun is missing its sole running Advance",
          );
        }
        if (candidate.status === "queued" && existingAdvance) {
          throw new Error("queued AgentRun already has an Advance");
        }
        if (!advance) {
          const messages = await tx.conversation_messages.findMany({
            where: {
              agent_run_id: run.id,
              role: "user",
              sequence_no: { gt: run.input_sequence_no },
              is_delete: 0,
            },
            orderBy: { sequence_no: "asc" },
            select: { id: true, role: true, content: true, sequence_no: true },
          });
          const inputSnapshot = messages.map((message) => ({
            message_id: message.id.toString(),
            sequence_no: message.sequence_no,
            role: message.role,
            content: message.content,
          }));
          const inputHighWatermark =
            messages.at(-1)?.sequence_no ?? run.input_sequence_no;
          advance = await tx.agent_advances.create({
            data: {
              agent_run_id: run.id,
              ordinal: 1,
              status: "running",
              input_snapshot: inputSnapshot,
              input_high_watermark_sequence_no: inputHighWatermark,
            },
          });
        }
        await appendProjectEvent(tx, {
          projectId: run.project_id.toString(),
          eventType: "agent_run.status_changed",
          aggregateType: "agent_run",
          aggregateId: run.id.toString(),
          aggregateVersion: run.version,
          correlationId: `run_${run.id.toString()}`,
          payload: publicRunEventPayload(run, "running", "responding"),
        });
        const inputMessages = advance.input_snapshot;
        const prompt = Array.isArray(inputMessages)
          ? inputMessages
              .map((message) =>
                typeof message === "object" &&
                message !== null &&
                "content" in message &&
                typeof message.content === "string"
                  ? message.content
                  : "",
              )
              .join("\n\n")
          : "";
        const contractWork = agentRunWorkSchema.parse({
          schema_version: 1,
          agent_run_id: run.id.toString(),
          advance_id: advance.id.toString(),
          fencing_token: run.fencing_token.toString(),
          run_version: run.version,
          input_high_watermark_sequence_no:
            advance.input_high_watermark_sequence_no,
          input_messages: inputMessages,
          prompt,
          run_pin: runPin,
          auto_creative_skill_candidates: runPin.auto_creative_skill_candidates,
          activated_creative_skill_versions:
            runPin.activated_creative_skill_versions,
        });
        return {
          ...contractWork,
          conversationId: run.conversation_id.toString(),
          userId: run.user_id.toString(),
          skillSummarize: run.skill_summarize,
        };
      });
    },

    renewLease(input) {
      return prisma.$transaction(async (tx) => {
        const now = await databaseNow(tx);
        const renewed = await tx.agent_runs.updateMany({
          where: {
            id: BigInt(input.agentRunId),
            status: "running",
            lease_owner: input.workerId,
            lease_expires_at: { gt: now },
            fencing_token: BigInt(input.fence),
            version: input.runVersion,
            is_delete: 0,
          },
          data: {
            lease_expires_at: new Date(now.getTime() + input.leaseMs),
          },
        });
        return renewed.count === 1;
      });
    },

    commitSuccess(input) {
      const commit = agentRunCommitSchema.parse({
        schema_version: 1,
        advance_id: input.advanceId,
        fencing_token: input.fence,
        expected_run_version: input.runVersion,
        request_digest: input.requestDigest,
        outcome: "completed",
        assistant_message: { content: input.content },
        reasoning_summary: input.reasoningSummary,
        auto_creative_skill_activation: input.autoCreativeSkillActivation,
      });
      if (commit.outcome !== "completed") {
        throw new Error("invalid completed RunCommit");
      }
      return prisma.$transaction(async (tx) => {
        const existing = await tx.run_commits.findUnique({
          where: { advance_id: BigInt(commit.advance_id) },
        });
        if (existing) {
          if (existing.request_digest !== commit.request_digest) {
            return { kind: "conflict" } as const;
          }
          return replayCommitReceipt(existing.receipt);
        }
        const advance = await tx.agent_advances.findUnique({
          where: { id: BigInt(commit.advance_id) },
        });
        if (!advance || advance.agent_run_id !== BigInt(input.agentRunId)) {
          return { kind: "conflict" } as const;
        }
        const run = await tx.agent_runs.findUnique({
          where: { id: BigInt(input.agentRunId) },
        });
        if (!run) return { kind: "conflict" } as const;
        const runPin = agentRunPinSchema.parse(run.run_pin);
        const activations = resolvedCommitActivations(
          runPin,
          commit.auto_creative_skill_activation,
        );
        if (!activations) return { kind: "conflict" } as const;
        const now = await databaseNow(tx);
        const locked = await tx.agent_runs.updateMany({
          where: {
            id: BigInt(input.agentRunId),
            status: "running",
            lease_owner: input.workerId,
            lease_expires_at: { gt: now },
            fencing_token: BigInt(input.fence),
            version: input.runVersion,
            is_delete: 0,
          },
          data: { version: { increment: 1 } },
        });
        if (locked.count !== 1) return { kind: "conflict" } as const;
        const sequenced = await tx.conversations.update({
          where: { id: run.conversation_id },
          data: { version: { increment: 1 } },
          select: { version: true },
        });
        const message = await tx.conversation_messages.create({
          data: {
            conversation_id: run.conversation_id,
            project_id: run.project_id,
            agent_run_id: run.id,
            role: "assistant",
            content: input.content,
            sequence_no: sequenced.version,
          },
        });
        const completedRun = await tx.agent_runs.update({
          where: { id: run.id },
          data: {
            status: "completed",
            stage: "completed",
            active_guard: null,
            input_sequence_no: advance.input_high_watermark_sequence_no,
            activated_creative_skill_versions:
              activations as Prisma.InputJsonValue,
            reasoning_summary: commit.reasoning_summary,
            lease_owner: null,
            lease_expires_at: null,
          },
        });
        const messageEvent = await appendProjectEvent(tx, {
          projectId: run.project_id.toString(),
          eventType: "conversation.message_completed",
          aggregateType: "conversation",
          aggregateId: run.conversation_id.toString(),
          aggregateVersion: sequenced.version,
          correlationId: `run_${run.id.toString()}`,
          payload: {
            message_id: message.id.toString(),
            conversation_id: run.conversation_id.toString(),
            agent_run_id: run.id.toString(),
            role: "assistant",
            content: input.content,
            sequence_no: sequenced.version,
          },
        });
        const runEvent = await appendProjectEvent(tx, {
          projectId: run.project_id.toString(),
          eventType: "agent_run.status_changed",
          aggregateType: "agent_run",
          aggregateId: run.id.toString(),
          aggregateVersion: completedRun.version,
          correlationId: `run_${run.id.toString()}`,
          causationId: messageEvent.event_id,
          payload: {
            agent_run_id: run.id.toString(),
            conversation_id: run.conversation_id.toString(),
            status: "completed",
            stage: completedRun.stage,
            activated_creative_skill_versions: activations,
            reasoning_summary: commit.reasoning_summary,
          },
        });
        await tx.agent_advances.update({
          where: { id: advance.id },
          data: { status: "completed" },
        });
        const autoActivation = activations.find(
          (activation) => activation.source === "auto",
        );
        if (autoActivation) {
          await tx.creative_skill_activation.create({
            data: {
              creative_skill_id: autoActivation.creative_skill_id,
              user_id: run.user_id,
              agent_run_id: run.id.toString(),
              skill_version: majorVersion(autoActivation.display_version),
              activation_source: "auto",
            },
          });
        }
        const receipt = {
          cursor: runEvent.cursor,
          status: "completed",
        } as const;
        await tx.run_commits.create({
          data: {
            advance_id: advance.id,
            agent_run_id: run.id,
            request_digest: commit.request_digest,
            outcome: "completed",
            receipt: receipt as Prisma.InputJsonValue,
          },
        });
        return {
          kind: "committed",
          ...receipt,
        } as const;
      });
    },

    commitFailure(input) {
      const commit = agentRunCommitSchema.parse({
        schema_version: 1,
        advance_id: input.advanceId,
        fencing_token: input.fence,
        expected_run_version: input.runVersion,
        request_digest: input.requestDigest,
        outcome: "failed",
        failure: {
          code: input.failureCode,
          message: input.failureMessage,
        },
      });
      if (commit.outcome !== "failed") {
        throw new Error("invalid failed RunCommit");
      }
      return prisma.$transaction(async (tx) => {
        const existing = await tx.run_commits.findUnique({
          where: { advance_id: BigInt(commit.advance_id) },
        });
        if (existing) {
          if (existing.request_digest !== commit.request_digest) {
            return { kind: "conflict" } as const;
          }
          return replayCommitReceipt(existing.receipt);
        }
        const advance = await tx.agent_advances.findUnique({
          where: { id: BigInt(commit.advance_id) },
        });
        if (!advance || advance.agent_run_id !== BigInt(input.agentRunId)) {
          return { kind: "conflict" } as const;
        }
        const run = await tx.agent_runs.findUnique({
          where: { id: BigInt(input.agentRunId) },
        });
        if (!run) return { kind: "conflict" } as const;
        const now = await databaseNow(tx);
        const locked = await tx.agent_runs.updateMany({
          where: {
            id: BigInt(input.agentRunId),
            status: "running",
            lease_owner: input.workerId,
            lease_expires_at: { gt: now },
            fencing_token: BigInt(input.fence),
            version: input.runVersion,
            is_delete: 0,
          },
          data: { version: { increment: 1 } },
        });
        if (locked.count !== 1) return { kind: "conflict" } as const;
        const failedRun = await tx.agent_runs.update({
          where: { id: run.id },
          data: {
            status: "failed",
            stage: null,
            terminal_reason: "runtime_error",
            failure_code: input.failureCode,
            failure_message: input.failureMessage,
            // 保持原输入水位：失败不消费输入，接管或后续处理可重放同一批输入。
            input_sequence_no: run.input_sequence_no,
            active_guard: null,
            lease_owner: null,
            lease_expires_at: null,
          },
        });
        const runEvent = await appendProjectEvent(tx, {
          projectId: run.project_id.toString(),
          eventType: "agent_run.status_changed",
          aggregateType: "agent_run",
          aggregateId: run.id.toString(),
          aggregateVersion: failedRun.version,
          correlationId: `run_${run.id.toString()}`,
          payload: publicRunEventPayload(run, "failed", null),
        });
        await tx.agent_advances.update({
          where: { id: advance.id },
          data: { status: "failed" },
        });
        const receipt = { cursor: runEvent.cursor, status: "failed" } as const;
        await tx.run_commits.create({
          data: {
            advance_id: advance.id,
            agent_run_id: run.id,
            request_digest: commit.request_digest,
            outcome: "failed",
            receipt: receipt as Prisma.InputJsonValue,
          },
        });
        return {
          kind: "committed",
          ...receipt,
        } as const;
      });
    },
  };
}
