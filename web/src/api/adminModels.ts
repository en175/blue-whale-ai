/* ============================================
 * 后台管理 API · 生成模型能力目录。
 *
 * 从 admin.ts 拆出来的域模块（IKJ058）：一个文件一个领域，
 * 读接口自带 `queryOptions` 工厂，页面不必再各自拼 key。
 * ============================================ */
import { http, apiRequest } from './http';

/** 模型分辨率档位。
 *
 *  ⚠️ 这只是**读侧最保守**的形态：wire 上的元素还带出站值（`api_value`）与像素宽高
 *  （库里 `generation_model_capability.supported_sizes` 就是 `{id,label,api_value,width,height}`）。
 *  读它们的消费方按 `unknown` 收（`sizeCandidates.ts` 的 `toCapabilitySize`、
 *  `model-form.ts` 的 `sizesFromModel`，两者都两种键形都认），**刻意不在这里声明成可选字段**
 *  ——`width` 在这两处是字符串、在 wire 上是数字，声明进来会让 ModelList 表单的 `SizeForm`
 *  与这里打架，而收益只是少一次断言。 */
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
  /** 渠道（`channel` 列，封闭枚举 `<家族>-<媒介>[-<协议>]`）：决定请求怎么解析、出站用哪种线协议。
   *  取值与标签见 `admin/pages/ModelList/model-form.ts` 的 `CHANNELS`。
   *  空值按行的 `capability_type` 回落（防御脏数据，正常行恒有值）。 */
  channel?: string | null;
  /** 图片请求映射（gpt 交叉格 / banana 一维表）；seedream 为 null */
  request_mapping?: unknown;
  /**
   * 该模型该能力的**计价规则**（`generation_model_capability.pricing` 列）。
   *
   * 形态与定价目录里 `document.models.<model_id>.<capability_type>` 那条**逐字相同**
   * （解析/换算见 `admin/lib/billing-catalog/catalogDraft.ts` 的 `CatalogRuleView`）。
   * `null` = 还没搬到能力行上，billing 侧回落到定价目录那份。
   */
  pricing?: unknown;
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
  /** 渠道（封闭枚举，见 {@link AdminModel.channel}）。解析与出站的唯一来源。 */
  channel?: string | null;
  /** 图片请求映射（gpt 交叉格 / banana 一维表）；seedream 为 null */
  request_mapping?: unknown;
  /** 计价规则（形态见 {@link AdminModel.pricing}）；`undefined` = 不改，`null` = 清空 */
  pricing?: unknown;
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
