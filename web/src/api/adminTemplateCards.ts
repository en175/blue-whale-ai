/* ============================================
 * 后台管理 API · 首页模板卡片与模板标签。
 *
 * 从 admin.ts 拆出来的域模块（IKJ058）：一个文件一个领域，
 * 读接口自带 `queryOptions` 工厂，页面不必再各自拼 key。
 * ============================================ */
import { http, apiRequest } from './http';

/** 模板卡片图片 */
export interface TemplateImage {
  /** 图片 ID（bigint string） */
  id: string;
  image_url: string;
  sort_order: number;
}

/** 模板卡片记录 */
export interface TemplateCard {
  /** 卡片 ID（bigint string） */
  id: string;
  /** 所属标签 code */
  tag_code: string;
  title: string;
  /** 提示词内容（点击卡片时带入 dock 输入框；留空则兜底用标题） */
  content: string | null;
  /** 视频 URL（hover 播放），无视频时为 null */
  video_url: string | null;
  /** 渲染形态：wide 横版视频卡 / portrait 竖版卡 / social 社媒小卡 / image 图片卡 */
  layout: string;
  /** 排序序号，同 tag 内越小越靠前 */
  sort_order: number;
  /** 卡片图片列表，顺序即展示顺序 */
  images: TemplateImage[];
}

/** GET /api/admin/templates?tagCode= 获取模板卡片列表（含图片），按 tag + sort_order 排序 */
export function fetchTemplateCards(tagCode?: string) {
  const qs = tagCode ? `?tagCode=${encodeURIComponent(tagCode)}` : '';
  return http.get<TemplateCard[]>(`/api/admin/templates${qs}`);
}

/** 新建/编辑模板卡片入参（编辑为全量更新，未传字段会丢失） */
export interface TemplateCardPayload {
  title: string;
  tag_code: string;
  layout: string;
  sort_order: number;
  video_url?: string;
  content?: string;
  /** 图片列表最多 20 张；编辑时已有图片传 id 保留，不传 id 视为软删 */
  images?: { id?: string; image_url: string }[];
}

/** 新建模板卡片，返回新卡片 ID */
export function createTemplateCard(params: TemplateCardPayload) {
  return http.post<{ id: string }>('/api/admin/templates', params);
}

/** 编辑模板卡片（全量更新），返回卡片 ID */
export function updateTemplateCard(id: string, params: TemplateCardPayload) {
  return apiRequest<{ id: string }>(`/api/admin/templates/${id}`, {
    method: 'PUT',
    body: JSON.stringify(params),
  });
}

/** 删除模板卡片（软删除，首页立即不可见，数据可恢复） */
export function deleteTemplateCard(id: string) {
  return apiRequest<{ id: string }>(`/api/admin/templates/${id}`, {
    method: 'DELETE',
  });
}

/** POST /api/admin/templates/:id/move 卡片排序（同 tag 内），已在边缘（最前/最后）时返回 409 */
export function moveTemplateCard(id: string, direction: 'up' | 'down') {
  return apiRequest<{ id: string }>(`/api/admin/templates/${id}/move`, {
    method: 'POST',
    body: JSON.stringify({ direction }),
  });
}

/** 后台标签项 */
export interface AdminTemplateTag {
  /** 标签唯一 code，固定不可改 */
  tag_code: string;
  /** 标签显示名称，可改名 */
  label: string;
  /** 可见性（IKA64P）：1 首页可见 / 0 隐藏 */
  visible: number;
}

/** GET /api/admin/template-tags 获取全部标签（按 sort_order 升序），用于筛选条与表单下拉 */
export function fetchAdminTemplateTags() {
  return http.get<AdminTemplateTag[]>('/api/admin/template-tags');
}

/** PUT /api/admin/template-tags 标签改名（tag_code 与顺序固定不可改，label 最长 128 字符） */
export function renameAdminTemplateTag(tag_code: string, label: string) {
  return apiRequest<{ tag_code: string }>('/api/admin/template-tags', {
    method: 'PUT',
    body: JSON.stringify({ tag_code, label }),
  });
}

/** PUT /api/admin/template-tags/visibility 标签隐藏开关（IKA64P，首页即时生效） */
export function setTemplateTagVisibility(tag_code: string, visible: number) {
  return apiRequest<{ tag_code: string; visible: number }>(
    '/api/admin/template-tags/visibility',
    { method: 'PUT', body: JSON.stringify({ tag_code, visible }) },
  );
}

/** 模板媒体上传 presign 返回 */
export interface TemplateUploadPresignData {
  /** 存储键（admin/templates/ 前缀），complete 时使用 */
  storage_key: string;
  /** 预签名上传 URL，第二步 PUT 直传 */
  upload_url: string;
  /** 第二步 PUT 需携带的请求头 */
  headers: Record<string, string>;
  /** 预签名 URL 有效期（秒） */
  expires_in: number;
}

/** POST /api/admin/templates/uploads/presign 三步上传第一步：签发 TOS PUT URL（图片 ≤20MB，视频 ≤200MB） */
export function presignTemplateMedia(params: { type: 'image' | 'video'; mime: string; size: number }) {
  return http.post<TemplateUploadPresignData>('/api/admin/templates/uploads/presign', params);
}

/** POST /api/admin/templates/uploads/complete 三步上传第三步：校验后返回公网 URL，可直接填入卡片 */
export function completeTemplateMedia(params: {
  type: 'image' | 'video';
  mime: string;
  size: number;
  storage_key: string;
}) {
  return apiRequest<{ url: string }>('/api/admin/templates/uploads/complete', {
    method: 'POST',
    body: JSON.stringify(params),
  });
}

/* ============ 技能管理（IKA64P） ============ */

/** POST /api/admin/template-images/:id/move 图片调序（数据层导出；前端图片排序走弹窗内本地操作 + 保存时整体同步，未直接调用） */
export function moveTemplateImage(id: string, direction: 'up' | 'down') {
  return apiRequest<{ id: string }>(`/api/admin/template-images/${id}/move`, {
    method: 'POST',
    body: JSON.stringify({ direction }),
  });
}
