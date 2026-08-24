import { Module } from "@nestjs/common";
import { AdminController } from "./admin.controller.js";
import { AdminDashboardController } from "./dashboard.controller.js";
import { AdminModelsController } from "./models.controller.js";
import { AdminOrdersController } from "./orders.controller.js";
import { AdminSkillsController } from "./skills.controller.js";
import { AdminTemplateImagesController } from "./template-images.controller.js";
import { AdminTemplateTagsController } from "./template-tags.controller.js";
import { AdminTemplatesController } from "./templates.controller.js";
import { AdminTopupTiersController } from "./topup-tiers.controller.js";
import { AdminUsersController } from "./users.controller.js";

@Module({
  controllers: [
    AdminController,
    AdminModelsController,
    AdminTopupTiersController,
    AdminUsersController,
    AdminOrdersController,
    AdminSkillsController,
    AdminDashboardController,
    AdminTemplatesController,
    AdminTemplateTagsController,
    AdminTemplateImagesController,
  ],
})
export class AdminModule {}
