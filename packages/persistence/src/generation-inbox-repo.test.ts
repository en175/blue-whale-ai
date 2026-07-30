import type { PrismaClient } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import { createGenerationInboxRepo } from "./generation-inbox-repo.js";

describe("GenerationInboxRepo", () => {
  it("creates the unique inbox and accepts its first message in one transaction", async () => {
    const tx = {
      project: {
        findFirst: vi
          .fn()
          .mockResolvedValueOnce(null)
          .mockResolvedValueOnce({ id: 42n }),
        create: vi.fn().mockResolvedValue({ id: 42n }),
      },
      command_idempotency: {
        findUnique: vi.fn().mockResolvedValue(null),
        create: vi.fn(),
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
          role: "user",
          content: "生成蓝鲸海报",
          sequence_no: 1,
          gmt_create: new Date(),
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
          gmt_create: new Date(),
          ...data,
        })),
      },
    };
    const prisma = {
      $transaction: vi.fn(async (callback) => callback(tx)),
    } as unknown as PrismaClient;

    const result = await createGenerationInboxRepo(prisma).acceptMessage({
      userId: "100",
      idempotencyKey: "cmd-1",
      requestHash: "a".repeat(64),
      clientMessageId: "client-1",
      content: "生成蓝鲸海报",
      conversationId: null,
      replyToInputRequestId: null,
    });

    expect(tx.project.create).toHaveBeenCalledWith({
      data: {
        owner_id: 100n,
        name: "生成收件箱",
        purpose: "generation_inbox",
        inbox_guard: 100n,
      },
      select: { id: true },
    });
    expect(result).toEqual(
      expect.objectContaining({
        kind: "accepted",
        project_id: "42",
        conversation_id: "7",
        message_id: "8",
      }),
    );
    expect(tx.agent_runs.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ active_guard: 7n }),
    });
  });

  it("GET is read-only and reports absence without creating a project", async () => {
    const findFirst = vi.fn().mockResolvedValue(null);
    const prisma = { project: { findFirst } } as unknown as PrismaClient;

    await expect(
      createGenerationInboxRepo(prisma).get("100"),
    ).resolves.toBeNull();
    expect(findFirst).toHaveBeenCalledTimes(1);
  });

  it("retries the whole transaction after a concurrent first-inbox unique conflict", async () => {
    const replayed = {
      kind: "replayed",
      project_id: "42",
      conversation_id: "7",
      message_id: "8",
      agent_run_id: "9",
      cursor: "2",
      sequence_no: 1,
    };
    const transaction = vi
      .fn()
      .mockRejectedValueOnce({ code: "P2002" })
      .mockResolvedValueOnce(replayed);
    const prisma = { $transaction: transaction } as unknown as PrismaClient;

    await expect(
      createGenerationInboxRepo(prisma).acceptMessage({
        userId: "100",
        idempotencyKey: "cmd-1",
        requestHash: "a".repeat(64),
        clientMessageId: "client-1",
        content: "生成蓝鲸海报",
        conversationId: null,
        replyToInputRequestId: null,
      }),
    ).resolves.toEqual(replayed);
    expect(transaction).toHaveBeenCalledTimes(2);
  });
});
