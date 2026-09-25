// 素材库对接服务：产品登录会话 → AuthGuard 回注的 sk- key → 网关 /api/material/{Action}。
// 归属与状态以网关/上游为权威；本地仅三处持久化：
//   - 素材关联镜像 assets.material_id/material_group_id（IKDJNZ）；
//   - 素材库组 material_groups（IKDE6X/IKEXX8 契约 v2：只维护虚拟组镜像，
//     ListAssetGroups(AIGC)/GetAssetGroup 命中时读本地，真人组查询仍透传上游）；
//   - 素材校验状态 material_assets（IKFYHJ，ADR-0087：镜像上游 Status，供生成采纳处判定）。
// 其余（素材列表等）仍纯过境透传。
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
import { logger } from "@lib/infra/logging/blue-whale-logger.js";
import { PrismaService } from "@lib/shared/prisma/prisma.service.js";
import { parseBearerToken } from "@lib/shared/errors/bearer-token.js";
import { newApiBaseUrl } from "@lib/shared/upstream/new-api-egress.js";
import { createUploadMaterialGate } from "./material-upload-gate.js";

/**
 * 素材库 Action 白名单（产品侧唯一权威清单）。
 * 不做无白名单的 wildcard 透传：上游未实现的 GetModerationResult 不暴露，
 * 未来网关新增 Action 时由产品侧显式跟进。
 */
export const MATERIAL_ACTIONS = [
  // 素材组
  "CreateAssetGroup",
  "GetAssetGroup",
  "UpdateAssetGroup",
  "DeleteAssetGroup",
  "ListAssetGroups",
  // 素材
  "CreateAsset",
  "ListAssets",
  "GetAsset",
  "UpdateAsset",
  "DeleteAsset",
  // 真人活体认证会话
  "CreateVisualValidateSession",
  "GetVisualValidateResult",
] as const;

export type MaterialAction = (typeof MATERIAL_ACTIONS)[number];

/** 素材库素材 id 格式（对齐上游 asset-...；与 material.controller / 生成侧同源）。 */
const MATERIAL_ID_PATTERN = /^asset-.{1,128}$/i;

// 真人会话的 CallbackURL 由前端传入（指向刷脸完成后的落地提示页），
// 本层纯透传不改动；未传时由上游按自身默认行为处理。

@Injectable()
export class MaterialService {
  private clientInstance?: MaterialLibraryClient;
  private groupRepoInstance?: MaterialGroupRepo;
  private materialAssetRepoInstance?: MaterialAssetRepo;
  private assetClearRepoInstance?: AssetRepo;

  constructor(private readonly prisma: PrismaService) {}

  private get client(): MaterialLibraryClient {
    if (!this.clientInstance) {
      let baseUrl: string;
      try {
        // 地址从上游唯一出口取（不再自己读 NEW_API_BASE_URL）
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

  /** IKF YHJ：失败处置要清 `assets` 的素材关联，这里自带一个最小仓库面。 */
  private get assetRepo(): Pick<AssetRepo, "clearMaterialLink"> {
    if (!this.assetClearRepoInstance) {
      this.assetClearRepoInstance = createAssetRepo(this.prisma.client);
    }
    return this.assetClearRepoInstance;
  }

  /** 透传调用：鉴权取 AuthGuard 回注的 Bearer sk-；上游状态码与信封原样返回。 */
  async callAction(
    authorization: string | undefined,
    action: string,
    body: unknown,
  ): Promise<MaterialLibraryResponse> {
    const token = parseBearerToken(authorization);
    if (!token) {
      throw new NewApiError("缺少登录凭证", 401, "unauthorized");
    }
    if (!(MATERIAL_ACTIONS as readonly string[]).includes(action)) {
      throw new NewApiError("不支持的素材操作", 400, "InvalidAction");
    }
    return this.client.callAction(action, body, token);
  }

  /** IKDE6X：确保当前用户存在虚拟默认组（kind=virtual, is_default=true），无则上游建组 + 本地落表。
   *  返回该用户虚拟默认组 id（material_group_id）。前端不感知组、不传 GroupId，
   *  首次向虚拟人像上传素材时由本方法兜底建组。
   *  注意：本方法为 check-then-act，无 DB 层 is_default 唯一约束兜底。并发首个上传可能短暂出现
   *  2 个虚拟默认组（上游建 2 组 + 本地 2 行 is_default=true）；findVirtualDefault 按 id asc 取最低，
   *  upload 侧后续读取稳定收敛，无数据丢失。已按当前契约（虚拟组每用户 1 个）尽力缩短窗口并
   *  在本地落表失败时补偿删除上游组；若后续要求严格一次一个，需再加 per-user 锁。 */
  async ensureVirtualDefaultGroup(
    authorization: string | undefined,
    userId: string,
  ): Promise<string> {
    // 1. 先查本地虚拟默认组（未删）。命中直接复用。
    const existing = await this.groupRepo.findVirtualDefault(userId);
    if (existing) return existing.materialGroupId;

    // 2. 上游建虚拟组（组名：默认分组：<userId>；GroupType=AIGC 网关必填，显式携带不赌默认值）。
    const upstream = await this.callAction(authorization, "CreateAssetGroup", {
      Name: `默认分组：${userId}`,
      GroupType: "AIGC",
    });
    // 上游 4xx：透传错误状态与消息（如账号未开通素材组能力），不包装成 502。
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

    // 3. 落表前复核：若期间已出现默认组（并发首个上传），本组不设 is_default（避免第二行默认），
    //    但仍落本地做 (user, group) 镜像，避免上游组孤儿。
    const raced = await this.groupRepo.findVirtualDefault(userId);
    const isDefault = raced === null;

    // 4. 本地落镜像（虚拟默认组）。同 (user_id, material_group_id) 已存在则覆盖（幂等）。
    try {
      await this.groupRepo.upsert({
        userId,
        materialGroupId,
        kind: "virtual",
        name: `默认分组：${userId}`,
        isDefault,
      });
    } catch (error) {
      // 契约 §2.2：上游成功但本地落表失败必须回滚/补偿——best-effort 删上游刚建的组，避免孤儿。
      logger.error(
        `material ensureVirtualDefaultGroup upsert failed, compensating delete upstream group: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      await this.callAction(authorization, "DeleteAssetGroup", {
        Id: materialGroupId,
      }).catch(() => undefined);
      throw error;
    }
    return materialGroupId;
  }

  /** IKEXX8（契约 v2 §5）：组查询分流——命中本地读规则时返回上游同款信封，否则 null（控制器透传）。
   *  - ListAssetGroups 且 Filter.GroupType==="AIGC" → 本地虚拟组分页（其余参数形状一律透传）；
   *  - GetAssetGroup 且 Id 命中本地虚拟组（未删）→ 本地详情；未命中（真人组等）→ 透传上游。 */
  async tryServeLocalGroupAction(
    userId: string,
    action: string,
    body: unknown,
  ): Promise<MaterialLibraryResponse | null> {
    if (!isRecord(body)) return null;
    if (action === "ListAssetGroups") {
      const filter = body.Filter;
      const groupType = isRecord(filter) ? filter.GroupType : undefined;
      if (groupType !== "AIGC") return null;
      const page = readPositiveInt(body.PageNumber) ?? 1;
      const size = readPositiveInt(body.PageSize) ?? 10;
      const { total, rows } = await this.groupRepo.pageByUser(
        userId,
        "virtual",
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

  /** IKEXX8：上游 DeleteAssetGroup 成功后软删本地虚拟组行（真人组无本地行，updateMany 空操作）。 */
  async softDeleteLocalGroup(
    userId: string,
    materialGroupId: string,
  ): Promise<void> {
    await this.groupRepo.softDelete(userId, materialGroupId);
  }

  /** IKF YHJ：给生成创建期的素材门用的最小仓库面（避免把 Prisma 透到 API 层）。 */
  get materialStatusRepo(): Pick<
    MaterialAssetRepo,
    "findByMaterialId" | "mirrorStatus"
  > {
    return this.materialAssetRepo;
  }

  /** IKGQWR：**上传口**的素材闸（ADR-0093 决策 3）。
   *
   *  与生成门共用同一套判定规则、同一套文案与同一套上游信封解析（见 material-upload-gate.ts），
   *  差别只有两处：它会用上 `GetAsset` 的 `Result.GroupId`（上传口要往 `assets.material_group_id`
   *  落列），以及能在无记录时**补建行**——后者是生成门做不到的（造行需要 group id）。
   *
   *  按调用构造：闭包捕获本次请求的 authorization，闸的生命周期不跨请求。 */
  uploadMaterialGate(authorization: string | undefined) {
    return createUploadMaterialGate({
      repo: this.materialAssetRepo,
      callAction: (action, body) => this.callAction(authorization, action, body),
      onMaterialFailure: (input) =>
        this.handleUpstreamMaterialFailure({
          userId: input.userId,
          materialId: input.materialId,
          authorization,
          errorCode: input.errorCode,
          errorMessage: input.errorMessage,
          deleteUpstream: input.deleteUpstream,
        }),
    });
  }

  /** IKF YHJ：上游判定素材失败时的**统一处置**（无论哪条路径发现的，都走这一个口子）。
   *
   *  三件事，顺序有意：
   *   ① 本地状态行留 `Failed`（**不删**——留痕，且拦截点据此直接拒绝、不必再问上游）；
   *   ② 清空 `assets` 表的素材关联（用户侧不再显示「已入库」，需重新走合规校验）；
   *   ③ 删掉上游素材（死素材不留在人家库里）。
   *
   *  ①② 同步完成——紧接着的请求必须立刻看到一致状态。
   *  ③ 是清理副作用，**不等待、失败只告警**：它不该拖慢/拖挂一个正在被拒绝的请求，
   *  也不该让上游抖动变成用户可见的错误。真删不掉也无妨（本地已 Failed，拦截点照样拒）。
   *
   *  为什么必须配套「本地 Failed 就不再问上游」（{@link tryServeLocalFailedAsset}）：
   *  ③ 删完之后上游只会回 `NotFound`，前端会看到自相矛盾的「素材不存在」而不是「未通过」。 */
  async handleUpstreamMaterialFailure(input: {
    userId: string;
    materialId: string;
    /** 代打上游 DeleteAsset 用；缺失则跳过 ③（例如无会话的后台路径）。 */
    authorization: string | undefined;
    errorCode?: string | null;
    errorMessage?: string | null;
    /** 上游**已经**没有这个素材（NotFound / id 非法）时传 false，省一次注定 404 的往返。 */
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
    // 刻意不 await：见方法头 ③。
    void this.deleteUpstreamMaterial(input.authorization, input.materialId);
  }

  /** 删上游素材（best-effort）：任何失败只记日志，绝不外抛。 */
  private async deleteUpstreamMaterial(
    authorization: string | undefined,
    materialId: string,
  ): Promise<void> {
    try {
      const response = await this.callAction(authorization, "DeleteAsset", {
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

  /** IKF YHJ：本地已判 `Failed` 的素材，`GetAsset` 直接回本地结论，**不打上游**。
   *
   *  两个理由：
   *   - 正确性：上游那张素材已被 {@link handleUpstreamMaterialFailure} 删掉，再问只会拿到
   *     `NotFound`，前端看到的是「不存在」而非「未通过」——自相矛盾且无法引导用户重传。
   *   - 性能：Failed 是终态，问一万次也是 Failed。
   *
   *  只短接 `Failed`。`Active` / `Processing` 仍透传上游——那两个状态以上游为准，
   *  本地行可能陈旧（只跟进创建后 10 分钟），拿本地答会答错。 */
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

  /** IKF YHJ：CreateAsset 2xx 后落 Processing 行——上游异步注册，此刻必然尚未 Active。 */
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

  /** IKF YHJ：把上游返回的素材状态镜像回本地（GetAsset 单条或 ListAssets 列表）。
   *  只更新已存在的行——无行意味着没走过 CreateAsset，语义是「未校验」，不得凭空造行。 */
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

  /** IKF YHJ：上游 DeleteAsset 成功后清状态行（硬删，ADR-0087 决策 5）。 */
  async clearMaterialStatus(
    userId: string,
    materialId: string,
  ): Promise<void> {
    await this.materialAssetRepo.deleteByMaterialId(userId, materialId);
  }

  /** IKF YHJ：上游 DeleteAssetGroup 成功后按组批量清状态行（硬删）。 */
  async clearMaterialStatusByGroup(
    userId: string,
    materialGroupId: string,
  ): Promise<void> {
    await this.materialAssetRepo.deleteByGroupId(userId, materialGroupId);
  }
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** IKF YHJ：上游 Status 白名单收敛——认不出的值一律当 Processing（继续跟进，不误判为可用）。 */
function normalizeMaterialStatus(raw: string): MaterialAssetStatus {
  return raw === "Active" || raw === "Failed" ? raw : "Processing";
}

/** PageNumber/PageSize 宽松解析（缺省走 1/10；非正非数走缺省）。 */
function readPositiveInt(v: unknown): number | undefined {
  const n = typeof v === "string" ? Number(v) : v;
  return typeof n === "number" && Number.isInteger(n) && n > 0 ? n : undefined;
}

/** 本地组 → 上游列表项形状（2026-09-11 实测样例：Id/Name/GroupType/CreateTime/UpdateTime）。 */
function toUpstreamGroupItem(
  view: MaterialGroupView,
): Record<string, unknown> {
  return {
    Id: view.materialGroupId,
    Name: view.name,
    GroupType: "AIGC",
    CreateTime: toIsoSeconds(view.createdAt),
    UpdateTime: toIsoSeconds(view.updatedAt),
  };
}

/** DateTime(0) 秒精度 → 上游同款 ISO8601 Z（无毫秒段）。 */
function toIsoSeconds(d: Date | null): string | null {
  return d ? d.toISOString().replace(/\.\d{3}Z$/, "Z") : null;
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

/** 上游 CreateAssetGroup 成功信封 Result 里的组 id 字段。 */
function readGroupId(upstreamBody: unknown): string | undefined {
  if (!upstreamBody || typeof upstreamBody !== "object") return undefined;
  const body = upstreamBody as Record<string, unknown>;
  const result = body.Result;
  if (!result || typeof result !== "object") return undefined;
  const id = (result as Record<string, unknown>).Id;
  // .{1,122} 封顶：group- 前缀 6 + 122 = 128，恰好匹配 material_group_id VARCHAR(128) 上限。
  return typeof id === "string" && /^group-.{1,122}$/i.test(id) ? id : undefined;
}

/** 上游错误信封 ResponseError.Message（不存在返回 undefined）。 */
function readUpstreamError(upstreamBody: unknown): string | undefined {
  if (!upstreamBody || typeof upstreamBody !== "object") return undefined;
  const body = upstreamBody as Record<string, unknown>;
  const error = body.ResponseError;
  if (!error || typeof error !== "object") return undefined;
  const message = (error as Record<string, unknown>).Message;
  return typeof message === "string" && message.length > 0 ? message : undefined;
}
