/** 视频 worker 输入素材/参考类型（从 video-job-runner 抽出，执行器已退役）。 */
export type VideoWorkerInputAsset = {
  id: string;
  type: string;
  url: string;
  mime?: string | null;
  size?: number | null;
  width?: number | null;
  height?: number | null;
  duration?: number | null;
  /** IKDJNZ：该本地素材关联的素材库素材 id（无关联为 null）。命中则上游走 asset://。 */
  material_id?: string | null;
};

export type VideoReference = {
  /** IKDJNZ：参考音频（type:"audio"）作为普通 reference 支持；首尾帧仍只允许图片。 */
  type: "image" | "video" | "audio";
  url: string;
  /** IKDJNZ：单数组 references 语义下，帧条目带 role（first_frame/last_frame）；普通参考无 role。 */
  role?: "first_frame" | "last_frame";
};
