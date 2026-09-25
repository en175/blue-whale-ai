/* ============================================
 * 后台管理 API：会话身份校验 + 仪表盘统计
 * 包络为后台侧 {success:true, data}，http 层已兼容
 * ============================================ */
import { http, apiRequest, apiRequestWithMeta } from './http';
import { useAuthStore } from '@/stores/auth';

/** GET /api/admin/session 返回：当前登录用户的管理员身份 */
export interface AdminSessionData {
  /** 管理员用户 ID */
  userId: number;
  /** 是否为管理员，true 表示有管理权限 */
  isAdmin: boolean;
}

/** 实时校验当前登录用户是否为管理员（登录态走 HttpOnly cookie） */
export function fetchAdminSession() {
  return http.get<AdminSessionData>('/api/admin/session', { silent: true });
}

/** 最近充值记录（最近 5 笔） */
export interface RechargeRecord {
  /** 订单号 */
  tradeNo: string;
  userId: number;
  /** 用户昵称（列表场景留空，前端展示 #userId） */
  nickname: string;
  phone: string;
  /** 充值档位名称 */
  tierName: string;
  /** 充值积分数量 */
  amount: number;
  /** 支付金额（元） */
  price: number;
  /** 到账积分 */
  points: number;
  /** 赠送积分 */
  bonus: number;
  /** 订单状态：pending 待支付 / success 已到账 / expired 已过期 / failed 支付失败 */
  status: string;
  paymentMethod: string;
  platformRefNo: string;
  ip: string;
  /** 创建时间（ISO） */
  createdAt: string;
  /** 支付时间（ISO），未支付时为 null */
  paidAt: string | null;
  /** 到账时间（ISO），未到账时为 null */
  arrivedAt: string | null;
}

/** 最近消费记录（最近 5 笔） */
export interface ConsumeRecord {
  userId: number;
  /** 消费的模型名称 */
  model: string;
  /** 消费积分数量 */
  points: number;
  /** 消费时间（ISO） */
  createdAt: string;
}

/** GET /api/admin/dashboard 返回：仪表盘运行概览 */
export interface DashboardData {
  /** 总用户数 */
  totalUsers: number;
  /** 今日充值积分总额 */
  todayRecharge: number;
  /** 今日充值笔数 */
  todayRechargeCount: number;
  /** 今日消费积分总额 */
  todaySpend: number;
  /** 待处理订单数 */
  pendingOrders: number;
  /** 最近 5 笔充值记录 */
  recentRecharges: RechargeRecord[];
  /** 最近 5 笔消费记录 */
  recentConsumes: ConsumeRecord[];
}

/** 获取仪表盘运行概览统计 */
export function fetchAdminDashboard() {
  return http.get<DashboardData>('/api/admin/dashboard');
}

/** 充值档位记录 */
export interface TopupTier {
  /** 档位 ID（string） */
  id: string;
  /** 档位名称 */
  name: string;
  /** 到账积分数（服务端派生：原价 × 500000） */
  amount: number;
  /** 原价（元），正整数，主输入字段 */
  originalPrice: number;
  /** 折扣比例 (0, 1]，1 表示无折扣 */
  discount: number;
  /** 实付价格（元）= 原价 × 折扣，保留两位小数 */
  price: number;
  /** 是否推荐档位 */
  isRecommended: boolean;
  /** 状态：active 启用 / inactive 停用 */
  status: 'active' | 'inactive';
  /** 生效时间（ISO），null 表示不限 */
  startTime: string | null;
  /** 失效时间（ISO），null 表示不限 */
  endTime: string | null;
  /** 排序序号，数字越小越靠前 */
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

/** 获取全部充值档位列表（含停用），按 sortOrder 排序展示 */
export function fetchTopupTiers() {
  return http.get<TopupTier[]>('/api/admin/topup-tiers');
}

/** POST /api/admin/topup-tiers 新建参数（amount 服务端派生，客户端传入会被忽略） */
export interface CreateTopupTierParams {
  /** 原价（元），须为正整数，同一原价只能有一个档位 */
  originalPrice: number;
  /** 折扣比例 (0, 1] */
  discount: number;
  name?: string;
  isRecommended?: boolean;
  status?: 'active' | 'inactive';
  /** 生效时间（ISO），留空表示永久有效 */
  startTime?: string;
  /** 失效时间（ISO），留空表示永久有效 */
  endTime?: string;
}

/** PUT /api/admin/topup-tiers/:id 部分更新参数（startTime/endTime 传空字符串清空） */
export interface UpdateTopupTierParams {
  originalPrice?: number;
  discount?: number;
  name?: string;
  isRecommended?: boolean;
  status?: 'active' | 'inactive';
  startTime?: string;
  endTime?: string;
}

/** 新建档位（包络可能携带 Go 折扣同步警告） */
export function createTopupTier(params: CreateTopupTierParams) {
  return apiRequestWithMeta<TopupTier>('/api/admin/topup-tiers', {
    method: 'POST',
    body: JSON.stringify(params),
  });
}

/** 编辑档位（部分更新，未传字段保持不变） */
export function updateTopupTier(id: string, params: UpdateTopupTierParams) {
  return apiRequestWithMeta<TopupTier>(`/api/admin/topup-tiers/${id}`, {
    method: 'PUT',
    body: JSON.stringify(params),
  });
}

/** 删除档位（逻辑删除，包络可能携带 Go 折扣同步警告） */
export function deleteTopupTier(id: string) {
  return apiRequestWithMeta<null>(`/api/admin/topup-tiers/${id}`, {
    method: 'DELETE',
  });
}

/** PUT /api/admin/topup-tiers/sort 排序项 */
export interface SortTopupTierItem {
  /** 档位 ID（正整数格式字符串） */
  id: string;
  /** 新排序序号（整数） */
  sortOrder: number;
}

/** 排序响应项（字段子集） */
export interface SortTopupTierResult {
  id: string;
  sortOrder: number;
  amount: number;
  originalPrice: number;
  price: number;
  status: 'active' | 'inactive';
}

/** 提交全量排序数组（本地交换后调用） */
export function sortTopupTiers(items: SortTopupTierItem[]) {
  return apiRequestWithMeta<SortTopupTierResult[]>('/api/admin/topup-tiers/sort', {
    method: 'PUT',
    body: JSON.stringify({ items }),
  });
}

/** 用户端预览档位（已上架且未失效，服务端过滤） */
export interface TopupTierPreview {
  id: string;
  /** 到账积分数 */
  amount: number;
  /** 原价（元） */
  originalPrice: number;
  /** 折扣比例 */
  discount: number;
  /** 实付价格（元） */
  price: number;
  /** 是否推荐，前端显示推荐标签 */
  isRecommended: boolean;
  status: 'active' | 'inactive';
}

/** 获取用户端充值页预览列表 */
export function fetchTopupTierPreview() {
  return http.get<TopupTierPreview[]>('/api/admin/topup-tiers/preview');
}

/** PUT /api/admin/topup-tiers/sync 全量同步折扣到 Go 结果 */
export interface SyncTiersData {
  /** 成功同步的档位数量 */
  synced: number;
  /** 当前 active 档位总数 */
  total: number;
}

/** 全量同步折扣到 Go payment_setting.amount_discount */
export function syncTopupTiersToGo() {
  return apiRequestWithMeta<SyncTiersData>('/api/admin/topup-tiers/sync', {
    method: 'PUT',
  });
}

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

/** 官方技能（管理视图） */
export interface AdminSkill {
  id: string;
  name: string;
  cover_url: string | null;
  category: string;
  sort_order: number;
}

/** 分类聚合（含计数） */
export interface AdminSkillCategory {
  name: string;
  count: number;
}

/** GET /api/admin/skills 官方技能列表 */
export function fetchAdminSkills() {
  return http.get<AdminSkill[]>('/api/admin/skills');
}

/** GET /api/admin/skills/categories 现有分类（含计数） */
export function fetchAdminSkillCategories() {
  return http.get<AdminSkillCategory[]>('/api/admin/skills/categories');
}

/** PUT /api/admin/skills/:id/category 技能归类（新分类随归类创建） */
export function setAdminSkillCategory(id: string, category: string) {
  return apiRequest<{ id: string }>(`/api/admin/skills/${id}/category`, {
    method: 'PUT',
    body: JSON.stringify({ category }),
  });
}

/** PUT /api/admin/skills/assign 批量归类（IKA64P 效率优化） */
export function assignAdminSkillsCategory(ids: string[], category: string) {
  return apiRequest<{ count: number }>('/api/admin/skills/assign', {
    method: 'PUT',
    body: JSON.stringify({ ids, category }),
  });
}

/** PUT /api/admin/skills/categories/rename 分类批量改名 */
export function renameAdminSkillCategory(from: string, to: string) {
  return apiRequest<{ count: number }>('/api/admin/skills/categories/rename', {
    method: 'PUT',
    body: JSON.stringify({ from, to }),
  });
}

/** DELETE /api/admin/skills/categories/:name 删除分类（其下技能变未分类） */
export function deleteAdminSkillCategory(name: string) {
  return apiRequest<{ count: number }>(
    `/api/admin/skills/categories/${encodeURIComponent(name)}`,
    { method: 'DELETE' },
  );
}

/** POST /api/admin/template-images/:id/move 图片调序（数据层导出；前端图片排序走弹窗内本地操作 + 保存时整体同步，未直接调用） */
export function moveTemplateImage(id: string, direction: 'up' | 'down') {
  return apiRequest<{ id: string }>(`/api/admin/template-images/${id}/move`, {
    method: 'POST',
    body: JSON.stringify({ direction }),
  });
}

/** 模型分辨率档位 */
export interface ModelSize {
  id: string;
  label?: string;
}

/** 时长范围（消费端契约形态）。
 *  库中 `supported_durations` 有两种形态：管理端提交用数组 `[min,max,step]`，
 *  消费端契约、种子与迁移写入的是本对象形态。后台表单读回时必须两种都认，
 *  否则会把对象行读成空、保存时整列覆盖成 null（IKG4UR）。 */
export interface DurationRange {
  min: number;
  max: number;
  step?: number;
}

/** 模型能力记录（generation_model_capability） */
export interface AdminModel {
  /** 行ID（bigint string） */
  id: string;
  /** 供应商ID（系统写死，管理端不再填写） */
  provider_id: string;
  /** 模型唯一标识 */
  model_id: string;
  /** 能力类型：image / video / text / audio */
  capability_type: 'image' | 'video' | 'text' | 'audio';
  /** 模型展示名称 */
  model_label: string;
  /** 图标 URL 或名称，无图标时为 null */
  icon: string | null;
  /** 支持的分辨率档位列表 */
  supported_sizes: ModelSize[];
  /** 支持的宽高比字符串数组 */
  supported_aspect_ratios: string[];
  /** 支持的视频时长（秒），图片/文生文为 null。读回时可能是数组（管理端写入）
   *  或 DurationRange（消费端契约/种子写入）——IKG4UR */
  supported_durations: number[] | DurationRange | null;
  /** 支持的输出格式字符串数组 */
  supported_formats: string[];
  /** 默认分辨率档位 */
  default_size: string | null;
  /** 默认输出格式，无默认时为 null */
  default_format: string | null;
  /** 默认宽高比 */
  default_aspect_ratio: string | null;
  /** 默认视频时长（秒），图片/文生文为 null */
  default_duration: number | null;
  /** 特性开关 JSON 对象 */
  features: Record<string, unknown>;
  /** 图片渠道解析器：seedream / gpt / banana */
  channel_parser?: string | null;
  /** 图片请求映射（gpt 交叉格 / banana 一维表）；seedream 为 null */
  request_mapping?: unknown;
  /** 是否启用：true 在 dock 展示 / false 隐藏 */
  enabled: boolean;
  /** 排序序号，同类型内越小越靠前 */
  sort_order: number;
  /** 是否为该能力类型的默认模型：同类型内至多一条 */
  is_default: boolean;
  created_at: string;
  updated_at: string;
}

/** GET /api/admin/models 获取全部未软删模型（含停用），按类型分 tab，同类型内按 sort_order 排序 */
export function fetchAdminModels() {
  return http.get<AdminModel[]>('/api/admin/models');
}

/** POST /api/admin/models 新建模型入参（复制自某模型为前端预填，服务端不感知 copy_source） */
export interface CreateAdminModelParams {
  provider_id?: string;
  model_id: string;
  capability_type: 'image' | 'video' | 'text' | 'audio';
  model_label: string;
  /** 留空为 null */
  icon?: string | null;
  supported_sizes?: ModelSize[];
  supported_aspect_ratios?: string[];
  /** IKG4UR：写回保持原形态——数组行写数组、对象行写对象（两者在读侧语义不同） */
  supported_durations?: number[] | DurationRange | null;
  supported_formats?: string[];
  default_size?: string | null;
  default_format?: string | null;
  default_aspect_ratio?: string | null;
  default_duration?: number | null;
  features?: Record<string, unknown>;
  channel_parser?: string | null;
  request_mapping?: unknown;
  enabled?: boolean;
  /** 排序序号（编辑部分更新时可调序） */
  sort_order?: number;
}

/** POST /api/admin/models 新建模型 */
export function createAdminModel(params: CreateAdminModelParams) {
  return http.post<AdminModel>('/api/admin/models', params);
}

/** PUT /api/admin/models/:id 编辑模型（部分更新，仅提交变更字段；身份字段 provider_id/model_id/capability_type 创建后不可改） */
export function updateAdminModel(id: string, params: Partial<CreateAdminModelParams>) {
  return apiRequest<AdminModel>(`/api/admin/models/${id}`, {
    method: 'PUT',
    body: JSON.stringify(params),
  });
}

/** PATCH /api/admin/models/:id/toggle 启停切换：翻转 enabled，停用后 dock 与消费端不再返回该模型 */
export function toggleAdminModel(id: string) {
  return apiRequest<AdminModel>(`/api/admin/models/${id}/toggle`, {
    method: 'PATCH',
  });
}

/**
 * PATCH /api/admin/models/:id/default 设为该能力类型的默认模型。
 *
 * 同类型其它模型的默认标记由服务端在同一事务里清除，所以返回的是**整份列表**而不是单行。
 * 只设不清：取消默认之后消费端会退回列表第一条，那正是这个标记要消灭的状态。
 */
export function setAdminModelDefault(id: string) {
  return apiRequest<AdminModel[]>(`/api/admin/models/${id}/default`, {
    method: 'PATCH',
  });
}

/** DELETE /api/admin/models/:id 删除模型（软删除） */
export function deleteAdminModel(id: string) {
  return apiRequest<unknown>(`/api/admin/models/${id}`, {
    method: 'DELETE',
  });
}

/** 后台用户记录 */
export interface AdminUserRow {
  /** 用户ID */
  userId: number;
  nickname: string;
  phone: string;
  /** 当前积分余额 */
  balance: number;
  /** 累计充值积分总额 */
  totalRecharge: number;
  /** 累计消费积分总额 */
  totalSpend: number;
  /** 角色：1 普通用户 / 10 管理员 / 100 root */
  role: number;
  /** 账户状态：active 正常 / disabled 已冻结 */
  status: 'active' | 'disabled';
  /** 注册时间（ISO） */
  createdAt: string;
  /** 最后更新时间（ISO） */
  updatedAt: string;
}

/** GET /api/admin/users 返回 */
export interface AdminUserListData {
  list: AdminUserRow[];
  /** 符合条件的总记录数 */
  total: number;
}

/** GET /api/admin/users 用户列表（keyword 匹配昵称/手机号/用户ID；status active/disabled；pageSize 最大 100）；请求头 New-Api-User 携带当前管理员 userId */
export function fetchAdminUsers(
  params: { keyword?: string; status?: string; role?: number; page?: number; pageSize?: number } = {}
) {
  const qs = new URLSearchParams();
  if (params.keyword) qs.set('keyword', params.keyword);
  if (params.status) qs.set('status', params.status);
  if (params.role !== undefined) qs.set('role', String(params.role));
  qs.set('page', String(params.page ?? 1));
  qs.set('pageSize', String(params.pageSize ?? 20));
  const adminUserId = useAuthStore.getState().user?.userId;
  return apiRequest<AdminUserListData>(`/api/admin/users?${qs.toString()}`, {
    method: 'GET',
    headers: adminUserId !== undefined ? { 'New-Api-User': String(adminUserId) } : {},
  });
}

/** 用户管理操作类型 */
export type UserManageAction = 'freeze' | 'unfreeze' | 'adjustBalance';

/** POST /api/admin/users/:userId/manage 冻结/解冻/调整积分（reason 必填；adjustBalance 时 value 非零，正增负减），服务端自动写审计日志 */
export function manageAdminUser(
  userId: number,
  params: { action: UserManageAction; reason: string; value?: number }
) {
  return apiRequest<null>(`/api/admin/users/${userId}/manage`, {
    method: 'POST',
    body: JSON.stringify(params),
  });
}

/** 审计日志记录 */
export interface OperationLog {
  /** 日志ID（bigint string） */
  id: string;
  /** 日志类别：user 用户管理 / order 订单管理 */
  category: string;
  /** 操作动作：user.freeze / user.unfreeze / user.adjust_balance / order.complete */
  action: string;
  /** 操作目标：用户页 user:{userId}；订单页为交易号 */
  target: string;
  /** 操作详情 JSON 字符串，含 reason（用户管理另含 value） */
  detail: string;
  /** 操作人用户名 */
  operator: string;
  /** 操作人 IP；后端未写入时为 null */
  ipAddress?: string | null;
  /** 操作时间（ISO） */
  createdAt: string;
}

/** GET /api/admin/operation-logs 查询审计日志（用户页：category=user + searchText=user:{userId}） */
export function fetchOperationLogs(
  params: { category?: string; searchText?: string; dateFrom?: string; dateTo?: string } = {}
) {
  const qs = new URLSearchParams();
  if (params.category) qs.set('category', params.category);
  if (params.searchText) qs.set('searchText', params.searchText);
  if (params.dateFrom) qs.set('dateFrom', params.dateFrom);
  if (params.dateTo) qs.set('dateTo', params.dateTo);
  const query = qs.toString();
  return apiRequest<OperationLog[]>(`/api/admin/operation-logs${query ? `?${query}` : ''}`);
}

/** POST /api/admin/operation-logs 审计写入入参（由各模块 BFF 调用，操作日志页不直接调用） */
export interface CreateOperationLogParams {
  /** 日志类别：model.capability / tier / order / user / template */
  category: string;
  /** 操作动作，如 user.adjust_balance / order.complete */
  action: string;
  /** 操作目标：user:{userId} / 交易号 / 模型ID / 档位ID / 标签code */
  target?: string;
  /** 目标用户ID（正整数格式 ≤19 位），仅涉及用户操作时传入 */
  targetUserId?: string;
  /** 操作详情，通常为 JSON 字符串 */
  detail?: string;
  /** 操作人用户名 */
  operator?: string;
  /** 操作人用户ID（正整数格式 ≤19 位） */
  operatorId?: string;
  /** 操作人 IP */
  ipAddress?: string;
}

/** POST /api/admin/operation-logs 审计写入（管理操作成功后的审计记录）；操作日志页面不直接调用。实测响应为完整 camelCase 日志记录（文档示例 snake_case 与实际不符） */
export function createOperationLog(params: CreateOperationLogParams) {
  return apiRequest<OperationLog>('/api/admin/operation-logs', {
    method: 'POST',
    body: JSON.stringify(params),
  });
}

/** 支付凭证（GET 回显为脱敏值） */
export interface SystemCredentials {
  /** 微信商户号 */
  wechat_mch_id: string;
  /** 微信 API Key */
  wechat_api_key: string;
  /** 支付宝 App ID */
  alipay_app_id: string;
  /** 支付宝私钥 */
  alipay_private_key: string;
}

/** 充值政策文案 */
export interface SystemPolicy {
  /** 退款政策文案 */
  refund_text: string;
  /** 发票政策文案 */
  invoice_text: string;
}

/** 限流配置 */
export interface SystemRateLimit {
  /** 每分钟请求上限 */
  rate_per_min: number;
  /** 每小时请求上限 */
  rate_per_hour: number;
  /** 并发上限 */
  concurrent: number;
  /** 突发倍数 */
  burst: number;
}

/** 系统配置全集 */
export interface SystemSettings {
  /** 支付凭证（脱敏回显） */
  credentials: SystemCredentials;
  /** 充值政策文案 */
  policy: SystemPolicy;
  /** 限流配置 */
  rateLimit: SystemRateLimit;
}

/** GET /api/admin/settings 获取全部系统配置（支付凭证脱敏回显）——规划接口，后端暂未实现 */
export function fetchAdminSettings() {
  return apiRequest<SystemSettings>('/api/admin/settings');
}

/** PUT /api/admin/settings 按模块部分更新（支持按 key 增量更新）——规划接口，后端暂未实现 */
export function updateAdminSettings(
  params: Partial<{
    credentials: Partial<SystemCredentials>;
    policy: Partial<SystemPolicy>;
    rateLimit: Partial<SystemRateLimit>;
  }>
) {
  return apiRequest<null>('/api/admin/settings', {
    method: 'PUT',
    body: JSON.stringify(params),
  });
}
