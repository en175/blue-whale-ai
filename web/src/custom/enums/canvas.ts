export type VideoRefRole = 'reference' | 'first' | 'last';

export type PickChannel = 'image' | 'video' | 'audio' | 'product' | 'asset';

export type ToolMode = 'drag' | 'select';

export type ToolStatus = 'running' | 'completed' | 'failed' | 'rejected' | 'cancelled';

export type ConnectGenKind = 'image' | 'video' | 'text' | 'audio';

export type RunOutcome = 'completed' | 'cancelled' | 'failed';

export type AtMentionKind = 'image' | 'video' | 'audio' | 'text';

export type EraseTool = 'brush' | 'rect' | 'eraser';

export type VideoSubtitleEraseMode = 'smart' | 'box';

export type AssetsPickerTarget = 'toolbar' | 'videoDraft' | 'imageDialog' | 'audioDialog' | 'agentPanel';

export const PANEL_REF_MEDIA_TYPES = {
  audio: { types: ['image', 'audio'], canvasRefError: '音频参考仅支持图片或音频素材' },
  image: { types: ['image'], canvasRefError: '图片参考仅支持图片素材' },
  videoAll: { types: ['image', 'video', 'audio'] },
  videoText2Video: { types: ['image'], canvasRefError: '图片参考仅支持图片素材' },
} as const;

export type RefPanelKind = keyof typeof PANEL_REF_MEDIA_TYPES;

export type CardFilter = 'all' | 'all-assets' | 'style' | 'character' | 'object' | 'environment';

export type AudioVideoMuxSync = 'none' | 'video' | 'audio';

export type CropPresetKey = 'free' | '1:1' | '4:3' | '3:4' | '16:9' | '9:16';

export const CROP_PRESET_LABELS: Record<CropPresetKey, string> = {
  free: '自由',
  '1:1': '1:1',
  '4:3': '4:3',
  '3:4': '3:4',
  '16:9': '16:9',
  '9:16': '9:16',
};

export type OutpaintPresetKey = 'original' | '1:1' | '4:3' | '3:4' | '16:9' | '9:16';

export const OUTPAINT_PRESET_LABELS: Record<OutpaintPresetKey, string> = {
  original: '原图比例',
  '1:1': '1:1',
  '4:3': '4:3',
  '3:4': '3:4',
  '16:9': '16:9',
  '9:16': '9:16',
};
