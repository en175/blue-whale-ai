import type { PrismaClient } from "@prisma/client";

export interface LegacyCardHistoryRow {
  id: bigint;
  project_id: bigint;
  node_id: string;
  title: string;
  prompt_text: string;
  visual_text: string | null;
  source_json: unknown;
  card_json: unknown;
  gmt_create: Date;
}

export interface LegacyCardHistoryDraft {
  nodeId: string;
  title: string;
  promptText: string;
  visualText: string | null;
  source: unknown;
  cardJson: unknown;
}

export interface LegacyCardHistoryRepo {
  migrate(projectId: string, version: number, nodes: string, rows: LegacyCardHistoryDraft[]): Promise<boolean>;
  listByProject(projectId: string): Promise<LegacyCardHistoryRow[]>;
  rememberMany(projectId: string, rows: LegacyCardHistoryDraft[]): Promise<void>;
}

export function createLegacyCardHistoryRepo(prisma: PrismaClient): LegacyCardHistoryRepo {
  return {
    async migrate(projectId, version, nodes, rows) {
      const conflict = new Error("Canvas migration version conflict");
      try {
        await prisma.$transaction(async tx => {
          await createLegacyCardHistoryRepo(tx as unknown as PrismaClient).rememberMany(projectId, rows);
          const result = await tx.project_canvas.updateMany({
            where: { project_id: BigInt(projectId), version },
            data: { nodes_json: JSON.parse(nodes), version: { increment: 1 } },
          });
          if (result.count !== 1) throw conflict;
        });
        return true;
      } catch (error) {
        if (error === conflict) return false;
        throw error;
      }
    },
    async listByProject(projectId) {
      return prisma.project_card_migration_history.findMany({
        where: { project_id: BigInt(projectId) },
        orderBy: { id: "asc" },
      });
    },
    async rememberMany(projectId, rows) {
      if (rows.length === 0) return;
      await prisma.project_card_migration_history.createMany({
        data: rows.map((row) => ({
          project_id: BigInt(projectId),
          node_id: row.nodeId,
          title: row.title,
          prompt_text: row.promptText,
          visual_text: row.visualText,
          ...(row.source != null ? { source_json: row.source } : {}),
          card_json: row.cardJson ?? {},
        })),
        skipDuplicates: true,
      });
    },
  };
}
