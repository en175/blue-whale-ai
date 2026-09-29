/* ============================================
 * 后台管理 API · 充值档位（定价目录 / 档位目录）。
 *
 * 从 admin.ts 拆出来的域模块（IKJ058）：一个文件一个领域，
 * 读接口自带 `queryOptions` 工厂，页面不必再各自拼 key。
 * ============================================ */
import { http, apiRequestWithMeta } from './http';

/**
 * 上架状态三态（PRD §10.5）。
 *
 * ⚠️ `draft` 是**新建的默认值**：新建卡片落在草稿、不展示给用户，
 * 运营把字段配齐再显式上架。存量档位已经是上架/下架，不会被回退成草稿。
 */
export type TopupTierStatus = 'draft' | 'active' | 'inactive';

/**
 * 购买权限（PRD §10.4）。
 *
 * ⚠️ `member_tier`（指定会员等级）是**阶段 2** 的事，本阶段只在枚举里占位、
 * 不做判断。本阶段真正生效的是 `all` 与 `user_group`。
 */
export type TopupTierPermission = 'all' | 'user_group' | 'member_tier';

/** 充值档位记录 */
export interface TopupTier {
  /** 档位 ID（string） */
  id: string;
  /** 档位名称 */
  name: string;
  /**
   * 基础积分：用户下单到账的积分（整数）。**运营配置的值，不是派生值**
   * （2026-09-27 起；充值常有折扣，¥499 的档给 7,500 而不是 499×15=7,485）。
   *
   * ⚠️ `originalPrice` / `discount` 只为展示划线价，**与积分再无数学关系** ——
   * 别拿积分去除原价、也别用「原价 × 换算率」在地推它。
   */
  baseCredits: number;
  /** 原价（元），正整数。与折扣一起构成划线价，不参与积分计算 */
  originalPrice: number;
  /** 折扣比例 (0, 1]，1 表示无折扣 */
  discount: number;
  /** 实付价格（元）= 原价 × 折扣，保留两位小数 */
  price: number;
  /** 是否推荐档位 */
  isRecommended: boolean;
  /** 上架状态：draft 草稿（新建默认）/ active 上架 / inactive 下架 */
  status: TopupTierStatus;
  /** 生效时间（ISO），null 表示不限 */
  startTime: string | null;
  /** 失效时间（ISO），null 表示不限 */
  endTime: string | null;
  /** 排序序号，数字越小越靠前 */
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
  /* ── PRD §10.2 卡片展示与首购活动 ── */
  /** 卡片说明；'' = 未填 */
  description: string;
  /** 首购/活动赠送积分；0 = 不赠送 */
  bonusCredits: number;
  /** 活动标签（如「首购加赠 50%」）；'' = 无标签。已首购用户在用户侧隐藏 */
  activityTag: string;
  /** 购买按钮文案，默认「立享加赠」 */
  buttonText: string;
  /** 是否参与首购加赠 */
  firstPurchaseEligible: boolean;
  /** 到账积分有效期，单位**月**（默认 24 = 2 年） */
  creditsValidMonths: number;
  /** 购买权限 */
  permission: TopupTierPermission;
  /**
   * 权限白名单（userId 列表）。
   *
   * ⚠️ 元素是**十进制字符串**而不是 number：userId 是 BigInt，超过 JS 安全整数范围后
   * number 会静默改值，而白名单错一位就是放进来一个陌生人。服务端读到 NULL 时归一成 `[]`。
   */
  permissionAllowlist: string[];
  /** 无权限提示；'' = 用默认文案 */
  permissionDeniedHint: string;
}

/** `GET /api/admin/topup-tiers` 的回包。 */
export interface TopupTierList {
  tiers: TopupTier[];
  // ⚠️ 这里**曾经**回 `creditsPerYuan`，唯一的用途是让表单「边输价格边显示会到账多少积分」。
  //    2026-09-27 起积分是配置值（`baseCredits`），那条派生关系废掉了，字段随之删除——
  //    留着它只会诱导下一个人在表单里重新乘一遍（而充值有折扣时乘出来就是错的）。
}

/** 获取全部充值档位列表（含停用），按 sortOrder 排序展示 */
export function fetchTopupTiers() {
  return http.get<TopupTierList>('/api/admin/topup-tiers');
}

/** POST /api/admin/topup-tiers 新建参数 */
export interface CreateTopupTierParams {
  /** 原价（元），须为正整数，同一原价只能有一个档位。只用于展示划线价，不参与积分计算 */
  originalPrice: number;
  /** 折扣比例 (0, 1] */
  discount: number;
  /**
   * 基础积分（用户下单到账的积分，整数 >= 1）。**必填**：服务端不替运营猜
   * （猜「原价 × 换算率」在充值有折扣时就是错的数）。0 积分的档位无法下单。
   */
  baseCredits: number;
  name?: string;
  isRecommended?: boolean;
  /** 不传 = draft（PRD §10.5：新建卡片默认草稿，不展示给用户） */
  status?: TopupTierStatus;
  /** 生效时间（ISO），留空表示永久有效 */
  startTime?: string;
  /** 失效时间（ISO），留空表示永久有效 */
  endTime?: string;
  description?: string;
  bonusCredits?: number;
  activityTag?: string;
  buttonText?: string;
  firstPurchaseEligible?: boolean;
  /** 积分有效期，单位月；1–1200 */
  creditsValidMonths?: number;
  permission?: TopupTierPermission;
  /** null = 清空；[] = 名单为空 */
  permissionAllowlist?: string[] | null;
  permissionDeniedHint?: string;
}

/** PUT /api/admin/topup-tiers/:id 部分更新参数（startTime/endTime 传空字符串清空） */
export interface UpdateTopupTierParams {
  originalPrice?: number;
  discount?: number;
  /** 基础积分（配置值）：传了才改；改原价**不会**连带改积分 */
  baseCredits?: number;
  name?: string;
  isRecommended?: boolean;
  status?: TopupTierStatus;
  startTime?: string;
  endTime?: string;
  description?: string;
  bonusCredits?: number;
  activityTag?: string;
  buttonText?: string;
  firstPurchaseEligible?: boolean;
  creditsValidMonths?: number;
  permission?: TopupTierPermission;
  permissionAllowlist?: string[] | null;
  permissionDeniedHint?: string;
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
  baseCredits: number;
  originalPrice: number;
  price: number;
  status: TopupTierStatus;
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
  /** 到账积分数 = 档位配的基础积分（配置值，不是派生） */
  baseCredits: number;
  /** 原价（元）：与折扣一起构成划线价，不参与积分计算 */
  originalPrice: number;
  /** 折扣比例 */
  discount: number;
  /** 实付价格（元） */
  price: number;
  /** 是否推荐，前端显示推荐标签 */
  isRecommended: boolean;
  status: TopupTierStatus;
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
