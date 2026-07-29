import type { PrismaClient } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import {
  appendProjectEvent,
  createProductEventRepo,
} from "./product-event-repo.js";

describe("ProductEventRepo", () => {
  it("allocates the next project cursor and persists the event in the caller transaction", async () => {
    const upsert = vi.fn().mockResolvedValue({ high_watermark: 4n });
    const update = vi.fn().mockResolvedValue({ high_watermark: 5n });
    const create = vi.fn().mockImplementation(({ data }) => ({
      id: 9n,
      gmt_create: new Date("2026-07-29T00:00:00.000Z"),
      ...data,
    }));
    const tx = {
      project_event_stream: { upsert, update },
      project_events: { create },
    };

    const event = await appendProjectEvent(tx as never, {
      projectId: "42",
      eventType: "conversation.message_accepted",
      aggregateType: "conversation",
      aggregateId: "7",
      aggregateVersion: 1,
      correlationId: "cmd_1",
      payload: { message_id: "8" },
    });

    expect(upsert).toHaveBeenCalledWith({
      where: { project_id: 42n },
      create: { project_id: 42n, high_watermark: 0n },
      update: {},
    });
    expect(update).toHaveBeenCalledWith({
      where: { project_id: 42n },
      data: { high_watermark: { increment: 1n } },
      select: { high_watermark: true },
    });
    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        project_id: 42n,
        cursor: 5n,
        event_type: "conversation.message_accepted",
        aggregate_type: "conversation",
        aggregate_id: "7",
        aggregate_version: 1,
        correlation_id: "cmd_1",
        payload: { message_id: "8" },
      }),
    });
    expect(event.cursor).toBe("5");
    expect(event.event_id).toMatch(/^evt_[0-9a-f]{32}$/);
  });

  it("lists replay events in cursor order and returns the project high-watermark", async () => {
    const findMany = vi.fn().mockResolvedValue([
      {
        event_id: "evt_1",
        event_type: "agent_run.completed",
        cursor: 8n,
        project_id: 42n,
        aggregate_type: "agent_run",
        aggregate_id: "3",
        aggregate_version: 2,
        correlation_id: null,
        causation_id: null,
        occurred_at: new Date("2026-07-29T00:00:00.000Z"),
        payload: { status: "completed" },
      },
    ]);
    const findUnique = vi.fn().mockResolvedValue({ high_watermark: 8n });
    const prisma = {
      project_events: { findMany },
      project_event_stream: { findUnique },
    } as unknown as PrismaClient;
    const repo = createProductEventRepo(prisma);

    await expect(repo.listAfter("42", "7", 100)).resolves.toEqual([
      expect.objectContaining({ event_id: "evt_1", cursor: "8" }),
    ]);
    await expect(repo.highWatermark("42")).resolves.toBe("8");
    expect(findMany).toHaveBeenCalledWith({
      where: { project_id: 42n, cursor: { gt: 7n }, is_delete: 0 },
      orderBy: { cursor: "asc" },
      take: 100,
    });
  });
});
