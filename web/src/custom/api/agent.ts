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
  title: string;
  video: string;
  images: string[];
  layout: string;
  content: string | null;
}

export interface TemplatePageData {
  records: TemplateRecord[];
  total: number;
  current: number;
  size: number;
  pages: number;
}

const pageCache = new Map<string, Promise<TemplatePageData>>();

export function fetchTemplatePage(tagCode: string, page = 1, size = 50) {
  const key = `${tagCode}|${page}|${size}`;
  let pending = pageCache.get(key);
  if (!pending) {
    pending = apiRequest<TemplatePageData>(
      `/api/agent/templates/page?tagCode=${encodeURIComponent(tagCode)}&page=${page}&size=${size}`
    ).catch((e) => {
      pageCache.delete(key);
      throw e;
    });
    pageCache.set(key, pending);
  }
  return pending;
}
