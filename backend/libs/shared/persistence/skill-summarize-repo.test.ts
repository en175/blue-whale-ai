import type { PrismaClient } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import { createSkillSummarizeRepo } from "./skill-summarize-repo.js";

// 总结当前对话待确认会话（IK60X1，契约 §15.4）：归属 conversation + user；
// 同一会话至多一条 pending（uk on conversation_id，upsert 覆盖旧记录）；
// 读路径容错（旧库缺表 → null/[]），写路径失败直接抛错。
describe("SkillSummarizeRepo", () => {
  it("findPending 命中 pending 记录返回草稿与提议名", async () => {
    const prisma = {
      skill_summarize_session: {
        findFirst: vi.fn().mockResolvedValue({
          draft_content: "---\nname: 周报\ndescription: d\n---\n\n正文",
          proposed_name: "周报助手",
        }),
      },
    } as unknown as PrismaClient;

    const repo = createSkillSummarizeRepo(prisma);
    await expect(
      repo.findPending({ conversationId: "7", userId: "100" }),
    ).resolves.toEqual({
      draftContent: "---\nname: 周报\ndescription: d\n---\n\n正文",
      proposedName: "周报助手",
    });
    expect(prisma.skill_summarize_session.findFirst).toHaveBeenCalledWith({
      where: {
        conversation_id: 7n,
        user_id: 100n,
        status: "pending_name_confirm",
        is_delete: 0,
      },
      select: { draft_content: true, proposed_name: true },
    });
  });

  it("findPending 无记录或表缺失 → null（读路径容错）", async () => {
    const missing = {
      skill_summarize_session: {
        findFirst: vi.fn().mockResolvedValue(null),
      },
    } as unknown as PrismaClient;
    await expect(
      createSkillSummarizeRepo(missing).findPending({
        conversationId: "7",
        userId: "100",
      }),
    ).resolves.toBeNull();

    const broken = {
      skill_summarize_session: {
        findFirst: vi.fn().mockRejectedValue(new Error("no such table")),
      },
    } as unknown as PrismaClient;
    await expect(
      createSkillSummarizeRepo(broken).findPending({
        conversationId: "7",
        userId: "100",
      }),
    ).resolves.toBeNull();
  });

  it("upsertPending 以 conversation_id 为唯一键覆盖旧记录（新冲突覆盖）", async () => {
    const upsert = vi.fn().mockResolvedValue({});
    const prisma = {
      skill_summarize_session: { upsert },
    } as unknown as PrismaClient;

    await createSkillSummarizeRepo(prisma).upsertPending({
      conversationId: "7",
      userId: "100",
      draftContent: "草稿v2",
      proposedName: "新名",
    });

    expect(upsert).toHaveBeenCalledWith({
      where: { conversation_id: 7n },
      create: expect.objectContaining({
        conversation_id: 7n,
        user_id: 100n,
        draft_content: "草稿v2",
        proposed_name: "新名",
        status: "pending_name_confirm",
      }),
      update: expect.objectContaining({
        draft_content: "草稿v2",
        proposed_name: "新名",
        status: "pending_name_confirm",
      }),
    });
  });

  it("close 只关闭当前用户的 pending 记录", async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const prisma = {
      skill_summarize_session: { updateMany },
    } as unknown as PrismaClient;

    await createSkillSummarizeRepo(prisma).close({
      conversationId: "7",
      userId: "100",
    });

    expect(updateMany).toHaveBeenCalledWith({
      where: {
        conversation_id: 7n,
        user_id: 100n,
        status: "pending_name_confirm",
      },
      data: { status: "closed" },
    });
  });

  it("listRecentMessages 按 sequence_no 取最近 N 条并升序返回；表缺失 → []", async () => {
    const findMany = vi.fn().mockResolvedValue([
      { role: "assistant", content: "后" },
      { role: "user", content: "先" },
    ]);
    const prisma = {
      conversation_messages: { findMany },
    } as unknown as PrismaClient;

    await expect(
      createSkillSummarizeRepo(prisma).listRecentMessages({
        conversationId: "7",
        limit: 50,
      }),
    ).resolves.toEqual([
      { role: "user", content: "先" },
      { role: "assistant", content: "后" },
    ]);
    expect(findMany).toHaveBeenCalledWith({
      where: { conversation_id: 7n, is_delete: 0 },
      orderBy: { sequence_no: "desc" },
      take: 50,
      select: { role: true, content: true },
    });

    const broken = {
      conversation_messages: {
        findMany: vi.fn().mockRejectedValue(new Error("no such table")),
      },
    } as unknown as PrismaClient;
    await expect(
      createSkillSummarizeRepo(broken).listRecentMessages({
        conversationId: "7",
        limit: 50,
      }),
    ).resolves.toEqual([]);
  });
});
