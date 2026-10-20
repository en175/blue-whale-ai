import { Module } from "@nestjs/common";
import { AdminController } from "./admin.controller.js";
import { AdminBillingCatalogController } from "./billing-catalog.controller.js";
import { AdminBillingDiscountsController } from "./billing-discounts.controller.js";
import { AdminBillingPromotionsController } from "./billing-promotions.controller.js";
import { AdminConsumptionRecordsController } from "./consumption-records.controller.js";
import { AdminDashboardController } from "./dashboard.controller.js";
import { AdminHomepageHeroesController } from "./homepage-heroes.controller.js";
import { AdminJobRecordsController } from "./job-records.controller.js";
import { AdminModelsController } from "./models.controller.js";
import { AdminMediaToolPricingController } from "./media-tool-pricing.controller.js";
import { AdminRechargeCustomConfigController } from "./recharge-custom-config.controller.js";
import { AdminRechargeRecordsController } from "./recharge-records.controller.js";
import { AdminSkillsController } from "./skills.controller.js";
import { AdminTemplateImagesController } from "./template-images.controller.js";
import { AdminTemplateTagsController } from "./template-tags.controller.js";
import { AdminTemplatesController } from "./templates.controller.js";
import { AdminTopupTiersController } from "./topup-tiers.controller.js";
import { AdminUserRolesController } from "./user-roles.controller.js";
import { AdminUsersController } from "./users.controller.js";
import { AdminAssetsController } from "./assets.controller.js";
import { AdminSettingsController } from "./settings.controller.js";

@Module({
  controllers: [
    AdminController,
    AdminModelsController,
    AdminMediaToolPricingController,
    AdminTopupTiersController,
    AdminUsersController,
    AdminUserRolesController,
    AdminSkillsController,
    AdminDashboardController,
    AdminTemplatesController,
    AdminTemplateTagsController,
    AdminTemplateImagesController,
    AdminHomepageHeroesController,
    AdminAssetsController,
    AdminSettingsController,
    AdminRechargeRecordsController,
    AdminRechargeCustomConfigController,
    AdminConsumptionRecordsController,
    AdminJobRecordsController,
    AdminBillingCatalogController,
    AdminBillingDiscountsController,
    AdminBillingPromotionsController,
  ],
})
export class AdminModule {}
