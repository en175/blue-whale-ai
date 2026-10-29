import { Body, Controller, Delete, Get, Param, Post, Query } from "@nestjs/common";
import {
  FAILURE_CODE,
  RESOURCE_NOT_FOUND_CODE,
  fail,
  ok,
  saveSharedAssetRequestSchema,
  sharedAssetListQuerySchema,
} from "@lib/contracts";
import { CurrentUser } from "@lib/infra/decorators/current-user.decorator.js";
import type { AuthenticatedUser } from "@lib/shared/types/authenticated-user.js";
import { SharedAssetError } from "@lib/shared/shared-assets/shared-asset-error.js";
import { SharedAssetService } from "@lib/shared/shared-assets/shared-assets.service.js";

@Controller("shared-assets")
export class SharedAssetsController {
  constructor(private readonly sharedAssets: SharedAssetService) {}

  @Post("save")
  async save(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: unknown,
  ) {
    const parsed = saveSharedAssetRequestSchema.safeParse(body);
    if (!parsed.success) return fail(FAILURE_CODE, "参数不合法");
    try {
      return ok(await this.sharedAssets.save(user, parsed.data));
    } catch (error) {
      if (error instanceof SharedAssetError) {
        return fail(error.code, error.message);
      }
      throw error;
    }
  }

  @Get()
  async list(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: Record<string, unknown> = {},
  ) {
    const parsed = sharedAssetListQuerySchema.safeParse(query);
    if (!parsed.success) return fail(FAILURE_CODE, "参数不合法");
    return ok(await this.sharedAssets.list(user, parsed.data));
  }

  @Get(":id")
  async detail(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") id: string,
  ) {
    if (!isDecimalId(id)) return fail(RESOURCE_NOT_FOUND_CODE, "共享资产不存在");
    const item = await this.sharedAssets.detail(user, id);
    return item
      ? ok(item)
      : fail(RESOURCE_NOT_FOUND_CODE, "共享资产不存在");
  }

  @Delete(":id")
  async remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") id: string,
  ) {
    if (!isDecimalId(id)) return fail(RESOURCE_NOT_FOUND_CODE, "共享资产不存在");
    const deleted = await this.sharedAssets.delete(user, id);
    return deleted
      ? ok(null)
      : fail(RESOURCE_NOT_FOUND_CODE, "共享资产不存在");
  }
}

function isDecimalId(value: string): boolean {
  return /^[1-9][0-9]*$/.test(value);
}
