import { timingSafeEqual } from "node:crypto";
import { Body, Controller, Headers, Post } from "@nestjs/common";
import {
  agentAssetResolveRequestSchema,
  resolveAgentAsset,
} from "@blue-whale/agent-runtime";
import { NewApiError } from "@blue-whale/core";
import { BypassTransform } from "@lib/infra/decorators/bypass-transform.decorator.js";
import { Public } from "@lib/infra/decorators/public.decorator.js";
import { AssetService } from "@lib/shared/assets/assets.service.js";
import { AssetStorageService } from "@lib/shared/assets/storage.service.js";

function authorizedService(header: string | undefined): boolean {
  const expected = process.env.AGENT_SERVICE_TOKEN?.trim();
  const supplied = header?.startsWith("Bearer ")
    ? header.slice("Bearer ".length)
    : "";
  if (!expected || !supplied) return false;
  const expectedBytes = Buffer.from(expected);
  const suppliedBytes = Buffer.from(supplied);
  return (
    expectedBytes.length === suppliedBytes.length &&
    timingSafeEqual(expectedBytes, suppliedBytes)
  );
}

function requiredDecimalHeader(value: string | undefined): string | null {
  const normalized = value?.trim();
  return normalized && /^[1-9][0-9]*$/.test(normalized) ? normalized : null;
}

@Public()
@BypassTransform()
@Controller("internal/agent-assets")
export class InternalAgentAssetsController {
  constructor(
    private readonly assets: AssetService,
    private readonly storage: AssetStorageService,
  ) {}

  @Post("resolve")
  async resolve(
    @Headers("authorization") authorization: string | undefined,
    @Headers("x-blue-whale-tenant-id") tenantId: string | undefined,
    @Headers("x-blue-whale-user-id") userHeader: string | undefined,
    @Headers("x-blue-whale-project-id") projectHeader: string | undefined,
    @Body() body: unknown,
  ) {
    if (!authorizedService(authorization)) {
      throw new NewApiError("服务凭证无效", 401, "unauthorized");
    }
    const userId = requiredDecimalHeader(userHeader);
    const projectId = requiredDecimalHeader(projectHeader);
    if (!tenantId?.trim() || !userId || !projectId) {
      throw new NewApiError("缺少可信 Agent 上下文", 400, "invalid_context");
    }
    const request = agentAssetResolveRequestSchema.safeParse(body);
    if (!request.success) {
      throw new NewApiError("Asset resolve 请求无效", 400, "invalid_request");
    }
    const signer = this.storage.signer;
    if (!signer) {
      throw new NewApiError("资源读取暂不可用", 503, "storage_unavailable");
    }

    const outcome = await resolveAgentAsset(
      request.data,
      { userId, projectId },
      {
        findAccessible: (ownerProjectId, assetId, ownerUserId) =>
          this.assets.findAccessible(ownerProjectId, assetId, ownerUserId),
        sign: storageKey => signer.sign(storageKey),
      },
    );
    if (outcome.kind === "ok") return outcome.value;
    if (
      outcome.reason === "asset_inaccessible" ||
      outcome.reason === "asset_version_mismatch"
    ) {
      throw new NewApiError("资源不存在", 404, "asset_not_found");
    }
    if (outcome.reason === "asset_metadata_unavailable") {
      throw new NewApiError("资源元数据不完整", 422, "asset_metadata_unavailable");
    }
    throw new NewApiError("资源读取暂不可用", 503, "storage_unavailable");
  }
}
