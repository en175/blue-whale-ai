









import { PANEL_REF_MEDIA_TYPES, type RefPanelKind } from '@/custom/enums';

type MediaTypesEntry = { types: readonly string[]; canvasRefError?: string };



export function panelCanvasRefError(panel: RefPanelKind, mediaType: unknown): string | null {
  const def = PANEL_REF_MEDIA_TYPES[panel] as MediaTypesEntry;
  return def.types.includes(mediaType as never) ? null : (def.canvasRefError ?? '不支持该类型素材');
}
