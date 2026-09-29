/* ============================================
 * 后台管理 API · 系统设置（凭证 / 上游 / 策略 / 限流）。
 *
 * 从 admin.ts 拆出来的域模块（IKJ058）：一个文件一个领域，
 * 读接口自带 `queryOptions` 工厂，页面不必再各自拼 key。
 * ============================================ */
import { queryOptions } from '@tanstack/react-query';
import { apiRequest } from './http';

/** 支付凭证（GET 回显：secret 字段为脱敏值） */
export interface SystemCredentials {
  /** 杭州银行商户号（支付网关侧的商户编号） */
  hccb_mch_no: string;
  /** 商户应用 ID（支付网关侧 appId） */
  hccb_app_id: string;
  /** 商户密钥 appSecret（**密**，回显脱敏） */
  hccb_app_secret: string;
  /** 异步通知地址（支付网关回调我们，须公网可达） */
  hccb_notify_url: string;
}

/** 上游（new-api）凭证（GET 回显：secret 字段为脱敏值） */
export interface SystemUpstream {
  /** new-api 项目统一 key（**密**，回显脱敏）——全项目共用这一把 */
  new_api_key: string;
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
  /** 上游 new-api 凭证（脱敏回显） */
  upstream: SystemUpstream;
  /** 充值政策文案 */
  policy: SystemPolicy;
  /** 限流配置 */
  rateLimit: SystemRateLimit;
}

/** GET /api/admin/settings 获取全部系统配置（凭证类字段脱敏回显） */
export function fetchAdminSettings() {
  return apiRequest<SystemSettings>('/api/admin/settings');
}

/** PUT /api/admin/settings 按模块部分更新（支持按 key 增量更新） */
export function updateAdminSettings(
  params: Partial<{
    credentials: Partial<SystemCredentials>;
    upstream: Partial<SystemUpstream>;
    policy: Partial<SystemPolicy>;
    rateLimit: Partial<SystemRateLimit>;
  }>
) {
  return apiRequest<null>('/api/admin/settings', {
    method: 'PUT',
    body: JSON.stringify(params),
  });
}

// ---------- TanStack Query 工厂 ----------

export const adminSettingsKeys = {
  all: ['admin-settings'] as const,
};

export function adminSettingsOptions() {
  return queryOptions({
    queryKey: adminSettingsKeys.all,
    queryFn: () => fetchAdminSettings(),
  });
}
