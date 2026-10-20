import { wallClockRfc3339 } from "@lib/core";
import { releaseRemovedPromptSources, type CanvasEdge } from "@lib/contracts";
import { nodeAssetId, planError } from "./prompt-target.js";
import { BadRequestException, ConflictException, Injectable } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { readPromptPreview, sourceKey } from "./prompt-preview.js";
import { planLegacyCardMigration, type CanvasNodeLike } from "./legacy-card-migration.js";
import { CANVAS_EDGE_LIMITS, CANVAS_RECOVERY_PROTOCOL_VERSION, CONVERSATION_QUOTE_LIST_LIMIT, DATA_NOT_EXIST_CODE, DomainError, canvasEdgeSchema, fail, ok, applyPreviewSchema, conversationQuoteCreateSchema, previewSourceSchema, PROMPT_TEXT_LIMITS as limits, RECOVERY_PAGE_LIMIT_DEFAULT, RECOVERY_PAGE_LIMIT_MAX, RECOVERY_PAGE_LIMIT_MIN, RECOVERY_REASONS, RECOVERY_RESOLVE_IDS_MAX, recoverySaveFieldsSchema, type LegacyCardHistoryItem, type LegacyMigrationReport } from "@lib/contracts";
import {
  createCanvasRepo,
  createConversationQuoteRepo,
  createLegacyCardHistoryRepo,
  RecoveryContractError,
  decodeRecoveryCursor,
  guardLegacyCanvasWrite,
  listCanvasRecoveryPage,
  projectCanvasNodeOwnerKeys,
  projectHasRecoverySubmissions,
  recoveryMarkerOfNode,
  resolveCanvasRecoveryItems,
  saveCanvasWithRecovery,
  type CanvasView,
  type ConversationQuoteRow,
  type LegacyCardHistoryRow,
  type RecoveryRecordView,
} from "@lib/shared/persistence/index.js";

import { PrismaService } from "@lib/shared/prisma/prisma.service.js";
import { ProjectService } from "@lib/shared/project/project.service.js";
import { promptMentionSchema, validPromptMentions, mediaMentionSchema, mediaRefSchema, validMediaMentions, mediaRefsCoverMentions, mediaAndPromptMentionsDisjoint, TEXT_INDEX_EDGE_MARKER, type PromptPreviewContent, type PromptPreviewSource } from "@lib/contracts";
import { PromptMaterialUnavailableError } from "@lib/shared/persistence/canvas-repo.js";

function isReusableApplyMediaNode(item: { type?: string; data?: Record<string, unknown> }): boolean {
  if (item.type !== "mediaNode") return false;
  if (item.data?.assetMissing === true) return false;
  const src = typeof item.data?.src === "string" ? item.data.src : "";
  return src.length > 0 && !src.startsWith("blob:");
}

function toQuoteView(row: ConversationQuoteRow) {
  const source = previewSourceSchema.nullable().safeParse(row.source_json ?? null);
  return {
    quoteId: row.id.toString(),
    nodeId: row.node_id,
    title: row.title,
    text: row.text,
    source: source.success ? source.data : null,
    quotedAt: wallClockRfc3339(row.gmt_create),
  };
}

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
    migratedAt: wallClockRfc3339(row.gmt_create),
  };
}

function canvasVersionConflict(version: number | null) {
  return { code: 412, msg: "Canvas 版本冲突", data: { version } } as const;
}

export const CANVAS_SAVE_CONFLICT_CODES: ReadonlySet<number> = new Set([400, 404, 409, 412, 422, 428]);

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
        const code = (error as { code?: unknown })?.code;
        if (code !== "P2034") throw error;
      }
    }
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

  async listLegacyCardHistory(ownerId: string, projectId: string) {
    if (!await this.project.findOwnedById(projectId, ownerId)) return fail(DATA_NOT_EXIST_CODE, "项目不存在");
    const rows = await this.historyRepo.listByProject(projectId);
    return ok({ items: rows.map(toHistoryItem) });
  }

  async createConversationQuote(ownerId: string, projectId: string, body: unknown) {
    if (!await this.project.findOwnedById(projectId, ownerId)) return fail(DATA_NOT_EXIST_CODE, "项目不存在");
    const parsed = conversationQuoteCreateSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(`引用正文缺失或超限（标题 ${limits.title}，正文 ${limits.text} 字），原文未改动`);
    const { row, reused } = await this.quoteRepo.rememberQuote(projectId, parsed.data);
    return ok({ quote: toQuoteView(row), reused });
  }

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
      const newEdges: CanvasEdge[] = [];
      const assetToNode = new Map<string, string>();
      const assetToName = new Map<string, string>();
      const textNodeId = `text-${randomUUID()}`;
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
        if (existing) continue;
        const existingMedia = nodes.find(item =>
          item.type === "mediaNode"
          && String(item.data?.assetId ?? item.data?.asset_id ?? item.data?.assetID ?? "") === material.assetId
          && isReusableApplyMediaNode(item),
        );
        const mediaNodeId = existingMedia?.id ?? `media-${randomUUID()}`;
        if (!existingMedia) additions.push({ id: mediaNodeId, type: "mediaNode", position: { x: position.x + 420, y: position.y + additions.length * 300 },
          data: { assetId: material.assetId, mediaType: material.mediaType, src: asset.url, width: asset.width, height: asset.height } });
        assetToNode.set(material.assetId, mediaNodeId);
        const existingFileName = typeof existingMedia?.data?.fileName === "string" && existingMedia.data.fileName ? existingMedia.data.fileName : mediaNodeId;
        assetToName.set(material.assetId, existingFileName);
        newEdges.push({ id: `edge-${randomUUID()}`, source: textNodeId, target: mediaNodeId, data: { [TEXT_INDEX_EDGE_MARKER]: true } });
      }
      if (existing) return ok({ node: existing, canvas, reused: true });
      const mediaMentions = (content.promptMentions ?? [])
        .map(mention => ({ start: mention.start, end: mention.end, nodeId: assetToNode.get(mention.assetId)!, assetId: mention.assetId }))
        .filter(mention => mention.nodeId);
      const mediaRefs = materialViews
        .map(material => ({ nodeId: assetToNode.get(material.assetId)!, assetId: material.assetId, mediaType: material.mediaType, name: assetToName.get(material.assetId)!, url: material.url }))
        .filter(ref => ref.nodeId);
      const node = { id: textNodeId, type: "textNode", position, data: { ...content,
        ...(content.promptMaterials ? { promptMaterials: materialViews } : {}), promptSource: source, mediaMentions, mediaRefs } };
      const existingEdges = JSON.parse(canvas.edges ?? "[]") as CanvasEdge[];
      const serializedEdges = JSON.stringify([...existingEdges, ...newEdges]);
      const serialized = JSON.stringify([...nodes, ...additions, node]);
      guardLegacyCanvasWrite(nodes as Array<Record<string, unknown>>, [...nodes, ...additions, node] as Array<Record<string, unknown>>);
      if (Buffer.byteLength(serialized, "utf8") > limits.canvasBytes) throw new BadRequestException("画布内容超过 4 MiB，原内容未改动");
      try {
        const saved = await this.repo.saveIfVersion(projectId, canvas.version, canvas.viewport, serialized, serializedEdges, { ownerId, items: content.promptMaterials ?? [] });
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

  async save(
    ownerId: string,
    projectId: string,
    body: {
      viewport?: unknown;
      nodes?: unknown;
      edges?: unknown;
      expectedVersion?: number | null;
      confirmEmpty?: unknown;
      recoveryProtocolVersion?: unknown;
      commandId?: unknown;
      recoveryChanges?: unknown;
    },
    recoveryMaterials: Array<{ assetId: string; mediaType: "image" | "video" | "audio" }> = [],
  ) {
    const owned = await this.project.findOwnedById(projectId, ownerId);
    if (!owned) throw new DomainError(DATA_NOT_EXIST_CODE, "项目不存在");
    if (body.recoveryProtocolVersion !== undefined) {
      return this.saveWithRecovery(ownerId, projectId, body);
    }
    const viewport = typeof body.viewport === "string" ? body.viewport : null;
    const nodes = typeof body.nodes === "string" ? body.nodes : null;
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
      if (node.type === "mediaNode") {
        const signature = node.data?.usedInputSignature;
        const jobId = node.data?.usedInputJobId;
        if ((signature !== undefined && (typeof signature !== "string" || signature.length === 0 || signature.length > 128))
          || (jobId !== undefined && (typeof jobId !== "number" || !Number.isInteger(jobId) || jobId <= 0))) {
          throw new BadRequestException("输入更新状态字段无效，原内容未改动");
        }
      }
      if (node.type !== "textNode") continue;
      if ((typeof node.data?.text === "string" && node.data.text.length > limits.text)
        || (typeof node.data?.html === "string" && node.data.html.length > limits.text)
        || (typeof node.data?.title === "string" && node.data.title.length > limits.title)) {
        throw new BadRequestException(`文本超限（标题 ${limits.title}，正文 ${limits.text} 字），原内容未改动`);
      }
    }
    const editedMaterials: Array<{ assetId: string; mediaType: "image" | "video" | "audio" }> = [...recoveryMaterials];
    const current = await this.repo.getByProject(projectId);
    const previous = JSON.parse(current.nodes ?? "[]") as typeof incoming;
    const guardedByRecovery = await projectHasRecoverySubmissions(this.prisma.client, projectId);
    if (guardedByRecovery && body.expectedVersion === undefined) {
      return {
        code: 428,
        msg: "该项目已启用任务恢复保护，保存必须携带 If-Match 版本",
        data: { reason: RECOVERY_REASONS.versionRequired },
      } as const;
    }
    const markedNodeIds = guardedByRecovery
      ? previous.filter(node => recoveryMarkerOfNode(node as Record<string, unknown>) !== null).map(node => String(node.id))
      : [];
    try {
      guardLegacyCanvasWrite(previous, incoming, markedNodeIds.length > 0
        ? await projectCanvasNodeOwnerKeys(this.prisma.client, projectId, markedNodeIds)
        : undefined);
    } catch (error) {
      if (error instanceof RecoveryContractError) return error.envelope;
      throw error;
    }
    if (previous.length > 0 && incoming.length === 0) {
      if (body.confirmEmpty !== true) {
        return { code: 422, msg: "画布非空，本次保存会清空全部节点；确认清空请携带 confirmEmpty", data: null } as const;
      }
      if (body.expectedVersion === undefined) {
        return { code: 428, msg: "确认清空必须携带 If-Match 数值版本", data: null } as const;
      }
    }
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
      const promptMentions = promptMentionSchema.array().safeParse(node.data?.promptMentions ?? []);
      if (!mediaAndPromptMentionsDisjoint(mentions.data, promptMentions.success ? promptMentions.data : [])) {
        throw new BadRequestException("正文媒体索引与方案绑定区间重叠，原内容未改动");
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
        const asset = await this.prisma.client.assets.findFirst({ where: { id: BigInt(ref.assetId), user_id: BigInt(ownerId), is_delete: false, status: "normal" } });
        if (!asset || asset.type !== ref.mediaType || asset.url !== ref.url) {
          throw new BadRequestException("媒体素材已删除、无权访问或身份不一致，原内容未改动");
        }
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
      { ownerId, items: editedMaterials },
    );
    if (!saved) {
      const latest = await this.repo.getByProject(projectId);
      return canvasVersionConflict(latest.version);
    }
    return ok(saved);
  }

  async listGenerationRecovery(ownerId: string, projectId: string, limitParam: string, cursorParam: string) {
    if (!await this.project.findOwnedById(projectId, ownerId)) {
      return { code: 404, msg: "项目不存在", data: { reason: RECOVERY_REASONS.resourceNotFound } } as const;
    }
    let limit = RECOVERY_PAGE_LIMIT_DEFAULT;
    if (limitParam !== "") {
      limit = Number(limitParam);
      if (!Number.isInteger(limit) || limit < RECOVERY_PAGE_LIMIT_MIN || limit > RECOVERY_PAGE_LIMIT_MAX) {
        return { code: 400, msg: "limit 超出范围", data: { reason: RECOVERY_REASONS.invalidPayload } } as const;
      }
    }
    let cursor: { maxId: number; lastId: number } | null = null;
    if (cursorParam !== "") {
      const decoded = decodeRecoveryCursor(cursorParam);
      if (!decoded || decoded.projectId !== projectId) {
        return { code: 400, msg: "游标非法", data: { reason: RECOVERY_REASONS.invalidPayload } } as const;
      }
      cursor = { maxId: decoded.maxId, lastId: decoded.lastId };
    }
    const page = await listCanvasRecoveryPage(this.prisma.client, projectId, limit, cursor);
    return ok({
      protocol_version: CANVAS_RECOVERY_PROTOCOL_VERSION,
      canvas_version: page.canvasVersion,
      records: page.records,
      next_cursor: page.nextCursor,
    });
  }

  async resolveGenerationRecovery(ownerId: string, projectId: string, body: unknown) {
    if (!await this.project.findOwnedById(projectId, ownerId)) {
      return { code: 404, msg: "项目不存在", data: { reason: RECOVERY_REASONS.resourceNotFound } } as const;
    }
    const ids = (body as { recovery_item_ids?: unknown } | null)?.recovery_item_ids;
    if (!Array.isArray(ids) || ids.length < 1 || ids.length > RECOVERY_RESOLVE_IDS_MAX
      || ids.some(id => typeof id !== "string" || id.length === 0)) {
      return { code: 400, msg: "recovery_item_ids 无效", data: { reason: RECOVERY_REASONS.invalidPayload } } as const;
    }
    let records: RecoveryRecordView[];
    try {
      records = await resolveCanvasRecoveryItems(this.prisma.client, projectId, ids as string[]);
    } catch (error) {
      if (error instanceof RecoveryContractError) return error.envelope;
      throw error;
    }
    return ok({ protocol_version: CANVAS_RECOVERY_PROTOCOL_VERSION, records });
  }

  private async saveWithRecovery(
    ownerId: string,
    projectId: string,
    body: {
      viewport?: unknown;
      nodes?: unknown;
      edges?: unknown;
      expectedVersion?: number | null;
      confirmEmpty?: unknown;
      recoveryProtocolVersion?: unknown;
      commandId?: unknown;
      recoveryChanges?: unknown;
    },
  ) {
    const parsedFields = recoverySaveFieldsSchema.safeParse({
      recoveryProtocolVersion: body.recoveryProtocolVersion,
      commandId: body.commandId,
      recoveryChanges: body.recoveryChanges,
    });
    if (!parsedFields.success) {
      return { code: 400, msg: "恢复保存字段无效", data: { reason: RECOVERY_REASONS.invalidPayload } } as const;
    }
    const itemIds = new Set(parsedFields.data.recoveryChanges.map(change => change.recoveryItemId));
    if (itemIds.size !== parsedFields.data.recoveryChanges.length) {
      return { code: 400, msg: "同请求的恢复项不得重复", data: { reason: RECOVERY_REASONS.invalidPayload } } as const;
    }
    if (typeof body.viewport !== "string" || typeof body.nodes !== "string" || typeof body.edges !== "string") {
      return { code: 400, msg: "新协议保存必须显式提交 viewport/nodes/edges", data: { reason: RECOVERY_REASONS.invalidPayload } } as const;
    }
    const viewport = body.viewport;
    const nodes = body.nodes;
    const edges = body.edges;
    let incoming: Array<{ id: string; type: string; data?: Record<string, unknown> }>;
    try {
      incoming = JSON.parse(nodes);
      if (!Array.isArray(incoming) || incoming.some(node => !node || typeof node.id !== "string")) throw new Error();
      JSON.parse(edges);
    } catch {
      return { code: 400, msg: "画布文档格式无效", data: { reason: RECOVERY_REASONS.invalidPayload } } as const;
    }
    if (Buffer.byteLength(nodes, "utf8") > limits.canvasBytes
      || Buffer.byteLength(edges, "utf8") > CANVAS_EDGE_LIMITS.edgesBytes) {
      return { code: 400, msg: "画布内容超限", data: { reason: RECOVERY_REASONS.invalidPayload } } as const;
    }
    const current = await this.repo.getByProject(projectId);
    const previousNodes = JSON.parse(current.nodes ?? "[]") as typeof incoming;
    if (previousNodes.length > 0 && incoming.length === 0 && body.confirmEmpty !== true) {
      return { code: 422, msg: "画布非空，本次保存会清空全部节点；确认清空请携带 confirmEmpty", data: { reason: RECOVERY_REASONS.documentMismatch } } as const;
    }
    try {
      const saved = await saveCanvasWithRecovery(this.prisma.client, {
        ownerId,
        projectId,
        expectedVersion: body.expectedVersion === undefined ? null : body.expectedVersion,
        viewport,
        nodes,
        edges,
        confirmEmpty: body.confirmEmpty === true,
        commandId: parsedFields.data.commandId,
        changes: parsedFields.data.recoveryChanges,
      });
      return ok(saved);
    } catch (error) {
      if (error instanceof RecoveryContractError) return error.envelope;
      throw error;
    }
  }
}
