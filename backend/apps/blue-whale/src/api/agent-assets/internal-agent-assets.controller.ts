import { Body, Controller, Headers, Post } from "@nestjs/common";
import {
  agentAssetResolveRequestSchema,
  resolveAgentAsset,
} from "@lib/shared/assets/agent-asset-resolver.js";
import { NewApiError } from "@lib/core";
import { authorizedAgentService, requiredDecimalHeader } from "@lib/shared/agent/internal-auth.js";
import { BypassTransform } from "@lib/infra/decorators/bypass-transform.decorator.js";
import { Public } from "@lib/infra/decorators/public.decorator.js";
import { AssetService } from "@lib/shared/assets/assets.service.js";
import { AssetStorageService } from "@lib/shared/assets/storage.service.js";



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
    if (!authorizedAgentService(authorization)) {
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
        findAccessible: (assetId, ownerUserId) =>
          this.assets.findAccessible(assetId, ownerUserId),
        sign: (storageKey, options) => signer.sign(storageKey, options),
      },
    );
    if (outcome.kind === "ok") return outcome.value;
    if (outcome.reason === "asset_inaccessible") {
      throw new NewApiError("资源不存在", 404, "asset_not_found");
    }
    if (outcome.reason === "asset_metadata_unavailable") {
      throw new NewApiError("资源元数据不完整", 422, "asset_metadata_unavailable");
    }
    throw new NewApiError("资源读取暂不可用", 503, "storage_unavailable");
  }
}
