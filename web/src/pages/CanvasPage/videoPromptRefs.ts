import type { VideoMediaRef, VideoMediaRefs } from './videoMediaRefs';
import { videoModeAcceptsRef } from './videoModes';

export interface VideoPromptRefItem {
  id: string;
  role: 'first_frame' | 'last_frame' | 'reference';
  type: 'image' | 'video' | 'audio';
}

export interface VideoLabelMap {
  labelOf: (id: string) => string | null;
  refItems: VideoPromptRefItem[];
  numberMap: Map<string, number>;
}

const TYPE_LABELS: Record<VideoPromptRefItem['type'], string> = {
  image: '图片',
  video: '视频',
  audio: '音频',
};

export const refIdOf = (item: VideoMediaRef): string => item.materialId ?? item.assetId;

function modeAccepts(mode: string, role: VideoPromptRefItem['role'], type: VideoPromptRefItem['type']): boolean {
  return videoModeAcceptsRef(mode, role, type);
}

export function videoLabelMapOf(refs: VideoMediaRefs, mode: string): VideoLabelMap {
  const refItems: VideoPromptRefItem[] = [];
  if (refs.first) refItems.push({ id: refIdOf(refs.first), role: 'first_frame', type: 'image' });
  if (refs.last) refItems.push({ id: refIdOf(refs.last), role: 'last_frame', type: 'image' });
  for (const item of refs.reference) {
    refItems.push({ id: refIdOf(item), role: 'reference', type: item.mediaType });
  }
  const labels = new Map<string, string>();
  const numberMap = new Map<string, number>();
  const typeCounters = new Map<VideoPromptRefItem['type'], number>();
  for (const item of refItems) {
    if (!modeAccepts(mode, item.role, item.type)) continue;
    if (item.role === 'first_frame') {
      labels.set(item.id, '首帧');
      continue;
    }
    if (item.role === 'last_frame') {
      labels.set(item.id, '尾帧');
      continue;
    }
    const next = (typeCounters.get(item.type) ?? 0) + 1;
    typeCounters.set(item.type, next);
    numberMap.set(item.id, next);
    labels.set(item.id, `${TYPE_LABELS[item.type]}${next}`);
  }
  return { labelOf: (id) => labels.get(id) ?? null, refItems, numberMap };
}
