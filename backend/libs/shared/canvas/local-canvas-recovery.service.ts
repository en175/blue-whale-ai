import { createHash } from "node:crypto";
import { HttpException, Inject, Injectable } from "@nestjs/common";
import { z } from "zod";
import { ok, type PromptMaterial } from "@lib/contracts";
import { PrismaService } from "@lib/shared/prisma/prisma.service.js";
import { ProjectService } from "@lib/shared/project/project.service.js";
import { CanvasService } from "./canvas.service.js";
import type { CanvasView } from "@lib/shared/persistence/canvas-repo.js";

const operation = "LOCAL_CANVAS_RECOVERY_V1";
const requestSchema = z.object({
  name: z.string().trim().min(1).max(128),
  viewport: z.string().max(4096),
  nodes: z.string().max(4 * 1024 * 1024),
  edges: z.string().max(256 * 1024),
}).strict();
const assetReferenceSchema = z.object({
  path: z.string(),
  assetId: z.string().optional(),
  resolvedAssetId: z.string().optional(),
  url: z.string().optional(),
  mediaType: z.string().optional(),
});
const receiptSchema = z.object({
  ownerId: z.string(),
  documentHash: z.string(),
  version: z.number().int().nonnegative().optional(),
  assets: z.array(assetReferenceSchema),
});
type AssetReference = z.infer<typeof assetReferenceSchema>;

function reject(status: number, reason: string, msg: string): never {
  throw new HttpException({ code: status, msg, data: { reason } }, status);
}

function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, item: unknown) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return item;
    return Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b)));
  });
}

function hash(value: unknown): string {
  return createHash("sha256").update(canonical(value)).digest("hex");
}

function documentHash(canvas: Pick<CanvasView, "viewport" | "nodes" | "edges">): string {
  return hash([JSON.parse(canvas.viewport ?? "null"), JSON.parse(canvas.nodes ?? "[]"), JSON.parse(canvas.edges ?? "[]")]);
}

function assetReferences(nodes: unknown): AssetReference[] {
  const result: AssetReference[] = [];
  function visit(value: unknown, path: string, depth: number): void {
    if (depth > 100) reject(400, "local_recovery_invalid_payload", "恢复内容嵌套过深");
    if (Array.isArray(value)) {
      value.forEach((item, i) => visit(item, `${path}.${i}`, depth + 1));
      return;
    }
    if (!value || typeof value !== "object") return;
    const entry = value as Record<string, unknown>;
    const ids = [entry.assetId, entry.asset_id, entry.assetID].filter(id => id !== undefined);
    const urls = [entry.src, entry.url].filter((url): url is string => typeof url === "string" && url.length > 0);
    const id = ids[0];
    const url = urls[0];
    if (new Set(ids.map(String)).size > 1 || new Set(urls).size > 1) {
      throw new HttpException({ code: 422, msg: "素材引用身份不一致", data: { reason: "local_recovery_assets_unavailable", missing: [{ path, ...(id === undefined ? {} : { assetId: String(id) }) }] } }, 422);
    }
    if (id !== undefined || (typeof url === "string" && url.length > 0)) {
      if (id !== undefined && !/^asset-.{1,128}$/i.test(String(id)) && (!/^[1-9][0-9]{0,18}$/.test(String(id)) || BigInt(String(id)) > 9223372036854775807n)) reject(400, "local_recovery_invalid_payload", "素材身份格式无效");
      result.push({ path, ...(id === undefined ? {} : { assetId: String(id) }), ...(typeof url === "string" && url.length > 0 ? { url } : {}), ...(typeof entry.mediaType === "string" ? { mediaType: entry.mediaType } : typeof entry.type === "string" && ["image", "video", "audio"].includes(entry.type) ? { mediaType: entry.type } : {}) });
    }
    if (typeof entry.srcH264 === "string" && entry.srcH264.length > 0) {
      result.push({ path: `${path}.srcH264`, url: entry.srcH264, mediaType: "video" });
    }
    for (const key of ["sourceAssetId", "source_asset_id", "mask_asset_id"]) {
      const assetId = entry[key];
      if (assetId === undefined) continue;
      if ((typeof assetId !== "string" && typeof assetId !== "number") || !/^[1-9][0-9]{0,18}$/.test(String(assetId)) || BigInt(String(assetId)) > 9223372036854775807n) reject(400, "local_recovery_invalid_payload", "素材身份格式无效");
      result.push({ path: `${path}.${key}`, assetId: String(assetId) });
    }
    for (const [key, child] of Object.entries(entry)) visit(child, `${path}.${key}`, depth + 1);
  }
  visit(nodes, "nodes", 0);
  return result;
}

function validateIndependentContent(value: unknown, sourceProjectId: string, depth = 0): void {
  if (depth > 100) reject(400, "local_recovery_invalid_payload", "恢复内容嵌套过深");
  if (Array.isArray(value)) {
    value.forEach(item => validateIndependentContent(item, sourceProjectId, depth + 1));
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, item] of Object.entries(value)) {
    if (key === "localRecoveryProvenance") {
      const parsed = z.object({ sourceProjectId: z.literal(sourceProjectId), sourceNodeId: z.string().min(1).max(256), sourceJobId: z.string().regex(/^[1-9][0-9]*$/).optional() }).strict().safeParse(item);
      if (!parsed.success) reject(422, "local_recovery_executable_identity", "恢复来源说明格式无效");
      continue;
    }
    if (/(?:job|task|submission)_?id$|^generationRecovery$|^frameInterpolation$|^recovery(?:Changes|ProtocolVersion)$|^commandId$|^usedInputSignature$/i.test(key)
      || ((key === "genStatus" || key === "status") && typeof item === "string" && ["pending", "queued", "running", "generating", "checking", "processing", "submitting", "recovering"].includes(item))
      || (key === "id" && typeof item === "string" && /^(?:generation-(?:output|result)|storyboard-frame|audio-mix|frame-interpolation)[:\-]/.test(item))) {
      reject(422, "local_recovery_executable_identity", "恢复内容仍含旧任务身份，请先转为未提交草稿");
    }
    if (["promptSource", "promptMaterials", "promptMentions", "promptOriginalTitle"].includes(key)) {
      reject(422, "local_recovery_protected_provenance", "请先将方案绑定转为独立文本与合法媒体引用");
    }
    validateIndependentContent(item, sourceProjectId, depth + 1);
  }
}

@Injectable()
export class LocalCanvasRecoveryService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(ProjectService) private readonly projects: ProjectService,
    @Inject(CanvasService) private readonly canvas: CanvasService,
  ) {}

  private async validateAssets(ownerId: string, references: AssetReference[], targetProjectId?: string): Promise<PromptMaterial[]> {
    if (references.length === 0) return [];
    const ids = references.flatMap(ref => [ref.assetId, ref.resolvedAssetId].flatMap(id => id && /^[1-9][0-9]{0,18}$/.test(id) ? [BigInt(id)] : []));
    const materialIds = references.flatMap(ref => ref.assetId && /^asset-.{1,128}$/i.test(ref.assetId) ? [ref.assetId] : []);
    const activeMaterials = materialIds.length === 0 ? [] : await this.prisma.client.material_assets.findMany({ where: {
      user_id: BigInt(ownerId), material_id: { in: materialIds }, status: "Active",
    }, select: { material_id: true } });
    const activeMaterialIds = new Set(activeMaterials.map(material => material.material_id));
    const urls = references.flatMap(ref => ref.url ? [ref.url] : []);
    const assets = await this.prisma.client.assets.findMany({ where: {
      user_id: BigInt(ownerId), is_delete: false, status: "normal", type: { in: ["image", "video", "audio"] },
      OR: [{ id: { in: ids } }, { url: { in: urls } }, { material_id: { in: [...activeMaterialIds] } }],
    }, select: { id: true, url: true, type: true, material_id: true } });
    const byId = new Map(assets.map(asset => [asset.id.toString(), asset]));
    const byUrl = new Map(assets.map(asset => [asset.url, asset]));
    const byMaterial = new Map(assets.filter(asset => asset.material_id && activeMaterialIds.has(asset.material_id)).map(asset => [asset.material_id!, asset]));
    const unproven = targetProjectId === undefined ? [] : references.filter(ref => !ref.assetId && !ref.resolvedAssetId && ref.url);
    const proven = unproven.length === 0 ? new Map<string, string>() : await this.provenAssetIds(ownerId, targetProjectId!, unproven.map(ref => ref.url!));
    const missing: Array<{ path: string; assetId?: string }> = [];
    const materials = new Map<string, PromptMaterial>();
    for (const ref of references) {
      const fixedId = ref.resolvedAssetId ?? (ref.assetId === undefined ? proven.get(ref.url!) : undefined);
      const first = fixedId === undefined && ref.assetId === undefined && targetProjectId === undefined;
      const asset = ref.assetId ? byId.get(ref.assetId) ?? byMaterial.get(ref.assetId) : first ? byUrl.get(ref.url!) : fixedId === undefined ? undefined : byId.get(fixedId);
      if (!asset || (ref.resolvedAssetId && ref.resolvedAssetId !== asset.id.toString()) || (ref.url && ref.url !== asset.url) || (ref.mediaType && ref.mediaType !== asset.type)) {
        missing.push({ path: ref.path, ...(ref.assetId ? { assetId: ref.assetId } : {}) });
      } else {
        if (ref.assetId && byMaterial.has(ref.assetId)) ref.resolvedAssetId = asset.id.toString();
        if (first) ref.resolvedAssetId = asset.id.toString();
        materials.set(asset.id.toString(), { assetId: asset.id.toString(), mediaType: asset.type as PromptMaterial["mediaType"] });
      }
    }
    if (missing.length > 0) throw new HttpException({ code: 422, msg: "部分素材已删除、失效或无权访问，恢复尚未完成", data: { reason: "local_recovery_assets_unavailable", missing } }, 422);
    return [...materials.values()];
  }

  private async provenAssetIds(ownerId: string, targetProjectId: string, urls: string[]): Promise<Map<string, string>> {
    const links = await this.prisma.client.project_asset.findMany({
      where: { user_id: BigInt(ownerId), project_id: BigInt(targetProjectId), is_delete: 0 }, select: { asset_id: true },
    });
    if (links.length === 0) return new Map();
    const linked = await this.prisma.client.assets.findMany({ where: { id: { in: links.map(link => link.asset_id) }, url: { in: urls } }, select: { id: true, url: true } });
    const byUrl = new Map<string, Set<string>>();
    for (const asset of linked) byUrl.set(asset.url, (byUrl.get(asset.url) ?? new Set()).add(asset.id.toString()));
    const proven = new Map<string, string>();
    for (const [url, found] of byUrl) {
      const [assetId] = [...found];
      if (found.size === 1 && assetId !== undefined) proven.set(url, assetId);
    }
    return proven;
  }

  private async key(ownerId: string, sourceProjectId: string, operationId: string) {
    if (!/^[1-9][0-9]{0,18}$/.test(sourceProjectId) || BigInt(sourceProjectId) > 9223372036854775807n || !z.uuid().safeParse(operationId).success) {
      reject(400, "local_recovery_invalid_payload", "恢复身份无效");
    }
    if (!await this.projects.findOwnedById(sourceProjectId, ownerId)) {
      reject(404, "local_recovery_not_found", "恢复项目不存在");
    }
    return { project_id: BigInt(sourceProjectId), operation, idempotency_key: operationId };
  }

  async get(ownerId: string, sourceProjectId: string, operationId: string) {
    const key = await this.key(ownerId, sourceProjectId, operationId);
    const row = await this.prisma.client.command_idempotency.findUnique({ where: { project_id_operation_idempotency_key: key } });
    const receipt = receiptSchema.safeParse(row?.result_payload);
    if (!row || row.is_delete !== 0 || !row.resource_id || !receipt.success || receipt.data.ownerId !== ownerId) {
      reject(404, "local_recovery_not_found", "恢复操作不存在");
    }
    const targetProjectId = row.resource_id.toString();
    if (!await this.projects.findOwnedById(targetProjectId, ownerId)) {
      reject(404, "local_recovery_not_found", "恢复目标不存在");
    }
    await this.validateAssets(ownerId, receipt.data.assets, targetProjectId);
    const saved = await this.canvas.getByProject(targetProjectId);
    let version = receipt.data.version;
    if (version === undefined && saved.version !== null) {
      if (documentHash(saved) !== receipt.data.documentHash) {
        reject(409, "local_recovery_target_changed", "恢复目标已被修改，请保留本地副本并复核");
      }
      version = saved.version;
      await this.prisma.client.command_idempotency.update({ where: { id: row.id }, data: { result_payload: { ...receipt.data, version } } });
    }
    return ok({ operationId, sourceProjectId, targetProjectId, stage: version === undefined ? "created" : "complete", version: version ?? null });
  }

  async restore(ownerId: string, sourceProjectId: string, operationId: string, body: unknown) {
    const key = await this.key(ownerId, sourceProjectId, operationId);
    const parsed = requestSchema.safeParse(body);
    if (!parsed.success) reject(400, "local_recovery_invalid_payload", "恢复内容格式无效");
    const payload = parsed.data;
    let content: unknown[];
    try {
      content = [JSON.parse(payload.viewport), JSON.parse(payload.nodes), JSON.parse(payload.edges)];
      if (!content[0] || typeof content[0] !== "object" || Array.isArray(content[0]) || !Array.isArray(content[1]) || !Array.isArray(content[2])) throw new Error();
    } catch {
      reject(400, "local_recovery_invalid_payload", "恢复画布 JSON 格式无效");
    }
    validateIndependentContent(content[1], sourceProjectId);
    const assets = assetReferences(content[1]);
    await this.validateAssets(ownerId, assets);
    const requestHash = hash([ownerId, sourceProjectId, payload.name, ...content]);
    await this.prisma.client.$transaction(async tx => {
      const owned = await tx.$queryRaw<Array<{ id: bigint }>>`SELECT id FROM project WHERE id = ${key.project_id} AND owner_id = ${BigInt(ownerId)} AND is_delete = 0 FOR UPDATE`;
      if (owned.length !== 1) reject(404, "local_recovery_not_found", "恢复项目不存在");
      const existing = await tx.command_idempotency.findUnique({ where: { project_id_operation_idempotency_key: key } });
      if (existing) {
        if (existing.request_hash !== requestHash) reject(409, "local_recovery_payload_mismatch", "同一恢复操作的内容已变化，请使用原请求继续");
        return;
      }
      const target = await tx.project.create({ data: { owner_id: BigInt(ownerId), name: payload.name } });
      await tx.command_idempotency.create({ data: { ...key, request_hash: requestHash, resource_id: target.id, accepted_cursor: 0n, result_payload: { ownerId, documentHash: hash(content), assets } } });
    });
    const current = await this.get(ownerId, sourceProjectId, operationId);
    if (current.data?.stage === "complete") return current;
    const targetProjectId = current.data!.targetProjectId;
    const stored = receiptSchema.safeParse((await this.prisma.client.command_idempotency.findUnique({ where: { project_id_operation_idempotency_key: key } }))?.result_payload);
    if (!stored.success) reject(404, "local_recovery_not_found", "恢复操作不存在");
    const result = await this.canvas.save(ownerId, targetProjectId, { ...payload, expectedVersion: null }, await this.validateAssets(ownerId, stored.data.assets, targetProjectId));
    if (result.code !== 200 && result.code !== 412) throw new HttpException(result, result.code);
    return this.get(ownerId, sourceProjectId, operationId);
  }
}
