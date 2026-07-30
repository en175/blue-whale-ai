import type { PrismaClient } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import { createProjectRepo } from "./project-repo.js";

describe("ProjectRepo GenerationInbox isolation", () => {
  it("lists only ordinary canvas projects", async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const prisma = { project: { findMany } } as unknown as PrismaClient;

    await createProjectRepo(prisma).listByOwner("100");

    expect(findMany).toHaveBeenCalledWith({
      where: {
        owner_id: 100n,
        purpose: "canvas",
        is_delete: 0,
      },
      orderBy: { gmt_modified: "desc" },
    });
  });

  it("checks owner and canvas purpose in the update predicate before renaming", async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 0 });
    const findFirst = vi.fn();
    const prisma = {
      project: { updateMany, findFirst },
    } as unknown as PrismaClient;

    await expect(
      createProjectRepo(prisma).rename("42", "100", "新名称"),
    ).resolves.toBeNull();
    expect(updateMany).toHaveBeenCalledWith({
      where: {
        id: 42n,
        owner_id: 100n,
        purpose: "canvas",
        is_delete: 0,
      },
      data: { name: "新名称" },
    });
    expect(findFirst).not.toHaveBeenCalled();
  });
});
