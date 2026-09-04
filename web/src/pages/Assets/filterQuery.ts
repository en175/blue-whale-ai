import type { AssetType } from '@/api/assets';

export type FilterKey = 'all' | AssetType | 'liveness';

const filterKeys: readonly FilterKey[] = ['all', 'image', 'video', 'audio', 'character', 'liveness'];

/** 从 URL 查询参数读取素材类型；缺失和未知值都回退到全部。 */
export function getAssetFilter(searchParams: URLSearchParams): FilterKey {
  const type = searchParams.get('type');
  return filterKeys.includes(type as FilterKey) ? type as FilterKey : 'all';
}

/** 更新素材类型筛选，同时保留页面上其他查询参数。 */
export function setAssetFilter(searchParams: URLSearchParams, filter: FilterKey): URLSearchParams {
  const next = new URLSearchParams(searchParams);
  if (filter === 'all') {
    next.delete('type');
  } else {
    next.set('type', filter);
  }
  return next;
}
