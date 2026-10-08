export type VideoWorkerInputAsset = {
  id: string;
  type: string;
  url: string;
  mime?: string | null;
  size?: number | null;
  width?: number | null;
  height?: number | null;
  duration?: number | null;
  material_id?: string | null;
};

export type VideoReference = {
  type: "image" | "video" | "audio";
  url: string;
  role?: "first_frame" | "last_frame";
};
