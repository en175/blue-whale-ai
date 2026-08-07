// IK74V8：从 agent-run-repo.ts 拆出（≤800 行硬线）。逐块搬运，语义不变。
// 领取/续租/mention 实时重查（契约 §8.2、T08 AC#5）。
import { Prisma, type PrismaClient } from "@prisma/client";
import {
  agentRunPinSchema,
  agentRunWorkSchema,
} from "@blue-whale/contracts";

import { appendProjectEvent } from "./product-event-repo.js";
import { classifyMentionAvailability } from "./mention-availability.js";
import {
  databaseNow,
  freezeMentionInputSnapshot,
  loadMentionTargetFacts,
  publicRunEventPayload,
} from "./agent-run-repo-internals.js";
import type { AgentRunRepo } from "./agent-run-repo-types.js";

export function createClaimNextOps(
  prisma: PrismaClient,
): Pick<AgentRunRepo, "claimNext" | "renewLease" | "recheckMentionAuthority"> {
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
        const runningAdvance = await tx.agent_advances.findFirst({
          where: { agent_run_id: run.id, status: "running" },
          orderBy: { ordinal: "desc" },
        });
        let advance = candidate.status === "running" ? runningAdvance : null;
        if (candidate.status === "running" && !advance) {
          throw new Error("active AgentRun is missing its running Advance");
        }
        if (!advance) {
          const latestAdvance = await tx.agent_advances.findFirst({
            where: { agent_run_id: run.id },
            orderBy: { ordinal: "desc" },
            select: { ordinal: true },
          });
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
          // 同事务冻结本轮 MentionInputSnapshot（T08）：接管分支复用 runningAdvance
          // 的既有快照，不重算（AC#1/#2）。
          const mentionInputSnapshot = await freezeMentionInputSnapshot(
            tx,
            { project_id: run.project_id, user_id: run.user_id },
            messages.map((message) => message.id),
          );
          advance = await tx.agent_advances.create({
            data: {
              agent_run_id: run.id,
              ordinal: (latestAdvance?.ordinal ?? 0) + 1,
              status: "running",
              input_snapshot: inputSnapshot,
              input_high_watermark_sequence_no: inputHighWatermark,
              mention_input_snapshot: mentionInputSnapshot as Prisma.InputJsonValue,
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
          payload: publicRunEventPayload(run, "running", run.stage),
        });
        const inputMessages = advance.input_snapshot;
        const snapshotRows = Array.isArray(inputMessages) ? inputMessages : [];
        const firstSnapshotRow = snapshotRows[0];
        const firstInputSequenceNo =
          typeof firstSnapshotRow === "object" &&
          firstSnapshotRow !== null &&
          "sequence_no" in firstSnapshotRow &&
          typeof firstSnapshotRow.sequence_no === "number"
            ? firstSnapshotRow.sequence_no
            : run.input_sequence_no + 1;
        const historyRows = await tx.conversation_messages.findMany({
          where: {
            conversation_id: run.conversation_id,
            role: { in: ["user", "assistant"] },
            sequence_no: { lt: firstInputSequenceNo },
            is_delete: 0,
          },
          orderBy: { sequence_no: "asc" },
          select: { role: true, content: true },
        });
        const historyMessages = historyRows.map((message) => ({
          role: message.role as "user" | "assistant",
          content: message.content,
        }));
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
          history_messages: historyMessages,
          prompt,
          run_pin: runPin,
          auto_creative_skill_candidates: runPin.auto_creative_skill_candidates,
          activated_creative_skill_versions:
            runPin.activated_creative_skill_versions,
          mention_input_snapshot: advance.mention_input_snapshot ?? {
            capability_snapshot_version: 1,
            entries: [],
          },
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

    recheckMentionAuthority(input) {
      if (input.snapshot.entries.length === 0) {
        return Promise.resolve({ authoritative: true });
      }
      return prisma.$transaction(async (tx) => {
        const run = await tx.agent_runs.findUnique({
          where: { id: BigInt(input.agentRunId) },
        });
        // 保守裁决：Run 缺失/已删时无法证明授权，一律拦截。
        if (!run || run.is_delete !== 0) return { authoritative: false };
        const mentionRows = await tx.conversation_message_mentions.findMany({
          where: {
            id: {
              in: input.snapshot.entries.map((entry) => BigInt(entry.mention_id)),
            },
          },
          select: {
            id: true,
            mention_type: true,
            target_id: true,
            target_version: true,
            accepted_user_id: true,
          },
        });
        const mentionById = new Map(
          mentionRows.map((mention) => [mention.id.toString(), mention]),
        );
        const { assetById, sceneCardById } = await loadMentionTargetFacts(
          tx,
          mentionRows,
        );
        for (const entry of input.snapshot.entries) {
          const mention = mentionById.get(entry.mention_id);
          if (
            !mention ||
            (mention.mention_type !== "asset" &&
              mention.mention_type !== "scene_card")
          ) {
            return { authoritative: false };
          }
          const { availability } = classifyMentionAvailability({
            type: mention.mention_type,
            targetVersion: mention.target_version,
            acceptedUserId: mention.accepted_user_id,
            asset: assetById.get(mention.target_id.toString()),
            sceneCard: sceneCardById.get(mention.target_id.toString()),
            projectId: run.project_id,
            userId: run.user_id,
          });
          if (availability === "unavailable") return { authoritative: false };
        }
        return { authoritative: true };
      });
    },
  };
}
