import type { PrismaClient } from "@prisma/client";

import {
  acceptConversationMessageInTransaction,
  transactionWithUniqueRetry,
  type AcceptedConversationRecord,
} from "./conversation-repo.js";
import { appendProjectEvent } from "./product-event-repo.js";

const INBOX_NAME = "生成收件箱";
const INBOX_PURPOSE = "generation_inbox";
const CREATE_CONVERSATION_OPERATION = "inbox.conversation.create";

export interface GenerationInboxView {
  project: {
    id: string;
    name: string;
    thumb: string | null;
    created_at: string;
    purpose: string;
  };
  active_conversation_id: string | null;
}

export interface InboxConversationView {
  id: string;
  created_at: string;
  preview: string;
}

export interface AcceptInboxMessageRecord {
  userId: string;
  idempotencyKey: string;
  requestHash: string;
  clientMessageId: string;
  content: string;
  conversationId: string | null;
  replyToInputRequestId: string | null;
}

export type CreateInboxConversationResult =
  | { kind: "created" | "replayed"; conversation: InboxConversationView }
  | { kind: "not_found" }
  | { kind: "idempotency_conflict" };

export interface GenerationInboxRepo {
  get(userId: string): Promise<GenerationInboxView | null>;
  acceptMessage(
    input: AcceptInboxMessageRecord,
  ): Promise<AcceptedConversationRecord>;
  listConversations(userId: string): Promise<InboxConversationView[] | null>;
  createConversation(
    userId: string,
    idempotencyKey: string,
    requestHash: string,
  ): Promise<CreateInboxConversationResult>;
  delete(userId: string): Promise<boolean>;
}

function preview(content: string | undefined): string {
  return (content ?? "").slice(0, 50);
}

export function createGenerationInboxRepo(
  prisma: PrismaClient,
): GenerationInboxRepo {
  return {
    async get(userId) {
      const inbox = await prisma.project.findFirst({
        where: {
          owner_id: BigInt(userId),
          purpose: INBOX_PURPOSE,
          is_delete: 0,
        },
      });
      if (!inbox) return null;
      const conversation = await prisma.conversations.findFirst({
        where: { project_id: inbox.id, is_delete: 0 },
        orderBy: { id: "desc" },
        select: { id: true },
      });
      return {
        project: {
          id: inbox.id.toString(),
          name: inbox.name,
          thumb: inbox.thumb,
          created_at: inbox.gmt_create.toISOString(),
          purpose: inbox.purpose,
        },
        active_conversation_id: conversation?.id.toString() ?? null,
      };
    },

    acceptMessage(input) {
      return transactionWithUniqueRetry(prisma, async (tx) => {
        let inbox = await tx.project.findFirst({
          where: {
            owner_id: BigInt(input.userId),
            purpose: INBOX_PURPOSE,
            is_delete: 0,
          },
          select: { id: true },
        });
        inbox ??= await tx.project.create({
          data: {
            owner_id: BigInt(input.userId),
            name: INBOX_NAME,
            purpose: INBOX_PURPOSE,
            inbox_guard: BigInt(input.userId),
          },
          select: { id: true },
        });
        return acceptConversationMessageInTransaction(tx, {
          ...input,
          projectId: inbox.id.toString(),
        });
      });
    },

    async listConversations(userId) {
      const inbox = await prisma.project.findFirst({
        where: {
          owner_id: BigInt(userId),
          purpose: INBOX_PURPOSE,
          is_delete: 0,
        },
        select: { id: true },
      });
      if (!inbox) return null;
      const conversations = await prisma.conversations.findMany({
        where: { project_id: inbox.id, is_delete: 0 },
        orderBy: { id: "desc" },
      });
      return Promise.all(
        conversations.map(async (conversation) => {
          const first = await prisma.conversation_messages.findFirst({
            where: {
              conversation_id: conversation.id,
              role: "user",
              is_delete: 0,
            },
            orderBy: { sequence_no: "asc" },
            select: { content: true },
          });
          return {
            id: conversation.id.toString(),
            created_at: conversation.gmt_create.toISOString(),
            preview: preview(first?.content),
          };
        }),
      );
    },

    createConversation(userId, idempotencyKey, requestHash) {
      return transactionWithUniqueRetry(prisma, async (tx) => {
        const inbox = await tx.project.findFirst({
          where: {
            owner_id: BigInt(userId),
            purpose: INBOX_PURPOSE,
            is_delete: 0,
          },
          select: { id: true },
        });
        if (!inbox) return { kind: "not_found" } as const;
        const existing = await tx.command_idempotency.findUnique({
          where: {
            project_id_operation_idempotency_key: {
              project_id: inbox.id,
              operation: CREATE_CONVERSATION_OPERATION,
              idempotency_key: idempotencyKey,
            },
          },
        });
        if (existing) {
          if (existing.request_hash !== requestHash) {
            return { kind: "idempotency_conflict" } as const;
          }
          if (existing.resource_id === null) {
            return { kind: "not_found" } as const;
          }
          const conversation = await tx.conversations.findUnique({
            where: { id: existing.resource_id },
          });
          if (!conversation) return { kind: "not_found" } as const;
          return {
            kind: "replayed",
            conversation: {
              id: conversation.id.toString(),
              created_at: conversation.gmt_create.toISOString(),
              preview: "",
            },
          } as const;
        }
        const conversation = await tx.conversations.create({
          data: { project_id: inbox.id },
        });
        const event = await appendProjectEvent(tx, {
          projectId: inbox.id.toString(),
          eventType: "conversation.created",
          aggregateType: "conversation",
          aggregateId: conversation.id.toString(),
          aggregateVersion: 0,
          correlationId: idempotencyKey,
          payload: { conversation_id: conversation.id.toString() },
        });
        await tx.command_idempotency.create({
          data: {
            project_id: inbox.id,
            operation: CREATE_CONVERSATION_OPERATION,
            idempotency_key: idempotencyKey,
            request_hash: requestHash,
            resource_id: conversation.id,
            accepted_cursor: BigInt(event.cursor),
          },
        });
        return {
          kind: "created",
          conversation: {
            id: conversation.id.toString(),
            created_at: conversation.gmt_create.toISOString(),
            preview: "",
          },
        } as const;
      });
    },

    delete(userId) {
      return prisma.$transaction(async (tx) => {
        const inbox = await tx.project.findFirst({
          where: {
            owner_id: BigInt(userId),
            purpose: INBOX_PURPOSE,
            is_delete: 0,
          },
          select: { id: true },
        });
        if (!inbox) return false;
        await tx.project.update({
          where: { id: inbox.id },
          data: { is_delete: 1, inbox_guard: null },
        });
        await Promise.all([
          tx.conversations.updateMany({
            where: { project_id: inbox.id },
            data: { is_delete: 1 },
          }),
          tx.conversation_messages.updateMany({
            where: { project_id: inbox.id },
            data: { is_delete: 1 },
          }),
          tx.agent_runs.updateMany({
            where: { project_id: inbox.id },
            data: {
              is_delete: 1,
              active_guard: null,
              status: "cancelled",
              lease_owner: null,
              lease_expires_at: null,
              fencing_token: { increment: 1n },
            },
          }),
          tx.user_input_requests.updateMany({
            where: { project_id: inbox.id },
            data: { is_delete: 1, status: "expired" },
          }),
          tx.generation_jobs.updateMany({
            where: { project_id: inbox.id },
            data: { is_delete: true, cancel_requested_at: new Date() },
          }),
          tx.assets.updateMany({
            where: { project_id: inbox.id },
            data: { is_delete: true },
          }),
          tx.canvas.updateMany({
            where: { project_id: inbox.id },
            data: { is_delete: 1 },
          }),
        ]);
        return true;
      });
    },
  };
}
