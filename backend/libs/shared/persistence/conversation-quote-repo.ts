import { createHash } from "node:crypto";
import type { ConversationQuoteCreate } from "@lib/contracts";
import type { PrismaClient } from "@prisma/client";

/** 对话引用快照行（IKDLQJ）：只增不改；来源节点编辑/删除不影响已冻结内容。 */
export interface ConversationQuoteRow {
  id: bigint;
  project_id: bigint;
  node_id: string;
  source_json: unknown;
  title: string;
  text: string;
  gmt_create: Date;
}

export interface ConversationQuoteRepo {
  /** 相同内容（节点 + 来源 + 正文摘要）并发创建只接受首个快照；reused=true 表示本次命中既有快照。 */
  rememberQuote(
    projectId: string,
    input: ConversationQuoteCreate,
  ): Promise<{ row: ConversationQuoteRow; reused: boolean }>;
  /** 按主键批量回读；不存在的 id 省略。非数字 id 忽略（BigInt 转换安全）。 */
  listQuotesByIds(projectId: string, ids: string[]): Promise<ConversationQuoteRow[]>;
}

export function conversationQuoteKey(input: { nodeId: string; source?: unknown; text: string }): string {
  return createHash("sha256").update(JSON.stringify([input.nodeId, input.source ?? null, input.text])).digest("hex");
}

export function createConversationQuoteRepo(prisma: PrismaClient): ConversationQuoteRepo {
  return {
    async rememberQuote(projectId, input) {
      const where = { project_id: BigInt(projectId), quote_key: conversationQuoteKey(input) };
      const inserted = await prisma.conversation_quote_snapshots.createMany({
        data: [{
          ...where,
          node_id: input.nodeId,
          // 无来源时缺省该列 → SQL NULL；Prisma nullable Json 不接受 undefined 值，只能省略键
          ...(input.source != null ? { source_json: input.source } : {}),
          title: input.title,
          text: input.text,
        }],
        skipDuplicates: true,
      });
      const row = await prisma.conversation_quote_snapshots.findUniqueOrThrow({
        where: { project_id_quote_key: where },
      });
      return { row, reused: inserted.count === 0 };
    },
    async listQuotesByIds(projectId, ids) {
      const numeric = ids.filter(id => /^[1-9][0-9]*$/.test(id)).map(id => BigInt(id));
      if (numeric.length === 0) return [];
      return prisma.conversation_quote_snapshots.findMany({
        where: { project_id: BigInt(projectId), id: { in: numeric } },
        orderBy: { id: "asc" },
      });
    },
  };
}
