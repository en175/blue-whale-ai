import { BadRequestException, ConflictException, Injectable } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { readPromptPreview, sourceKey } from "./prompt-preview.js";
import { planLegacyCardMigration, type CanvasNodeLike } from "./legacy-card-migration.js";
import { CANVAS_EDGE_LIMITS, CONVERSATION_QUOTE_LIST_LIMIT, DATA_NOT_EXIST_CODE, canvasEdgeSchema, fail, ok, applyPreviewSchema, conversationQuoteCreateSchema, previewSourceSchema, PROMPT_TEXT_LIMITS as limits, type LegacyCardHistoryItem, type LegacyMigrationReport } from "@blue-whale/contracts";
import { createCanvasRepo, createConversationQuoteRepo, createLegacyCardHistoryRepo, type CanvasView, type ConversationQuoteRow, type LegacyCardHistoryRow } from "@lib/shared/persistence/index.js";
import { PrismaService } from "@lib/shared/prisma/prisma.service.js";
import { ProjectService } from "@lib/shared/project/project.service.js";

/** 对话引用快照视图（IKDLQJ）：主键字符串化；来源损坏时按无来源处理，不丢正文。 */
function toQuoteView(row: ConversationQuoteRow) {
  const source = previewSourceSchema.nullable().safeParse(row.source_json ?? null);
  return {
    quoteId: row.id.toString(),
    nodeId: row.node_id,
    title: row.title,
    text: row.text,
    source: source.success ? source.data : null,
    quotedAt: row.gmt_create.toISOString(),
  };
}

/** 迁移历史视图（IKDLQK）：主键字符串化；来源损坏按无来源处理，原卡片 JSON 原样返回。 */
function toHistoryItem(row: LegacyCardHistoryRow): LegacyCardHistoryItem {
  const source = previewSourceSchema.nullable().safeParse(row.source_json ?? null);
  return {
    historyId: row.id.toString(),
    nodeId: row.node_id,
    title: row.title,
    promptText: row.prompt_text,
    visualText: row.visual_text ?? null,
    source: source.success ? source.data : null,
    cardJson: row.card_json ?? null,
    migratedAt: row.gmt_create.toISOString(),
  };
}

@Injectable()
export class CanvasService {
  private repoInstance?: ReturnType<typeof createCanvasRepo>;
  private quoteRepoInstance?: ReturnType<typeof createConversationQuoteRepo>;
  private historyRepoInstance?: ReturnType<typeof createLegacyCardHistoryRepo>;

  private get repo(): ReturnType<typeof createCanvasRepo> {
    if (!this.repoInstance) {
      this.repoInstance = createCanvasRepo(this.prisma.client);
    }
    return this.repoInstance;
  }

  private get quoteRepo(): ReturnType<typeof createConversationQuoteRepo> {
    if (!this.quoteRepoInstance) {
      this.quoteRepoInstance = createConversationQuoteRepo(this.prisma.client);
    }
    return this.quoteRepoInstance;
  }

  private get historyRepo(): ReturnType<typeof createLegacyCardHistoryRepo> {
    if (!this.historyRepoInstance) {
      this.historyRepoInstance = createLegacyCardHistoryRepo(this.prisma.client);
    }
    return this.historyRepoInstance;
  }

  constructor(
    private readonly prisma: PrismaService,
    private readonly project: ProjectService,
  ) {}

  async get(ownerId: string, projectId: string) {
    const owned = await this.project.findOwnedById(projectId, ownerId);
    if (!owned) return fail(DATA_NOT_EXIST_CODE, "项目不存在");
    const { canvas, report } = await this.migrateLegacyCards(projectId);
    if (report.migrated.length > 0 || report.failed.length > 0) {
      return ok({ ...canvas, legacy_migration: report });
    }
    return ok(canvas);
  }

  getByProject(projectId: string) {
    return this.repo.getByProject(projectId);
  }

  /**
   * 打开路径上的旧生成卡迁移（IKDLQK）：先落不可变历史，再条件写画布；
   * 冲突重读重算最多五次，耗尽返回当前画布原样（不阻断打开，下次打开重试）。
   * 仅由项目打开入口（snapshot / canvases GET）调用；生成任务接纳等读路径不触发。
   */
  async migrateLegacyCards(projectId: string): Promise<{ canvas: CanvasView; report: LegacyMigrationReport }> {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const canvas = await this.repo.getByProject(projectId);
      let nodes: CanvasNodeLike[];
      try {
        const parsed = JSON.parse(canvas.nodes ?? "[]") as unknown;
        if (!Array.isArray(parsed)) throw new Error();
        nodes = parsed as CanvasNodeLike[];
      } catch {
        return { canvas, report: { migrated: [], failed: [] } };
      }
      const history = await this.historyRepo.listByProject(projectId);
      const plan = planLegacyCardMigration(nodes, history);
      if (!plan) return { canvas, report: { migrated: [], failed: [] } };
      if (plan.migrated.length === 0) {
        return { canvas, report: { migrated: [], failed: plan.failed } };
      }
      try {
        const saved = await this.historyRepo.migrate(projectId, canvas.version!, JSON.stringify(plan.nodes), plan.historyDrafts);
        if (saved) return { canvas: await this.repo.getByProject(projectId), report: { migrated: plan.migrated, failed: plan.failed } };
      } catch (error) {
        // 并发打开的唯一键 INSERT IGNORE 可能死锁（MySQL 1213 → Prisma P2034）：与版本冲突同等处理，重读重算
        const code = (error as { code?: unknown })?.code;
        if (code !== "P2034") throw error;
      }
    }
    // 重试耗尽：按最终读到的画布重算报告（并发请求可能已完成迁移，不用过期计划谎报失败）
    const canvas = await this.repo.getByProject(projectId);
    try {
      const parsed = JSON.parse(canvas.nodes ?? "[]") as unknown;
      const nodes = (Array.isArray(parsed) ? parsed : []) as CanvasNodeLike[];
      const history = await this.historyRepo.listByProject(projectId);
      const plan = planLegacyCardMigration(nodes, history);
      return { canvas, report: { migrated: [], failed: plan?.failed ?? [] } };
    } catch {
      return { canvas, report: { migrated: [], failed: [] } };
    }
  }

  /** 迁移历史只读回读（IKDLQK）：本项目全部条目，id 升序。 */
  async listLegacyCardHistory(ownerId: string, projectId: string) {
    if (!await this.project.findOwnedById(projectId, ownerId)) return fail(DATA_NOT_EXIST_CODE, "项目不存在");
    const rows = await this.historyRepo.listByProject(projectId);
    return ok({ items: rows.map(toHistoryItem) });
  }

  /** 添加到对话（IKDLQJ）：冻结点击当刻正文与来源为不可变快照；相同内容复用既有快照。 */
  async createConversationQuote(ownerId: string, projectId: string, body: unknown) {
    if (!await this.project.findOwnedById(projectId, ownerId)) return fail(DATA_NOT_EXIST_CODE, "项目不存在");
    const parsed = conversationQuoteCreateSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(`引用正文缺失或超限（标题 ${limits.title}，正文 ${limits.text} 字），原文未改动`);
    const { row, reused } = await this.quoteRepo.rememberQuote(projectId, parsed.data);
    return ok({ quote: toQuoteView(row), reused });
  }

  /** 会话刷新后按消息中的 quoteId 批量回读引用事实；不存在的 id 省略。 */
  async listConversationQuotes(ownerId: string, projectId: string, idsParam: string) {
    if (!await this.project.findOwnedById(projectId, ownerId)) return fail(DATA_NOT_EXIST_CODE, "项目不存在");
    const ids = idsParam.split(",").map(id => id.trim()).filter(id => id.length > 0);
    if (ids.length === 0) return ok({ items: [] });
    if (ids.length > CONVERSATION_QUOTE_LIST_LIMIT) throw new BadRequestException(`一次最多回读 ${CONVERSATION_QUOTE_LIST_LIMIT} 条引用`);
    const rows = await this.quoteRepo.listQuotesByIds(projectId, ids);
    return ok({ items: rows.map(toQuoteView) });
  }

  async applyPreview(ownerId: string, projectId: string, body: unknown) {
    if (!await this.project.findOwnedById(projectId, ownerId)) return fail(DATA_NOT_EXIST_CODE, "项目不存在");
    const parsed = applyPreviewSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException("预览来源或位置无效");
    const { source, position } = parsed.data;
    const key = sourceKey(source);
    let content: { title: string; text: string } | undefined;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const canvas = await this.repo.getByProject(projectId);
      const nodes = JSON.parse(canvas.nodes ?? "[]") as Array<{ id: string; type: string; data?: Record<string, unknown> }>;
      const existing = nodes.find(node => node.type === "textNode" && sourceKey(node.data?.promptSource) === key);
      if (existing) return ok({ node: existing, canvas, reused: true });
      if (!content) {
        content = await this.repo.getPromptSnapshot(projectId, source) ?? undefined;
        if (!content) {
          const preview = await readPromptPreview(ownerId, projectId, source);
          content = await this.repo.rememberPromptSnapshot(projectId, source, preview);
        }
      }
      const node = { id: `text-${randomUUID()}`, type: "textNode", position, data: { ...content, promptSource: source } };
      const serialized = JSON.stringify([...nodes, node]);
      if (Buffer.byteLength(serialized, "utf8") > limits.canvasBytes) throw new BadRequestException("画布内容超过 4 MiB，原内容未改动");
      const saved = await this.repo.saveIfVersion(projectId, canvas.version, canvas.viewport, serialized, canvas.edges);
      if (saved) return ok({ node, canvas: saved, reused: false });
    }
    throw new ConflictException("画布正在被修改，请重试应用");
  }

  async save(
    ownerId: string,
    projectId: string,
    body: {
      viewport?: unknown;
      nodes?: unknown;
      edges?: unknown;
      expectedVersion?: number | null;
    },
  ) {
    const owned = await this.project.findOwnedById(projectId, ownerId);
    if (!owned) return fail(DATA_NOT_EXIST_CODE, "项目不存在");
    const viewport = typeof body.viewport === "string" ? body.viewport : null;
    const nodes = typeof body.nodes === "string" ? body.nodes : null;
    // IKDLQF：edges 省略时保留既有连线（旧客户端保存不得清边）；携带时按下文校验后覆盖。
    const edgesProvided = typeof body.edges === "string";
    const edges = edgesProvided ? (body.edges as string) : null;
    let incoming: Array<{ id: string; type: string; data?: Record<string, unknown> }>;
    try {
      incoming = JSON.parse(nodes ?? "[]");
      if (!Array.isArray(incoming) || incoming.some(node => !node || typeof node.id !== "string")) throw new Error();
    } catch {
      throw new BadRequestException("画布节点格式无效，原内容未改动");
    }
    if (Buffer.byteLength(nodes ?? "", "utf8") > limits.canvasBytes) throw new BadRequestException("画布内容超过 4 MiB，原内容未改动");
    // IKDLQF：edges 与 nodes 同构（JSON 数组字符串），校验失败明确拒绝、零写入。
    let incomingEdges: unknown[] = [];
    if (edgesProvided) {
      try {
        incomingEdges = JSON.parse(edges ?? "[]");
        if (!Array.isArray(incomingEdges)) throw new Error();
      } catch {
        throw new BadRequestException("画布连线格式无效，原内容未改动");
      }
      if (Buffer.byteLength(edges ?? "", "utf8") > CANVAS_EDGE_LIMITS.edgesBytes) throw new BadRequestException("连线内容超过 256 KiB，原内容未改动");
      if (incomingEdges.length > CANVAS_EDGE_LIMITS.maxEdges) throw new BadRequestException(`连线数量超过 ${CANVAS_EDGE_LIMITS.maxEdges} 条上限，原内容未改动`);
    }
    const nodeIds = new Set(incoming.map(node => node.id));
    const seenPairs = new Set<string>();
    for (const edge of incomingEdges) {
      const parsed = canvasEdgeSchema.safeParse(edge);
      if (!parsed.success) throw new BadRequestException("画布连线格式无效，原内容未改动");
      if (parsed.data.source === parsed.data.target) throw new BadRequestException("连线不能指向同一节点，原内容未改动");
      if (!nodeIds.has(parsed.data.source) || !nodeIds.has(parsed.data.target)) throw new BadRequestException("连线端点必须引用本次保存的画布节点，原内容未改动");
      const pair = `${parsed.data.source}\0${parsed.data.target}`;
      if (seenPairs.has(pair)) throw new BadRequestException("同一对节点之间只允许一条连线，原内容未改动");
      seenPairs.add(pair);
    }
    for (const node of incoming) {
      if (node.type !== "textNode") continue;
      if ((typeof node.data?.text === "string" && node.data.text.length > limits.text)
        || (typeof node.data?.title === "string" && node.data.title.length > limits.title)) {
        throw new BadRequestException(`文本超限（标题 ${limits.title}，正文 ${limits.text} 字），原内容未改动`);
      }
    }
    const current = await this.repo.getByProject(projectId);
    const previous = JSON.parse(current.nodes ?? "[]") as typeof incoming;
    if ([...previous, ...incoming].some(node => node.data?.promptSource !== undefined)) {
      if (body.expectedVersion === undefined) throw new BadRequestException("保存预览节点必须携带 If-Match");
      if (body.expectedVersion !== current.version) return { code: 412, msg: "Canvas 版本冲突", data: null } as const;
      const seen = new Set<string>();
      for (const node of incoming) {
        const old = previous.find(item => item.id === node.id);
        const key = sourceKey(node.data?.promptSource);
        if (node.data?.promptSource !== undefined || old?.data?.promptSource !== undefined) {
          if (!key || key !== sourceKey(old?.data?.promptSource) || seen.has(key)
            || node.type !== "textNode" || typeof node.data?.text !== "string" || typeof node.data?.title !== "string") {
            throw new BadRequestException("预览来源不可修改或重复，请使用应用入口");
          }
          seen.add(key);
        }
      }
    }
    const saved = await this.repo.saveIfVersion(
      projectId,
      body.expectedVersion === undefined ? current.version : body.expectedVersion,
      viewport,
      nodes,
      edgesProvided ? edges : current.edges,
    );
    if (!saved) return { code: 412, msg: "Canvas 版本冲突", data: null } as const;
    return ok(saved);
  }
}
