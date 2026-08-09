// IK74V8：从 agent-run-repo.ts 拆出（≤800 行硬线）。逐块搬运，语义不变。
// RunCommit 成功路径：正式消息接纳与计划卡原子接纳（契约 §9）。
import { Prisma, type PrismaClient } from "@prisma/client";
import {
  agentRunCommitSchema,
  agentRunPinSchema,
} from "@blue-whale/contracts";

import { appendProjectEvent } from "./product-event-repo.js";
import {
  closeStreamingDelivery,
  databaseNow,
  majorVersion,
  publicRunEventPayload,
  replayCommitReceipt,
  resolvedCommitActivations,
} from "./agent-run-repo-internals.js";
import { validateAndPreparePlanCards } from "./agent-run-plan-preparation.js";
import type { AgentRunRepo } from "./agent-run-repo-types.js";

export function createCommitSuccessOps(
  prisma: PrismaClient,
): Pick<AgentRunRepo, "commitSuccess" | "commitPlanMessages"> {
  return {
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
            terminal_reason: null,
            failure_code: null,
            retry_count: completedRun.retry_count,
            activated_creative_skill_versions: activations,
            reasoning_summary: commit.reasoning_summary,
          },
        });
        // 临时交付提升边界（契约 §8.1）：只有 completed RunCommit 能把 streaming 交付置 completed。
        await closeStreamingDelivery(
          tx,
          run,
          advance.id,
          completedRun.version,
          "completed",
        );
        await tx.agent_advances.update({
          where: { id: advance.id },
          data: { status: "completed" },
        });
        // 只补「Worker 提议」路径的 auto 埋点：服务端在消息接纳缝已固定的 auto 激活
        // （资产契约 §16.2）已于接纳时落一行埋点，commit 不重复写。
        const autoActivation = commit.auto_creative_skill_activation
          ? activations.find((activation) => activation.source === "auto")
          : undefined;
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

    commitPlanMessages(input) {
      const commit = agentRunCommitSchema.parse({
        schema_version: 1,
        advance_id: input.advanceId,
        fencing_token: input.fence,
        expected_run_version: input.runVersion,
        request_digest: input.requestDigest,
        outcome: "completed_with_plan",
        reasoning_summary: input.reasoningSummary,
        plan_cards: input.planCards,
        capability_snapshot_version: input.capabilitySnapshotVersion,
      });
      if (commit.outcome !== "completed_with_plan") {
        throw new Error("invalid completed_with_plan RunCommit");
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
        agentRunPinSchema.parse(run.run_pin);
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

        // 验证阶段（零消息/计划写入前提）：任一失败 → failed commit，零 plan 行（AC#2）。
        const validation = await validateAndPreparePlanCards(
          tx,
          { project_id: run.project_id, user_id: run.user_id },
          advance,
          commit.plan_cards,
        );
        if (!validation.ok) {
          const failedRun = await tx.agent_runs.update({
            where: { id: run.id },
            data: {
              status: "failed",
              stage: null,
              terminal_reason: "runtime_error",
              failure_code: "plan_card_validation_failed",
              failure_message: validation.failureMessage,
              input_sequence_no: run.input_sequence_no,
              active_guard: null,
              lease_owner: null,
              lease_expires_at: null,
            },
          });
          const failedEvent = await appendProjectEvent(tx, {
            projectId: run.project_id.toString(),
            eventType: "agent_run.status_changed",
            aggregateType: "agent_run",
            aggregateId: run.id.toString(),
            aggregateVersion: failedRun.version,
            correlationId: `run_${run.id.toString()}`,
            payload: publicRunEventPayload(failedRun, "failed", null),
          });
          await closeStreamingDelivery(
            tx,
            run,
            advance.id,
            failedRun.version,
            "interrupted",
            "failed",
          );
          await tx.agent_advances.update({
            where: { id: advance.id },
            data: { status: "failed" },
          });
          const failedReceipt = {
            cursor: failedEvent.cursor,
            status: "failed",
          } as const;
          await tx.run_commits.create({
            data: {
              advance_id: advance.id,
              agent_run_id: run.id,
              request_digest: commit.request_digest,
              outcome: "failed",
              receipt: failedReceipt as Prisma.InputJsonValue,
            },
          });
          return { kind: "committed", ...failedReceipt } as const;
        }

        // 接纳阶段：每卡 conversations.version++ → conversation_messages(content_type=plan_message) → plan_messages。
        const activations = agentRunPinSchema.parse(
          run.run_pin,
        ).activated_creative_skill_versions;
        let lastCursor = "";
        for (
          let index = 0;
          index < validation.plans.length;
          index += 1
        ) {
          const plan = validation.plans[index];
          if (!plan) continue;
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
              content_type: "plan_message",
              content: plan.contentMarkdown,
              sequence_no: sequenced.version,
            },
          });
          await tx.plan_messages.create({
            data: {
              message_id: message.id,
              conversation_id: run.conversation_id,
              project_id: run.project_id,
              agent_run_id: run.id,
              ordinal: index + 1,
              total_in_batch: validation.plans.length,
              sequence_label: plan.sequenceLabel,
              application_kind: plan.applicationKind,
              target_scene_card_mention_id: plan.targetSceneCardMentionId
                ? BigInt(plan.targetSceneCardMentionId)
                : null,
              base_scene_card_version: plan.baseSceneCardVersion,
              content_markdown: plan.contentMarkdown,
              derived_references:
                plan.derivedReferences as Prisma.InputJsonValue,
              frozen_generation_parameters:
                plan.frozenParameters as Prisma.InputJsonValue,
              capability_snapshot_version:
                plan.capabilitySnapshotVersion as Prisma.InputJsonValue,
              provider_prompt_projection:
                plan.providerPromptProjection as Prisma.InputJsonValue,
              base_plan_message_id: plan.basePlanMessageId
                ? BigInt(plan.basePlanMessageId)
                : null,
              source_plan_message_id: plan.sourcePlanMessageId
                ? BigInt(plan.sourcePlanMessageId)
                : null,
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
              content_type: "plan_message",
              content: plan.contentMarkdown,
              sequence_no: sequenced.version,
            },
          });
          lastCursor = messageEvent.cursor;
        }
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
        const runEvent = await appendProjectEvent(tx, {
          projectId: run.project_id.toString(),
          eventType: "agent_run.status_changed",
          aggregateType: "agent_run",
          aggregateId: run.id.toString(),
          aggregateVersion: completedRun.version,
          correlationId: `run_${run.id.toString()}`,
          payload: {
            agent_run_id: run.id.toString(),
            conversation_id: run.conversation_id.toString(),
            status: "completed",
            stage: completedRun.stage,
            terminal_reason: null,
            failure_code: null,
            retry_count: completedRun.retry_count,
            activated_creative_skill_versions: activations,
            reasoning_summary: commit.reasoning_summary,
          },
        });
        lastCursor = runEvent.cursor;
        await closeStreamingDelivery(
          tx,
          run,
          advance.id,
          completedRun.version,
          "completed",
        );
        await tx.agent_advances.update({
          where: { id: advance.id },
          data: { status: "completed" },
        });
        const receipt = { cursor: lastCursor, status: "completed" } as const;
        await tx.run_commits.create({
          data: {
            advance_id: advance.id,
            agent_run_id: run.id,
            request_digest: commit.request_digest,
            outcome: "completed_with_plan",
            receipt: receipt as Prisma.InputJsonValue,
          },
        });
        return { kind: "committed", ...receipt } as const;
      });
    },
  };
}
