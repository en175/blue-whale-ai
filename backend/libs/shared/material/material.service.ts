// 素材库对接服务：产品登录会话 → AuthGuard 回注的 sk- key → 网关 /api/material/{Action}。
// 归属与状态以网关/上游为权威；本地仅两处持久化：
//   - 素材关联镜像 assets.material_id/material_group_id（IKDJNZ）；
//   - 素材库组 material_groups（IKDE6X，本地为组主、上游备份、双向维护）。
// 其余（素材列表等）仍纯过境透传。
import { Injectable } from "@nestjs/common";
import {
  NewApiError,
  createMaterialLibraryClient,
  type MaterialLibraryClient,
  type MaterialLibraryResponse,
} from "@blue-whale/core";
import { createMaterialGroupRepo, type MaterialGroupRepo } from "@lib/shared/persistence/index.js";
import { logger } from "@lib/infra/logging/blue-whale-logger.js";
import { PrismaService } from "@lib/shared/prisma/prisma.service.js";
import { parseBearerToken } from "@lib/shared/errors/bearer-token.js";

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

// 真人会话的 CallbackURL 由前端传入（指向刷脸完成后的落地提示页），
// 本层纯透传不改动；未传时由上游按自身默认行为处理。

@Injectable()
export class MaterialService {
  private clientInstance?: MaterialLibraryClient;
  private groupRepoInstance?: MaterialGroupRepo;

  constructor(private readonly prisma: PrismaService) {}

  private get client(): MaterialLibraryClient {
    if (!this.clientInstance) {
      const baseUrl = process.env.NEW_API_BASE_URL;
      if (!baseUrl) {
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

    // 2. 上游建虚拟组（组名：默认分组：<userId>）。
    const upstream = await this.callAction(authorization, "CreateAssetGroup", {
      Name: `默认分组：${userId}`,
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

  /** IKDE6X：组查询走本地表（前端不经 newapi 透传组）。按 kind 过滤可选。 */
  async listLocalGroups(
    userId: string,
    kind?: "virtual" | "real",
  ) {
    return this.groupRepo.listByUser(userId, kind);
  }
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
