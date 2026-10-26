import { type VideoRefRole, type PickerMediaType, PANEL_REF_MEDIA_TYPES } from '@/custom/enums';

export type AssetsPickerTarget = 'toolbar' | 'videoDraft' | 'imageDialog' | 'audioDialog' | 'agentPanel';

export function assetsPickerMediaTypes(
  target: AssetsPickerTarget,
  videoAssetPickRole: VideoRefRole,
  videoAssetPickKind: 'image' | 'video',
): PickerMediaType[] | undefined {
  if (target === 'imageDialog') return [...PANEL_REF_MEDIA_TYPES.image.types] as PickerMediaType[];
  if (target === 'audioDialog') return [...PANEL_REF_MEDIA_TYPES.audio.types] as PickerMediaType[];
  if (target === 'videoDraft') {
    if (videoAssetPickRole === 'first' || videoAssetPickRole === 'last') return ['image'];
    return videoAssetPickKind === 'image'
      ? ([...PANEL_REF_MEDIA_TYPES.videoText2Video.types] as PickerMediaType[])
      : ([...PANEL_REF_MEDIA_TYPES.videoAll.types] as PickerMediaType[]);
  }
  if (target === 'agentPanel') return ['image', 'video'];
  return undefined;
}
