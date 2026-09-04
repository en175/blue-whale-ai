// IKD806：plan-application 写路径（applyPlanMessage 视频/图片分支）已随旧 Agent 引擎退役删除，
// 入参/出参契约与仓储接口一并移除。仅保留 scene-card-generation-repo 消费的
// CapabilitySnapshot 与 DerivedReference（再生成预检的能力快照/派生引用类型）。
export interface CapabilitySnapshot {
  schema_version: number;
  capability_type: string;
  model_id: string;
  provider_id: string;
  row_version: number;
  digest: string;
}

export interface DerivedReference {
  mention_id: string;
  mention_seq: number;
  type: "asset" | "scene_card";
  first_seen_offset: number;
}
