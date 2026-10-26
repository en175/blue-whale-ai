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
