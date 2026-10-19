import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Put,
  UseGuards,
} from "@nestjs/common";
import { AdminGuard } from "@lib/infra/guard/admin.guard.js";
import { AdminException, toAdminError } from "@lib/shared/errors/admin-error.js";
import {
  MediaToolPricingAdminService,
  parseMediaToolPricingUpdate,
} from "@lib/shared/media-tool-pricing/media-tool-pricing-admin.service.js";

@Controller("admin/media-tool-pricing")
@UseGuards(AdminGuard)
export class AdminMediaToolPricingController {
  constructor(private readonly service: MediaToolPricingAdminService) {}

  @Get()
  async list() {
    try {
      return { success: true, data: await this.service.listAll() };
    } catch (error) {
      throw toAdminError(error);
    }
  }

  @Get(":toolType")
  async get(@Param("toolType") toolType: string) {
    try {
      const row = await this.service.get(toolType);
      if (!row) throw new AdminException(404, "工具不存在");
      return { success: true, data: row };
    } catch (error) {
      if (error instanceof AdminException) throw error;
      throw toAdminError(error);
    }
  }

  @Put(":toolType")
  async update(
    @Param("toolType") toolType: string,
    @Body() body: unknown,
  ) {
    const parsed = parseMediaToolPricingUpdate(body);
    if (!parsed.ok) throw new AdminException(400, parsed.error);
    try {
      const row = await this.service.update(toolType, parsed.value);
      if (!row) throw new AdminException(404, "工具不存在");
      return { success: true, data: row };
    } catch (error) {
      if (error instanceof AdminException) throw error;
      throw toAdminError(error);
    }
  }

  @Patch(":toolType/charge")
  async toggleCharge(@Param("toolType") toolType: string) {
    try {
      const row = await this.service.toggleCharge(toolType);
      if (!row) throw new AdminException(404, "工具不存在");
      return { success: true, data: row };
    } catch (error) {
      if (error instanceof AdminException) throw error;
      throw toAdminError(error);
    }
  }

  @Patch(":toolType/toggle")
  async toggleEnabled(@Param("toolType") toolType: string) {
    try {
      const row = await this.service.toggleEnabled(toolType);
      if (!row) throw new AdminException(404, "工具不存在");
      return { success: true, data: row };
    } catch (error) {
      if (error instanceof AdminException) throw error;
      throw toAdminError(error);
    }
  }
}
