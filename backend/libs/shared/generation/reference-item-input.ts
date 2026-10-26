export interface ReferenceItemInput {
  role: "first_frame" | "last_frame" | "reference";
  asset_id?: string;
  material_id?: string;
  type: "image" | "video" | "audio";
  duration?: number;
}
