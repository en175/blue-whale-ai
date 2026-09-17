import { validateReferences } from "../generation-runtime/video-reference-validation.js";
import { NewApiError } from "@lib/core";
import { promptReferenceRequestSchema, releaseRemovedPromptSources, type CanvasEdge } from "@lib/contracts";
import { createModelCapabilityRepo } from "@lib/shared/persistence/model-capability-repo.js";
import { createAssetOwnershipOps } from "@lib/shared/persistence/asset-ownership-repo.js";
import { confirmPlanEdges, nodeAssetId, planError, syncDraftModeOnPlanMedia, validatePlanModel, validateVideoPlan } from "./prompt-target.js";
import { BadRequestException, ConflictException, Injectable } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { readPromptPreview, sourceKey } from "./prompt-preview.js";
import { planLegacyCardMigration, type CanvasNodeLike } from "./legacy-card-migration.js";
import { CANVAS_EDGE_LIMITS, CONVERSATION_QUOTE_LIST_LIMIT, DATA_NOT_EXIST_CODE, DomainError, canvasEdgeSchema, fail, ok, applyPreviewSchema, conversationQuoteCreateSchema, previewSourceSchema, PROMPT_TEXT_LIMITS as limits, type LegacyCardHistoryItem, type LegacyMigrationReport } from "@lib/contracts";
import { createCanvasRepo, createConversationQuoteRepo, createLegacyCardHistoryRepo, type CanvasView, type ConversationQuoteRow, type LegacyCardHistoryRow } from "@lib/shared/persistence/index.js";
import { PrismaService } from "@lib/shared/prisma/prisma.service.js";
import { ProjectService } from "@lib/shared/project/project.service.js";
import { promptMentionSchema, validPromptMentions, mediaMentionSchema, mediaRefSchema, validMediaMentions, mediaRefsCoverMentions, type PromptPreviewContent, type PromptPreviewSource } from "@lib/contracts";
import { PromptMaterialUnavailableError } from "@lib/shared/persistence/canvas-repo.js";

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

/** 版本冲突（412）信封：data 带回服务端当前 version，前端可据其直接刷新 If-Match。
 *  与成功路径同址同字段（`data.version`），前端一套解析逻辑通吃。
 *  不用 contracts 的 fail()：它命中 `ResultEnvelope<never>` 重载，data 被收窄成 null，
 *  调用方就拿不到 `result.data.version` 了；这里要保住 payload 类型。
 *  version 为 null 是可达的：画布行尚不存在（项目在、canvas 无行）时 getByProject 给 emptyView，
 *  此时客户端若用数字 If-Match（如 "0"）就会走到冲突分支，回 `{ version: null }`，
 *  语义等同「无版本」，客户端应按第一次保存（"missing"）处理。 */
function canvasVersionConflict(version: number | null) {
  return { code: 412, msg: "Canvas 版本冲突", data: { version } } as const;
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
    let content: PromptPreviewContent | undefined;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const canvas = await this.repo.getByProject(projectId);
      const nodes = JSON.parse(canvas.nodes ?? "[]") as Array<{ id: string; type: string; position?: { x: number; y: number }; data?: Record<string, unknown> }>;
      const existing = nodes.find(node => node.type === "textNode" && sourceKey(node.data?.promptSource) === key);
      if (!content) {
        content = await this.repo.getPromptSnapshot(projectId, source) ?? undefined;
        if (!content) {
          const preview = await readPromptPreview(ownerId, projectId, source);
          content = await this.repo.rememberPromptSnapshot(projectId, source, preview);
        }
      }
      const additions: typeof nodes = [];
      const materialViews = [];
      const requiredIds = existing && Array.isArray(existing.data?.promptMentions)
        ? new Set((existing.data.promptMentions as Array<{ assetId: string }>).map(mention => mention.assetId)) : undefined;
      for (const material of content.promptMaterials ?? []) {
        if (requiredIds && !requiredIds.has(material.assetId)) continue;
        const asset = await this.prisma.client.assets.findFirst({ where: {
          id: BigInt(material.assetId), user_id: BigInt(ownerId), is_delete: false, status: "normal", type: material.mediaType,
        } });
        const indices = content.promptMentions?.filter(mention => mention.assetId === material.assetId).map(mention => `#${mention.index}`).join("、");
        if (!asset) throw new BadRequestException(`素材索引 ${indices} 已删除或无权访问，整次应用未保存`);
        materialViews.push({ ...material, url: asset.url });
        const exists = nodes.some(item => item.type === "mediaNode" && String(item.data?.assetId ?? item.data?.asset_id ?? item.data?.assetID ?? "") === material.assetId);
        if (!existing && !exists) additions.push({ id: `media-${randomUUID()}`, type: "mediaNode", position: { x: position.x + 420, y: position.y + additions.length * 300 },
          data: { assetId: material.assetId, mediaType: material.mediaType, src: asset.url, width: asset.width, height: asset.height } });
      }
      if (existing) return ok({ node: existing, canvas, reused: true });
      const node = { id: `text-${randomUUID()}`, type: "textNode", position, data: { ...content,
        ...(content.promptMaterials ? { promptMaterials: materialViews } : {}), promptSource: source } };
      const serialized = JSON.stringify([...nodes, ...additions, node]);
      if (Buffer.byteLength(serialized, "utf8") > limits.canvasBytes) throw new BadRequestException("画布内容超过 4 MiB，原内容未改动");
      try {
        const saved = await this.repo.saveIfVersion(projectId, canvas.version, canvas.viewport, serialized, canvas.edges, { ownerId, items: content.promptMaterials ?? [] });
        if (saved) return ok({ node, canvas: saved, reused: false });
      } catch (error) {
        if (error instanceof PromptMaterialUnavailableError) {
          const indices = content.promptMentions?.filter(mention => mention.assetId === error.assetId).map(mention => `#${mention.index}`).join("、");
          throw new BadRequestException(`素材索引 ${indices} 已删除或无权访问，整次应用未保存`);
        }
        if ((error as { code?: unknown })?.code !== "P2034") throw error;
      }
    }
    throw new ConflictException("画布正在被修改，请重试应用");
  }

  async referencePrompt(ownerId: string, projectId: string, body: unknown) {
    if (!await this.project.findOwnedById(projectId, ownerId)) return fail(DATA_NOT_EXIST_CODE, "项目不存在");
    const parsed = promptReferenceRequestSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException("方案引用参数无效");
    const { planNodeId, targetNodeId, expectedVersion, modelId, syncBindings } = parsed.data;
    const canvas = await this.repo.getByProject(projectId);
    if (canvas.version !== expectedVersion) throw new NewApiError("Canvas 版本冲突", 412);
    const nodes = JSON.parse(canvas.nodes ?? "[]");
    const result = confirmPlanEdges(nodes, JSON.parse(canvas.edges ?? "[]"), planNodeId, targetNodeId, syncBindings);
    const target = nodes.find((n: { id: string }) => n.id === targetNodeId);
    const isVideo = target.data?.mediaType === "video";
    const models = await createModelCapabilityRepo(this.prisma.client).listEnabledByType(isVideo ? "video" : "image");
    const targetModel = modelId ?? nodes.find((n: { id: string }) => n.id === targetNodeId)?.data?.draftModelId;
    const model = targetModel ? models.find(m => m.model_id === targetModel) : models.find(m => m.is_default) ?? models[0];
    if (!isVideo) validatePlanModel(planNodeId, result.plan.bindings, result.assetIds.length, model);
    const assets = await createAssetOwnershipOps(this.prisma.client).resolveInputAssets(result.assetIds, ownerId, projectId);
    for (const id of result.assetIds) {
      if (!assets.some(a => a.id === id && (isVideo || a.type === "image"))) planError(planNodeId, result.plan.bindings.filter(b => b.assetId === id), "素材已删除或无权访问");
    }
    if (isVideo) {
      const refs = result.assetIds.map(id => {
        const asset = assets.find(a => a.id === id)!;
        const edge = result.edges.find(e => e.target === targetNodeId && nodes.some((n: { id: string; data: Record<string, unknown> }) => n.id === e.source && String(n.data?.assetId) === id));
        const role = edge?.data?.refRole === "first" ? "first_frame" : edge?.data?.refRole === "last" ? "last_frame" : "reference";
        return { ...asset, role };
      });
      const materials = (Array.isArray(target.data?.draftMaterialRefs) ? target.data.draftMaterialRefs : []) as Array<{ materialId: string; mediaType: "image" | "video"; role: string }>;
      const materialRefs = materials.map(m => ({ id: m.materialId, type: m.mediaType, role: m.role === "first" ? "first_frame" : m.role === "last" ? "last_frame" : "reference" }));
      validateVideoPlan(planNodeId, result.plan.bindings, [...refs, ...materialRefs], model, target.data?.draftMode);
      try { validateReferences(model!.model_id, refs.filter(r => r.role === "reference"), materialRefs.filter(r => r.role === "reference")); }
      catch (error) { planError(planNodeId, result.plan.bindings, error instanceof Error ? error.message : "素材不受支持"); }
    }
    // IKFC26：校验按既有 draftMode 口径执行（validateVideoPlan 对 prompt 无特判），模式切换仅影响持久化
    const nextNodes = isVideo ? syncDraftModeOnPlanMedia(nodes, targetNodeId, result.plan.bindings) : nodes;
    try {
      const saved = await this.repo.saveIfVersion(projectId, expectedVersion, canvas.viewport, nextNodes === nodes ? canvas.nodes : JSON.stringify(nextNodes), JSON.stringify(result.edges),
        { ownerId, items: assets.map(a => ({ assetId: a.id, mediaType: a.type as "image" | "video" | "audio" })) });
      if (!saved) throw new NewApiError("Canvas 版本冲突", 412);
      return ok(saved);
    } catch (error) {
      if (error instanceof PromptMaterialUnavailableError) planError(planNodeId, result.plan.bindings.filter(b => b.assetId === error.assetId), "素材已删除或无权访问");
      throw error;
    }
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
    // 抛而不是 return 信封：信封走不到 AllExceptionsFilter，没人写 HTTP 状态码，
    // 一次「项目不存在」会回 HTTP 200 + body code 100100（ADR-0083 禁的那类不一致）。
    // 文案沿用原样，本次只修状态码；同 skill 域 SKILL_NOT_FOUND 的处理。
    if (!owned) throw new DomainError(DATA_NOT_EXIST_CODE, "项目不存在");
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
      // 自环（source === target）合法：素材原卡重新编辑引用自身，按普通连线保存；
      // 媒体参考消费在前端（连线→Dock 推导、提交时换算 input_asset_ids），服务端快照推导仅消费文本边（契约 IKDLQF 修订）。
      if (!nodeIds.has(parsed.data.source) || !nodeIds.has(parsed.data.target)) throw new BadRequestException("连线端点必须引用本次保存的画布节点，原内容未改动");
      const pair = `${parsed.data.source}\0${parsed.data.target}`;
      if (seenPairs.has(pair)) throw new BadRequestException("同一对节点之间只允许一条连线，原内容未改动");
      seenPairs.add(pair);
    }
    for (const node of incoming) {
      if ((node.data?.promptMaterials !== undefined || node.data?.promptMentions !== undefined || node.data?.promptOriginalTitle !== undefined)
        && node.data?.promptSource === undefined) {
        throw new BadRequestException("方案素材身份不可伪造，请使用应用入口");
      }
      // IKFM3S §4：输入更新状态字段只做形态校验、宽松放行（系统 UX 状态，伪造仅影响本画布提示显示）
      if (node.type === "mediaNode") {
        const signature = node.data?.usedInputSignature;
        const jobId = node.data?.usedInputJobId;
        if ((signature !== undefined && (typeof signature !== "string" || signature.length === 0 || signature.length > 128))
          || (jobId !== undefined && (typeof jobId !== "number" || !Number.isInteger(jobId) || jobId <= 0))) {
          throw new BadRequestException("输入更新状态字段无效，原内容未改动");
        }
      }
      if (node.type !== "textNode") continue;
      // IKFM3L 契约 §1：text 是权威正文（Markdown 源），html 为存量兼容字段，两者同限长
      if ((typeof node.data?.text === "string" && node.data.text.length > limits.text)
        || (typeof node.data?.html === "string" && node.data.html.length > limits.text)
        || (typeof node.data?.title === "string" && node.data.title.length > limits.title)) {
        throw new BadRequestException(`文本超限（标题 ${limits.title}，正文 ${limits.text} 字），原内容未改动`);
      }
    }
    const editedMaterials: Array<{ assetId: string; mediaType: "image" | "video" | "audio" }> = [];
    const current = await this.repo.getByProject(projectId);
    const previous = JSON.parse(current.nodes ?? "[]") as typeof incoming;
    // IKFM3Q 正文媒体索引契约 §7：mediaMentions/mediaRefs 同现同缺、区间与覆盖有效；
    // 新增身份素材真实可及且与来源节点身份一致；存量身份展示元数据不可变（失效身份豁免正文编辑）
    for (const node of incoming) {
      const hasMentions = node.data?.mediaMentions !== undefined;
      const hasRefs = node.data?.mediaRefs !== undefined;
      if (!hasMentions && !hasRefs) continue;
      if (node.type !== "textNode" || hasMentions !== hasRefs) {
        throw new BadRequestException("正文媒体索引字段无效，原内容未改动");
      }
      const mentions = mediaMentionSchema.array().safeParse(node.data?.mediaMentions);
      const refs = mediaRefSchema.array().safeParse(node.data?.mediaRefs);
      const text = typeof node.data?.text === "string" ? node.data.text : "";
      if (!mentions.success || !refs.success || !validMediaMentions(text, mentions.data) || !mediaRefsCoverMentions(mentions.data, refs.data)) {
        throw new BadRequestException("正文媒体索引无效，原内容未改动");
      }
      // 契约 §1：media 索引与 Agent 方案绑定（promptMentions）区间互不重叠
      const promptMentions = promptMentionSchema.array().safeParse(node.data?.promptMentions ?? []);
      const combined = [...mentions.data, ...(promptMentions.success ? promptMentions.data : [])].sort((a, b) => a.start - b.start);
      let covered = 0;
      for (const range of combined) {
        if (range.start < covered) throw new BadRequestException("正文媒体索引与方案绑定区间重叠，原内容未改动");
        covered = range.end;
      }
      const old = previous.find(item => item.id === node.id);
      const oldRefs = mediaRefSchema.array().safeParse(old?.data?.mediaRefs ?? []);
      const oldByNode = new Map((oldRefs.success ? oldRefs.data : []).map(ref => [ref.nodeId, ref]));
      for (const ref of refs.data) {
        const before = oldByNode.get(ref.nodeId);
        if (before) {
          if (JSON.stringify(before) !== JSON.stringify(ref)) {
            throw new BadRequestException("媒体素材展示信息不可修改，原内容未改动");
          }
          continue;
        }
        // 新增身份：素材真实可及（归属/未删/正常/类型/地址一致），与 promptMaterials 新增校验同口径
        const asset = await this.prisma.client.assets.findFirst({ where: { id: BigInt(ref.assetId), user_id: BigInt(ownerId), is_delete: false, status: "normal" } });
        if (!asset || asset.type !== ref.mediaType || asset.url !== ref.url) {
          throw new BadRequestException("媒体素材已删除、无权访问或身份不一致，原内容未改动");
        }
        // 来源节点在本次保存中存在时必须是同身份 mediaNode；节点不存在即来源已删的失效身份，豁免（契约 §7.3）
        const source = incoming.find(item => item.id === ref.nodeId);
        if (source && (source.type !== "mediaNode" || nodeAssetId(source) !== ref.assetId || String(source.data?.mediaType ?? "") !== ref.mediaType)) {
          throw new BadRequestException("媒体素材与来源节点身份不一致，原内容未改动");
        }
      }
    }
    if ([...previous, ...incoming].some(node => node.data?.promptSource !== undefined)) {
      if (body.expectedVersion === undefined) throw new BadRequestException("保存预览节点必须携带 If-Match");
      if (body.expectedVersion !== current.version) return canvasVersionConflict(current.version);
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
          if (node.data?.promptOriginalTitle !== old?.data?.promptOriginalTitle) {
            throw new BadRequestException("方案原始标题不可修改");
          }
          if (old?.data?.promptMentions !== undefined || node.data?.promptMentions !== undefined) {
            const mentions = promptMentionSchema.array().safeParse(node.data?.promptMentions);
            if (!mentions.success || !validPromptMentions(node.data!.text as string, mentions.data)) {
              throw new BadRequestException("正文素材索引无效，原内容未改动");
            }
            const oldMentions = promptMentionSchema.array().parse(old?.data?.promptMentions ?? []);
            const oldMaterials = (old?.data?.promptMaterials ?? []) as Array<{ assetId: string; mediaType: string; url: string }>;
            const materials = Array.isArray(node.data?.promptMaterials) ? node.data.promptMaterials as typeof oldMaterials : [];
            if (materials.some(m => !m || typeof m.assetId !== "string" || typeof m.mediaType !== "string" || typeof m.url !== "string")
              || new Set(materials.map(m => m.assetId)).size !== materials.length) {
              throw new BadRequestException("方案素材身份无效或重复");
            }
            // Existing display metadata stays immutable; newly chosen identities must be real, owned Canvas assets.
            if (oldMaterials.some(material => !materials.some(m => m.assetId === material.assetId && m.mediaType === material.mediaType && m.url === material.url))) {
              throw new BadRequestException("方案素材身份不可伪造，请重新选择素材");
            }
            const changed = mentions.data.filter(m => !oldMentions.some(old => old.index === m.index && old.assetId === m.assetId));
            const added = materials.filter(m => !oldMaterials.some(old => old.assetId === m.assetId));
            for (const assetId of new Set([...changed.map(m => m.assetId), ...added.map(m => m.assetId)])) {
              const indices = mentions.data.filter(m => m.assetId === assetId);
              if (!/^[1-9][0-9]*$/.test(assetId) || !incoming.some(n => n.type === "mediaNode" && nodeAssetId(n) === assetId)) {
                planError(node.id, indices, "请从画布选择明确的素材");
              }
              const asset = await this.prisma.client.assets.findFirst({ where: { id: BigInt(assetId), user_id: BigInt(ownerId), is_delete: false, status: "normal" } });
              const material = materials.find(m => m.assetId === assetId);
              if (!asset || !material || material.mediaType !== asset.type || material.url !== asset.url || !["image", "video", "audio"].includes(asset.type)) {
                planError(node.id, indices, "素材已删除、无权访问或身份不一致");
              }
              editedMaterials.push({ assetId, mediaType: asset.type as "image" | "video" | "audio" });
            }
          } else if (node.data?.promptMentions !== undefined || JSON.stringify(node.data?.promptMaterials) !== JSON.stringify(old?.data?.promptMaterials)) {
            throw new BadRequestException("正文素材索引不可伪造，请使用应用入口");
          }
        }
      }
    }
    const saved = await this.repo.saveIfVersion(
      projectId,
      body.expectedVersion === undefined ? current.version : body.expectedVersion,
      viewport,
      nodes,
      edgesProvided ? JSON.stringify(releaseRemovedPromptSources(JSON.parse(current.edges ?? "[]") as CanvasEdge[], incomingEdges as CanvasEdge[])) : current.edges,
      editedMaterials.length ? { ownerId, items: editedMaterials } : undefined,
    );
    if (!saved) {
      // 条件写失败说明读与写之间被并发改动：重读一次拿服务端当前 version 回给前端。
      const latest = await this.repo.getByProject(projectId);
      return canvasVersionConflict(latest.version);
    }
    return ok(saved);
  }
}
