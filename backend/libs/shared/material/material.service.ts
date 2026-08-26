// 素材库对接服务（纯过境）：产品登录会话 → AuthGuard 回注的 sk- key → 网关
// /api/material/{Action}。归属与状态全部以网关/上游为权威，本地零落表；
// 唯一持久化点在使用方（生成任务 input 冻结的素材引用快照）。
import { Injectable } from "@nestjs/common";
import {
  NewApiError,
  createMaterialLibraryClient,
  type MaterialLibraryClient,
  type MaterialLibraryResponse,
} from "@blue-whale/core";
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

/** 真人会话不对调用方开放自定义 CallbackURL：认证回调与数据全由网关维护。 */
function stripCallbackUrl(body: unknown): unknown {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return body ?? {};
  }
  const record = body as Record<string, unknown>;
  if (!("CallbackURL" in record)) return record;
  const rest: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    if (key !== "CallbackURL") rest[key] = value;
  }
  return rest;
}

@Injectable()
export class MaterialService {
  private clientInstance?: MaterialLibraryClient;

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
    const payload =
      action === "CreateVisualValidateSession" ? stripCallbackUrl(body) : body;
    return this.client.callAction(action, payload, token);
  }
}
