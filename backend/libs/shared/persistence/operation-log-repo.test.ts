import { describe, expect, it, vi } from "vitest";

import {
  createOperationLogRepo,
  OPERATION_STATUS_FAILED,
  OPERATION_STATUS_PENDING,
} from "./operation-log-repo.js";

function row(over: Record<string, unknown> = {}) {
  return {
    id: 1n,
    category: "account",
    action: "phone_rebind",
    target: "138****1234",
    target_user_id: 42n,
    detail: "{}",
    operator: "138****1234",
    operator_id: 42n,
    ip_address: "1.2.3.4",
    status: OPERATION_STATUS_PENDING,
    ref: "ref-1",
    gmt_create: new Date("2026-10-28T00:00:00.000Z"),
    gmt_modified: new Date("2026-10-28T00:00:00.000Z"),
    version: 0,
    is_delete: 0,
    ...over,
  };
}

function build() {
  const create = vi.fn();
  const updateMany = vi.fn();
  const findFirst = vi.fn();
  const prisma = {
    bw_operation_logs: { create, updateMany, findFirst },
  } as never;
  return { repo: createOperationLogRepo(prisma), create, updateMany, findFirst };
}

describe("operation-log-repo", () => {
  it("create 落 status/ref 并回读视图", async () => {
    const { repo, create } = build();
    create.mockResolvedValue(row());

    const view = await repo.create({
      category: "account",
      action: "phone_rebind",
      status: OPERATION_STATUS_PENDING,
      ref: "ref-1",
    });

    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        status: OPERATION_STATUS_PENDING,
        ref: "ref-1",
      }),
    });
    expect(view).toMatchObject({
      status: OPERATION_STATUS_PENDING,
      ref: "ref-1",
      targetUserId: "42",
    });
  });

  it("finishByRef 命中返回 true，未命中返回 false", async () => {
    const { repo, updateMany } = build();
    updateMany
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 0 });

    await expect(
      repo.finishByRef("ref-1", {
        status: OPERATION_STATUS_FAILED,
        detail: "{}",
      }),
    ).resolves.toBe(true);
    await expect(
      repo.finishByRef("ref-1", { status: OPERATION_STATUS_FAILED }),
    ).resolves.toBe(false);
    expect(updateMany).toHaveBeenCalledWith({
      where: { ref: "ref-1", is_delete: 0 },
      data: expect.objectContaining({
        status: OPERATION_STATUS_FAILED,
        detail: "{}",
      }),
    });
  });

  it("findByRef 可按账号收窄，避免跨账号同 ref 命中", async () => {
    const { repo, findFirst } = build();
    findFirst.mockResolvedValue(row());

    await repo.findByRef("ref-1", "42");
    expect(findFirst).toHaveBeenCalledWith({
      where: { ref: "ref-1", is_delete: 0, target_user_id: 42n },
    });

    findFirst.mockClear();
    await repo.findByRef("ref-1");
    expect(findFirst).toHaveBeenCalledWith({
      where: { ref: "ref-1", is_delete: 0 },
    });
  });
});
