import { randomUUID } from "node:crypto";
import { Injectable } from "@nestjs/common";
import {
  NewApiError,
  createMaterialLibraryClient,
  type MaterialLibraryClient,
  type MaterialLibraryResponse,
} from "@lib/core";
import {
  createAssetRepo,
  createMaterialAssetRepo,
  createMaterialGroupRepo,
  type AssetRepo,
  type MaterialAssetRepo,
  type MaterialAssetStatus,
  type MaterialGroupRepo,
  type MaterialGroupView,
} from "@lib/shared/persistence/index.js";
import { ASSET_ERROR_SPECS, DomainError } from "@lib/contracts";
import { logger } from "@lib/infra/logging/blue-whale-logger.js";
import { PrismaService } from "@lib/shared/prisma/prisma.service.js";
import { isMaterialLevelRejection } from "@lib/shared/generation/material-compliance-gate.js";
import { SystemSettingsService } from "@lib/shared/system-settings/index.js";
import { newApiBaseUrl } from "@lib/shared/upstream/new-api-egress.js";
import {
  createUploadMaterialGate,
  readResponseError,
} from "./material-upload-gate.js";

export const MATERIAL_ACTIONS = [
  "CreateAssetGroup",
  "GetAssetGroup",
  "UpdateAssetGroup",
  "DeleteAssetGroup",
  "ListAssetGroups",
  "CreateAsset",
  "ListAssets",
  "GetAsset",
  "UpdateAsset",
  "DeleteAsset",
  "CreateVisualValidateSession",
  "GetVisualValidateResult",
] as const;

export type MaterialAction = (typeof MATERIAL_ACTIONS)[number];

const MATERIAL_ID_PATTERN = /^asset-.{1,128}$/i;

const MATERIAL_DELETE_FAILED_MESSAGE = "素材库服务不可用，删除失败，请稍后重试";

const MATERIAL_ID_FIELD = "Id";

@Injectable()
export class MaterialService {
  private clientInstance?: MaterialLibraryClient;
  private groupRepoInstance?: MaterialGroupRepo;
  private materialAssetRepoInstance?: MaterialAssetRepo;
  private assetClearRepoInstance?: AssetRepo;

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SystemSettingsService,
  ) {}

  private get client(): MaterialLibraryClient {
    if (!this.clientInstance) {
      let baseUrl: string;
      try {
        baseUrl = newApiBaseUrl();
      } catch {
        throw new NewApiError(
          "素材库服务未配置",
          503,
          "material_library_unconfigured",
        );
      }
      this.clientInstance = createMaterialLibraryClient({ baseUrl });
    }
    return this.clientInstance;
  }

  private get groupRepo(): MaterialGroupRepo {
    if (!this.groupRepoInstance) {
      this.groupRepoInstance = createMaterialGroupRepo(this.prisma.client);
    }
    return this.groupRepoInstance;
  }

  private get materialAssetRepo(): MaterialAssetRepo {
    if (!this.materialAssetRepoInstance) {
      this.materialAssetRepoInstance = createMaterialAssetRepo(this.prisma.client);
    }
    return this.materialAssetRepoInstance;
  }

  private get assetRepo(): Pick<
    AssetRepo,
    "clearMaterialLink" | "findOwnedByMaterialIds" | "findOwnedMaterialLink"
  > {
    if (!this.assetClearRepoInstance) {
      this.assetClearRepoInstance = createAssetRepo(this.prisma.client);
    }
    return this.assetClearRepoInstance;
  }

  async callAction(
    action: string,
    body: unknown,
  ): Promise<MaterialLibraryResponse> {
    if (!(MATERIAL_ACTIONS as readonly string[]).includes(action)) {
      throw new NewApiError("不支持的素材操作", 400, "InvalidAction");
    }
    const token = await this.settings.requireUpstreamKey();
    return this.client.callAction(action, body, token);
  }

  async ensureVirtualDefaultGroup(
    userId: string,
  ): Promise<string> {
    const existing = await this.groupRepo.findVirtualDefault(userId);
    if (existing) return existing.materialGroupId;

    const upstream = await this.callAction("CreateAssetGroup", {
      Name: `默认分组：${userId}`,
      GroupType: "AIGC",
    });
    if (upstream.status < 200 || upstream.status >= 300) {
      throw new NewApiError(
        readUpstreamError(upstream.body) ?? "创建默认素材组失败",
        upstream.status,
        "create_default_material_group_failed",
      );
    }
    const materialGroupId = readGroupId(upstream.body);
    if (!materialGroupId) {
      throw new NewApiError(
        "创建默认素材组失败",
        502,
        "create_default_material_group_failed",
      );
    }

    const raced = await this.groupRepo.findVirtualDefault(userId);
    const isDefault = raced === null;

    try {
      await this.groupRepo.upsert({
        userId,
        materialGroupId,
        kind: "virtual",
        name: `默认分组：${userId}`,
        isDefault,
      });
    } catch (error) {
      logger.error(
        `material ensureVirtualDefaultGroup upsert failed, compensating delete upstream group: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      await this.callAction("DeleteAssetGroup", {
        Id: materialGroupId,
      }).catch(() => undefined);
      throw error;
    }
    return materialGroupId;
  }

  async tryServeLocalGroupAction(
    userId: string,
    action: string,
    body: unknown,
  ): Promise<MaterialLibraryResponse | null> {
    if (!isRecord(body)) return null;
    if (action === "ListAssetGroups") {
      const filter = body.Filter;
      const groupType = isRecord(filter) ? filter.GroupType : undefined;
      const kind =
        groupType === "AIGC"
          ? ("virtual" as const)
          : groupType === "LivenessFace"
            ? ("real" as const)
            : null;
      if (kind === null) return null;
      const page = readPositiveInt(body.PageNumber) ?? 1;
      const size = readPositiveInt(body.PageSize) ?? 10;
      const { total, rows } = await this.groupRepo.pageByUser(
        userId,
        kind,
        page,
        size,
      );
      return localEnvelope("ListAssetGroups", {
        TotalCount: total,
        Items: rows.map(toUpstreamGroupItem),
        PageNumber: page,
        PageSize: size,
      });
    }
    if (action === "GetAssetGroup") {
      const id = body.Id;
      if (typeof id !== "string") return null;
      const hit = await this.groupRepo.findByUserAndUpstream(userId, id);
      if (!hit) return null;
      return localEnvelope("GetAssetGroup", toUpstreamGroupItem(hit));
    }
    return null;
  }

  async softDeleteLocalGroup(
    userId: string,
    materialGroupId: string,
  ): Promise<void> {
    await this.groupRepo.softDelete(userId, materialGroupId);
  }

  async recordClaimedRealGroup(
    userId: string,
    materialGroupId: string,
  ): Promise<void> {
    try {
      const existing = await this.groupRepo.findByUserAndUpstream(
        userId,
        materialGroupId,
      );
      if (existing) return;
      const listed = await this.callAction("ListAssetGroups", {
        Filter: { GroupType: "LivenessFace" },
        PageNumber: 1,
        PageSize: 100,
      });
      await this.groupRepo.upsert({
        userId,
        materialGroupId,
        kind: "real",
        name: readGroupName(listed, materialGroupId) ?? materialGroupId,
        coverUrl: null,
      });
    } catch (error) {
      logger.warn(
        `material 真人组落本地镜像失败 groupId=${materialGroupId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  get materialStatusRepo(): Pick<
    MaterialAssetRepo,
    "findByMaterialId" | "mirrorStatus"
  > {
    return this.materialAssetRepo;
  }

  uploadMaterialGate() {
    return createUploadMaterialGate({
      repo: this.materialAssetRepo,
      callAction: (action, body) => this.callAction(action, body),
      onMaterialFailure: (input) =>
        this.handleUpstreamMaterialFailure({
          userId: input.userId,
          materialId: input.materialId,
          errorCode: input.errorCode,
          errorMessage: input.errorMessage,
          deleteUpstream: input.deleteUpstream,
        }),
    });
  }

  materialStatusReader(): {
    load(userId: string, materialId: string): Promise<string | null>;
  } {
    return {
      load: async (userId, materialId) => {
        try {
          const row = await this.materialAssetRepo.findByMaterialId(
            userId,
            materialId,
          );
          return row?.status ?? null;
        } catch (error) {
          logger.warn(
            `[upload] 回显素材状态失败，按无状态行处理 materialId=${materialId}: ${
              error instanceof Error ? error.message : String(error)
            }`,
          );
          return null;
        }
      },
    };
  }

  async handleUpstreamMaterialFailure(input: {
    userId: string;
    materialId: string;
    errorCode?: string | null;
    errorMessage?: string | null;
    deleteUpstream?: boolean;
  }): Promise<void> {
    await this.materialAssetRepo.mirrorStatus({
      userId: input.userId,
      materialId: input.materialId,
      status: "Failed",
      errorCode: input.errorCode ?? null,
      errorMessage: input.errorMessage ?? null,
    });
    await this.assetRepo.clearMaterialLink(input.userId, input.materialId);

    if (input.deleteUpstream === false) return;
    void this.deleteUpstreamMaterial(input.materialId);
  }

  private async deleteUpstreamMaterial(
    materialId: string,
  ): Promise<void> {
    try {
      const response = await this.callAction("DeleteAsset", {
        Id: materialId,
      });
      if (response.status < 200 || response.status >= 300) {
        logger.warn(
          `material 清理上游失败素材未成功 materialId=${materialId} HTTP ${response.status}`,
        );
      } else {
        logger.info(`material 已清理上游失败素材 materialId=${materialId}`);
      }
    } catch (error) {
      logger.warn(
        `material 清理上游失败素材异常 materialId=${materialId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  async tryServeLocalFailedAsset(
    userId: string,
    action: string,
    body: unknown,
  ): Promise<MaterialLibraryResponse | null> {
    if (action !== "GetAsset" || !isRecord(body)) return null;
    const id = body.Id;
    if (typeof id !== "string" || !MATERIAL_ID_PATTERN.test(id)) return null;
    const row = await this.materialAssetRepo.findByMaterialId(userId, id);
    if (row === null || row.status !== "Failed") return null;
    return localEnvelope("GetAsset", {
      Id: id,
      Status: "Failed",
      ...(row.errorCode !== null || row.errorMessage !== null
        ? { Error: { Code: row.errorCode, Message: row.errorMessage } }
        : {}),
    });
  }

  async trackMaterialProcessing(
    userId: string,
    materialId: string,
    materialGroupId: string,
  ): Promise<void> {
    await this.materialAssetRepo.upsertProcessing({
      userId,
      materialId,
      materialGroupId,
    });
  }

  async mirrorMaterialStatuses(
    userId: string,
    entries: ReadonlyArray<{
      materialId: string;
      status: string;
      errorCode?: string | null;
      errorMessage?: string | null;
    }>,
  ): Promise<void> {
    for (const entry of entries) {
      await this.materialAssetRepo.mirrorStatus({
        userId,
        materialId: entry.materialId,
        status: normalizeMaterialStatus(entry.status),
        errorCode: entry.errorCode ?? null,
        errorMessage: entry.errorMessage ?? null,
      });
    }
  }

  async clearMaterialStatus(
    userId: string,
    materialId: string,
  ): Promise<void> {
    await this.materialAssetRepo.deleteByMaterialId(userId, materialId);
  }

  async clearMaterialStatusByGroup(
    userId: string,
    materialGroupId: string,
  ): Promise<void> {
    await this.materialAssetRepo.deleteByGroupId(userId, materialGroupId);
  }

  async ingestUpstreamMaterialStatuses(
    userId: string,
    upstreamBody: unknown,
  ): Promise<void> {
    const entries = readAssetStatusEntries(upstreamBody);
    if (entries.length === 0) return;
    await this.mirrorMaterialStatuses(userId, entries);
    for (const entry of entries) {
      if (entry.status !== "Failed") continue;
      await this.handleUpstreamMaterialFailure({
        userId,
        materialId: entry.materialId,
        errorCode: entry.errorCode,
        errorMessage: entry.errorMessage,
      });
    }
  }

  async listLibraryAssets(input: {
    userId: string;
    body: unknown;
  }): Promise<Record<string, unknown>> {
    const response = await this.callAction("ListAssets", input.body);
    if (response.status < 200 || response.status >= 300) {
      throw new NewApiError(
        "素材库列表获取失败，请稍后重试",
        response.status >= 500 ? 503 : response.status,
        "list_library_assets_failed",
      );
    }
    await this.ingestUpstreamMaterialStatuses(input.userId, response.body);
    const result = isRecord(response.body) ? response.body.Result : undefined;
    if (!isRecord(result)) return { TotalCount: 0, Items: [] };
    const items = Array.isArray(result.Items)
      ? result.Items.filter(isRecord)
      : [];
    const local = await this.assetRepo.findOwnedByMaterialIds(
      input.userId,
      items
        .map((item) => item[MATERIAL_ID_FIELD])
        .filter((id): id is string => typeof id === "string"),
    );
    const byMaterialId = new Map(local.map((row) => [row.materialId, row]));
    return {
      ...result,
      Items: items.map((item) => {
        const rawId = item[MATERIAL_ID_FIELD];
        const hit = typeof rawId === "string" ? byMaterialId.get(rawId) : undefined;
        return {
          ...item,
          asset_id: hit?.assetId ?? null,
          url: hit?.url ?? null,
        };
      }),
    };
  }

  async cascadeDeleteUpstreamMaterial(input: {
    userId: string;
    materialId: string;
  }): Promise<void> {
    const response = await this.callAction("DeleteAsset", {
      Id: input.materialId,
    });
    if (response.status < 200 || response.status >= 300) {
      const code = readResponseError(response.body)?.Code;
      if (!isMaterialLevelRejection(typeof code === "string" ? code : null)) {
        logger.warn(
          `material 删除素材失败 materialId=${input.materialId} HTTP ${response.status}`,
        );
        throw new DomainError(
          ASSET_ERROR_SPECS.ASSET_MATERIAL_UNAVAILABLE.code,
          MATERIAL_DELETE_FAILED_MESSAGE,
        );
      }
    }
    await this.assetRepo.clearMaterialLink(input.userId, input.materialId);
    await this.clearMaterialStatus(input.userId, input.materialId);
  }

  async preflightCreateAsset(input: {
    userId: string;
    sourceAssetId: string | undefined;
  }): Promise<MaterialLibraryResponse | null> {
    if (!input.sourceAssetId) return null;
    const linked = await this.assetRepo.findOwnedMaterialLink(
      input.userId,
      input.sourceAssetId,
    );
    if (linked === null) return null;

    const outcome = await this.uploadMaterialGate().check(
      input.userId,
      linked,
    );
    if (outcome.ok) {
      return localEnvelope("CreateAsset", { Id: linked, AlreadyLinked: true });
    }
    if (outcome.reason !== "not_approved") return null;

    await this.discardMaterialHistory(input.userId, linked);
    return null;
  }

  private async discardMaterialHistory(
    userId: string,
    materialId: string,
  ): Promise<void> {
    await this.assetRepo.clearMaterialLink(userId, materialId);
    await this.clearMaterialStatus(userId, materialId);
    void this.deleteUpstreamMaterial(materialId);
  }
}

function readAssetStatusEntries(upstreamBody: unknown): Array<{
  materialId: string;
  status: string;
  errorCode: string | null;
  errorMessage: string | null;
}> {
  if (!isRecord(upstreamBody)) return [];
  const result = upstreamBody.Result;
  if (!isRecord(result)) return [];
  const rawItems = Array.isArray(result.Items) ? result.Items : [result];
  const entries: Array<{
    materialId: string;
    status: string;
    errorCode: string | null;
    errorMessage: string | null;
  }> = [];
  for (const raw of rawItems) {
    if (!isRecord(raw)) continue;
    const id = raw[MATERIAL_ID_FIELD];
    const status = raw.Status;
    if (
      typeof id !== "string" ||
      !MATERIAL_ID_PATTERN.test(id) ||
      typeof status !== "string"
    ) {
      continue;
    }
    const error = isRecord(raw.Error) ? raw.Error : undefined;
    const code = error?.Code;
    const message = error?.Message;
    entries.push({
      materialId: id,
      status,
      errorCode: typeof code === "string" ? code : null,
      errorMessage: typeof message === "string" ? message : null,
    });
  }
  return entries;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function normalizeMaterialStatus(raw: string): MaterialAssetStatus {
  return raw === "Active" || raw === "Failed" ? raw : "Processing";
}

function readPositiveInt(v: unknown): number | undefined {
  const n = typeof v === "string" ? Number(v) : v;
  return typeof n === "number" && Number.isInteger(n) && n > 0 ? n : undefined;
}

function toUpstreamGroupItem(
  view: MaterialGroupView,
): Record<string, unknown> {
  return {
    Id: view.materialGroupId,
    Name: view.name,
    GroupType: view.kind === "real" ? "LivenessFace" : "AIGC",
    CoverUrl: view.coverUrl,
    CreateTime: toIsoSeconds(view.createdAt),
    UpdateTime: toIsoSeconds(view.updatedAt),
  };
}

function toIsoSeconds(d: Date | null): string | null {
  return d ? d.toISOString().replace(/\.\d{3}Z$/, "Z") : null;
}

function readGroupName(
  response: MaterialLibraryResponse,
  groupId: string,
): string | null {
  if (response.status < 200 || response.status >= 300) return null;
  const result = isRecord(response.body) ? response.body.Result : undefined;
  const items =
    isRecord(result) && Array.isArray(result.Items) ? result.Items : [];
  for (const item of items) {
    if (!isRecord(item) || item.Id !== groupId) continue;
    const name = item.Name;
    return typeof name === "string" && name.length > 0 ? name : null;
  }
  return null;
}

function localEnvelope(
  action: string,
  result: unknown,
): MaterialLibraryResponse {
  return {
    status: 200,
    body: {
      ResponseMetadata: { RequestId: `req_${randomUUID()}`, Action: action },
      Result: result,
    },
  };
}

function readGroupId(upstreamBody: unknown): string | undefined {
  if (!upstreamBody || typeof upstreamBody !== "object") return undefined;
  const body = upstreamBody as Record<string, unknown>;
  const result = body.Result;
  if (!result || typeof result !== "object") return undefined;
  const id = (result as Record<string, unknown>).Id;
  return typeof id === "string" && /^group-.{1,122}$/i.test(id) ? id : undefined;
}

function readUpstreamError(upstreamBody: unknown): string | undefined {
  if (!upstreamBody || typeof upstreamBody !== "object") return undefined;
  const body = upstreamBody as Record<string, unknown>;
  const error = body.ResponseError;
  if (!error || typeof error !== "object") return undefined;
  const message = (error as Record<string, unknown>).Message;
  return typeof message === "string" && message.length > 0 ? message : undefined;
}
