import { Module } from "@nestjs/common";
import { AdminController } from "./admin.controller.js";
import { AdminDashboardController } from "./dashboard.controller.js";
import { AdminHomepageHeroesController } from "./homepage-heroes.controller.js";
import { AdminModelsController } from "./models.controller.js";
import { AdminSkillsController } from "./skills.controller.js";
import { AdminTemplateImagesController } from "./template-images.controller.js";
import { AdminTemplateTagsController } from "./template-tags.controller.js";
import { AdminTemplatesController } from "./templates.controller.js";
import { AdminTopupTiersController } from "./topup-tiers.controller.js";
import { AdminUserRolesController } from "./user-roles.controller.js";
import { AdminUsersController } from "./users.controller.js";
import { AdminAssetsController } from "./assets.controller.js";

@Module({
  controllers: [
    AdminController,
    AdminModelsController,
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
  ],
})
export class AdminModule {}
