import type { PrismaClient } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import { createSnapshotRepo } from "./snapshot-repo.js";

describe("SnapshotRepo.loadJobsAndAssets", () => {
  it("does not expose the encrypted provider credential in snapshot input", async () => {
    const prisma = {
      generation_jobs: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 300n,
            type: "video",
            source: "bottom_dock",
            status: "processing",
            progress: 10,
            input: {
              prompt: "鲸鱼游动",
              provider_credential: "sealed-token",
            },
            output_asset_ids: [],
            error: null,
          },
        ]),
      },
      assets: { findMany: vi.fn().mockResolvedValue([]) },
    } as unknown as PrismaClient;

    const result = await createSnapshotRepo(prisma).loadJobsAndAssets("55");

    expect(result.generation_jobs[0]?.input).toEqual({ prompt: "鲸鱼游动" });
  });

  it("returns normal uploaded project assets even when no generation job produced them", async () => {
    const findJobs = vi.fn().mockResolvedValue([]);
    const findAssets = vi.fn().mockResolvedValue([
      {
        id: 200n,
        project_id: 55n,
        type: "image",
        url: "tos://project/55/200.png",
      },
      {
        id: 201n,
        project_id: 55n,
        type: "image",
        url: "tos://project/55/201.png",
      },
    ]);
    const prisma = {
      generation_jobs: { findMany: findJobs },
      assets: { findMany: findAssets },
    } as unknown as PrismaClient;

    const result = await createSnapshotRepo(prisma).loadJobsAndAssets("55");

    expect(findAssets).toHaveBeenCalledTimes(1);
    expect(findAssets).toHaveBeenCalledWith({
      where: { project_id: 55n, status: "normal", is_delete: false },
    });
    expect(result.assets).toEqual([
      {
        id: "200",
        project_id: "55",
        type: "image",
        url: "tos://project/55/200.png",
      },
      {
        id: "201",
        project_id: "55",
        type: "image",
        url: "tos://project/55/201.png",
      },
    ]);
  });
});

describe("SnapshotRepo.loadConversationState", () => {
  it("returns persisted messages, runs, active input requests, and the real high-watermark", async () => {
    const findInputRequests = vi.fn().mockResolvedValue([
      {
        id: 10n,
        source_agent_run_id: 9n,
        request_type: "creation_clarification",
        question: "需要什么风格？",
        status: "pending",
        expires_at: new Date("2026-07-30T00:00:00.000Z"),
      },
    ]);
    const prisma = {
      conversation_messages: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 8n,
            conversation_id: 7n,
            agent_run_id: 9n,
            role: "user",
            content: "蓝鲸海报",
            sequence_no: 1,
            gmt_create: new Date("2026-07-29T00:00:00.000Z"),
          },
        ]),
      },
      agent_runs: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 9n,
            conversation_id: 7n,
            status: "awaiting_input",
            stage: "clarifying",
            version: 2,
          },
        ]),
      },
      user_input_requests: {
        findMany: findInputRequests,
      },
      project_events: {
        findMany: vi.fn().mockResolvedValue([]),
        aggregate: vi.fn().mockResolvedValue({ _max: { cursor: 12n } }),
      },
    } as unknown as PrismaClient;

    await expect(
      createSnapshotRepo(prisma).loadConversationState("42"),
    ).resolves.toEqual({
      conversation_messages: [
        expect.objectContaining({ message_id: "8", sequence_no: 1 }),
      ],
      agent_runs: [
        expect.objectContaining({
          agent_run_id: "9",
          active_input_request: expect.objectContaining({
            input_request_id: "10",
          }),
        }),
      ],
      high_watermark_cursor: "12",
    });
    expect(findInputRequests).toHaveBeenCalledWith({
      where: {
        project_id: 42n,
        status: "pending",
        expires_at: { gt: expect.any(Date) },
        is_delete: 0,
      },
      orderBy: { id: "asc" },
    });
  });
});
