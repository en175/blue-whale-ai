import { apiRequest } from '@/shared/api/http';

export interface TemplateTag {
  tag_code: string;
  label: string;
}

let tagsPromise: Promise<TemplateTag[]> | null = null;

export function fetchTemplateTags() {
  if (!tagsPromise) {
    tagsPromise = apiRequest<TemplateTag[]>('/api/agent/templates/tags').catch((e) => {
      tagsPromise = null;
      throw e;
    });
  }
  return tagsPromise;
}

export interface TemplateRecord {
  tag_code?: string;
  title: string;
  video: string | null;
  images: string[];
  layout: string;
  content: string | null;
  is_featured?: number | boolean;
}

export interface TemplatePageData {
  records: TemplateRecord[];
  total: number;
  current: number;
  size: number;
  pages: number;
}

const pageCache = new Map<string, Promise<TemplatePageData>>();

export function fetchTemplatePage(
  tagCode?: string,
  page = 1,
  size = 50,
  options?: { isFeatured?: boolean },
) {
  const featured = options?.isFeatured ? '1' : '';
  const key = `${tagCode ?? ''}|${page}|${size}|${featured}`;
  let pending = pageCache.get(key);
  if (!pending) {
    const params = new URLSearchParams({ page: String(page), size: String(size) });
    if (tagCode) params.set('tagCode', tagCode);
    if (featured) params.set('isFeatured', featured);
    pending = apiRequest<TemplatePageData>(`/api/agent/templates/page?${params.toString()}`).catch((e) => {
      pageCache.delete(key);
      throw e;
    });
    pageCache.set(key, pending);
  }
  return pending;
}
