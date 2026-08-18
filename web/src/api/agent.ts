/* ============================================
 * agent 接口：模板标签等首页内容
 * ============================================ */
import { apiRequest } from './http';

/** GET /api/agent/templates/tags 返回项 */
export interface TemplateTag {
  /** 标签映射值（后续拉取卡片内容用） */
  tag_code: string;
  /** 展示文字 */
  label: string;
}

/** 首页画廊标签列表（模块级缓存：StrictMode 双挂载/重复进入首页只发一次请求；失败释放缓存可重试） */
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

/** GET /api/agent/templates/page 卡片记录 */
export interface TemplateRecord {
  /** 卡片内展示的文字 */
  title: string;
  /** 鼠标悬停自动播放的视频 */
  video: string;
  /** 展示图片：第二张为主展示，第一/三张稍后调整 */
  images: string[];
  /** 图片展示样式（wide 为默认，后续扩展） */
  layout: string;
  /** 模板描述文案，可能为 null */
  content: string | null;
}

/** GET /api/agent/templates/page 分页数据 */
export interface TemplatePageData {
  records: TemplateRecord[];
  total: number;
  current: number;
  size: number;
  pages: number;
}

/** 标签下卡片列表（分页缓存：StrictMode 双挂载/tab 来回切换只发一次请求；失败释放缓存可重试） */
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
