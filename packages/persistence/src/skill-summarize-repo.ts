import type { PrismaClient } from "@prisma/client";

/** 总结当前对话（IK60X1，资产契约 §15.2/§15.4）持久化缝：
 *  - findPending / upsertPending / close：skill_summarize_session 名称冲突待确认会话；
 *    同一会话至多一条（uk on conversation_id），新冲突 upsert 覆盖旧记录；
 *  - listRecentMessages：总结管道读会话历史（按 sequence_no 取最近 N 条，升序返回）。
 *  读路径容错（旧库缺表 → null/[]，不阻塞 Run 主路径）；写路径失败直接抛错。 */

export interface SkillSummarizePendingSession {
  draftContent: string;
  proposedName: string;
}

export interface SkillSummarizeHistoryMessage {
  role: string;
  content: string;
}

export interface SkillSummarizeRepo {
  /** 该会话当前的 pending 待确认记录；无/已关闭/表缺失 → null。 */
  findPending(input: {
    conversationId: string;
    userId: string;
  }): Promise<SkillSummarizePendingSession | null>;
  /** 写入/覆盖该会话的 pending 记录（新冲突覆盖旧记录）。 */
  upsertPending(input: {
    conversationId: string;
    userId: string;
    draftContent: string;
    proposedName: string;
  }): Promise<void>;
  /** 关闭该会话的 pending 记录（确认/取消/无关判定后调用）。 */
  close(input: { conversationId: string; userId: string }): Promise<void>;
  /** 会话历史：按 sequence_no 最近 limit 条，升序返回；表缺失/查询失败 → []。 */
  listRecentMessages(input: {
    conversationId: string;
    limit: number;
  }): Promise<SkillSummarizeHistoryMessage[]>;
}

export function createSkillSummarizeRepo(
  prisma: PrismaClient,
): SkillSummarizeRepo {
  return {
    async findPending({ conversationId, userId }) {
      try {
        const row = await prisma.skill_summarize_session.findFirst({
          where: {
            conversation_id: BigInt(conversationId),
            user_id: BigInt(userId),
            status: "pending_name_confirm",
            is_delete: 0,
          },
          select: { draft_content: true, proposed_name: true },
        });
        return row
          ? { draftContent: row.draft_content, proposedName: row.proposed_name }
          : null;
      } catch {
        return null;
      }
    },

    async upsertPending({ conversationId, userId, draftContent, proposedName }) {
      await prisma.skill_summarize_session.upsert({
        where: { conversation_id: BigInt(conversationId) },
        create: {
          conversation_id: BigInt(conversationId),
          user_id: BigInt(userId),
          draft_content: draftContent,
          proposed_name: proposedName,
          status: "pending_name_confirm",
        },
        update: {
          user_id: BigInt(userId),
          draft_content: draftContent,
          proposed_name: proposedName,
          status: "pending_name_confirm",
          is_delete: 0,
        },
      });
    },

    async close({ conversationId, userId }) {
      await prisma.skill_summarize_session.updateMany({
        where: {
          conversation_id: BigInt(conversationId),
          user_id: BigInt(userId),
          status: "pending_name_confirm",
        },
        data: { status: "closed" },
      });
    },

    async listRecentMessages({ conversationId, limit }) {
      try {
        const rows = await prisma.conversation_messages.findMany({
          where: { conversation_id: BigInt(conversationId), is_delete: 0 },
          orderBy: { sequence_no: "desc" },
          take: limit,
          select: { role: true, content: true },
        });
        return rows.reverse();
      } catch {
        return [];
      }
    },
  };
}
