/* ============================================
 * 管理端 API：自定义充值配置（`GET/PUT /api/admin/recharge-custom-config`，PRD §10.3）
 *
 * 单行配置，只有读与保存两个动作 —— 没有新建/删除：它本来就只有一份，
 * 「删掉配置」不是一个有意义的状态（删了用户侧拿什么报价？）。要停用就把 `enabled`
 * 改成 false，那是一个能被展示、能被解释的状态。
 *
 * ⚠️ 保存是**部分更新**：只传要改的键，不传的保持原值。本页一次提交整份（见页面），
 *    所以这里把全部字段都标成可选 —— 服务端缺的键**不会落默认值**，那会让
 *    「只改下限」的操作把上限悄悄重置成 499995。
 * ============================================ */
import { queryOptions } from '@tanstack/react-query';
import { apiRequestWithMeta } from './http';
import type { TopupTierPermission } from './admin';

/** 配置视图（服务端 `RechargeCustomConfigView` 的逐字对应，字段名是 camelCase） */
export interface AdminRechargeCustomConfig {
  /** 最低充值积分（PRD §7.1 默认 600 = ¥40） */
  minCredits: number;
  /** 最高充值积分（PRD §7.1 默认 499,995） */
  maxCredits: number;
  /** 默认选中积分（PRD §7.1 默认 600） */
  defaultCredits: number;
  /**
   * 每元积分数（PRD §7.1 默认 15）—— **自定义充值自己的**换算率，
   * 价格 = 积分数 ÷ 它。与消费锚点「1 元 = 15 积分」不是一个数（见页面说明）。
   */
  creditsPerYuan: number;
  /** 积分步长（PRD §10.3）。滑杆步进与手输修正用 */
  stepCredits: number;
  /** 是否启用。false = 用户侧不展示自定义充值，下单被拒 */
  enabled: boolean;
  /** 购买权限。枚举与档位**同一套**（PRD §10.3「与固定积分卡一致」） */
  permission: TopupTierPermission;
  /** 白名单（userId 十进制字符串）。读出恒为数组：列的 NULL 归一成 [] */
  permissionAllowlist: string[];
  /** 无权限提示；空串 = 用服务端默认文案 */
  permissionDeniedHint: string;
  /** 到账积分有效期，单位**月**（默认 24 = 2 年） */
  creditsValidMonths: number;
  /** 配置版本，每保存一次 +1（下单时快照进订单） */
  version: number;
  /** 配置最后更新时间（ISO 8601）：管理端展示「当前口径是什么时候定的」 */
  updatedAt: string;
  /** 服务端补的中文枚举名，免得每个页面各写一份映射 */
  permissionLabel?: string;
}

/** 保存入参：只传要改的键（本页提交整份） */
export interface SaveRechargeCustomConfigParams {
  minCredits?: number;
  maxCredits?: number;
  defaultCredits?: number;
  creditsPerYuan?: number;
  stepCredits?: number;
  enabled?: boolean;
  permission?: TopupTierPermission;
  /** null = 显式清空；数组 = 覆盖成这份名单（[] 与 null 的物理落点不同） */
  permissionAllowlist?: string[] | null;
  permissionDeniedHint?: string;
  creditsValidMonths?: number;
}

/** 读取当前配置（管理端，需管理员身份） */
export function fetchAdminRechargeCustomConfig() {
  return apiRequestWithMeta<AdminRechargeCustomConfig>('/api/admin/recharge-custom-config');
}

export const adminRechargeCustomConfigKeys = {
  all: ['admin-recharge-custom-config'] as const,
};

export function adminRechargeCustomConfigOptions() {
  return queryOptions({
    queryKey: adminRechargeCustomConfigKeys.all,
    queryFn: async () => (await fetchAdminRechargeCustomConfig()).data,
  });
}

/**
 * 保存配置（**部分更新**）。返回包络级 warning（服务端在配置落库后有非致命告警时给）。
 *
 * silent：页面自己有就地错误位（保存失败要有上下文，不能让一个 toast 飞过去就没了），
 * 而且保存是低频的显式动作，用户就盯着这个按钮。
 */
export function saveAdminRechargeCustomConfig(params: SaveRechargeCustomConfigParams) {
  return apiRequestWithMeta<AdminRechargeCustomConfig>('/api/admin/recharge-custom-config', {
    method: 'PUT',
    silent: true,
    body: JSON.stringify(params),
  });
}
