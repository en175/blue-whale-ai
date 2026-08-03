import type { PrismaClient } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import { createConversationRepo } from "./conversation-repo.js";

describe("ConversationRepo.acceptMessage", () => {
  it("atomically persists a sequenced message, queued run, events, and receipt", async () => {
    const tx = {
      project: {
        findFirst: vi.fn().mockResolvedValue({ id: 42n }),
      },
      command_idempotency: {
        findUnique: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockImplementation(({ data }) => data),
      },
      conversations: {
        findFirst: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue({ id: 7n, project_id: 42n }),
        update: vi.fn().mockResolvedValue({ id: 7n, version: 1 }),
      },
      agent_runs: {
        findFirst: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue({
          id: 9n,
          project_id: 42n,
          conversation_id: 7n,
          active_guard: 7n,
          status: "queued",
          stage: "understanding",
          version: 0,
        }),
      },
      conversation_messages: {
        create: vi.fn().mockResolvedValue({
          id: 8n,
          conversation_id: 7n,
          project_id: 42n,
          agent_run_id: 9n,
          client_message_id: "client-1",
          role: "user",
          content: "做一张蓝鲸海报",
          sequence_no: 1,
          gmt_create: new Date("2026-07-29T00:00:00.000Z"),
        }),
      },
      project_event_stream: {
        upsert: vi.fn(),
        update: vi
          .fn()
          .mockResolvedValueOnce({ high_watermark: 1n })
          .mockResolvedValueOnce({ high_watermark: 2n }),
      },
      project_events: {
        create: vi.fn().mockImplementation(({ data }) => ({
          id: 1n,
          gmt_create: new Date("2026-07-29T00:00:00.000Z"),
          ...data,
        })),
      },
    };
    const transaction = vi.fn(async (callback) => callback(tx));
    const prisma = { $transaction: transaction } as unknown as PrismaClient;

    const result = await createConversationRepo(prisma).acceptMessage({
      userId: "100",
      projectId: "42",
      idempotencyKey: "cmd-1",
      requestHash: "a".repeat(64),
      clientMessageId: "client-1",
      content: "做一张蓝鲸海报",
      conversationId: null,
      replyToInputRequestId: null,
      skillSummarize: false,
    });

    expect(result).toEqual({
      kind: "accepted",
      project_id: "42",
      conversation_id: "7",
      message_id: "8",
      agent_run_id: "9",
      cursor: expect.any(String),
      sequence_no: 1,
    });
    expect(transaction).toHaveBeenCalledTimes(1);
    expect(tx.conversations.update).toHaveBeenCalledWith({
      where: { id: 7n },
      data: { version: { increment: 1 } },
      select: { id: true, version: true },
    });
    expect(tx.conversation_messages.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        sequence_no: 1,
        agent_run_id: 9n,
        content: "做一张蓝鲸海报",
      }),
    });
    expect(tx.agent_runs.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        conversation_id: 7n,
        active_guard: 7n,
        status: "queued",
      }),
    });
    expect(tx.command_idempotency.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        project_id: 42n,
        operation: "conversation.message.accept",
        idempotency_key: "cmd-1",
        accepted_cursor: expect.any(BigInt),
      }),
    });
  });

  it("returns the first receipt for an identical replay and rejects a changed request", async () => {
    const receipt = {
      request_hash: "a".repeat(64),
      message_id: 8n,
      agent_run_id: 9n,
      resource_id: 7n,
      accepted_cursor: 2n,
    };
    const tx = {
      project: { findFirst: vi.fn().mockResolvedValue({ id: 42n }) },
      command_idempotency: { findUnique: vi.fn().mockResolvedValue(receipt) },
      conversation_messages: {
        findUnique: vi.fn().mockResolvedValue({ sequence_no: 1 }),
      },
    };
    const prisma = {
      $transaction: vi.fn(async (callback) => callback(tx)),
    } as unknown as PrismaClient;
    const repo = createConversationRepo(prisma);
    const base = {
      userId: "100",
      projectId: "42",
      idempotencyKey: "cmd-1",
      requestHash: "a".repeat(64),
      clientMessageId: "client-1",
      content: "做一张蓝鲸海报",
      conversationId: null,
      replyToInputRequestId: null,
      skillSummarize: false,
    };

    await expect(repo.acceptMessage(base)).resolves.toEqual({
      kind: "replayed",
      project_id: "42",
      conversation_id: "7",
      message_id: "8",
      agent_run_id: "9",
      cursor: "2",
      sequence_no: 1,
    });
    await expect(
      repo.acceptMessage({ ...base, requestHash: "b".repeat(64) }),
    ).resolves.toEqual({ kind: "idempotency_conflict" });
  });

  it("retries the transaction after a concurrent idempotency unique conflict", async () => {
    const replayed = {
      kind: "replayed",
      project_id: "42",
      conversation_id: "7",
      message_id: "8",
      agent_run_id: "9",
      cursor: "2",
      sequence_no: 1,
    } as const;
    const transaction = vi
      .fn()
      .mockRejectedValueOnce({ code: "P2002" })
      .mockResolvedValueOnce(replayed);
    const prisma = { $transaction: transaction } as unknown as PrismaClient;

    await expect(
      createConversationRepo(prisma).acceptMessage({
        userId: "100",
        projectId: "42",
        idempotencyKey: "cmd-1",
        requestHash: "a".repeat(64),
        clientMessageId: "client-1",
        content: "蓝鲸海报",
        conversationId: null,
        replyToInputRequestId: null,
        skillSummarize: false,
      }),
    ).resolves.toEqual(replayed);
    expect(transaction).toHaveBeenCalledTimes(2);
  });

  it("locks an active run before attaching a later message", async () => {
    const running = {
      id: 9n,
      project_id: 42n,
      conversation_id: 7n,
      user_id: 100n,
      active_guard: 7n,
      status: "running",
      stage: "responding",
      version: 3,
    };
    const tx = {
      project: { findFirst: vi.fn().mockResolvedValue({ id: 42n }) },
      command_idempotency: {
        findUnique: vi.fn().mockResolvedValue(null),
        create: vi.fn(),
      },
      conversations: {
        findFirst: vi.fn().mockResolvedValue({ id: 7n, project_id: 42n }),
        update: vi.fn().mockResolvedValue({ id: 7n, version: 2 }),
      },
      agent_runs: {
        findFirst: vi.fn().mockResolvedValue(running),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        findUnique: vi.fn().mockResolvedValue(running),
        create: vi.fn(),
      },
      conversation_messages: {
        create: vi.fn().mockResolvedValue({
          id: 10n,
          conversation_id: 7n,
          project_id: 42n,
          agent_run_id: 9n,
          role: "user",
          content: "再加一只蓝鲸",
          sequence_no: 2,
        }),
      },
      project_event_stream: {
        upsert: vi.fn(),
        update: vi.fn().mockResolvedValue({ high_watermark: 3n }),
      },
      project_events: {
        create: vi.fn().mockImplementation(({ data }) => ({
          id: 3n,
          gmt_create: new Date("2026-07-29T00:00:00.000Z"),
          ...data,
        })),
      },
    };
    const prisma = {
      $transaction: vi.fn(async (callback) => callback(tx)),
    } as unknown as PrismaClient;

    await expect(
      createConversationRepo(prisma).acceptMessage({
        userId: "100",
        projectId: "42",
        idempotencyKey: "cmd-2",
        requestHash: "b".repeat(64),
        clientMessageId: "client-2",
        content: "再加一只蓝鲸",
        conversationId: "7",
        replyToInputRequestId: null,
        skillSummarize: false,
      }),
    ).resolves.toEqual(
      expect.objectContaining({ kind: "accepted", agent_run_id: "9" }),
    );

    expect(tx.agent_runs.updateMany).toHaveBeenCalledWith({
      where: {
        id: 9n,
        version: 3,
        status: { in: [...ACTIVE_RUN_STATUSES_FOR_TEST] },
        active_guard: 7n,
        is_delete: 0,
      },
      data: { status: "running" },
    });
    expect(tx.agent_runs.create).not.toHaveBeenCalled();
  });

  it("emits the input-answered event in the message acceptance transaction", async () => {
    const run = {
      id: 9n,
      project_id: 42n,
      conversation_id: 7n,
      user_id: 100n,
      active_guard: 7n,
      status: "awaiting_input",
      stage: "clarifying",
      version: 2,
    };
    const createEvent = vi.fn().mockImplementation(({ data }) => ({
      id: 11n,
      gmt_create: new Date("2026-07-29T00:00:00.000Z"),
      ...data,
    }));
    const tx = {
      project: { findFirst: vi.fn().mockResolvedValue({ id: 42n }) },
      command_idempotency: {
        findUnique: vi.fn().mockResolvedValue(null),
        create: vi.fn(),
      },
      conversations: {
        findFirst: vi.fn().mockResolvedValue({ id: 7n, project_id: 42n }),
        update: vi.fn().mockResolvedValue({ id: 7n, version: 2 }),
      },
      agent_runs: {
        findFirst: vi.fn().mockResolvedValue(run),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        findUnique: vi.fn().mockResolvedValue({
          ...run,
          status: "queued",
          version: 3,
        }),
      },
      user_input_requests: {
        findFirst: vi.fn().mockResolvedValue({
          id: 12n,
          source_agent_run_id: 9n,
        }),
        update: vi.fn(),
      },
      conversation_messages: {
        create: vi.fn().mockResolvedValue({
          id: 10n,
          conversation_id: 7n,
          project_id: 42n,
          agent_run_id: 9n,
          role: "user",
          content: "极简风格",
          sequence_no: 2,
        }),
      },
      project_event_stream: {
        upsert: vi.fn(),
        update: vi
          .fn()
          .mockResolvedValueOnce({ high_watermark: 3n })
          .mockResolvedValueOnce({ high_watermark: 4n }),
      },
      project_events: { create: createEvent },
    };
    const prisma = {
      $transaction: vi.fn(async (callback) => callback(tx)),
    } as unknown as PrismaClient;

    await createConversationRepo(prisma).acceptMessage({
      userId: "100",
      projectId: "42",
      idempotencyKey: "cmd-answer",
      requestHash: "c".repeat(64),
      clientMessageId: "client-answer",
      content: "极简风格",
      conversationId: "7",
      replyToInputRequestId: "12",
      skillSummarize: false,
    });

    expect(createEvent).toHaveBeenLastCalledWith({
      data: expect.objectContaining({
        event_type: "agent_run.user_input_answered",
        payload: expect.objectContaining({
          input_request_id: "12",
          answer_message_id: "10",
          status: "answered",
        }),
      }),
    });
  });

  // 总结当前对话意图持久化（IK60X1，契约 §15.2）：接纳 skill_summarize=true 的消息
  // 把所属 agent_runs 行打上总结意图标记——新建 Run 直接置位，复用活动 Run 随 updateMany 置位。
  it("新建 Run 时按本条消息意图写入 skill_summarize", async () => {
    const tx = {
      project: { findFirst: vi.fn().mockResolvedValue({ id: 42n }) },
      command_idempotency: {
        findUnique: vi.fn().mockResolvedValue(null),
        create: vi.fn(),
      },
      conversations: {
        findFirst: vi.fn().mockResolvedValue({ id: 7n, project_id: 42n }),
        update: vi.fn().mockResolvedValue({ id: 7n, version: 1 }),
      },
      agent_runs: {
        findFirst: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue({
          id: 9n,
          project_id: 42n,
          conversation_id: 7n,
          active_guard: 7n,
          status: "queued",
          stage: "understanding",
          version: 0,
        }),
      },
      conversation_messages: {
        create: vi.fn().mockResolvedValue({ id: 8n, sequence_no: 1 }),
      },
      project_event_stream: {
        upsert: vi.fn(),
        update: vi
          .fn()
          .mockResolvedValueOnce({ high_watermark: 1n })
          .mockResolvedValueOnce({ high_watermark: 2n }),
      },
      project_events: {
        create: vi.fn().mockImplementation(({ data }) => ({
          id: 1n,
          gmt_create: new Date("2026-07-29T00:00:00.000Z"),
          ...data,
        })),
      },
    };
    const prisma = {
      $transaction: vi.fn(async (callback) => callback(tx)),
    } as unknown as PrismaClient;

    await createConversationRepo(prisma).acceptMessage({
      userId: "100",
      projectId: "42",
      idempotencyKey: "cmd-sum",
      requestHash: "d".repeat(64),
      clientMessageId: "client-sum",
      content: "总结当前对话并保存为我的技能",
      conversationId: "7",
      replyToInputRequestId: null,
      skillSummarize: true,
    });

    expect(tx.agent_runs.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ skill_summarize: true }),
    });
  });

  it("复用活动 Run 且本条消息带意图 → updateMany 置位 skill_summarize", async () => {
    const running = {
      id: 9n,
      project_id: 42n,
      conversation_id: 7n,
      user_id: 100n,
      active_guard: 7n,
      status: "running",
      stage: "responding",
      version: 3,
    };
    const tx = {
      project: { findFirst: vi.fn().mockResolvedValue({ id: 42n }) },
      command_idempotency: {
        findUnique: vi.fn().mockResolvedValue(null),
        create: vi.fn(),
      },
      conversations: {
        findFirst: vi.fn().mockResolvedValue({ id: 7n, project_id: 42n }),
        update: vi.fn().mockResolvedValue({ id: 7n, version: 2 }),
      },
      agent_runs: {
        findFirst: vi.fn().mockResolvedValue(running),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        findUnique: vi.fn().mockResolvedValue(running),
        create: vi.fn(),
      },
      conversation_messages: {
        create: vi.fn().mockResolvedValue({ id: 10n, sequence_no: 2 }),
      },
      project_event_stream: {
        upsert: vi.fn(),
        update: vi.fn().mockResolvedValue({ high_watermark: 3n }),
      },
      project_events: {
        create: vi.fn().mockImplementation(({ data }) => ({
          id: 3n,
          gmt_create: new Date("2026-07-29T00:00:00.000Z"),
          ...data,
        })),
      },
    };
    const prisma = {
      $transaction: vi.fn(async (callback) => callback(tx)),
    } as unknown as PrismaClient;

    await createConversationRepo(prisma).acceptMessage({
      userId: "100",
      projectId: "42",
      idempotencyKey: "cmd-sum-2",
      requestHash: "e".repeat(64),
      clientMessageId: "client-sum-2",
      content: "总结当前对话并保存为我的技能",
      conversationId: "7",
      replyToInputRequestId: null,
      skillSummarize: true,
    });

    expect(tx.agent_runs.updateMany).toHaveBeenCalledWith({
      where: expect.objectContaining({ id: 9n }),
      data: { status: "running", skill_summarize: true },
    });
    expect(tx.agent_runs.create).not.toHaveBeenCalled();
  });
});

const ACTIVE_RUN_STATUSES_FOR_TEST = [
  "queued",
  "running",
  "awaiting_input",
  "awaiting_job",
] as const;
