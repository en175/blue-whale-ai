import type { PrismaClient } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import {
  appendProjectEvent,
  createProductEventRepo,
} from "./product-event-repo.js";

describe("ProductEventRepo", () => {
  it("allocates a snowflake cursor (no project_event_stream lock) and persists the event in the caller transaction", async () => {
    const create = vi.fn().mockImplementation(({ data }) => ({
      id: 9n,
      gmt_create: new Date("2026-07-29T00:00:00.000Z"),
      ...data,
    }));
    const streamUpsert = vi.fn();
    const streamUpdate = vi.fn();
    const tx = {
      project_event_stream: { upsert: streamUpsert, update: streamUpdate },
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

    // 关键：cursor 用雪花，不再碰 project_event_stream（去掉了那把 per-project 行锁）
    expect(streamUpsert).not.toHaveBeenCalled();
    expect(streamUpdate).not.toHaveBeenCalled();
    const cursor = BigInt(event.cursor);
    expect(cursor).toBeGreaterThan(0n);
    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        project_id: 42n,
        cursor,
        event_type: "conversation.message_accepted",
        aggregate_type: "conversation",
        aggregate_id: "7",
        aggregate_version: 1,
        correlation_id: "cmd_1",
        payload: { message_id: "8" },
      }),
    });
    expect(event.event_id).toMatch(/^evt_[0-9a-f]{32}$/);
  });

  it("连续分配的 cursor 两两不同（雪花全局唯一，不撞 uk_project_cursor）", async () => {
    const create = vi.fn().mockImplementation(({ data }) => ({
      id: 9n,
      gmt_create: new Date(),
      ...data,
    }));
    const tx = { project_events: { create } };
    const cursors = new Set<string>();
    for (let i = 0; i < 1000; i += 1) {
      const e = await appendProjectEvent(tx as never, {
        projectId: "42",
        eventType: "t",
        aggregateType: "a",
        aggregateId: String(i),
        aggregateVersion: 0,
        payload: {},
      });
      cursors.add(e.cursor);
    }
    expect(cursors.size).toBe(1000);
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
    const aggregate = vi.fn().mockResolvedValue({ _max: { cursor: 8n } });
    const prisma = {
      project_events: { findMany, aggregate },
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
