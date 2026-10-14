import type { AssetType } from '@/api/assets';

export type FilterKey = 'all' | AssetType | 'liveness';

const filterKeys: readonly FilterKey[] = ['all', 'image', 'video', 'audio', 'character', 'liveness'];

export function getAssetFilter(searchParams: URLSearchParams): FilterKey {
  const type = searchParams.get('type');
  return filterKeys.includes(type as FilterKey) ? type as FilterKey : 'all';
}

export function setAssetFilter(searchParams: URLSearchParams, filter: FilterKey): URLSearchParams {
  const next = new URLSearchParams(searchParams);
  if (filter === 'all') {
    next.delete('type');
  } else {
    next.set('type', filter);
  }
  return next;
}
