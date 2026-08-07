// IK74V6：Composer 域参数常量（从 AgentComposer 下沉，供 VideoTabPanel 使用）。
export const VIDEO_ASPECT_RATIOS = [
  { id: "16:9", label: "16:9" },
  { id: "4:3", label: "4:3" },
  { id: "1:1", label: "1:1" },
  { id: "3:4", label: "3:4" },
  { id: "9:16", label: "9:16" },
  { id: "21:9", label: "21:9" },
];

export const RESOLUTIONS = [
  { id: "480p", label: "480p" },
  { id: "720p", label: "720p" },
  { id: "1080p", label: "1080p" },
  { id: "2160p", label: "2160p" },
];

export const VIDEO_REF_MODES = [
  { id: "omni", label: "Omni Reference" },
  { id: "first-last", label: "首尾帧" },
  { id: "text-to-video", label: "Text to Video" },
];
