// IKD806：plan-application 写路径（applyPlanMessage 视频/图片分支）已随旧 Agent 引擎退役删除。
// 本文件仅剩活跃符号的再导出：validateDerivedReferences 与派生引用/能力快照类型，
// 供 scene-card-generation-repo（再生成预检）消费。
export type {
  CapabilitySnapshot,
  DerivedReference,
} from "./plan-application-types.js";
export { validateDerivedReferences } from "./plan-application-internals.js";
