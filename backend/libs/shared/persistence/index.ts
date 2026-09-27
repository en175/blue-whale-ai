export { getPrismaClient, type PrismaClient } from "./db.js";
export { createAuthRepo, type AuthRepo } from "./auth-repo.js";
export {
  createMaterialAssetRepo,
  type MaterialAssetRepo,
  type MaterialAssetStatus,
  type MaterialAssetView,
} from "./material-asset-repo.js";
export {
  createUserInfoRepo,
  type UserInfoRepo,
} from "./user-info-repo.js";
export {
  createProjectRepo,
  type ProjectPage,
  type ProjectRepo,
  type ProjectView,
} from "./project-repo.js";
export {
  createCanvasRepo,
  type CanvasRepo,
  type CanvasView,
} from "./canvas-repo.js";
export {
  createConversationQuoteRepo,
  type ConversationQuoteRepo,
  type ConversationQuoteRow,
} from "./conversation-quote-repo.js";
export {
  createLegacyCardHistoryRepo,
  type LegacyCardHistoryDraft,
  type LegacyCardHistoryRepo,
  type LegacyCardHistoryRow,
} from "./legacy-card-history-repo.js";
export {
  createJobRepo,
  type JobRepo,
  type JobListItem,
  type JobOutputAsset,
  type JobStatusView,
  type JobPage,
  type JobListFilter,
  type AdminJobListItem,
  type AdminJobPage,
  type AdminJobListFilter,
} from "./job-repo.js";
export {
  createSnapshotRepo,
  type SnapshotRepo,
  type SnapshotJobView,
  type SnapshotOutputSlotView,
  type SnapshotJobAggregate,
  type SnapshotConversationState,
  type SnapshotMentionView,
  type SnapshotAssetRow,
  type SnapshotSceneCardView,
  type SnapshotPlanApplicationReceiptView,
  type SnapshotSceneCardGenerationRecordView,
  type SnapshotStoryboardPreviewView,
} from "./snapshot-repo.js";
export {
  appendProjectEvent,
  createProductEventRepo,
  type AppendProjectEventInput,
  type ProductEventRepo,
  type ProductEventView,
} from "./product-event-repo.js";
export {
  transactionWithUniqueRetry,
} from "./conversation-repo.js";
export {
  createModelCapabilityRepo,
  DEFAULT_VIDEO_REFERENCE_MAX,
  DEFAULT_AUDIO_REFERENCE_MAX,
  DEFAULT_IMAGE_REFERENCE_MAX,
  type ModelCapabilityRepo,
  type ModelCapabilityView,
  type ModelSizeOption,
  type ModelFeatures,
} from "./model-capability-repo.js";
export {
  createModelCapabilityAdminRepo,
  type ModelCapabilityAdminRepo,
  type AdminModelCapabilityRow,
  type CreateModelCapabilityInput,
  type UpdateModelCapabilityInput,
  type CreateModelCapabilityResult,
} from "./model-capability-admin-repo.js";
export { invalidateModelCapabilityCache } from "./model-capability-cache.js";
export {
  createAssetRepo,
  assetDurationSeconds,
  type AssetRepo,
  type AssetView,
  type AssetDetailView,
  type AssetPage,
  type AssetListFilter,
  type AssetInternal,
  type AssetSourceFields,
  type PendingUploadAsset,
} from "./asset-repo.js";
export {
  createSharedAssetRepo,
  type SharedAssetRepo,
  type SharedAssetRow,
  type SharedAssetCreateInput,
  type SharedAssetListFilter,
  type SharedAssetPage,
} from "./shared-asset-repo.js";
export {
  createMaterialGroupRepo,
  type MaterialGroupRepo,
  type MaterialGroupView,
  type CreateMaterialGroupInput,
} from "./material-group-repo.js";
export {
  createSkillRepo,
  normalizeNameKey,
  SkillAddConflictError,
  SkillInUseError,
  SkillNameConflictError,
  SkillNameReservedError,
  type SkillRepo,
  type SkillLibraryView,
  type SkillMineView,
  type PersonalSkillCreateResult,
  type SkillPage,
  type SkillLibraryCategory,
  type SkillLibrarySort,
  type SkillLibraryLang,
} from "./skill-repo.js";
export {
  createTemplateRepo,
  type TemplateRepo,
  type TemplateTagView,
  type TemplateTagAdminView,
  type TemplateCardView,
  type TemplateCardPage,
} from "./template-repo.js";
export {
  createTemplateAdminRepo,
  swapSequence,
  TemplateAdminInputError,
  type TemplateAdminRepo,
  type AdminTemplateCardView,
  type AdminTemplateImageView,
  type TemplateCardInput,
  type MoveDirection,
  type MoveResult,
} from "./template-admin-repo.js";
export {
  createSkillAdminRepo,
  type SkillAdminRepo,
  type AdminSkillView,
  type AdminSkillCategoryView,
} from "./skill-admin-repo.js";
export {
  createHomepageHeroRepo,
  HOMEPAGE_HERO_MAX_ENABLED,
  HomepageHeroLimitError,
  type HomepageHeroRepo,
  type HomepageHeroAdminView,
  type HomepageHeroPublicView,
  type CreateHomepageHeroInput,
  type UpdateHomepageHeroInput,
} from "./homepage-hero-repo.js";
export {
  createUserRepo,
  type UserRepo,
  type UserInfoView,
} from "./user-repo.js";
export {
  createGenerationCommandRepo,
  type GenerationCommandRepo,
  type CreateJobInput,
  type CreateJobOptions,
  type CreatedJob,
} from "./generation-command-repo.js";
// 建任务幂等（command_idempotency，operation=generation.create）：读/写/并发回读都在这里，
// repo 只负责在正确的时点调用它。
export {
  CREATE_GENERATION_JOB_OPERATION,
  readCreateIdempotency,
  type CreateJobIdempotency,
  type CreateJobResult,
} from "./generation-job-idempotency.js";
// 建 job 的计费依赖（预扣 + 失败补偿）：装配层（handler/controller）经这里取端口类型；
// 补偿的执行与纯数据闸只在 persistence 内部用（generation-command-repo 直接相对导入）。
export type { JobBilling } from "./job-billing.js";
export {
  aggregateSlotStatus,
  resolveLogicalSlots,
  type OutputSlotStatus,
  type SlotSummaryStatus,
} from "./generation-output-slot-repo.js";
export {
  validateDerivedReferences,
  type CapabilitySnapshot,
  type DerivedReference,
} from "./plan-application-repo.js";
export {
  createSceneCardGenerationRepo,
  type SceneCardGenerationRepo,
  type RegenerateSceneCardInput,
  type RegenerateSceneCardResult,
  type SceneCardGenerationPresetView,
  type SceneCardGenerationPresetViewResult,
} from "./scene-card-generation-repo.js";
export {
  createSceneCardResourceRepo,
  type SceneCardResourceRepo,
  type SceneCardResourceResult,
  type DeleteSceneCardResourceInput,
  type DeleteSceneCardResourceResult,
  type SceneCardSharedSnapshotSource,
  type FindOwnedSceneCardWithPresetResult,
  type CopySceneCardToProjectInput,
  type CopySceneCardToProjectResult,
} from "./scene-card-resource-repo.js";
export {
  createStoryboardPreviewRepo,
  type StoryboardPreviewRepo,
  type CreateStoryboardPreviewInput,
  type CreateStoryboardPreviewResult,
  type StoryboardPreviewView,
  type ListStoryboardPreviewsResult,
} from "./storyboard-preview-repo.js";
export { createAssetOwnershipOps } from "./asset-ownership-repo.js";
export type { AssetOwnershipOps, WorkerInputAsset } from "./asset-ownership-types.js";
export {
  createTopupTierRepo,
  type TopupTierRepo,
  type TopupTierView,
  type TopupTierStatus,
  type TopupTierPermission,
  type CreateTopupTierInput,
  type UpdateTopupTierInput,
} from "./topup-tier-repo.js";
export {
  createOperationLogRepo,
  type OperationLogRepo,
  type OperationLogView,
  type OperationLogFilter,
  type CreateOperationLogInput,
} from "./operation-log-repo.js";
export {
  createCostAdjustmentRepo,
  alignReservationBySettlement,
  type CostAdjustmentItemInput,
  type CostAdjustmentBatchInput,
} from "./cost-adjustment-repo.js";
export {
  createRechargeOrderRepo,
  RECHARGE_ORDER_STATUS,
  RECHARGE_ORDER_STATUSES,
  PAID_REACHED_STATUSES,
  RECHARGE_ORDER_SNAPSHOT_DEFAULTS,
  type RechargeOrderRepo,
  type RechargeOrderView,
  type RechargeOrderStatus,
  type CreateRechargeOrderInput,
  type RechargeOrderListFilter,
  type RechargeOrderPage,
} from "./recharge-order-repo.js";
export {
  createRechargeCustomConfigRepo,
  CUSTOM_CONFIG_ROW_ID,
  type RechargeCustomConfigRepo,
  type RechargeCustomConfigView,
  type SaveRechargeCustomConfigInput,
} from "./recharge-custom-config-repo.js";
export {
  createSystemSettingRepo,
  type SystemSettingRepo,
  type SystemSettingRow,
} from "./system-setting-repo.js";
