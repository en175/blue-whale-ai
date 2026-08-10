// IK74V6：Composer 域共享类型（从 AgentComposer 下沉）。

/** IK74TX：Composer 三个 Tab 的标识（用于 per-tab 状态 map，工单 6.1 隔离）。 */
export type ComposerTabId = "agent" | "video" | "image";

/** 首页输入区上传的媒体项（参考图/视频/音频）。 */
export interface MediaItem {
  id: string;
  type: "image" | "video" | "audio";
  name: string;
  src: string;
  duration?: string;
  /** IK74TX 1.1/1.2/1.3：原始 File 引用——提交时 uploadAsset 落全局资产库（project_id=0），
   *  跳转画布后 worker 经 resolveInputAssets 认 project_id=0 的资产，无需复制。 */
  file?: File;
}
