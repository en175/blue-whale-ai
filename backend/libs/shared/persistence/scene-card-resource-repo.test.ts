import type { PrismaClient } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import { createSceneCardResourceRepo } from "./scene-card-resource-repo.js";

function repoWith(overrides: Record<string, Record<string, unknown>>) {
  const tx = {
    project: {
      findFirst: vi.fn().mockResolvedValue({ id: 42n }),
      ...overrides.project,
    },
    scene_cards: {
      findFirst: vi.fn(),
      updateMany: vi.fn(),
      ...overrides.scene_cards,
    },
    project_command_receipts: {
      findUnique: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({}),
      ...overrides.project_command_receipts,
    },
  };
  const prisma = {
    $transaction: vi.fn(
      async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx),
    ),
  } as unknown as PrismaClient;
  return { repo: createSceneCardResourceRepo(prisma), tx };
}

describe("SceneCardResourceRepo", () => {
  it("按归属读取场景卡并返回删除所需版本", async () => {
    const { repo, tx } = repoWith({
      scene_cards: {
        findFirst: vi.fn().mockResolvedValue({
          id: 5001n,
          project_id: 42n,
          title: "海边开场",
          summary: "蓝鲸跃出海面",
          content_markdown: "# 开场",
          version: 3,
        }),
      },
    });

    await expect(
      repo.getSceneCardResource("100", "5001"),
    ).resolves.toMatchObject({
      kind: "found",
      scene_card_id: "5001",
      project_id: "42",
      version: 3,
    });
    expect(tx.project.findFirst).toHaveBeenCalledWith({
      where: { id: 42n, owner_id: 100n, is_delete: 0 },
      select: { id: true },
    });
  });

  it("按 If-Match 版本软删除并记录幂等键", async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const { repo, tx } = repoWith({
      scene_cards: {
        findFirst: vi.fn().mockResolvedValue({
          id: 5001n,
          project_id: 42n,
          version: 3,
          is_delete: 0,
        }),
        updateMany,
      },
    });

    await expect(
      repo.deleteSceneCardResource({
        userId: "100",
        sceneCardId: "5001",
        expectedVersion: 3,
        idempotencyKey: "delete-1",
        requestHash: "b".repeat(64),
      }),
    ).resolves.toEqual({ kind: "deleted" });
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: 5001n, version: 3, is_delete: 0 },
      data: {
        is_delete: 1,
        version: { increment: 1 },
        gmt_modified: expect.any(Date),
      },
    });
    expect(tx.project_command_receipts.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        project_id: 42n,
        operation: "scene_card.delete",
        idempotency_key: "delete-1",
        resource_id: 5001n,
      }),
    });
  });

  it("相同删除命令重放时不重复写数据库", async () => {
    const updateMany = vi.fn();
    const { repo, tx } = repoWith({
      scene_cards: {
        findFirst: vi.fn().mockResolvedValue({
          id: 5001n,
          project_id: 42n,
          version: 4,
          is_delete: 1,
        }),
        updateMany,
      },
      project_command_receipts: {
        findUnique: vi.fn().mockResolvedValue({
          request_hash: "b".repeat(64),
          resource_id: 5001n,
        }),
      },
    });

    await expect(
      repo.deleteSceneCardResource({
        userId: "100",
        sceneCardId: "5001",
        expectedVersion: 3,
        idempotencyKey: "delete-1",
        requestHash: "b".repeat(64),
      }),
    ).resolves.toEqual({ kind: "replayed" });
    expect(updateMany).not.toHaveBeenCalled();
    expect(tx.project_command_receipts.create).not.toHaveBeenCalled();
  });

  it("If-Match 版本过期时零写入", async () => {
    const updateMany = vi.fn();
    const { repo, tx } = repoWith({
      scene_cards: {
        findFirst: vi.fn().mockResolvedValue({
          id: 5001n,
          project_id: 42n,
          version: 4,
          is_delete: 0,
        }),
        updateMany,
      },
    });

    await expect(
      repo.deleteSceneCardResource({
        userId: "100",
        sceneCardId: "5001",
        expectedVersion: 3,
        idempotencyKey: "delete-2",
        requestHash: "c".repeat(64),
      }),
    ).resolves.toEqual({ kind: "version_conflict", current_version: 4 });
    expect(updateMany).not.toHaveBeenCalled();
    expect(tx.project_command_receipts.create).not.toHaveBeenCalled();
  });

  it("CAS 更新被并发请求抢先时返回数据库中的最新版本", async () => {
    const { repo } = repoWith({
      scene_cards: {
        findFirst: vi
          .fn()
          .mockResolvedValueOnce({
            id: 5001n,
            project_id: 42n,
            version: 3,
            is_delete: 0,
          })
          .mockResolvedValueOnce({ version: 4 }),
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      },
    });

    await expect(
      repo.deleteSceneCardResource({
        userId: "100",
        sceneCardId: "5001",
        expectedVersion: 3,
        idempotencyKey: "delete-race",
        requestHash: "d".repeat(64),
      }),
    ).resolves.toEqual({ kind: "version_conflict", current_version: 4 });
  });

  it("越权删除他人资源返回 not_found，零写入且不泄漏存在性", async () => {
    const updateMany = vi.fn();
    const idempotencyCreate = vi.fn();
    const { repo, tx } = repoWith({
      scene_cards: {
        findFirst: vi.fn().mockResolvedValue({
          id: 5001n,
          project_id: 42n,
          version: 3,
          is_delete: 0,
        }),
        updateMany,
      },
      project: { findFirst: vi.fn().mockResolvedValue(null) },
      project_command_receipts: {
        findUnique: vi.fn().mockResolvedValue(null),
        create: idempotencyCreate,
      },
    });

    await expect(
      repo.deleteSceneCardResource({
        userId: "200",
        sceneCardId: "5001",
        expectedVersion: 3,
        idempotencyKey: "delete-forbidden",
        requestHash: "e".repeat(64),
      }),
    ).resolves.toEqual({ kind: "not_found" });
    expect(tx.project.findFirst).toHaveBeenCalledWith({
      where: { id: 42n, owner_id: 200n, is_delete: 0 },
      select: { id: true },
    });
    expect(updateMany).not.toHaveBeenCalled();
    expect(idempotencyCreate).not.toHaveBeenCalled();
  });

  it("越权读取他人资源返回 not_found，不泄漏存在性", async () => {
    const { repo, tx } = repoWith({
      scene_cards: {
        findFirst: vi.fn().mockResolvedValue({
          id: 5001n,
          project_id: 42n,
          title: "他人场景卡",
          summary: null,
          content_markdown: "# 不可见",
          version: 3,
        }),
      },
      project: { findFirst: vi.fn().mockResolvedValue(null) },
    });

    await expect(
      repo.getSceneCardResource("200", "5001"),
    ).resolves.toEqual({ kind: "not_found" });
    expect(tx.project.findFirst).toHaveBeenCalledWith({
      where: { id: 42n, owner_id: 200n, is_delete: 0 },
      select: { id: true },
    });
  });
});
