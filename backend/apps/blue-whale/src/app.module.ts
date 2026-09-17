import { Module } from "@nestjs/common";
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from "@nestjs/core";
import { AllExceptionsFilter } from "@lib/infra/filters/all-exceptions.filter.js";
import { AuthGuard } from "@lib/infra/guard/auth.guard.js";
import { TransformInterceptor } from "@lib/infra/interceptors/transform.interceptor.js";
import { AccountModule } from "@lib/shared/account/account.module.js";
import { AssetModule } from "@lib/shared/assets/assets.module.js";
import { CanvasModule } from "@lib/shared/canvas/canvas.module.js";
import { GenerationModule } from "@lib/shared/generation/generation.module.js";
import { HomepageHeroModule } from "@lib/shared/homepage-hero/homepage-hero.module.js";
import { JobsModule } from "@lib/shared/jobs/jobs.module.js";
import { ModelCapabilityAdminModule } from "@lib/shared/model-capability/model-capability-admin.module.js";
import { OperationLogModule } from "@lib/shared/operation-log/operation-log.module.js";
import { PrismaModule } from "@lib/shared/prisma/prisma.module.js";
import { ProjectModule } from "@lib/shared/project/project.module.js";
import { SceneCardModule } from "@lib/shared/scene-card/scene-card.module.js";
import { SessionModule } from "@lib/shared/session/session.module.js";
import { RateLimitModule } from "@lib/shared/rate-limit/rate-limit.module.js";
import { RateLimitGuard } from "@lib/shared/rate-limit/rate-limit.guard.js";
import { SharedAssetsModule } from "@lib/shared/shared-assets/shared-assets.module.js";
import { SkillModule } from "@lib/shared/skills/skills.module.js";
import { SnapshotModule } from "@lib/shared/snapshot/snapshot.module.js";
import { TemplateModule } from "@lib/shared/template/template.module.js";
import { TopupTierModule } from "@lib/shared/topup-tier/topup-tier.module.js";
import { AccountApiModule } from "./api/account/account.module.js";
import { AdminModule } from "./api/admin/admin.module.js";
import { AgentAssetsModule } from "./api/agent-assets/agent-assets.module.js";
import { AgentSkillsModule } from "./api/agent-skills/agent-skills.module.js";
import { AssetsApiModule } from "./api/assets/assets.module.js";
import { AuthModule } from "./api/auth/auth.module.js";
import { CanvasApiModule } from "./api/canvases/canvases.module.js";
import { GenerationApiModule } from "./api/generation/generation.module.js";
import { HealthModule } from "./api/health/health.module.js";
import { ImageEnhancementsApiModule } from "./api/image-enhancements/image-enhancements.module.js";
import { ImageOutpaintsApiModule } from "./api/image-outpaints/image-outpaints.module.js";
import { JobsApiModule } from "./api/jobs/jobs.module.js";
import { MaterialApiModule } from "./api/material/material.module.js";
import { MediaExtractionsApiModule } from "./api/media-extractions/media-extractions.module.js";
import { ProjectAssetsModule } from "./api/project-assets/project-assets.module.js";
import { ProjectsApiModule } from "./api/projects/projects.module.js";
import { RechargeModule } from "./api/recharge/recharge.module.js";
import { SceneCardsApiModule } from "./api/scene-cards/scene-cards.module.js";
import { SharedAssetsApiModule } from "./api/shared-assets/shared-assets.module.js";
import { SiteHomepageHeroesModule } from "./api/site/homepage-heroes.module.js";
import { SkillsApiModule } from "./api/skills/skills.module.js";
import { AgentTemplatesModule } from "./api/templates/templates.module.js";
import { TextApiModule } from "./api/text/text.module.js";
import { UsageModule } from "./api/usage/usage.module.js";
import { AgentV1Module } from "./api/agent/agent-v1.module.js";
import { CostSettlementModule } from "./api/internal/cost-settlement.module.js";

@Module({
  imports: [
    PrismaModule,
    AccountModule,
    AssetModule,
    TopupTierModule,
    OperationLogModule,
    ModelCapabilityAdminModule,
    TemplateModule,
    HomepageHeroModule,
    ProjectModule,
    JobsModule,
    CanvasModule,
    GenerationModule,
    SkillModule,
    SceneCardModule,
    SharedAssetsModule,
    SnapshotModule,
    SessionModule,
    RateLimitModule,
    AuthModule,
    AccountApiModule,
    AssetsApiModule,
    AgentAssetsModule,
    AgentSkillsModule,
    GenerationApiModule,
    RechargeModule,
    UsageModule,
    AdminModule,
    JobsApiModule,
    CanvasApiModule,
    MaterialApiModule,
    MediaExtractionsApiModule,
    ImageEnhancementsApiModule,
    ImageOutpaintsApiModule,
    ProjectsApiModule,
    ProjectAssetsModule,
    SkillsApiModule,
    SceneCardsApiModule,
    SharedAssetsApiModule,
    SiteHomepageHeroesModule,
    AgentTemplatesModule,
    TextApiModule,
    AgentV1Module,
    CostSettlementModule,
    HealthModule,
  ],
  providers: [
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    { provide: APP_INTERCEPTOR, useClass: TransformInterceptor },
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_GUARD, useClass: RateLimitGuard },
  ],
})
export class AppModule {}
