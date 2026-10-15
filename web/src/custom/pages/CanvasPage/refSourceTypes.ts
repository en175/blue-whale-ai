









type MediaTypesEntry = { types: readonly string[]; canvasRefError?: string };


export const PANEL_REF_MEDIA_TYPES = {
  audio: { types: ['image', 'audio'], canvasRefError: '音频参考仅支持图片或音频素材' },
  image: { types: ['image'], canvasRefError: '图片参考仅支持图片素材' },


  videoAll: { types: ['image', 'video', 'audio'] },


  videoText2Video: { types: ['image'], canvasRefError: '图片参考仅支持图片素材' },
} as const;

export type RefPanelKind = keyof typeof PANEL_REF_MEDIA_TYPES;



export function panelCanvasRefError(panel: RefPanelKind, mediaType: unknown): string | null {
  const def = PANEL_REF_MEDIA_TYPES[panel] as MediaTypesEntry;
  return def.types.includes(mediaType as never) ? null : (def.canvasRefError ?? '不支持该类型素材');
}
