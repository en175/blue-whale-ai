/**
 * 页面数据入口。
 *
 * @todo 接真实接口后只改本文件：
 *   - GET /api/usage/token（余额 + 临期批次）
 *   - GET /api/recharge/orders（我的订单）
 *   - GET /api/account/consumptions（积分明细）
 */
import type { AccountCreditsPageData } from './types';

/** @todo 当前返回占位数据，接入接口后删除 PLACEHOLDER_PAGE_DATA 的页面依赖 */
export async function fetchAccountCreditsPage(): Promise<AccountCreditsPageData> {
  // TODO(IKIZNS): 替换为真实请求，保持 AccountCreditsPageData 形状
  return PLACEHOLDER_PAGE_DATA;
}

export const PLACEHOLDER_PAGE_DATA: AccountCreditsPageData = {
  summary: {
    balance: 12345,
    validityYears: 2,
    nearestLot: { remaining: 1200, expiresAt: '2026-12-01' },
  },
  orders: [
    { id: '1', orderedAt: '2026-09-29 14:32', productName: '自定义充值 · 600 积分', tradeNo: 'BW20260929143200801', amountYuan: 40, creditsGranted: 600, status: 'paid' },
    { id: '2', orderedAt: '2026-09-28 10:05', productName: '自定义充值 · 12,000 积分', tradeNo: 'BW20260928100511236', amountYuan: 800, creditsGranted: 12000, status: 'paid' },
    { id: '4', orderedAt: '2026-09-27 20:11', productName: '自定义充值 · 1,500 积分', tradeNo: 'BW20260927201145777', amountYuan: 100, creditsGranted: null, status: 'pending' },
    { id: '5', orderedAt: '2026-09-26 16:44', productName: '自定义充值 · 750 积分', tradeNo: 'BW20260926164420988', amountYuan: 50, creditsGranted: null, status: 'failed' },
    { id: '6', orderedAt: '2026-09-25 11:27', productName: '自定义充值 · 600 积分', tradeNo: 'BW20260925112703345', amountYuan: 40, creditsGranted: null, status: 'expired' },
    { id: '7', orderedAt: '2026-09-24 18:03', productName: '自定义充值 · 2,400 积分', tradeNo: 'BW20260924180355102', amountYuan: 160, creditsGranted: null, status: 'grant_failed' },
  ],
  acquired: [
    { id: 'a1', acquiredAt: '2026-09-29 14:33', source: '充值到账', detail: '自定义充值 600 积分 · 订单 BW…801', effectiveAt: '2026-09-29 14:33', expiresAt: '2028-09-29', credits: 600, remaining: null },
    { id: 'a2', acquiredAt: '2026-09-28 10:07', source: '充值到账', detail: '自定义充值 12,000 积分 · 订单 BW…236', effectiveAt: '2026-09-28 10:07', expiresAt: '2028-09-28', credits: 12000, remaining: null },
    { id: 'a3', acquiredAt: '2024-12-01 09:12', source: '充值到账', detail: '自定义充值 3,000 积分 · 订单 BW…555 · 剩余 1,200', effectiveAt: '2024-12-01 09:12', expiresAt: '2026-12-01', credits: 3000, remaining: 1200 },
  ],
  consumed: [
    { id: 'c1', consumedAt: '2026-09-29 15:02', kind: 'consume', taskType: '视频生成', model: 'seedance-2.5', detail: '1080p 5s', taskId: '9104', credits: 40 },
    { id: 'c2', consumedAt: '2026-12-01 00:00', kind: 'expire', taskType: '过期核销', model: null, detail: '批次到期', taskId: null, credits: 1200 },
  ],
  refunded: [],
};
