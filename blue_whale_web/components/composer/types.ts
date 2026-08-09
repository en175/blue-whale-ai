// IK74V6：Composer 域共享类型（从 AgentComposer 下沉）。

/** 首页输入区上传的媒体项（参考图/视频/音频）。 */
export interface MediaItem {
  id: string;
  type: "image" | "video" | "audio";
  name: string;
  src: string;
  duration?: string;
}
